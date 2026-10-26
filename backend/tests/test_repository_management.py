"""项目与分析记录的管理接口：建立项目、重命名、硬删、记录列表与删除。"""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from jit_baseline.sync import utc_now

REPO_URL = 'https://github.com/example/management'


@pytest.fixture
def client(tmp_path):
    from jit_baseline.api import create_app
    from jit_baseline.catalog_storage import CatalogStorage
    database = tmp_path / 'management.sqlite3'
    CatalogStorage(database).initialize()
    with TestClient(create_app(tmp_path / 'missing-run', database=database,
                               artifact_root=tmp_path / 'artifacts',
                               dataset_root=tmp_path / 'datasets')) as value:
        value.database = database
        yield value


def make_repository(client, url=REPO_URL):
    response = client.post('/api/v1/repositories', json={'repositoryUrl': url, 'autoUpdate': False})
    assert response.status_code in (200, 201)
    return response.json()


def seed_sync(client, repository, sync_id, *, status='completed', created_at=None, with_commits=True,
              risks=(.2, .21, .22)):
    service = client.app.state.sync
    now = created_at or utc_now()
    service.sync.create({
        'id': sync_id, 'repository_url': repository['url'], 'repository_id': repository['repositoryId'],
        'branch': 'main', 'requested_strategy': 'generic-model', 'status': status,
        'stage': status, 'created_at': now, 'updated_at': now,
        'dataset_version': f'data-{sync_id}'})
    if status == 'completed' and with_commits:
        service.sync.write_commits(sync_id, [
            {'id': f'{i:040x}', 'epoch': 1700000000 + i, 'risk': risk,
             'addedLines': 1, 'deletedLines': 2, 'files': 1, 'features': {'la': 1},
             'label': 0, 'subject': f'commit {i}'} for i, risk in enumerate(risks)])
        service.sync.repository_refresh(repository['repositoryId'], sync_id)
    service.sync.repository_update(repository['repositoryId'], latest_sync_id=sync_id,
                                   latest_sync_at=now)
    return service


def test_explicit_registration_only_is_idempotent_and_creates_no_analysis(client):
    first = client.post('/api/v1/repositories', json={'repositoryUrl': f'{REPO_URL}.git', 'autoUpdate': False})
    assert first.status_code == 201
    repository = first.json()
    assert repository['displayName'] == 'management'
    assert repository['viewSyncId'] is None and repository['commitCount'] == 0
    again = client.post('/api/v1/repositories', json={'repositoryUrl': REPO_URL + '/'})
    assert again.status_code == 200
    assert again.json()['repositoryId'] == repository['repositoryId']
    assert client.get('/api/v1/repositories').json()['total'] == 1
    assert client.get('/api/v1/repository-syncs').json()['total'] == 0


def test_create_repository_rejects_invalid_address(client):
    assert client.post('/api/v1/repositories', json={}).status_code == 422
    response = client.post('/api/v1/repositories', json={'repositoryUrl': 'not-a-public-url'})
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'INPUT_INVALID'


def test_rename_repository_only_changes_display_name(client):
    repository = make_repository(client)
    response = client.patch(f"/api/v1/repositories/{repository['repositoryId']}",
                            json={'displayName': '  订单服务  '})
    assert response.status_code == 200
    assert response.json()['displayName'] == '订单服务'
    assert response.json()['url'] == REPO_URL
    assert response.json()['repositoryId'] == repository['repositoryId']


def test_rename_repository_validates_input_and_identity(client):
    repository = make_repository(client)
    assert client.patch(f"/api/v1/repositories/{repository['repositoryId']}",
                        json={'displayName': '   '}).status_code == 422
    assert client.patch(f"/api/v1/repositories/{repository['repositoryId']}",
                        json={'displayName': 'x' * 81}).status_code == 422
    missing = client.patch('/api/v1/repositories/does-not-exist', json={'displayName': 'x'})
    assert missing.status_code == 404
    assert missing.json()['error']['code'] == 'REPOSITORY_UNKNOWN'


def test_repository_syncs_lists_newest_first(client):
    repository = make_repository(client)
    seed_sync(client, repository, 'older', created_at='2026-01-01T00:00:00+00:00')
    seed_sync(client, repository, 'newer', status='failed', created_at='2026-01-02T00:00:00+00:00')
    page = client.get(f"/api/v1/repositories/{repository['repositoryId']}/syncs").json()
    assert page['total'] == 2
    assert [item['syncId'] for item in page['syncs']] == ['newer', 'older']
    assert page['syncs'][0]['status'] == 'failed'
    limited = client.get(f"/api/v1/repositories/{repository['repositoryId']}/syncs",
                         params={'limit': 1, 'offset': 1}).json()
    assert limited['total'] == 2 and [item['syncId'] for item in limited['syncs']] == ['older']


