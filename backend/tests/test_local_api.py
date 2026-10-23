"""The product is a local tool: business APIs work without team configuration."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    from jit_baseline.api import create_app
    from jit_baseline.catalog_storage import CatalogStorage
    monkeypatch.delenv('JIT_MEMBER_TOKEN', raising=False)
    monkeypatch.delenv('JIT_ADMIN_TOKEN', raising=False)
    database = tmp_path / 'local.sqlite3'
    CatalogStorage(database).initialize()
    with TestClient(create_app(tmp_path / 'missing-run', database=database,
                              artifact_root=tmp_path / 'artifacts')) as value:
        yield value


@pytest.mark.parametrize('path', ['/api/v1/repositories', '/api/v1/repository-syncs'])
def test_business_reads_need_no_configuration_or_authentication(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.headers['X-Request-Id']
    assert response.headers['Cache-Control'] == 'no-store'


def test_anonymous_maintenance_write_requires_login(client):
    response = client.post('/api/v1/models/register', content='invalid json')
    assert response.status_code == 401
    assert response.json()['error']['code'] == 'AUTH_REQUIRED'
    assert response.json()['error']['requestId'] == response.headers['X-Request-Id']


def test_obsolete_authorization_headers_do_not_change_access(client):
    for header in ['Bearer old-value', 'Basic old-value']:
        assert client.get('/api/v1/models', headers={'Authorization': header}).status_code == 401


def test_local_registration_migration_retains_historical_events(tmp_path):
    import sqlite3
    from jit_baseline.catalog_storage import CatalogStorage, MIGRATIONS
    path = tmp_path / 'old-catalog.sqlite3'
    with sqlite3.connect(path) as db:
        for _, migration in MIGRATIONS[:5]:
            db.executescript(migration.read_text(encoding='utf-8'))
        db.execute("INSERT INTO schema_migration VALUES (5,'original-time')")
        db.execute("INSERT INTO registration_event VALUES ('old','request-old','candidate-old','http-admin','created',NULL,'original-time',NULL,NULL)")
    storage = CatalogStorage(path)
    storage.initialize()
    storage.initialize()
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT * FROM registration_event').fetchone() == ('old','request-old','candidate-old','http-admin','created',None,'original-time',None,None)
        db.execute("INSERT INTO registration_event VALUES ('new','request-new','candidate-new','http-local','created',NULL,'new-time',NULL,NULL)")
        assert db.execute('SELECT count(*) FROM registration_event').fetchone()[0] == 2
