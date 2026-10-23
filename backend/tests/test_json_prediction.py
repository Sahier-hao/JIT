import json
import shutil
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest
from admin_support import AdminTestClient as TestClient

from test_catalog_api import settings, HEADERS  # noqa: F401
from test_artifacts import real_run  # noqa: F401


def register(client):
    candidate = client.get('/api/v1/model-candidates', headers=HEADERS).json()['candidates'][0]
    return client.post('/api/v1/models/register', headers=HEADERS, json={
        'candidateId': candidate['candidateId'], 'expectedManifestSha256': candidate['manifestSha256']}).json()['model']


def payload(model_id):
    return {'modelId': model_id, 'featureSchemaVersion': 'openstack-six-v1', 'project': 'fixture-project',
            'record': {'recordId': 'input-1', 'features': {'ns': 1, 'nd': 2, 'nf': 3, 'ent': .8, 'la': 10, 'ld': 2}}}


def test_real_single_prediction_persists_and_reopens_after_model_removed(settings):
    from jit_baseline.api import create_app
    app = create_app(**settings)
    with TestClient(app) as client:
        model = register(client)
        body = payload(model['modelId'])
        response = client.post('/api/v1/predictions', headers=HEADERS, json=body)
        assert response.status_code == 201
        saved = response.json()
        assert saved['mode'] == 'feature-input' and saved['sourceKind'] == 'client-features'
        assert saved['model']['artifactRunId'] == model['artifactRunId']
        record_saved = saved['records'][0]
        assert record_saved['explanationStatus'] == 'supported'
        assert record_saved['explanationMethod'] == 'occlusion-mean-v1'
        assert record_saved['explanation'] and len(record_saved['explanation']) <= 5
        assert record_saved['explanationSummary']
        assert any('基线' in note for note in saved['limitations'])
        assert record_saved['time'] is None and record_saved['commitId'] is None
        repeated = client.post('/api/v1/predictions', headers=HEADERS, json=body).json()
        assert repeated['batchId'] != saved['batchId']
        assert repeated['inputSha256'] == saved['inputSha256']
        (settings['artifact_root'] / 'baseline/model.joblib').unlink()
        assert client.post('/api/v1/predictions', headers=HEADERS, json=body).status_code == 503
    with TestClient(create_app(**settings)) as client:
        assert client.get('/api/v1/prediction-batches/' + saved['batchId'], headers=HEADERS).json() == saved
        assert client.get('/api/v1/prediction-batches/' + str(uuid4()), headers=HEADERS).status_code == 404


def test_explanation_survives_reload_and_failure_degrades(settings, monkeypatch):
    """PEX-04/05：解释随批次保存并可重开；归因失败只降级解释，不改变风险。"""
    from jit_baseline import attribution
    from jit_baseline.api import create_app
    app = create_app(**settings)
    with TestClient(app) as client:
        model = register(client)
        body = payload(model['modelId'])
        saved = client.post('/api/v1/predictions', headers=HEADERS, json=body).json()
        record = saved['records'][0]
        assert record['explanationStatus'] == 'supported'
        assert record['explanationMethod'] == attribution.METHOD
        assert record['explanation'] and isinstance(record['explanation'], list)
        reopened = client.get('/api/v1/prediction-batches/' + saved['batchId'], headers=HEADERS).json()
        assert reopened == saved and reopened['records'][0]['explanation'] == record['explanation']

        def boom(*_args, **_kwargs):
            raise RuntimeError('fixture attribution failure')
        monkeypatch.setattr(attribution, 'explain', boom)
        degraded = client.post('/api/v1/predictions', headers=HEADERS, json=body).json()
        fallback = degraded['records'][0]
        assert fallback['explanationStatus'] == 'not-supported'
        assert fallback['explanationReason']
        assert 'explanation' not in fallback and 'explanationMethod' not in fallback
        assert 0 <= fallback['risk'] <= 1
        assert any('预测解释' in note for note in degraded['limitations'])


@pytest.mark.parametrize('bad', ['missing', 'extra', 'label', 'bool', 'fraction', 'string',
                                'negative', 'time', 'schema', 'array', 'infinity', 'huge', 'malformed', 'duplicate'])