def test_delete_current_sync_returns_repository_to_no_result(client):
    repository = make_repository(client)
    repository_id = repository['repositoryId']
    seed_sync(client, repository, 'first', created_at='2026-01-01T00:00:00+00:00')
    assert client.get(f'/api/v1/repositories/{repository_id}').json()['viewSyncId'] == 'first'
    assert client.delete('/api/v1/repository-syncs/first').status_code == 204
    view = client.get(f'/api/v1/repositories/{repository_id}').json()
    assert view['viewSyncId'] is None
    assert view['commitCount'] == 0
    assert view['latestSyncId'] is None
    assert client.get(f'/api/v1/repositories/{repository_id}/commits').json()['total'] == 0
    assert client.get('/api/v1/repository-syncs/first').status_code == 404


def test_delete_older_sync_keeps_current_result(client):
    repository = make_repository(client)
    repository_id = repository['repositoryId']
    seed_sync(client, repository, 'older', created_at='2026-01-01T00:00:00+00:00')
    seed_sync(client, repository, 'newer', created_at='2026-01-02T00:00:00+00:00')
    assert client.delete('/api/v1/repository-syncs/older').status_code == 204
    view = client.get(f'/api/v1/repositories/{repository_id}').json()
    assert view['viewSyncId'] == 'newer'
    assert view['latestSyncId'] == 'newer'


def test_delete_running_sync_is_rejected(client):
    repository = make_repository(client)
    seed_sync(client, repository, 'running', status='collecting')
    response = client.delete('/api/v1/repository-syncs/running')
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'CONFLICT_ACTIVE_SYNC'
    assert client.get('/api/v1/repository-syncs/running').status_code == 200


def test_delete_repository_removes_all_children(client):
    repository = make_repository(client)
    repository_id = repository['repositoryId']
    seed_sync(client, repository, 'first', created_at='2026-01-01T00:00:00+00:00')
    seed_sync(client, repository, 'second', status='failed', created_at='2026-01-02T00:00:00+00:00')
    assert client.delete(f'/api/v1/repositories/{repository_id}').status_code == 204
    assert client.get(f'/api/v1/repositories/{repository_id}').status_code == 404
    assert client.get(f'/api/v1/repositories/{repository_id}/syncs').status_code == 404
    assert client.get('/api/v1/repository-syncs/first').status_code == 404
    with sqlite3.connect(client.database) as db:
        assert db.execute('SELECT COUNT(*) FROM repository_sync').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM repository_commit').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM repository').fetchone()[0] == 0


def test_delete_repository_with_running_analysis_is_rejected(client):
    repository = make_repository(client)
    seed_sync(client, repository, 'running', status='training')
    response = client.delete(f"/api/v1/repositories/{repository['repositoryId']}")
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'CONFLICT_ACTIVE_SYNC'


def test_delete_missing_repository_is_not_found(client):
    response = client.delete('/api/v1/repositories/does-not-exist')
    assert response.status_code == 404
    assert response.json()['error']['code'] == 'REPOSITORY_UNKNOWN'
    assert response.headers['X-Request-Id']


def test_select_view_switches_current_result_without_touching_history(client):
    repository = make_repository(client)
    repository_id = repository['repositoryId']
    seed_sync(client, repository, 'older', created_at='2026-01-01T00:00:00+00:00', risks=(.9,))
    seed_sync(client, repository, 'newer', created_at='2026-01-02T00:00:00+00:00', risks=(.05, .06))
    current = client.get(f'/api/v1/repositories/{repository_id}').json()
    assert current['viewSyncId'] == 'newer' and current['commitCount'] == 2

    response = client.patch(f'/api/v1/repositories/{repository_id}', json={'viewSyncId': 'older'})
    assert response.status_code == 200
    selected = response.json()
    assert selected['viewSyncId'] == 'older'
    assert selected['commitCount'] == 1
    assert selected['distribution'] == {'high': 1, 'medium': 0, 'low': 0, 'unknown': 0}
    assert selected['latestSyncId'] == 'newer'
    assert client.get(f'/api/v1/repositories/{repository_id}').json()['viewSyncId'] == 'older'
    assert client.get(f'/api/v1/repositories/{repository_id}/syncs').json()['total'] == 2


def test_select_view_validates_ownership_and_status(client):
    repository = make_repository(client)
    other = make_repository(client, url='https://github.com/example/other')
    seed_sync(client, repository, 'failed-one', status='failed')
    seed_sync(client, other, 'foreign')
    base = f"/api/v1/repositories/{repository['repositoryId']}"

    running = client.patch(base, json={'viewSyncId': 'failed-one'})
    assert running.status_code == 409
    assert running.json()['error']['code'] == 'CONFLICT_ACTIVE_SYNC'
    foreign = client.patch(base, json={'viewSyncId': 'foreign'})
    assert foreign.status_code == 404
    missing = client.patch(base, json={'viewSyncId': 'no-such-sync'})
    assert missing.status_code == 404
    empty = client.patch(base, json={'viewSyncId': '  '})
    assert empty.status_code == 422
    assert empty.json()['error']['code'] == 'INPUT_INVALID'
    unknown = client.patch('/api/v1/repositories/does-not-exist', json={'viewSyncId': 'foreign'})
    assert unknown.status_code == 404
    assert unknown.json()['error']['code'] == 'REPOSITORY_UNKNOWN'
