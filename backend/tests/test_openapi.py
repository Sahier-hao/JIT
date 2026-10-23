"""开放接口文档与真实预测响应的契约测试（PEX-07）。

依赖 PyYAML / jsonschema，只在契约工具环境可用（`scripts/requirements-contract.txt`）；
普通测试环境会 skip，不算通过。
"""
import json
from pathlib import Path

import pytest

yaml = pytest.importorskip('yaml')
jsonschema = pytest.importorskip('jsonschema')

from test_catalog_api import HEADERS, settings  # noqa: F401,E402
from test_artifacts import real_run  # noqa: F401,E402

ROOT = Path(__file__).resolve().parents[2]
DOCUMENT = ROOT / 'docs/api/openapi.yaml'


def document():
    return yaml.safe_load(DOCUMENT.read_text(encoding='utf-8'))


def register(client):
    candidate = client.get('/api/v1/model-candidates', headers=HEADERS).json()['candidates'][0]
    return client.post('/api/v1/models/register', headers=HEADERS, json={
        'candidateId': candidate['candidateId'], 'expectedManifestSha256': candidate['manifestSha256']}).json()['model']


def payload(model_id):
    return {'modelId': model_id, 'featureSchemaVersion': 'openstack-six-v1', 'project': 'fixture-project',
            'record': {'recordId': 'openapi-1', 'features': {'ns': 1, 'nd': 2, 'nf': 3, 'ent': .8, 'la': 10, 'ld': 2}}}


def test_prediction_explanation_is_documented():
    schemas = document()['components']['schemas']
    record = schemas['PredictionRecord']
    assert record['properties']['explanationStatus']['enum'] == ['supported', 'not-supported']
    assert {'explanation', 'explanationMethod', 'explanationSummary', 'explanationReason'} <= set(record['properties'])
    assert 'explanationReason' not in record['required']
    assert record['properties']['explanation']['maxItems'] == 5
    explanation = schemas['PredictionExplanation']
    assert set(explanation['required']) == {'feature', 'value', 'baseline', 'delta', 'direction'}
    assert explanation['properties']['direction']['enum'] == ['increases', 'decreases']
    assert explanation['additionalProperties'] is False


def test_supported_explanation_matches_documented_schema(settings):
    from admin_support import AdminTestClient as TestClient
    from jit_baseline.api import create_app
    schema = document()['components']['schemas']['PredictionExplanation']
    validator = jsonschema.Draft202012Validator(schema)
    with TestClient(create_app(**settings)) as client:
        model = register(client)
        response = client.post('/api/v1/predictions', headers=HEADERS, json=payload(model['modelId']))
        assert response.status_code == 201, response.text
        record = response.json()['records'][0]
        assert record['explanationStatus'] == 'supported'
        assert record['explanationMethod']
        assert record['explanationSummary']
        for item in record['explanation']:
            validator.validate(item)


def test_degraded_explanation_keeps_documented_reason(settings, monkeypatch):
    from admin_support import AdminTestClient as TestClient
    from jit_baseline import attribution
    from jit_baseline.api import create_app

    def boom(*_args, **_kwargs):
        raise RuntimeError('fixture attribution failure')
    monkeypatch.setattr(attribution, 'explain', boom)
    with TestClient(create_app(**settings)) as client:
        model = register(client)
        record = client.post('/api/v1/predictions', headers=HEADERS, json=payload(model['modelId'])).json()['records'][0]
        assert record['explanationStatus'] == 'not-supported'
        assert record['explanationReason']
        assert 'explanation' not in record
        assert 'explanation' not in document()['components']['schemas']['PredictionRecord']['required']