def test_strict_input_rejected_without_rows(settings, bad):
    from jit_baseline.api import create_app
    app = create_app(**settings)
    with TestClient(app) as client:
        model = register(client)
        body = payload(model['modelId'])
        features = body['record']['features']
        if bad == 'missing':
            del features['ns']
        elif bad == 'extra':
            features['unexpected'] = 1
        elif bad == 'label':
            body['record']['label'] = 1
        elif bad in ('bool','fraction','string','negative','huge'):
            features['ns'] = {'bool':True,'fraction':1.5,'string':'1','negative':-1,'huge':10**400}[bad]
        elif bad == 'time':
            body['record']['time'] = '2026-10-14T12:00:00'
        elif bad == 'schema':
            body['featureSchemaVersion'] = 'kamei14-v1'
        elif bad == 'array':
            body['record'] = [body['record']]
        raw = json.dumps(body)
        if bad == 'infinity':
            raw = raw.replace('0.8', 'Infinity')
        elif bad == 'malformed':
            raw = '{'
        elif bad == 'duplicate':
            raw = raw.replace('"ns": 1', '"ns": 1, "ns": 2')
        response = client.post('/api/v1/predictions', headers=HEADERS, content=raw)
        assert response.status_code == 422
        assert response.json()['error']['code'] in ('INPUT_INVALID','INPUT_SCHEMA_MISMATCH')
        with app.state.catalog.store.connection() as db:
            assert db.execute('SELECT count(*) FROM prediction_batch').fetchone()[0] == 0


def test_size_limit_counts_actual_bytes_not_content_length(settings):
    from jit_baseline.api import create_app
    with TestClient(create_app(**settings)) as client:
        response = client.post('/api/v1/predictions', headers=dict(HEADERS, **{'Content-Length':'1'}),
                               content=b' ' * (64 * 1024 + 1))
        assert response.status_code == 413


@pytest.mark.parametrize('bad', ['exception', 'nan', 'range', 'count'])
def test_inference_errors_are_500_without_saved_risk(settings, monkeypatch, bad):
    from jit_baseline.api import create_app
    app = create_app(**settings)
    with TestClient(app) as client:
        model = register(client)
        snapshot, descriptor = app.state.catalog.load_model(model['modelId'])
        def fail(_):
            if bad == 'exception':
                raise RuntimeError('private detail must not leak')
            return np.array([[.5, float('nan') if bad == 'nan' else 2 if bad == 'range' else .5]])[:0 if bad == 'count' else 1]
        monkeypatch.setattr(snapshot.model, 'predict_proba', fail)
        monkeypatch.setattr(app.state.catalog, 'load_model', lambda _: (snapshot, descriptor))
        response = client.post('/api/v1/predictions', headers=HEADERS, json=payload(model['modelId']))
        assert response.status_code == 500
        assert response.json()['error']['code'] == 'INFERENCE_ERROR'
        assert 'private' not in response.text and 'risk' not in response.text


def test_two_methods_use_raw_features_without_labels_or_refitting(settings, monkeypatch):
    from jit_baseline.api import create_app
    from jit_baseline.artifacts import build_run
    from jit_baseline.config import BACKEND
    from sklearn.pipeline import Pipeline
    root = settings['artifact_root']
    build_run(BACKEND / 'data/openstack', root / 'decision-tree', algorithm='decision-tree-v1')
    app = create_app(**settings)
    with TestClient(app) as client:
        candidates = client.get('/api/v1/model-candidates', headers=HEADERS).json()['candidates']
        models = [client.post('/api/v1/models/register', headers=HEADERS, json={
            'candidateId': c['candidateId'], 'expectedManifestSha256': c['manifestSha256']}).json()['model'] for c in candidates]
        expected = {}
        inputs = {}
        for c, model in zip(candidates, models):
            directory = root / c['displayName']
            row = json.loads((directory / 'test-input.json').read_text(encoding='utf-8'))['records'][0]
            expected[model['modelId']] = json.loads((directory / 'reference-predictions.json').read_text(encoding='utf-8'))[0]['risk']
            inputs[model['modelId']] = row['metrics']
        read_text, read_bytes = Path.read_text, Path.read_bytes
        def allowed_text(path, *a, **kw):
            assert path.name not in ('test-labels.json','reference-predictions.json')
            return read_text(path, *a, **kw)
        def allowed_bytes(path, *a, **kw):
            assert path.name not in ('test-labels.json','reference-predictions.json')
            return read_bytes(path, *a, **kw)
        monkeypatch.setattr(Path, 'read_text', allowed_text)
        monkeypatch.setattr(Path, 'read_bytes', allowed_bytes)
        monkeypatch.setattr(Pipeline, 'fit', lambda *a, **kw: pytest.fail('Prediction must not fit'))
        for model in models:
            body = payload(model['modelId'])
            body['record']['features'] = inputs[model['modelId']]
            saved = client.post('/api/v1/predictions', headers=HEADERS, json=body).json()
            assert saved['records'][0]['risk'] == pytest.approx(expected[model['modelId']], abs=model['reproducibility']['atol'])
            body['record']['features'] = dict(reversed(list(body['record']['features'].items())))
            reordered = client.post('/api/v1/predictions', headers=HEADERS, json=body).json()
            assert reordered['inputSha256'] == saved['inputSha256']
            assert reordered['records'][0]['risk'] == saved['records'][0]['risk']


