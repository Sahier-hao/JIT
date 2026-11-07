import json
import shutil
import logging
from pathlib import Path

import pytest
from admin_support import AdminTestClient as TestClient

from test_artifacts import real_run  # noqa: F401

HEADERS = {}


@pytest.fixture
def settings(tmp_path, real_run):
    from jit_baseline.catalog_storage import CatalogStorage
    root = tmp_path / 'artifacts'
    shutil.copytree(real_run, root / 'baseline')
    store = CatalogStorage(tmp_path / 'catalog.sqlite3')
    store.initialize()
    return {'directory': real_run, 'database': store.path, 'artifact_root': root,}


def test_training_method_catalog_exposes_schema_and_dependency_status(settings):
    from jit_baseline.api import create_app
    with TestClient(create_app(**settings)) as client:
        body = client.get('/api/v1/training-methods', headers=HEADERS).json()
        assert body['schema'] == 'kamei14-git-v2'
        methods = {item['method']: item for item in body['methods']}
        assert {'logistic-regression-l2-v1', 'decision-tree-v1'} <= set(methods)
        assert methods['logistic-regression-l2-v1']['available'] is True
        assert {'category', 'requires', 'supportedSchema', 'reason'} <= set(methods['decision-tree-v1'])
        assert client.get('/api/v1/training-methods?schema=missing', headers=HEADERS).status_code == 422


def test_admin_register_member_list_and_cli_share_identity(settings, monkeypatch, capsys, caplog):
    from jit_baseline.api import create_app
    from jit_baseline.cli import main
    caplog.set_level(logging.INFO, logger='jit.catalog')
    with TestClient(create_app(**settings)) as client:
        assert client.get('/api/v1/models', headers=HEADERS).json()['models'] == []
        candidate = client.get('/api/v1/model-candidates', headers=HEADERS).json()['candidates'][0]
        data = {'candidateId': candidate['candidateId'], 'expectedManifestSha256': candidate['manifestSha256']}
        first = client.post('/api/v1/models/register', headers=HEADERS, json=data)
        assert first.status_code == 201
        assert first.json()['model']['modelId'] in caplog.text
        assert client.post('/api/v1/models/register', headers=HEADERS, json=data).status_code == 200
        models = client.get('/api/v1/models', headers=HEADERS).json()['models']
        assert len(models) == 1 and models[0]['modelId'] == first.json()['model']['modelId']
        assert str(settings['artifact_root']) not in json.dumps(models)
        monkeypatch.setattr('sys.argv', ['jit', 'register-model', '--run-key', 'baseline',
                             '--database', str(settings['database']),
                             '--artifact-root', str(settings['artifact_root'])])
        main()
        assert json.loads(capsys.readouterr().out)['model']['modelId'] == models[0]['modelId']


def test_admin_model_detail_returns_verified_metrics_and_lineage(settings):
    from fastapi.testclient import TestClient as PublicTestClient
    from jit_baseline.api import create_app

    with TestClient(create_app(**settings)) as client:
        candidate = client.get('/api/v1/model-candidates').json()['candidates'][0]
        registered = client.post('/api/v1/models/register', json={
            'candidateId': candidate['candidateId'],
            'expectedManifestSha256': candidate['manifestSha256'],
        }).json()
        model = registered['model']
        detail = client.get(f"/api/v1/models/{model['modelId']}")
        assert detail.status_code == 200
        body = detail.json()
        assert body['modelId'] == model['modelId']
        assert body['runId'] == model['runId']
        assert body['artifactRunId'] == model['artifactRunId']
        assert body['artifactDatasetVersion']
        assert body['artifactKey'] == 'baseline'
        assert body['metrics']['averagePrecision']['value'] is not None
        assert body['source']['files']
        assert str(settings['artifact_root']) not in detail.text
        (settings['artifact_root'] / 'baseline/model.joblib').unlink()
        unavailable = client.get(f"/api/v1/models/{model['modelId']}")
        assert unavailable.status_code == 503
        assert unavailable.json()['error']['code'] == 'ARTIFACT_UNAVAILABLE'
    with PublicTestClient(create_app(**settings)) as public:
        assert public.get(f"/api/v1/models/{model['modelId']}").status_code == 401


