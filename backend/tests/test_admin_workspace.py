"""Admin sessions protect maintenance; project review stays public."""
import sqlite3
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from jit_baseline.api import create_app
from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.errors import BaselineError
from jit_baseline.sync import SyncService


@pytest.fixture
def client(tmp_path):
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    with TestClient(create_app(tmp_path / 'missing', database=storage.path,
                               artifact_root=tmp_path / 'artifacts', dataset_root=tmp_path / 'data')) as value:
        yield value


def test_maintenance_requires_admin_but_projects_and_model_choices_are_public(client):
    assert client.get('/api/health').status_code == 200
    assert client.get('/api/v1/repositories').status_code == 200
    assert client.get('/api/v1/repository-models').status_code == 200
    for path in ['/api/v1/models', '/api/v1/model-candidates', '/api/v1/datasets', '/api/review-batch']:
        assert client.get(path).status_code == 401, path
    assert client.post('/api/v1/models/register', json={}).status_code == 401


def test_admin_setup_login_logout_and_no_password_in_response(client):
    assert client.get('/api/admin/session').json()['setupRequired'] is True
    credentials = {'username': 'maintainer', 'password': 'correct-horse-battery-23'}
    response = client.post('/api/admin/setup', json=credentials)
    assert response.status_code == 201
    assert 'httponly' in response.headers['set-cookie'].lower()
    assert 'samesite=strict' in response.headers['set-cookie'].lower()
    assert credentials['password'] not in response.text
    assert client.get('/api/admin/session').json()['authenticated'] is True
    assert client.get('/api/v1/model-candidates').status_code == 200
    assert client.post('/api/admin/setup', json=credentials).status_code == 409
    assert client.post('/api/admin/logout').status_code == 204
    assert client.get('/api/v1/models').status_code == 401
    assert client.post('/api/admin/login', json={**credentials, 'password': 'wrong'}).status_code == 401
    assert client.post('/api/admin/login', json=credentials).status_code == 200
    assert client.get('/api/v1/models').status_code == 200


def test_admin_distinguishes_supported_methods_from_delivered_models(client):
    client.post('/api/admin/setup', json={'username': 'admin', 'password': 'method-admin-password'})
    body = client.get('/api/v1/models').json()
    assert body['models'] == []
    methods = body['methods']
    assert len(methods) == 9
    assert {item['method'] for item in methods if item['category'] == 'deep'} == {
        'mlp-v1', 'tabular-resnet-v1', 'ft-transformer-v1', 'wide-deep-v1'}
    assert all(item['registeredModels'] == 0 and item['deliveredArtifacts'] == 0 for item in methods)


def test_weak_password_and_cross_origin_setup_rejected(client):
    assert client.post('/api/admin/setup', json={'username': 'admin', 'password': '123'}).status_code == 422
    response = client.post('/api/admin/setup', headers={'Origin': 'https://evil.example'},
                           json={'username': 'admin', 'password': 'a-long-valid-password'})
    assert response.status_code == 403
    same_host = client.post('/api/admin/setup', headers={'Origin': 'http://localhost:9999'},
                            json={'username': 'admin', 'password': 'a-long-valid-password'})
    assert same_host.status_code == 403
    assert client.get('/api/admin/session').json()['setupRequired'] is True


def test_expired_sessions_and_local_password_reset(client, monkeypatch, capsys):
    from jit_baseline.cli import main
    credentials = {'username': 'maintainer', 'password': 'old-password-long-enough'}
    assert client.post('/api/admin/setup', json=credentials).status_code == 201
    storage = client.app.state.storage
    with storage.connection(write=True) as db:
        db.execute('UPDATE admin_session SET expires_at=0')
    assert client.get('/api/v1/models').status_code == 401
    monkeypatch.setattr('sys.argv', ['jit', 'admin-reset-password', '--username', 'maintainer', '--database', str(storage.path)])
    monkeypatch.setattr('getpass.getpass', lambda prompt: 'new-password-long-enough')
    main()
    assert 'new-password-long-enough' not in capsys.readouterr().out
    assert client.post('/api/admin/login', json=credentials).status_code == 401
    assert client.post('/api/admin/login', json={**credentials, 'password': 'new-password-long-enough'}).status_code == 200


def test_admin_dataset_refresh_reads_newly_registered_versions(client, monkeypatch):
    from jit_baseline import datasets
    assert client.post('/api/admin/setup', json={'username': 'admin', 'password': 'dataset-admin-password'}).status_code == 201
    current = datasets.load_all()
    new = dict(next(iter(current.values())), dataset='newly-registered', version='new-version')
    monkeypatch.setattr(datasets, 'load_all', lambda: {**current, 'new-version': new})
    body = client.get('/api/v1/datasets').json()
    assert any(item['dataset'] == 'newly-registered' for item in body['datasets'])


def test_malformed_admin_request_has_a_bounded_error_envelope(client):
    with TestClient(client.app, raise_server_exceptions=False) as malformed:
        response = malformed.post('/api/admin/login', content='{broken', headers={'Content-Type': 'application/json'})
        assert response.status_code == 422
        assert response.json()['error']['code'] == 'INPUT_INVALID'


def test_explicit_model_is_selected_and_incompatible_models_rejected(tmp_path):
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    class Catalog:
        def models(self, state=None):
            return [{'modelId': key, 'featureSchemaVersion': schema} for key, schema in
                    [('first', 'openstack-six-v1'), ('second', 'openstack-six-v1'), ('wrong', 'kamei14-v1')]]
        def load_model(self, model_id):
            schema = 'kamei14-v1' if model_id == 'wrong' else 'openstack-six-v1'
            return SimpleNamespace(schema=SimpleNamespace(name=schema)), {'modelId': model_id, 'featureSchemaVersion': schema}
    service = SyncService(storage, Catalog(), dataset_root=tmp_path / 'data')
    try:
        assert service._generic_model('second')[1]['modelId'] == 'second'
        with pytest.raises(BaselineError):
            service._generic_model('wrong')
        with sqlite3.connect(storage.path) as db:
            columns = {row[1] for row in db.execute('pragma table_info(repository_sync)')}
            assert 'requested_model_id' in columns
    finally:
        service._executor.shutdown(wait=True)