def test_second_insert_failure_rolls_back_and_no_risk_returned(settings):
    from jit_baseline.api import create_app
    app = create_app(**settings)
    with TestClient(app) as client:
        model = register(client)
        with app.state.catalog.store.connection(write=True) as db:
            db.execute("CREATE TRIGGER reject_prediction BEFORE INSERT ON prediction BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END")
        response = client.post('/api/v1/predictions', headers=HEADERS, json=payload(model['modelId']))
        assert response.status_code == 503 and 'risk' not in response.text
        assert response.json()['error']['code'] == 'STORAGE_UNAVAILABLE'
        with app.state.catalog.store.connection() as db:
            assert db.execute('SELECT count(*) FROM prediction_batch').fetchone()[0] == 0


def test_unknown_model_metadata_normalization_and_storage_unavailable(settings):
    from jit_baseline.api import create_app
    app = create_app(**settings)
    with TestClient(app) as client:
        missing = client.post('/api/v1/predictions', headers=HEADERS, json=payload(str(uuid4())))
        assert missing.status_code == 404 and missing.json()['error']['code'] == 'NOT_FOUND'
        model = register(client)
        body = payload(model['modelId'])
        body['record'].update(time='2026-10-14T18:00:00+08:00', commitId='A' * 40)
        saved = client.post('/api/v1/predictions', headers=HEADERS, json=body).json()
        assert saved['records'][0]['time'] == '2026-10-14T10:00:00Z'
        assert saved['records'][0]['commitId'] == 'a' * 40
        with app.state.catalog.store.connection(write=True) as db:
            db.execute('UPDATE schema_migration SET version=99')
        response = client.get('/api/v1/prediction-batches/'+saved['batchId'], headers=HEADERS)
        assert response.status_code == 503 and response.json()['error']['code'] == 'STORAGE_UNAVAILABLE'


DATASET_VERSION = 'openstack-six-v1-2011-11-29_2014-02-28'
STORED_COMMIT = 'a' * 40
PARTIAL_COMMIT = 'b' * 40
STORED_FEATURES = {'la': 10, 'ld': 2, 'nf': 3, 'nd': 2, 'ns': 1, 'ent': 0.8}


def seed_commit(settings):
    from jit_baseline import datasets
    from jit_baseline.catalog_storage import CatalogStorage
    manifest = datasets.load_all()[DATASET_VERSION]
    CatalogStorage(settings['database']).import_dataset(manifest, [
        {'id': STORED_COMMIT, 'time': '2012-01-01T00:00:00Z', 'label': 1, 'metrics': dict(STORED_FEATURES)}])
    return DATASET_VERSION


def persisted_payload(model_id, version, commit_id=STORED_COMMIT):
    return {'modelId': model_id, 'featureSchemaVersion': 'openstack-six-v1', 'project': 'fixture-project',
            'datasetVersion': version, 'record': {'recordId': 'backend:' + commit_id, 'commitId': commit_id}}


def test_persisted_commit_prediction_uses_stored_features_and_reopens(settings):
    from jit_baseline.api import create_app
    version = seed_commit(settings)
    with TestClient(create_app(**settings)) as client:
        model = register(client)
        response = client.post('/api/v1/predictions', headers=HEADERS,
                               json=persisted_payload(model['modelId'], version))
        assert response.status_code == 201, response.text
        saved = response.json()
        assert saved['mode'] == 'persisted-commit' and saved['sourceKind'] == 'persisted-commit'
        assert saved['datasetVersion'] == version
        assert saved['records'][0]['features'] == STORED_FEATURES
        assert saved['records'][0]['commitId'] == STORED_COMMIT
        assert saved['limitations'][0] == '特征来自已导入的提交数据，尚未核验真实标签。'
        assert client.get('/api/v1/prediction-batches/' + saved['batchId'], headers=HEADERS).json() == saved
        absent = persisted_payload(model['modelId'], version, '0' * 40)
        assert client.post('/api/v1/predictions', headers=HEADERS, json=absent).status_code == 404
        unknown = persisted_payload(model['modelId'], 'unknown-version')
        assert client.post('/api/v1/predictions', headers=HEADERS, json=unknown).status_code == 404


