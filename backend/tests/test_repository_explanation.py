"""Public, explicitly generated explanations remain bound to a saved analysis."""
import json
import shutil
import sqlite3
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
    assert body['featureSummary']
    assert body['featureSummary'].startswith(('本次分数主要受', '相对保存的基线，'))
    assert '不是缺陷' not in body['featureSummary']
    assert c['client'].get(c['path'], params=c['params']).json() == body
    monkeypatch.setattr(c['catalog'], 'load_model', lambda *_: pytest.fail(
        'saved explanation must not infer',
    ))
    assert c['client'].post(c['path'], params=c['params']).json() == body
    assert c['client'].get(c['path'], params=c['params']).json() == body


# [AI生成]
def test_method_catalog_and_independent_generation_preserve_each_saved_explanation(context, monkeypatch):
    c = context
    root = c['path'].removesuffix('/explanation')
    methods = c['client'].get(
        root + '/explanation-methods', params=c['params'],
    ).json()
    assert methods['modelAvailable'] is True
    assert [item['method'] for item in methods['methods']] == [
        'occlusion-mean-v1',
        'linear-logodds-v1',
    ]
    assert methods['methods'][0]['unit'] == 'probability'
    assert methods['methods'][1]['unit'] == 'logit'
    assert methods['methods'][1]['applicableModels'] == ['logistic-regression']
    assert methods['savedMethods'] == []

    probability = c['client'].post(c['path'], params=c['params']).json()
    assert probability['explanationUnit'] == 'probability'
    assert probability['contributionTotal'] is None
    linear = c['client'].post(
        c['path'],
        params={**c['params'], 'method': 'linear-logodds-v1'},
    ).json()
    assert linear['explanationStatus'] == 'supported', linear
    assert linear['explanationMethod'] == 'linear-logodds-v1'
    assert linear['explanationUnit'] == 'logit'
    assert isinstance(linear['contributionTotal'], float)
    assert linear['stability']['status'] in ('stable', 'unstable')
    assert linear['featureSummary']
    assert 'log-odds' in linear['featureSummary']

    saved = c['client'].get(root + '/explanations', params=c['params']).json()
    assert [item['explanationMethod'] for item in saved['explanations']] == [
        'occlusion-mean-v1',
        'linear-logodds-v1',
    ]
    assert saved['explanations'][0] == probability
    assert saved['explanations'][1] == linear

    monkeypatch.setattr(c['catalog'], 'load_model', lambda *_: pytest.fail(
        'saved explanations must not reload the model',
    ))
    assert c['client'].post(
        c['path'],
        params={**c['params'], 'method': 'linear-logodds-v1'},
    ).json() == linear
    assert c['client'].get(
        c['path'],
        params={**c['params'], 'method': 'linear-logodds-v1'},
    ).json() == linear


# [AI生成]
def test_unknown_explanation_method_is_rejected_without_saving_a_substitute(context):
    c = context
    response = c['client'].post(
        c['path'],
        params={**c['params'], 'method': 'not-a-method'},
    )
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'EXPLANATION_METHOD_UNKNOWN'
    with c['storage'].connection() as db:
        assert db.execute('SELECT count(*) FROM repository_explanation').fetchone()[0] == 0


# [AI生成]
def test_storage_failure_does_not_publish_an_explanation_or_change_risk(context, monkeypatch):
    from jit_baseline.errors import BaselineError

    c = context
    original = c['storage'].connection

    def fail_write(*, write=False):
        if write:
            raise BaselineError('STORAGE_UNAVAILABLE', 'fixture write failure')
        return original(write=write)

    monkeypatch.setattr(c['storage'], 'connection', fail_write)
    response = c['client'].post(c['path'], params=c['params'])
    assert response.status_code == 503
    assert response.json()['error']['code'] == 'STORAGE_UNAVAILABLE'
    monkeypatch.setattr(c['storage'], 'connection', original)
    assert c['service'].sync.commit(c['params']['viewSyncId'], 'a' * 40)['risk'] == c['risk']
    with c['storage'].connection() as db:
        assert db.execute('SELECT count(*) FROM repository_explanation').fetchone()[0] == 0


