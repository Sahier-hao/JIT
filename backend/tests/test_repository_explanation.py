"""Public, explicitly generated explanations remain bound to a saved analysis."""
import json
import shutil
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from test_artifacts import real_run  # noqa: F401
from jit_baseline.catalog_storage import CatalogStorage, utc_now
from jit_baseline.catalog import ModelCatalog
from jit_baseline.sync import SyncService
from jit_baseline.model import predict_risks


@pytest.fixture
def context(tmp_path, real_run):
    from jit_baseline.api import create_app
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    root = tmp_path / 'artifacts'
    shutil.copytree(real_run, root / 'baseline')
    catalog = ModelCatalog(storage, root)
    model = catalog.register_key('baseline')['model']
    snapshot, _ = catalog.load_model(model['modelId'])
    metrics = dict(ns=1, nd=2, nf=3, entropy=.7, la=30, ld=4, lt=100,
                   fix=0, ndev=2, age=3, nuc=2, exp=7, rexp=3, sexp=4)
    risk = predict_risks(snapshot.model, [{'features': [1, 2, 3, .7, 30, 4]}], snapshot.schema)[0]
    service = SyncService(storage, catalog, artifact_root=root, dataset_root=tmp_path / 'datasets')
    app = create_app(database=storage.path, artifact_root=root, sync_service=service)
    repo, _ = service.create_repository({'repositoryUrl': 'https://github.com/example/explanation'})
    sync_id = str(uuid4())
    service.sync.create(dict(id=sync_id, repository_url=repo['url'], repository_id=repo['repositoryId'],
        branch='main', requested_strategy='generic-model', status='scoring', stage='scoring',
        model_strategy='generic-model', created_at=utc_now(), updated_at=utc_now()))
    service.sync.complete(sync_id, repo['repositoryId'], [dict(id='a'*40, epoch=1700000000,
        risk=risk, addedLines=30, deletedLines=4, files=3, features=metrics, label=0)],
        head_commit='b'*40, dataset_version='collected-fixture-v1', run_id=model['runId'], model_id=model['modelId'])
    path = f"/api/v1/repositories/{repo['repositoryId']}/commits/{'a'*40}/explanation"
    with TestClient(app) as client:
        yield dict(client=client, service=service, catalog=app.state.catalog, storage=storage,
                   path=path, params={'viewSyncId': sync_id}, model=model, risk=risk, root=root)
    service.close()


def test_read_does_not_infer_and_explicit_generation_saves_exact_model_explanation(context, monkeypatch):
    c = context
    monkeypatch.setattr(c['catalog'], 'default_model_id', lambda: pytest.fail('must not load current default'))
    before = c['client'].get(c['path'], params=c['params'])
    assert before.status_code == 200
    assert before.json()['explanationStatus'] == 'not-generated'
    generated = c['client'].post(c['path'], params=c['params'])
    assert generated.status_code == 200, generated.text
    body = generated.json()
    assert body['explanationStatus'] == 'supported', body
    assert body['modelId'] == c['model']['modelId'] and body['runId'] == c['model']['runId']
    assert body['risk'] == c['risk']
    assert body['baselineSource'] == 'zero' and body['limitations']
    assert 0 < len(body['explanation']) <= 5
    assert all(item['feature'] in ('ns', 'nd', 'nf', 'ent', 'la', 'ld') for item in body['explanation'])
    assert c['client'].get(c['path'], params=c['params']).json() == body
    monkeypatch.setattr(c['catalog'], 'load_model', lambda *_: pytest.fail('saved explanation must not infer'))
    assert c['client'].post(c['path'], params=c['params']).json() == body
    assert c['client'].get(c['path'], params=c['params']).json() == body


