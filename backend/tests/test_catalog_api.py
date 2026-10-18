import json
import shutil
import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from test_artifacts import real_run  # noqa: F401

ADMIN = {'Authorization': 'Bearer fixture-admin'}
MEMBER = {'Authorization': 'Bearer fixture-member'}


@pytest.fixture
def settings(tmp_path, real_run):
    from jit_baseline.catalog_storage import CatalogStorage
    root = tmp_path / 'artifacts'
    shutil.copytree(real_run, root / 'baseline')
    store = CatalogStorage(tmp_path / 'catalog.sqlite3')
    store.initialize()
    return {'directory': real_run, 'database': store.path, 'artifact_root': root,
            'member_token': 'fixture-member', 'admin_token': 'fixture-admin'}


def test_admin_register_member_list_and_cli_share_identity(settings, monkeypatch, capsys, caplog):
    from jit_baseline.api import create_app
    from jit_baseline.cli import main
    caplog.set_level(logging.INFO, logger='jit.catalog')
    with TestClient(create_app(**settings)) as client:
        assert client.get('/api/v1/models', headers=MEMBER).json() == {'models': []}
        candidate = client.get('/api/v1/model-candidates', headers=ADMIN).json()['candidates'][0]
        data = {'candidateId': candidate['candidateId'], 'expectedManifestSha256': candidate['manifestSha256']}
        first = client.post('/api/v1/models/register', headers=ADMIN, json=data)
        assert first.status_code == 201
        assert first.json()['model']['modelId'] in caplog.text
        assert client.post('/api/v1/models/register', headers=ADMIN, json=data).status_code == 200
        models = client.get('/api/v1/models', headers=MEMBER).json()['models']
        assert len(models) == 1 and models[0]['modelId'] == first.json()['model']['modelId']
        assert str(settings['artifact_root']) not in json.dumps(models)
        monkeypatch.setattr('sys.argv', ['jit', 'register-model', '--run-key', 'baseline',
                             '--database', str(settings['database']),
                             '--artifact-root', str(settings['artifact_root'])])
        main()
        assert json.loads(capsys.readouterr().out)['model']['modelId'] == models[0]['modelId']


@pytest.mark.parametrize('change,code', [('unknown','NOT_FOUND'), ('changed','CONTEXT_MISMATCH'),
                                      ('path','INPUT_INVALID'), ('broken','INTEGRITY_ERROR')])
def test_register_errors_never_publish_models(settings, change, code):
    from jit_baseline.api import create_app
    with TestClient(create_app(**settings)) as client:
        candidate = client.get('/api/v1/model-candidates', headers=ADMIN).json()['candidates'][0]
        data = {'candidateId': candidate['candidateId'], 'expectedManifestSha256': candidate['manifestSha256']}
        if change == 'unknown':
            data['candidateId'] = '0' * 64
        elif change == 'changed':
            data['expectedManifestSha256'] = '0' * 64
        elif change == 'path':
            data['path'] = str(settings['artifact_root'])
        else:
            (settings['artifact_root'] / 'baseline/model.joblib').write_bytes(b'broken')
        response = client.post('/api/v1/models/register', headers=ADMIN, json=data)
        assert response.json()['error']['code'] == code
        assert response.status_code == {'NOT_FOUND':404,'CONTEXT_MISMATCH':409,'INPUT_INVALID':422,'INTEGRITY_ERROR':503}[code]
        assert client.get('/api/v1/models', headers=MEMBER).json() == {'models': []}


def test_kamei_schema_reports_unavailable_fields(settings):
    from jit_baseline.api import create_app
    with TestClient(create_app(**settings)) as client:
        info = client.get('/api/v1/feature-schemas/kamei14-v1', headers=MEMBER).json()
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
        listing = client.get('/api/v1/datasets', headers=MEMBER)
        assert listing.status_code == 200
        assert [item['dataset'] for item in listing.json()['datasets']] == ['openstack-six-v1']
        versions = client.get('/api/v1/datasets/openstack-six-v1/versions', headers=MEMBER)
        assert [item['version'] for item in versions.json()['versions']] == [manifest['version']]
        assert client.get('/api/v1/datasets/unknown/versions', headers=MEMBER).status_code == 404

        commits = client.get('/api/v1/commits', params={'version': manifest['version']}, headers=MEMBER)
        assert commits.status_code == 200
        body = commits.json()
        assert [item['commitId'] for item in body['commits']] == ['c1', 'c2']
        assert (body['total'], body['limit'], body['offset']) == (2, 100, 0)
        assert body['commits'][0] == {'commitId': 'c1', 'authorTime': '2012-01-01T00:00:00Z',
                                      'label': 1, 'module': None}
        page = client.get('/api/v1/commits', params={'version': manifest['version'], 'limit': 1, 'offset': 1},
                          headers=MEMBER).json()
        assert [item['commitId'] for item in page['commits']] == ['c2'] and page['total'] == 2
        filtered = client.get('/api/v1/commits', params={'version': manifest['version'], 'module': 'absent'},
                              headers=MEMBER).json()
        assert (filtered['total'], filtered['commits']) == (0, [])
        for bad in ({'limit': 0}, {'limit': 501}, {'offset': -1}, {'limit': 'abc'}):
            response = client.get('/api/v1/commits', params={'version': manifest['version'], **bad}, headers=MEMBER)
            assert response.status_code == 422, bad
            assert response.json()['error']['code'] == 'INPUT_INVALID', bad
        detail = client.get('/api/v1/commits/c1', params={'version': manifest['version']}, headers=MEMBER)
        assert detail.json()['label'] == 1 and detail.json()['features']['ent'] == 1.5
        assert client.get('/api/v1/commits/missing', params={'version': manifest['version']},
                          headers=MEMBER).status_code == 404
        assert client.get('/api/v1/commits', params={'version': 'missing'}, headers=MEMBER).status_code == 404
        assert client.get('/api/v1/datasets', headers={'Authorization': 'Bearer wrong'}).status_code == 401


REAL_DATABASE = Path(__file__).resolve().parents[1] / 'storage' / 'catalog.sqlite3'
REAL_VERSION = 'openstack-six-v1-2011-11-29_2014-02-28'


@pytest.mark.skipif(not REAL_DATABASE.exists(), reason='真实数据集尚未导入')
def test_real_dataset_commits_page_stays_bounded(real_run, tmp_path):
    from jit_baseline.api import create_app
    import sqlite3
    from jit_baseline.catalog_storage import CatalogStorage
    # Upgrade a snapshot in this test's owned directory, never the developer's live catalog.
    copied = tmp_path / 'real-dataset.sqlite3'
    with sqlite3.connect(f'{REAL_DATABASE.as_uri()}?mode=ro', uri=True) as source:
        with sqlite3.connect(copied) as target:
            source.backup(target)
    CatalogStorage(copied).initialize()
    options = {'directory': real_run, 'database': copied, 'artifact_root': tmp_path,
               'member_token': 'fixture-member', 'admin_token': 'fixture-admin'}
    with TestClient(create_app(**options)) as client:
        response = client.get('/api/v1/commits', params={'version': REAL_VERSION}, headers=MEMBER)
        assert response.status_code == 200
        body = response.json()
        assert (body['total'], body['limit'], body['offset']) == (12374, 100, 0)
        assert len(body['commits']) == 100
        assert set(body['commits'][0]) == {'commitId', 'authorTime', 'label', 'module'}
        assert len(response.content) < 50 * 1024