def test_public_model_card_reuses_diagnostics_and_hides_admin_artifacts(settings):
    from fastapi.testclient import TestClient as PublicTestClient
    from jit_baseline.api import create_app

    with TestClient(create_app(**settings)) as client:
        candidate = client.get('/api/v1/model-candidates').json()['candidates'][0]
        registered = client.post('/api/v1/models/register', json={
            'candidateId': candidate['candidateId'],
            'expectedManifestSha256': candidate['manifestSha256'],
        }).json()
        model = registered['model']
    with PublicTestClient(create_app(**settings)) as public:
        response = public.get(f"/api/v1/model-cards/{model['modelId']}")
        assert response.status_code == 200
        card = response.json()
        assert card['available'] is True
        assert card['modelId'] == model['modelId']
        assert card['artifactRunId'] == model['artifactRunId']
        assert card['dataScale']['records'] > 0
        assert set(card['metricsByPartition']) == {'train', 'validation', 'test'}
        assert card['metricsByPartition']['train']['available'] is True
        assert card['metricsByPartition']['test']['metrics']['counts']['records'] > 0
        assert card['benefit']['available'] is False
        assert 'artifactKey' not in card
        assert 'modelSha256' in card and 'datasetSha256' in card
        assert str(settings['artifact_root']) not in response.text
        assert 'sqlite' not in response.text.lower()


def test_old_model_without_supplement_marks_train_and_validation_not_recorded(
        tmp_path, monkeypatch):
    from fastapi.testclient import TestClient as PublicTestClient
    from jit_baseline.api import create_app
    from jit_baseline.catalog_storage import CatalogStorage
    from jit_baseline.config import BACKEND

    root = tmp_path / 'artifacts'
    shutil.copytree(BACKEND / 'artifacts/baseline', root / 'baseline')
    store = CatalogStorage(tmp_path / 'catalog.sqlite3')
    store.initialize()
    monkeypatch.setenv('JIT_MODEL_DIAGNOSTICS_ROOT', str(tmp_path / 'no-diagnostics'))
    settings = {'directory': BACKEND / 'artifacts/baseline',
                'database': store.path, 'artifact_root': root}
    with TestClient(create_app(**settings)) as client:
        candidate = client.get('/api/v1/model-candidates').json()['candidates'][0]
        model = client.post('/api/v1/models/register', json={
            'candidateId': candidate['candidateId'],
            'expectedManifestSha256': candidate['manifestSha256'],
        }).json()['model']
    with PublicTestClient(create_app(**settings)) as public:
        card = public.get(f"/api/v1/model-cards/{model['modelId']}").json()
    assert card['metricsByPartition']['train']['available'] is False
    assert card['metricsByPartition']['validation']['available'] is False
    assert '未记录' in card['metricsByPartition']['train']['reason']
    assert card['metricsByPartition']['test']['available'] is True


def test_old_model_reads_matching_frozen_diagnostic_and_benefit_without_admin_fields(
        tmp_path, monkeypatch):
    from fastapi.testclient import TestClient as PublicTestClient
    from jit_baseline.api import create_app
    from jit_baseline.catalog_storage import CatalogStorage
    from jit_baseline.config import BACKEND
    from jit_baseline.data import sha256

    root = tmp_path / 'artifacts'
    shutil.copytree(BACKEND / 'artifacts/baseline', root / 'baseline')
    model_hash = sha256((root / 'baseline/model.joblib').read_bytes())
    store = CatalogStorage(tmp_path / 'catalog.sqlite3')
    store.initialize()
    settings = {'directory': BACKEND / 'artifacts/baseline',
                'database': store.path, 'artifact_root': root}
    with TestClient(create_app(**settings)) as client:
        candidate = client.get('/api/v1/model-candidates').json()['candidates'][0]
        model = client.post('/api/v1/models/register', json={
            'candidateId': candidate['candidateId'],
            'expectedManifestSha256': candidate['manifestSha256'],
        }).json()['model']
    with PublicTestClient(create_app(**settings)) as public:
        response = public.get(f"/api/v1/model-cards/{model['modelId']}")
        assert response.status_code == 200
        card = response.json()
    assert card['metricsByPartition']['train']['source'] == 'frozen-diagnostic'
    assert card['diagnostics']['available'] is True
    assert card['benefit']['available'] is True
    assert card['benefit']['conclusion']['sentence']
    assert card['modelSha256'] == model_hash
    assert 'artifactKey' not in card and 'artifactPath' not in json.dumps(card)
    assert sha256((root / 'baseline/model.joblib').read_bytes()) == model_hash