def test_repository_explanation_matches_published_contract(context):
    from pathlib import Path
    yaml = pytest.importorskip('yaml')
    jsonschema = pytest.importorskip('jsonschema')
    document = yaml.safe_load((Path(__file__).resolve().parents[2] / 'docs/api/openapi.yaml').read_text(encoding='utf-8'))
    endpoint = document['paths']['/api/v1/repositories/{repositoryId}/commits/{commitId}/explanation']
    assert any(p['name'] == 'viewSyncId' and p['required'] for p in endpoint['parameters'])
    assert endpoint['get']['security'] == endpoint['post']['security'] == []
    validator = jsonschema.Draft202012Validator({'$ref': '#/components/schemas/RepositoryExplanation', 'components': document['components']})
    c = context
    validator.validate(c['client'].get(c['path'], params=c['params']).json())
    validator.validate(c['client'].post(c['path'], params=c['params']).json())


def test_explanation_requires_pinned_analysis_and_rejects_cross_project_context(context):
    c = context
    assert c['client'].post(c['path']).status_code == 422
    assert c['client'].post(c['path'], params={'viewSyncId': str(uuid4())}).status_code == 404
    other, _ = c['service'].create_repository({'repositoryUrl': 'https://github.com/example/other'})
    foreign = c['path'].replace(c['service'].get(c['params']['viewSyncId'])['repositoryId'], other['repositoryId'])
    assert c['client'].post(foreign, params=c['params']).status_code == 404


def test_mismatched_saved_score_is_not_explained_with_a_new_prediction(context):
    c = context
    with c['storage'].connection(write=True) as db:
        db.execute('UPDATE repository_commit SET risk=?', (0 if c['risk'] > .5 else 1,))
    response = c['client'].post(c['path'], params=c['params'])
    assert response.status_code == 200
    body = response.json()
    assert body['explanationStatus'] == 'not-supported'
    assert body['reasonCode'] == 'SCORE_MISMATCH'
    assert body['explanation'] == []


def test_model_failure_keeps_saved_risk_and_can_be_retried_after_restoration(context):
    c = context
    model_file = c['root'] / 'baseline/model.joblib'
    original = model_file.read_bytes()
    model_file.write_bytes(b'corrupt-copy')
    body = c['client'].post(c['path'], params=c['params']).json()
    assert body['explanationStatus'] == 'not-supported'
    assert body['risk'] == c['risk'] and body['explanationReason']
    model_file.write_bytes(original)
    c['catalog'].register_key('baseline')
    recovered = c['client'].post(c['path'], params=c['params']).json()
    assert recovered['explanationStatus'] == 'supported'


def test_simultaneous_generation_is_one_saved_fact_and_deletion_cleans_it(context):
    c = context
    def generate(_):
        return c['client'].post(c['path'], params=c['params']).json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = list(pool.map(generate, range(2)))
    assert first == second and first['explanationStatus'] == 'supported'
    with c['storage'].connection() as db:
        assert db.execute('SELECT count(*) FROM repository_explanation').fetchone()[0] == 1
    c['service'].delete_sync(c['params']['viewSyncId'])
    with c['storage'].connection() as db:
        assert db.execute('SELECT count(*) FROM repository_explanation').fetchone()[0] == 0


def test_explanation_error_is_saved_without_modifying_original_score(context, monkeypatch):
    from jit_baseline import attribution
    c = context
    def fail(*_args, **_kwargs):
        raise RuntimeError('private diagnostic must not reach response')
    monkeypatch.setattr(attribution, 'explain', fail)
    body = c['client'].post(c['path'], params=c['params']).json()
    assert body['explanationStatus'] == 'not-supported'
    assert body['reasonCode'] == 'EXPLANATION_FAILED'
    assert 'private diagnostic' not in json.dumps(body)
    assert c['service'].sync.commit(c['params']['viewSyncId'], 'a'*40)['risk'] == c['risk']


@pytest.mark.parametrize('problem,reason', [('run', 'MODEL_CONTEXT_MISMATCH'), ('features', 'FEATURES_INVALID')])
def test_incomplete_features_and_wrong_run_never_generate_substitute_explanations(context, problem, reason):
    c = context
    with c['storage'].connection(write=True) as db:
        if problem == 'run':
            db.execute("UPDATE repository_sync SET run_id='wrong-run'")
        else:
            db.execute("UPDATE repository_commit SET features_json='{}'")
    assert c['client'].post(c['path'], params=c['params']).json()['reasonCode'] == reason