# [AI生成]
def test_method_catalog_excludes_linear_for_a_decision_tree_model(context):
    from jit_baseline.artifacts import build_run
    from jit_baseline.config import BACKEND

    c = context
    tree_root = c['root'] / 'decision-tree'
    build_run(BACKEND / 'data/openstack', tree_root, algorithm='decision-tree-v1')
    tree = c['catalog'].register_key('decision-tree')['model']
    snapshot, _ = c['catalog'].load_model(tree['modelId'])
    record = c['service'].sync.commit(c['params']['viewSyncId'], 'a' * 40)
    names = snapshot.schema.in_model_names()
    features = [
        record['features']['entropy'] if name == 'ent' else record['features'][name]
        for name in names
    ]
    risk = predict_risks(
        snapshot.model,
        [{'features': features}],
        snapshot.schema,
    )[0]
    with c['storage'].connection(write=True) as db:
        db.execute(
            'UPDATE repository_sync SET model_id=?,run_id=?',
            (tree['modelId'], tree['runId']),
        )
        db.execute('UPDATE repository_commit SET risk=?', (risk,))

    root = c['path'].removesuffix('/explanation')
    methods = c['client'].get(
        root + '/explanation-methods',
        params=c['params'],
    ).json()
    assert [item['method'] for item in methods['methods']] == ['occlusion-mean-v1']
    response = c['client'].post(
        c['path'],
        params={**c['params'], 'method': 'linear-logodds-v1'},
    )
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'EXPLANATION_METHOD_UNSUPPORTED'
    with c['storage'].connection() as db:
        assert db.execute('SELECT count(*) FROM repository_explanation').fetchone()[0] == 0


# [AI生成]
def test_migration_043_preserves_legacy_payloads_and_supports_multiple_methods(tmp_path):
    from jit_baseline.catalog_storage import MIGRATIONS

    database = tmp_path / 'explanation-methods.sqlite3'
    payloads = [
        ('legacy-explicit', '{"explanationMethod":"occlusion-mean-v1","value":1}'),
        ('legacy-default', '{"explanationStatus":"not-supported","value":2}'),
        ('legacy-linear', '{"explanationMethod":"linear-logodds-v1","value":3}'),
    ]
    with sqlite3.connect(database) as db:
        for number, path in MIGRATIONS:
            if number <= 42:
                db.executescript(path.read_text(encoding='utf-8'))
        db.execute("INSERT INTO schema_migration VALUES (42,'fixture')")
        db.execute(
            "INSERT INTO repository_sync(id,repository_url,branch,requested_strategy,status,stage,"
            "created_at,updated_at) VALUES "
            "('sync','https://github.com/example/legacy','main','generic-model','completed',"
            "'completed','fixture','fixture')",
        )
        for commit_id, payload in payloads:
            db.execute(
                "INSERT INTO repository_commit(sync_id,commit_id,epoch,risk,added_lines,"
                "deleted_lines,files,features_json,label) VALUES (?,?,?,?,?,?,?,?,?)",
                ('sync', commit_id, 1, .2, 1, 0, 1, '{}', 0),
            )
            db.execute(
                'INSERT INTO repository_explanation VALUES (?,?,?)',
                ('sync', commit_id, payload),
            )

    storage = CatalogStorage(database)
    storage.initialize()
    storage.initialize()
    with storage.connection() as db:
        rows = db.execute(
            'SELECT commit_id,method,payload_json FROM repository_explanation ORDER BY commit_id',
        ).fetchall()
        assert [tuple(row) for row in rows] == [
            ('legacy-default', 'occlusion-mean-v1', payloads[1][1]),
            ('legacy-explicit', 'occlusion-mean-v1', payloads[0][1]),
            ('legacy-linear', 'linear-logodds-v1', payloads[2][1]),
        ]
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
    with storage.connection(write=True) as db:
        db.execute(
            'INSERT INTO repository_explanation VALUES (?,?,?,?)',
            ('sync', 'legacy-explicit', 'linear-logodds-v1', '{"second":true}'),
        )
    with storage.connection() as db:
        assert db.execute(
            "SELECT count(*) FROM repository_explanation "
            "WHERE sync_id='sync' AND commit_id='legacy-explicit'",
        ).fetchone()[0] == 2


