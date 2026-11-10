"""普通用户账户、数据归属与训练配额。"""
import threading

import pytest
from fastapi.testclient import TestClient

from jit_baseline.api import create_app
from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.data import BaselineError
from jit_baseline.training_tasks import TrainingTaskService

ACCOUNT = {'username': 'reader', 'password': 'reader-password-1'}


@pytest.fixture
def storage(tmp_path):
    value = CatalogStorage(tmp_path / 'catalog.sqlite3')
    value.initialize()
    return value


@pytest.fixture
def client(tmp_path, storage):
    with TestClient(create_app(tmp_path / 'missing', database=storage.path,
                               artifact_root=tmp_path / 'artifacts')) as value:
        yield value


def test_register_login_session_and_logout(client):
    assert client.get('/api/user/session').json() == {'authenticated': False, 'username': None}
    created = client.post('/api/user/register', json=ACCOUNT)
    assert created.status_code == 201
    assert client.get('/api/user/session').json()['username'] == 'reader'
    assert client.post('/api/user/logout').status_code == 204
    assert client.get('/api/user/session').json()['authenticated'] is False
    again = client.post('/api/user/register', json=ACCOUNT)
    assert again.status_code == 409
    bad = client.post('/api/user/login', json={**ACCOUNT, 'password': 'wrong-password'})
    assert bad.status_code == 401
    assert client.post('/api/user/login', json=ACCOUNT).status_code == 200


def test_user_api_requires_login(client):
    response = client.get('/api/v1/user/datasets')
    assert response.status_code == 401
    assert response.json()['error']['code'] == 'AUTH_REQUIRED'


def test_dataset_ownership_and_quota(storage, client):
    assert client.post('/api/user/register', json=ACCOUNT).status_code == 201
    storage.add_dataset_owner('v1', 'reader')
    assert storage.dataset_owners('v1') == ['reader']
    assert storage.user_datasets('reader') == ['v1']
    assert storage.dataset_owner_count('reader') == 1
    for index in range(2, 6):
        storage.add_dataset_owner(f'v{index}', 'reader')
    with pytest.raises(BaselineError) as info:
        storage.add_dataset_owner('v6', 'reader', limit=5)
    assert info.value.code == 'QUOTA_EXCEEDED'
    assert storage.dataset_owner_count('reader') == 5


def test_user_training_quota_and_owner(storage, tmp_path):
    from jit_baseline.datasets import load_manifest
    from jit_baseline.config import BACKEND
    manifest = BACKEND / 'data/datasets/openstack-six-v1/openstack-six-v1-2011-11-29_2014-02-28.json'
    if not manifest.exists():
        pytest.skip('开放数据集未取得')
    release = threading.Event()
    service = TrainingTaskService(
        storage, artifact_root=tmp_path / 'artifacts', dataset_root=BACKEND / 'data/datasets',
        timeout=10, runner=lambda *args, **kwargs: {'artifactKey': kwargs['output_key'],
            'artifactRunId': 'a' * 64, 'runId': 'b' * 36, 'modelId': 'c' * 36,
            'datasetVersion': 'x', 'manifestSha256': 'd' * 64,
            'featureSchemaVersion': 'openstack-six-v1', 'metricSet': 'metric-set-v2',
            'metrics': {}, 'metricsByPartition': {}, 'split': {}, 'splitRule': 'UTC',
            'dataScale': {}, 'trainingPerformance': {}})
    service._executor.submit(release.wait)
    try:
        version = load_manifest(manifest)['version']
        first, created = service.create_experiment(
            {'datasetVersion': version, 'methods': [{'method': 'logistic-regression-l2-v1'}]},
            created_by='reader', owner_user_id='reader')
        assert created and first['ownerUserId'] == 'reader'
        with pytest.raises(BaselineError) as info:
            service.create_experiment(
                {'datasetVersion': version, 'methods': [{'method': 'decision-tree-v1'}]},
                created_by='reader', owner_user_id='reader')
        assert info.value.code == 'QUOTA_EXCEEDED'
        other, created_other = service.create_experiment(
            {'datasetVersion': version, 'methods': [{'method': 'logistic-regression-l2-v1'}]},
            created_by='other', owner_user_id='other')
        assert created_other and other['ownerUserId'] == 'other'
        assert other['experimentId'] != first['experimentId']
    finally:
        release.set()
        service.close()


def test_user_can_delete_own_dataset_but_not_shared(monkeypatch, tmp_path):
    from jit_baseline import datasets
    from jit_baseline.config import BACKEND
    csv = BACKEND / 'data/openstack/openstack.csv'
    if not csv.exists():
        pytest.skip('开放数据集未取得')
    registry = tmp_path / 'registry'
    registry.mkdir()
    copied = registry / 'openstack.csv'
    copied.write_bytes(csv.read_bytes())
    registered = datasets.register(copied, root=registry)
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    with TestClient(create_app(tmp_path / 'missing', database=storage.path,
                               artifact_root=tmp_path / 'artifacts', dataset_root=registry)) as client:
        assert client.post('/api/user/register', json=ACCOUNT).status_code == 201
        shared = client.delete(f"/api/v1/user/datasets/{registered['version']}")
        assert shared.status_code == 403
        assert shared.json()['error']['code'] == 'DATASET_FORBIDDEN'
        storage.add_dataset_owner(registered['version'], 'reader')
        deleted = client.delete(f"/api/v1/user/datasets/{registered['version']}")
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()['deleted'] == registered['version']
        assert storage.dataset(registered['version']) is None
        assert storage.dataset_owners(registered['version']) == []
        assert not (registry / registered['dataset'] / (registered['version'] + '.json')).exists()
        assert not copied.exists()
        assert csv.exists()


def test_user_profile_and_password_change(client):
    assert client.post('/api/user/register', json=ACCOUNT).status_code == 201
    profile = client.get('/api/v1/user/profile')
    assert profile.status_code == 200
    body = profile.json()
    assert body['username'] == 'reader' and body['displayName'] is None
    assert (body['datasetCount'], body['modelCount'], body['experimentCount']) == (0, 0, 0)
    saved = client.patch('/api/v1/user/profile', json={'displayName': '审阅者'})
    assert saved.json()['displayName'] == '审阅者'
    assert client.get('/api/v1/user/profile').json()['displayName'] == '审阅者'
    wrong = client.post('/api/user/password', json={'currentPassword': 'bad-password', 'newPassword': 'new-reader-pass'})
    assert wrong.status_code == 401
    changed = client.post('/api/user/password', json={'currentPassword': ACCOUNT['password'], 'newPassword': 'new-reader-pass'})
    assert changed.status_code == 200
    client.post('/api/user/logout')
    assert client.post('/api/user/login', json=ACCOUNT).status_code == 401
    assert client.post('/api/user/login', json={**ACCOUNT, 'password': 'new-reader-pass'}).status_code == 200