def test_partial_model_dataset_baseline_is_declared_and_disabled_model_history_still_works(context):
    c = context
    version = c['model']['artifactDatasetVersion']
    with c['storage'].connection(write=True) as db:
        db.execute('INSERT INTO dataset_record VALUES (?,?,?,?,?,?,?)', (version, 'fixture', '{}', 'fixture', 'fixture', 1, utc_now()))
        db.execute('INSERT INTO commit_record VALUES (?,?,?,?,?)', (version, 'baseline-fixture', utc_now(), 0, 'fixture'))
        db.execute('INSERT INTO feature_record VALUES (?,?,?,?)', (version, 'baseline-fixture', 'ns', '2'))
        db.execute('UPDATE model_policy SET enabled=0 WHERE model_id=?', (c['model']['modelId'],))
    result = c['client'].post(c['path'], params=c['params']).json()
    assert result['explanationStatus'] == 'supported'
    assert result['baselineSource'] == 'mixed' and result['baselineDatasetVersion'] == version
    assert 'ns' not in result['missingBaselineFeatures'] and 'ent' in result['missingBaselineFeatures']


def test_trained_analysis_artifact_run_reference_is_preserved(context):
    c = context
    artifact_run = c['model']['artifactRunId']
    with c['storage'].connection(write=True) as db:
        db.execute('UPDATE repository_sync SET run_id=?', (artifact_run,))
    result = c['client'].post(c['path'], params=c['params']).json()
    assert result['explanationStatus'] == 'supported' and result['runId'] == artifact_run


def test_real_registered_fourteen_field_model_uses_its_own_dataset_baseline(context, tmp_path):
    import csv
    from datetime import datetime, timedelta, timezone
    from jit_baseline import artifacts, collect, datasets, store
    from jit_baseline.schemas import resolve
    c = context
    schema = resolve('kamei14-git-v1')
    fields = schema.in_model_names()
    source = tmp_path / 'fourteen.csv'
    with source.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(['commit_id', 'author_date', 'bugcount', *fields])
        for index in range(40):
            moment = datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(days=index)
            metrics = dict(ns=1+index%3, nd=2, nf=3, entropy=.7, la=30+index, ld=4, lt=100+index,
                           fix=index%2, ndev=2, age=3, nuc=2+index, exp=7+index, rexp=3, sexp=4)
            writer.writerow([f'{index:040x}', int(moment.timestamp()), index%2, *(metrics[name] for name in fields)])
    registry = tmp_path / 'model-datasets'
    registered = datasets.register(source, schema=schema.name, dataset='explain-git', root=registry,
                                   cohort=collect.cohort('2024-01-01', '2025-01-01'))
    manifest = registry / 'explain-git' / (registered['version'] + '.json')
    artifacts.build_run(tmp_path / 'source', c['root'] / 'fourteen', schema=schema.name, dataset_manifest=manifest)
    model = c['catalog'].register_key('fourteen')['model']
    store.import_dataset(source, manifest, c['storage'])
    snapshot, _ = c['catalog'].load_model(model['modelId'])
    record = c['service'].sync.commit(c['params']['viewSyncId'], 'a'*40)
    risk = predict_risks(snapshot.model, [{'features': [record['features'][name] for name in fields]}], schema)[0]
    with c['storage'].connection(write=True) as db:
        db.execute('UPDATE repository_sync SET model_id=?,run_id=?', (model['modelId'], model['runId']))
        db.execute('UPDATE repository_commit SET risk=?', (risk,))
    body = c['client'].post(c['path'], params=c['params']).json()
    assert body['explanationStatus'] == 'supported', body
    assert body['featureSchemaVersion'] == schema.name and body['modelId'] == model['modelId']
    assert body['baselineSource'] == 'model-dataset-mean' and body['missingBaselineFeatures'] == []
