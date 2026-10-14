"""Public projection of the existing schema declaration, not a second registry."""
from dataclasses import asdict

from .artifacts import identity
from .schemas import get_schema


def schema_info(name):
    schema = get_schema(name)
    return {'featureSchemaVersion': schema.name, 'state': 'ready',
            'schemaSha256': identity(asdict(schema)), 'inModel': list(schema.in_model_names()),
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