def test_public_model_card_marks_broken_artifact_without_fallback(settings):
    from fastapi.testclient import TestClient as PublicTestClient
    from jit_baseline.api import create_app

    with TestClient(create_app(**settings)) as client:
        candidate = client.get('/api/v1/model-candidates').json()['candidates'][0]
        model = client.post('/api/v1/models/register', json={
            'candidateId': candidate['candidateId'],
            'expectedManifestSha256': candidate['manifestSha256'],
        }).json()['model']
    (settings['artifact_root'] / 'baseline/model.joblib').unlink()
    with PublicTestClient(create_app(**settings)) as public:
        response = public.get(f"/api/v1/model-cards/{model['modelId']}")
        card = response.json()
    assert response.status_code == 200
    assert card['available'] is False
    assert card['reason']
    assert 'metricsByPartition' not in card


def _copy_run(source, target, *, run_id=None, schema=None):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target)
    if run_id is not None:
        manifest_path = target / 'manifest.json'
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        manifest['runId'] = run_id
        if schema:
            manifest['config']['schema'] = schema
            manifest['config']['protocol'] = schema
        manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
        summary_path = target / 'summary.json'
        summary = json.loads(summary_path.read_text(encoding='utf-8'))
        summary['runId'] = run_id
        if schema:
            summary['featureSchema']['name'] = schema
        summary_path.write_text(json.dumps(summary), encoding='utf-8')
    return target


def test_experiment_inventory_groups_nested_runs_and_excludes_reports(settings, real_run):
    from jit_baseline.api import create_app

    root = settings['artifact_root']
    baseline = json.loads((root / 'baseline/manifest.json').read_text(encoding='utf-8'))['runId']
    nested = _copy_run(real_run, root / 'suites/demo/logistic-regression-l2-v1')
    _copy_run(real_run, root / 'semantic/semantic-only/logistic-regression-l2-v1',
              run_id='a' * 64, schema='code-semantic-codebert-v1')
    _copy_run(real_run, root / 'suites/benchmark/logistic-regression-l2-v1',
              run_id='b' * 64, schema='kamei14-benchmark-v1')
    invalid = _copy_run(real_run, root / 'experiments/invalid', run_id='c' * 64)
    (invalid / 'model.joblib').unlink()
    (root / 'multi-project/demo').mkdir(parents=True)
    (root / 'multi-project/demo/multi-project-report.json').write_text('{}', encoding='utf-8')
    with TestClient(create_app(**settings)) as client:
        body = client.get('/api/v1/experiment-runs', params={'limit': 100}).json()
        assert body['total'] == 4
        baseline_run = next(item for item in body['runs'] if item['artifactRunId'] == baseline)
        assert len(baseline_run['locations']) == 2
        assert {item['artifactKey'] for item in baseline_run['locations']} == {
            'baseline', 'suites/demo/logistic-regression-l2-v1'}
        assert baseline_run['registrationState'] == 'unregistered'
        assert baseline_run['serviceCompatibility'] == 'repository-analysis'
        assert next(item for item in body['runs'] if item['artifactRunId'] == 'a' * 64)['serviceCompatibility'] == 'input-unsupported'
        assert next(item for item in body['runs'] if item['artifactRunId'] == 'b' * 64)['serviceCompatibility'] == 'offline-only'
        assert next(item for item in body['runs'] if item['artifactRunId'] == 'c' * 64)['artifactState'] == 'invalid'
        assert body['reports'] == [{
            'artifactKey': 'multi-project/demo/multi-project-report.json',
            'registrationEligible': False,
            'reason': '聚合报告不含完整模型产物，不能登记为模型。',
        }]
        filtered = client.get('/api/v1/experiment-runs', params={
            'registrationState': 'unregistered', 'compatibility': 'repository-analysis',
            'artifactState': 'complete'}).json()
        assert filtered['total'] == 1


