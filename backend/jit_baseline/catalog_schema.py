"""Public projection of the existing schema declaration, not a second registry."""
from dataclasses import asdict

from .artifacts import identity
from .schemas import get_schema


def _identity_claims(schema):
    """身份只覆盖实际声明的语义：扩展字段停在默认值时不参与哈希。

    Schema 新增带默认值的可选声明（semantic/semantic_only）会改变 asdict 的形状；若直接入哈希，
    所有早于该声明的投影都会对不上，已登记的产物被判 ARTIFACT_INVALID。字段默认值不是身份的一部分。
    """
    claims = asdict(schema)
    if claims.get('semantic') is None and claims.get('semantic_only') is False:
        claims.pop('semantic', None)
        claims.pop('semantic_only', None)
    return claims


def schema_info(name):
    schema = get_schema(name)
    return {'featureSchemaVersion': schema.name, 'state': 'ready',
            'schemaSha256': identity(_identity_claims(schema)), 'inModel': list(schema.in_model_names()),
            'jsonPredictionSupported': name == 'openstack-six-v1',
            'fields': [{'name': field.name, 'type': 'boolean' if field.binary else
                        'integer' if field.integer else 'number',
                        'unit': '发布者原生单位', 'description': field.reason or field.name,
                        'sourceStatus': 'missing' if field.status == 'unavailable' else 'verified',
                        'inModel': field.in_model, 'sourceColumn': field.source,
                        'transform': field.transform, 'reason': field.reason or None}
                       for field in schema.fields],
            'transforms': [field.transform for field in schema.in_model_fields()],
            'limitations': [field.reason for field in schema.unavailable()]}