# [AI生成-人工修改]
def test_repository_explanation_matches_published_contract(context):
    from pathlib import Path
    yaml = pytest.importorskip('yaml')
    jsonschema = pytest.importorskip('jsonschema')
    document = yaml.safe_load((Path(__file__).resolve().parents[2] / 'docs/api/openapi.yaml').read_text(encoding='utf-8'))
    endpoint = document['paths']['/api/v1/repositories/{repositoryId}/commits/{commitId}/explanation']
    assert any(p['name'] == 'viewSyncId' and p['required'] for p in endpoint['parameters'])
    assert any(p['name'] == 'method' and p['required'] is False for p in endpoint['parameters'])
    assert endpoint['get']['security'] == endpoint['post']['security'] == []
    validator = jsonschema.Draft202012Validator({'$ref': '#/components/schemas/RepositoryExplanation', 'components': document['components']})
    c = context
    validator.validate(c['client'].get(c['path'], params=c['params']).json())
    validator.validate(c['client'].post(c['path'], params=c['params']).json())
    linear = c['client'].post(
        c['path'],
        params={**c['params'], 'method': 'linear-logodds-v1'},
    ).json()
    validator.validate(linear)
    assert linear['explanationUnit'] == 'logit'
    root = c['path'].removesuffix('/explanation')
    methods_validator = jsonschema.Draft202012Validator({
        '$ref': '#/components/schemas/RepositoryExplanationMethods',
        'components': document['components'],
    })
    methods_validator.validate(c['client'].get(root + '/explanation-methods', params=c['params']).json())
    listing_validator = jsonschema.Draft202012Validator({
        '$ref': '#/components/schemas/RepositoryExplanationList',
        'components': document['components'],
    })
    listing_validator.validate(c['client'].get(root + '/explanations', params=c['params']).json())


# [AI生成-人工修改]
def test_explanation_requires_pinned_analysis_and_rejects_cross_project_context(context):
    c = context
    assert c['client'].post(c['path']).status_code == 422
    assert c['client'].post(c['path'], params={'viewSyncId': str(uuid4())}).status_code == 404
    other, _ = c['service'].create_repository({'repositoryUrl': 'https://github.com/example/other'})
    foreign = c['path'].replace(c['service'].get(c['params']['viewSyncId'])['repositoryId'], other['repositoryId'])
    assert c['client'].post(foreign, params=c['params']).status_code == 404
    root = foreign.removesuffix('/explanation')
    assert c['client'].get(root + '/explanations', params=c['params']).status_code == 404
    assert c['client'].get(root + '/explanation-methods', params=c['params']).status_code == 404


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


def test_partial_model_dataset_baseline_is_declared_and_disabled_model_history_still_works(context, monkeypatch):
    c = context
    from jit_baseline import attribution
    monkeypatch.setattr(attribution, 'training_partition_ids', lambda directory: None)
    version = c['model']['artifactDatasetVersion']
    with c['storage'].connection(write=True) as db:
        db.execute('INSERT INTO dataset_record(dataset_version,dataset_name,manifest_json,manifest_sha256,source_sha256,row_count,created_at) VALUES (?,?,?,?,?,?,?)', (version, 'fixture', '{}', 'fixture', 'fixture', 1, utc_now()))
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
    from jit_baseline import artifacts, collect, store
    from jit_baseline.schemas import resolve
    c = context
    schema = resolve('kamei14-git-v1')
    fields = schema.in_model_names()
    source = tmp_path / 'fourteen.csv'
    records = []
    with source.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(['commit_id', 'author_date', 'bugcount', *fields])
        for index in range(40):
            moment = datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(days=index)
            metrics = dict(ns=1+index%3, nd=2, nf=3, entropy=.7, la=30+index, ld=4, lt=100+index,
                           fix=index%2, ndev=2, age=3, nuc=2+index, exp=7+index, rexp=3, sexp=4)
            writer.writerow([f'{index:040x}', int(moment.timestamp()), index%2, *(metrics[name] for name in fields)])
            records.append({'id': f'{index:040x}', 'epoch': int(moment.timestamp()),
                            'label': index % 2})
    registry = tmp_path / 'model-datasets'
    from label_fixtures import register_labeled
    registered = register_labeled(source, records, schema=schema.name, dataset='explain-git',
                                  root=registry,
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
    assert body['baselineSource'] == 'training-partition-mean' and body['missingBaselineFeatures'] == []


def test_feature_summary_uses_only_supplied_saved_items_and_reuses_chinese_names():
    from jit_baseline.ml import explanations

    summary = explanations.feature_summary([
        {"feature": "nf", "delta": 2.0, "direction": "increases"},
        {"feature": "la", "delta": 1.0, "direction": "increases"},
        {"feature": "ld", "delta": -0.5, "direction": "decreases"},
        {"feature": "ndev", "delta": 0.1, "direction": "increases"},
    ], "probability")
    assert summary == "本次分数主要受文件数、新增行数推高模型分数；删除行数拉低模型分数。"
    assert "参与开发者数" not in summary
    assert "文件数" in summary and "新增行数" in summary and "删除行数" in summary

    unstable = explanations.feature_summary([
        {"feature": "la", "delta": 1.0, "direction": "increases"},
    ], "logit", {"status": "unstable"})
    assert unstable == "相对保存的基线，新增行数推高 log-odds。特征排序不稳定，不作为确定主因。"
    assert explanations.feature_summary([], "probability") is None