def test_experiment_promotion_is_nested_idempotent_and_batch_isolated(settings, real_run):
    from jit_baseline.api import create_app
    from fastapi.testclient import TestClient as PublicTestClient

    root = settings['artifact_root']
    _copy_run(real_run, root / 'suites/demo/logistic-regression-l2-v1')
    invalid = _copy_run(real_run, root / 'experiments/invalid', run_id='d' * 64)
    (invalid / 'model.joblib').unlink()
    with TestClient(create_app(**settings)) as client:
        runs = client.get('/api/v1/experiment-runs', params={'limit': 100}).json()['runs']
        baseline = next(item for item in runs if item['artifactRunId'] ==
                        json.loads((root / 'baseline/manifest.json').read_text(encoding='utf-8'))['runId'])
        nested_location = next(item for item in baseline['locations']
                               if item['artifactKey'] == 'suites/demo/logistic-regression-l2-v1')
        top_location = next(item for item in baseline['locations'] if item['artifactKey'] == 'baseline')
        broken_location = next(item for item in runs if item['artifactRunId'] == 'd' * 64)['locations'][0]
        wrong = client.post('/api/v1/experiment-runs/promote', json={'items': [{
            'candidateId': nested_location['candidateId'],
            'expectedManifestSha256': '0' * 64,
        }]}).json()
        assert wrong['items'][0]['status'] == 'failed'
        assert wrong['items'][0]['code'] == 'CONTEXT_MISMATCH'
        response = client.post('/api/v1/experiment-runs/promote', json={'items': [
            {'candidateId': nested_location['candidateId'],
             'expectedManifestSha256': nested_location['manifestSha256']},
            {'candidateId': top_location['candidateId'],
             'expectedManifestSha256': top_location['manifestSha256']},
            {'candidateId': broken_location['candidateId'],
             'expectedManifestSha256': broken_location['manifestSha256']},
        ]})
        assert response.status_code == 200
        results = response.json()['items']
        assert [item['status'] for item in results] == ['registered', 'already-registered', 'failed'], results
        model_id = results[0]['modelId']
        assert model_id == results[1]['modelId']
        models = client.get('/api/v1/models').json()['models']
        assert [(item['modelId'], item['state']) for item in models] == [(model_id, 'ready')]
        assert client.get(f'/api/v1/models/{model_id}').json()['artifactKey'] == 'suites/demo/logistic-regression-l2-v1'
        assert any(item['registrationState'] == 'registered'
                   for item in client.get('/api/v1/experiment-runs').json()['runs'])
    with PublicTestClient(create_app(**settings)) as public:
        assert public.get('/api/v1/experiment-runs').status_code == 401


def test_experiment_paths_reject_traversal_and_links(settings, tmp_path, monkeypatch):
    from jit_baseline.api_errors import RequestError
    from jit_baseline.catalog import ModelCatalog
    from jit_baseline.catalog_storage import CatalogStorage

    catalog = ModelCatalog(CatalogStorage(settings['database']), settings['artifact_root'])
    for value in ('../outside', '/absolute', 'suites/../../outside', 'suites/.hidden'):
        with pytest.raises(RequestError) as error:
            catalog._nested_directory(value)
        assert error.value.code == 'INPUT_INVALID'
    outside = tmp_path / 'outside'
    outside.mkdir()
    link = settings['artifact_root'] / 'linked-experiment'
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        original = Path.is_symlink
        monkeypatch.setattr(Path, 'is_symlink', lambda path: path.name == 'linked-experiment' or original(path))
    with pytest.raises(RequestError) as error:
        catalog._nested_directory('linked-experiment')
    assert error.value.code == 'INPUT_INVALID'