@pytest.mark.parametrize('change', ['both', 'neither', 'no-dataset', 'no-commit'])
def test_prediction_source_must_be_exactly_one(settings, change):
    from jit_baseline.api import create_app
    version = seed_commit(settings)
    with TestClient(create_app(**settings)) as client:
        model = register(client)
        body = {'modelId': model['modelId'], 'featureSchemaVersion': 'openstack-six-v1',
                'project': 'fixture-project', 'record': {'recordId': 'input-1'}}
        if change == 'both':
            body['datasetVersion'] = version
            body['record'] = {'recordId': 'input-1', 'commitId': STORED_COMMIT, 'features': dict(STORED_FEATURES)}
        elif change == 'no-dataset':
            body['record'] = {'recordId': 'input-1', 'commitId': STORED_COMMIT}
        elif change == 'no-commit':
            body['datasetVersion'] = version
        response = client.post('/api/v1/predictions', headers=HEADERS, json=body)
        assert response.status_code == 422, (change, response.text)
        assert response.json()['error']['code'] == 'INPUT_INVALID'


def test_persisted_commit_with_incomplete_features_is_rejected(settings):
    from jit_baseline.api import create_app
    from jit_baseline.catalog_storage import CatalogStorage
    store = CatalogStorage(settings['database'])
    with store.connection(write=True) as db:
        db.execute("INSERT INTO dataset_record VALUES ('broken-v1','demo','{}','m','s',1,'2026-01-01T00:00:00Z')")
        db.execute('INSERT INTO commit_record VALUES (?,?,?,?,?)',
                   ('broken-v1', PARTIAL_COMMIT, '2012-01-01T00:00:00Z', 0, 'r'))
        db.execute('INSERT INTO feature_record VALUES (?,?,?,?)', ('broken-v1', PARTIAL_COMMIT, 'ns', '1'))
    with TestClient(create_app(**settings)) as client:
        model = register(client)
        response = client.post('/api/v1/predictions', headers=HEADERS,
                               json=persisted_payload(model['modelId'], 'broken-v1', PARTIAL_COMMIT))
        assert response.status_code == 422, response.text
        assert response.json()['error']['code'] == 'INPUT_SCHEMA_MISMATCH'

LEGACY_BATCH = '00000000-0000-4000-8000-000000000001'


def test_legacy_batch_without_explanation_reopens_unchanged(settings, monkeypatch):
    """PEX-04：历史批次没有解释字段，重开时原样返回且不触发推理。"""
    from jit_baseline.api import create_app
    from jit_baseline.catalog import encoded
    app = create_app(**settings)
    with TestClient(app) as client:
        model = register(client)
        legacy = {'mode': 'feature-input', 'sourceKind': 'client-features', 'batchId': LEGACY_BATCH,
                  'datasetVersion': DATASET_VERSION, 'project': 'fixture-project', 'runId': model['runId'],
                  'model': model, 'featureSchemaVersion': 'openstack-six-v1', 'inputSha256': '0' * 64,
                  'createdAt': '2026-01-01T00:00:00Z',
                  'records': [{'predictionId': '00000000-0000-4000-8000-000000000002', 'recordId': 'legacy',
                               'features': STORED_FEATURES, 'risk': 0.5,
                               'explanationStatus': 'not-supported',
                               'explanationReason': '该模型的真实预测解释尚未接入'}],
                  'limitations': ['本轮未提供真实预测解释或代码定位。']}
        with app.state.catalog.store.connection(write=True) as db:
            db.execute('INSERT INTO prediction_batch VALUES (?,?,?,?)',
                       (LEGACY_BATCH, model['modelId'], encoded(legacy), '2026-01-01T00:00:00Z'))
            db.execute('INSERT INTO prediction VALUES (?,?,?,?,?)',
                       ('00000000-0000-4000-8000-000000000002', LEGACY_BATCH, 'legacy', 0.5,
                        encoded(STORED_FEATURES)))
        import jit_baseline.prediction as module
        monkeypatch.setattr(module, 'predict_risks', pytest.fail)
        response = client.get('/api/v1/prediction-batches/' + LEGACY_BATCH, headers=HEADERS)
        assert response.status_code == 200, response.text
        assert response.json() == legacy
        assert 'explanation' not in response.json()['records'][0]
        assert response.json()['records'][0]['explanationStatus'] == 'not-supported'