@pytest.mark.parametrize('change,code', [('unknown','NOT_FOUND'), ('changed','CONTEXT_MISMATCH'),
                                      ('path','INPUT_INVALID'), ('broken','INTEGRITY_ERROR')])
def test_register_errors_never_publish_models(settings, change, code):
    from jit_baseline.api import create_app
    with TestClient(create_app(**settings)) as client:
        candidate = client.get('/api/v1/model-candidates', headers=HEADERS).json()['candidates'][0]
        data = {'candidateId': candidate['candidateId'], 'expectedManifestSha256': candidate['manifestSha256']}
        if change == 'unknown':
            data['candidateId'] = '0' * 64
        elif change == 'changed':
            data['expectedManifestSha256'] = '0' * 64
        elif change == 'path':
            data['path'] = str(settings['artifact_root'])
        else:
            (settings['artifact_root'] / 'baseline/model.joblib').write_bytes(b'broken')
        response = client.post('/api/v1/models/register', headers=HEADERS, json=data)
        assert response.json()['error']['code'] == code
        assert response.status_code == {'NOT_FOUND':404,'CONTEXT_MISMATCH':409,'INPUT_INVALID':422,'INTEGRITY_ERROR':503}[code]
        assert client.get('/api/v1/models', headers=HEADERS).json()['models'] == []


def test_kamei_schema_reports_unavailable_fields(settings):
    from jit_baseline.api import create_app
    with TestClient(create_app(**settings)) as client:
        info = client.get('/api/v1/feature-schemas/kamei14-v1', headers=HEADERS).json()
        assert len(info['inModel']) == 12 and info['jsonPredictionSupported'] is False
        assert {f['name'] for f in info['fields'] if not f['inModel']} == {'lt','rexp'}


def test_dataset_and_commit_queries_share_one_registry(settings):
    """数据集与提交查询是只读的：登记事实不存在时返回 404，不构造空响应。"""
    from jit_baseline import datasets
    from jit_baseline.api import create_app
    from jit_baseline.catalog_storage import CatalogStorage

    manifest = datasets.load_all()['openstack-six-v1-2011-11-29_2014-02-28']
    records = [
        {'id': 'c1', 'time': '2012-01-01T00:00:00Z', 'label': 1,
         'metrics': {'la': 1, 'ld': 0, 'nf': 2, 'nd': 1, 'ns': 0, 'ent': 1.5}},
        {'id': 'c2', 'time': '2012-01-02T00:00:00Z', 'label': 0,
         'metrics': {'la': 0, 'ld': 3, 'nf': 1, 'nd': 0, 'ns': 2, 'ent': 0.5}},
    ]
    CatalogStorage(settings['database']).import_dataset(manifest, records)
    with TestClient(create_app(**settings)) as client:
        listing = client.get('/api/v1/datasets', headers=HEADERS)
        assert listing.status_code == 200
        listed = next(item for item in listing.json()['datasets'] if item['dataset'] == 'openstack-six-v1')
        version = listed['versions'][0]
        assert version['source'] == {
            'publisher': manifest['publisher'],
            'url': manifest['url'],
            'revision': manifest['revision'],
            'citation': manifest.get('citation'),
            'branch': None,
            'head': None,
            'window': None,
        }
        assert version['labelRule'] is None
        assert version['limitations'] == []
        versions = client.get('/api/v1/datasets/openstack-six-v1/versions', headers=HEADERS)
        assert [item['version'] for item in versions.json()['versions']] == [manifest['version']]
        assert client.get('/api/v1/datasets/unknown/versions', headers=HEADERS).status_code == 404

        commits = client.get('/api/v1/commits', params={'version': manifest['version']}, headers=HEADERS)
        assert commits.status_code == 200
        body = commits.json()
        assert [item['commitId'] for item in body['commits']] == ['c1', 'c2']
        assert (body['total'], body['limit'], body['offset']) == (2, 100, 0)
        assert body['commits'][0] == {'commitId': 'c1', 'authorTime': '2012-01-01T00:00:00Z',
                                      'label': 1, 'module': None}
        page = client.get('/api/v1/commits', params={'version': manifest['version'], 'limit': 1, 'offset': 1},
                          headers=HEADERS).json()
        assert [item['commitId'] for item in page['commits']] == ['c2'] and page['total'] == 2
        filtered = client.get('/api/v1/commits', params={'version': manifest['version'], 'module': 'absent'},
                              headers=HEADERS).json()
        assert (filtered['total'], filtered['commits']) == (0, [])
        for bad in ({'limit': 0}, {'limit': 501}, {'offset': -1}, {'limit': 'abc'}):
            response = client.get('/api/v1/commits', params={'version': manifest['version'], **bad}, headers=HEADERS)
            assert response.status_code == 422, bad
            assert response.json()['error']['code'] == 'INPUT_INVALID', bad
        detail = client.get('/api/v1/commits/c1', params={'version': manifest['version']}, headers=HEADERS)
        assert detail.json()['label'] == 1 and detail.json()['features']['ent'] == 1.5
        assert client.get('/api/v1/commits/missing', params={'version': manifest['version']},
                          headers=HEADERS).status_code == 404
        assert client.get('/api/v1/commits', params={'version': 'missing'}, headers=HEADERS).status_code == 404
        assert client.get('/api/v1/datasets', headers={'Authorization': 'Bearer wrong'}).status_code == 200


def test_dataset_queries_include_versions_registered_after_startup(settings, tmp_path):
    from jit_baseline import datasets
    from jit_baseline.api import create_app
    from jit_baseline.config import BACKEND

    registry = tmp_path / 'datasets'
    shutil.copytree(BACKEND / 'data' / 'datasets', registry)
    with TestClient(create_app(**settings, dataset_root=registry)) as client:
        registered = datasets.register(
            BACKEND / 'data' / 'openstack' / 'openstack.csv',
            dataset='dynamic-six-v1',
            root=registry,
        )
        versions = client.get('/api/v1/datasets/dynamic-six-v1/versions', headers=HEADERS)
        assert versions.status_code == 200
        assert [item['version'] for item in versions.json()['versions']] == [registered['version']]
        listing = client.get('/api/v1/datasets', headers=HEADERS)
        assert any(item['dataset'] == 'dynamic-six-v1' for item in listing.json()['datasets'])


REAL_DATABASE = Path(__file__).resolve().parents[1] / 'storage' / 'catalog.sqlite3'
REAL_VERSION = 'openstack-six-v1-2011-11-29_2014-02-28'


@pytest.mark.skipif(not REAL_DATABASE.exists(), reason='真实数据集尚未导入')
def test_real_dataset_commits_page_stays_bounded(real_run, tmp_path):
    from jit_baseline.api import create_app
    import sqlite3
    from jit_baseline.catalog_storage import CatalogStorage
    with sqlite3.connect(f'{REAL_DATABASE.as_uri()}?mode=ro', uri=True) as source:
        if source.execute('SELECT 1 FROM dataset_record WHERE dataset_version=?',
                          (REAL_VERSION,)).fetchone() is None:
            pytest.skip('真实数据集尚未导入')
    # Upgrade a snapshot in this test's owned directory, never the developer's live catalog.
    copied = tmp_path / 'real-dataset.sqlite3'
    with sqlite3.connect(f'{REAL_DATABASE.as_uri()}?mode=ro', uri=True) as source:
        with sqlite3.connect(copied) as target:
            source.backup(target)
    storage = CatalogStorage(copied)
    storage.initialize()
    # The snapshot owns only business-data assertions; use an isolated test account.
    with storage.connection(write=True) as db:
        db.execute('DELETE FROM admin_session')
        db.execute('DELETE FROM admin_account')
    options = {'directory': real_run, 'database': copied, 'artifact_root': tmp_path,}
    with TestClient(create_app(**options)) as client:
        response = client.get('/api/v1/commits', params={'version': REAL_VERSION}, headers=HEADERS)
        assert response.status_code == 200
        body = response.json()
        assert (body['total'], body['limit'], body['offset']) == (12374, 100, 0)
        assert len(body['commits']) == 100
        assert set(body['commits'][0]) == {'commitId', 'authorTime', 'label', 'module'}
        assert len(response.content) < 50 * 1024
