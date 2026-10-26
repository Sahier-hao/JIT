"""Recurring repository updates own their schedule, model and immutable analysis source."""
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.errors import BaselineError
from jit_baseline.sync import SyncService, utc_now
from test_artifacts import real_run  # noqa: F401


@pytest.fixture
def updates(tmp_path, monkeypatch):
    from jit_baseline.repository_updates import RepositoryUpdates
    storage = CatalogStorage(tmp_path / 'updates.sqlite3')
    storage.initialize()
    service = SyncService(storage, allow_local=True, collect_fn=lambda **kw: None)
    monkeypatch.setattr(service.catalog, 'default_model_id', lambda: 'model-original')
    monkeypatch.setattr(service, '_generic_model', lambda model_id: ({}, {}))
    monkeypatch.setattr(service, '_execute', lambda sync_id: None)
    repo, _ = service.create_repository({'repositoryUrl': 'https://github.com/example/updates'})
    heads = ['a' * 40]
    watcher = RepositoryUpdates(service, probe=lambda url, branch, stop: {'head': heads[0], 'branch': 'main'})
    yield watcher, service, repo['repositoryId'], heads
    watcher.close()
    service.close()


def settle(watcher, repository_id):
    for _ in range(300):
        result = watcher.get(repository_id)
        if result['status'] != 'checking':
            return result
        time.sleep(.01)
    pytest.fail('repository check did not finish')


def complete(service, job_id, head):
    service.sync.update(job_id, status='completed', stage='completed', model_id='model-original',
                        head_commit=head, completed_at=utc_now())
    service.sync.repository_refresh(service.get(job_id)['repositoryId'], job_id)


def test_first_check_binds_model_and_no_change_does_not_duplicate(updates):
    watcher, service, repo, heads = updates
    assert watcher.get(repo)['enabled'] is False
    watcher.request(repo)
    first = settle(watcher, repo)
    assert first['status'] == 'analyzing'
    job = service.get(first['syncId'])
    assert job['requestedModelId'] == 'model-original'
    assert job['requestedStrategy'] == 'generic-model'
    assert job['branch'] == 'main'
    complete(service, job['syncId'], heads[0])
    assert watcher.get(repo)['status'] == 'updated'
    watcher.request(repo)
    assert settle(watcher, repo)['status'] == 'up-to-date'
    assert service.repository_syncs(repo)['total'] == 1


def test_new_head_keeps_old_snapshot_and_bound_model(updates, monkeypatch):
    watcher, service, repo, heads = updates
    watcher.request(repo)
    first = settle(watcher, repo)['syncId']
    complete(service, first, heads[0])
    monkeypatch.setattr(service.catalog, 'default_model_id', lambda: 'different-default')
    heads[0] = 'b' * 40
    watcher.request(repo)
    second = settle(watcher, repo)['syncId']
    assert second != first
    assert service.get(second)['requestedModelId'] == 'model-original'
    assert service.repository(repo, view_sync_id=first)['viewContext']['headCommit'] == 'a' * 40
    assert service.get(first)['status'] == 'completed'


def test_failed_check_is_error_and_retry_rechecks_same_head(updates):
    watcher, service, repo, heads = updates
    watcher.probe = lambda *args: (_ for _ in ()).throw(BaselineError('REPOSITORY_UNAVAILABLE', 'network'))
    watcher.request(repo)
    failed = settle(watcher, repo)
    assert failed['status'] == 'error' and failed['lastCheckedAt'] is None
    assert failed['errorCode'] == 'REPOSITORY_UNAVAILABLE'
    watcher.probe = lambda *args: {'head': heads[0], 'branch': 'main'}
    watcher.request(repo)
    job = settle(watcher, repo)['syncId']
    service.sync.finish(job, 'failed', 'SYNC_TIMEOUT', 'timeout')
    assert watcher.get(repo)['errorCode'] == 'SYNC_TIMEOUT'
    watcher.request(repo)
    assert settle(watcher, repo)['syncId'] != job


def test_overlapping_clicks_and_existing_analysis_do_not_duplicate(updates):
    watcher, service, repo, heads = updates
    gate = threading.Event()
    watcher.probe = lambda *args: (gate.wait(2), {'head': heads[0], 'branch': 'main'})[1]
    with ThreadPoolExecutor(max_workers=5) as executor:
        list(executor.map(lambda _: watcher.request(repo), range(5)))
    gate.set()
    settle(watcher, repo)
    assert service.repository_syncs(repo)['total'] == 1
    watcher.request(repo)
    assert service.repository_syncs(repo)['total'] == 1


def test_schedule_survives_restart_and_disable_stops_tick(updates):
    from jit_baseline.repository_updates import RepositoryUpdates
    watcher, service, repo, heads = updates
    watcher.configure(repo, {'enabled': True, 'branch': 'main', 'modelId': 'model-original'})
    with service.sync.storage.connection(write=True) as db:
        db.execute("UPDATE repository_watch SET next_check_at='2000-01-01T00:00:00Z' WHERE repository_id=?", (repo,))
    watcher.close()
    restarted = RepositoryUpdates(service, probe=lambda *args: {'head': heads[0], 'branch': 'main'})
    try:
        assert restarted.get(repo)['enabled'] is True
        restarted.tick()
        assert settle(restarted, repo)['status'] == 'analyzing'
        restarted.configure(repo, {'enabled': False})
        assert restarted.get(repo)['nextCheckAt'] is None
        assert restarted.tick() == 0
    finally:
        restarted.close()


def test_disabled_model_never_falls_back(updates, monkeypatch):
    watcher, service, repo, heads = updates
    watcher.configure(repo, {'enabled': True, 'modelId': 'model-original'})
    def disabled(model_id):
        raise BaselineError('MODEL_DISABLED', 'disabled')
    monkeypatch.setattr(service, '_generic_model', disabled)
    watcher.request(repo)
    failed = settle(watcher, repo)
    assert failed['modelId'] == 'model-original'
    assert failed['errorCode'] == 'MODEL_DISABLED'
    assert service.repository_syncs(repo)['total'] == 0


def test_unchanged_head_with_different_actual_analysis_head_rechecks(updates):
    watcher, service, repo, heads = updates
    watcher.request(repo)
    first = settle(watcher, repo)['syncId']
    complete(service, first, 'c' * 40)
    watcher.request(repo)
    assert settle(watcher, repo)['syncId'] != first


def test_update_window_and_limit_can_recover_busy_repository(updates):
    from datetime import datetime, timezone
    watcher, service, repo, heads = updates
    watcher.configure(repo, {'windowDays': 7, 'commitLimit': 5000})
    watcher.request(repo)
    first = settle(watcher, repo)['syncId']
    job = service.get(first)
    assert job['commitLimit'] == 5000
    days = (datetime.now(timezone.utc).date() - datetime.fromisoformat(job['since']).date()).days
    assert days == 7
    complete(service, first, heads[0])
    # A different coverage setting deliberately creates a new immutable result even at the same HEAD.
    watcher.configure(repo, {'windowDays': 30})
    watcher.request(repo)
    assert settle(watcher, repo)['syncId'] != first


def test_fixed_pr_head_analysis_does_not_replace_tracked_branch(updates):
    watcher, service, repo, _ = updates
    service.sync.repository_update(repo, default_branch='release')
    service.create({'repositoryUrl': service.sync.repository_get(repo)['url'], 'branch': 'a' * 40,
                    'strategy': 'generic-model', 'modelId': 'model-original'})
    assert service.sync.repository_get(repo)['defaultBranch'] == 'release'


def test_configuration_validation_and_delete_cascade(updates):
    watcher, service, repo, _ = updates
    for payload in ({'enabled': 'yes'}, {'branch': '--upload-pack=bad'}, {'intervalSeconds': 1}, {'modelId': ''}, {'windowDays': 0}, {'commitLimit': 5001}):
        with pytest.raises(BaselineError) as exc:
            watcher.configure(repo, payload)
        assert exc.value.code == 'INPUT_INVALID'
    service.delete_repository(repo)
    with service.sync.storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM repository_watch').fetchone()[0] == 0


def test_old_project_initial_settings_preserve_successful_branch_and_model(updates):
    watcher, service, _, _ = updates
    repo, _ = service.create_repository({'repositoryUrl': 'https://github.com/example/existing'})
    repo_id = repo['repositoryId']
    now = utc_now()
    service.sync.create({'id': 'old-analysis', 'repository_id': repo_id, 'repository_url': repo['url'],
                         'branch': 'release', 'requested_strategy': 'generic-model', 'status': 'completed',
                         'stage': 'completed', 'model_id': 'saved-selected-model', 'created_at': now, 'updated_at': now})
    service.sync.repository_refresh(repo_id, 'old-analysis')
    initial = watcher.get(repo_id)
    assert initial['enabled'] is False
    assert initial['branch'] == 'release'
    assert initial['modelId'] == 'saved-selected-model'


def test_stale_check_lease_recovers_and_source_cannot_change_during_check(updates):
    watcher, service, repo, heads = updates
    gate = threading.Event()
    watcher.probe = lambda *args: (gate.wait(2), {'head': heads[0], 'branch': 'main'})[1]
    watcher.request(repo)
    with pytest.raises(BaselineError) as error:
        watcher.configure(repo, {'branch': 'release'})
    assert error.value.code == 'CONFLICT_ACTIVE_SYNC'
    with pytest.raises(BaselineError):
        service.delete_repository(repo)
    gate.set()
    settle(watcher, repo)
    with service.sync.storage.connection(write=True) as db:
        db.execute("UPDATE repository_watch SET status='checking', check_token='old', lease_until='2000-01-01T00:00:00Z' WHERE repository_id=?", (repo,))
    assert watcher.get(repo)['errorCode'] == 'SYNC_INTERRUPTED'


def test_update_api_and_onboarding(tmp_path):
    from fastapi.testclient import TestClient
    from jit_baseline.api import create_app
    storage = CatalogStorage(tmp_path / 'api.sqlite3')
    storage.initialize()
    with TestClient(create_app(database=storage.path, artifact_root=tmp_path / 'artifacts')) as client:
        response = client.post('/api/v1/repositories', json={'repositoryUrl': 'https://github.com/example/onboarding'})
        assert response.status_code == 201
        repo = response.json()['repositoryId']
        base = f'/api/v1/repositories/{repo}'
        state = client.get(base + '/updates')
        assert state.status_code == 200 and state.json()['enabled'] is True
        import jsonschema
        from test_openapi import document
        doc = document()
        jsonschema.Draft202012Validator({'$ref': '#/components/schemas/RepositoryUpdateState',
                                        'components': doc['components']}).validate(state.json())
        assert doc['paths']['/api/v1/repositories/{repositoryId}/updates']['get']['security'] == []
        failed = settle(client.app.state.updates, repo)
        assert failed['errorCode'] == 'DEFAULT_MODEL_REQUIRED'
        assert client.patch(base + '/updates', json={'enabled': False}).json()['enabled'] is False
        # Re-adding an existing address preserves the user's paused setting.
        assert client.post('/api/v1/repositories', json={'repositoryUrl': 'https://github.com/example/onboarding'}).status_code == 200
        assert client.get(base + '/updates').json()['enabled'] is False
        assert client.post(base + '/refresh').status_code == 202
        settle(client.app.state.updates, repo)
        invalid = client.patch(base + '/updates', json={'branch': '--bad'})
        assert invalid.status_code == 422 and invalid.json()['error']['requestId']
        missing = client.get('/api/v1/repositories/missing/updates')
        assert missing.status_code == 404 and missing.headers['X-Request-Id']
        assert client.post('/api/v1/repositories', json={'repositoryUrl': 'https://github.com/example/invalid', 'autoUpdate': 'yes'}).status_code == 422


def test_real_git_probe_tracks_default_and_named_branch(tmp_path):
    import subprocess
    from jit_baseline.repository_probe import probe_repository
    repo = tmp_path / 'source'
    repo.mkdir()
    def git(*args):
        return subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True, check=True).stdout.strip()
    git('init', '-b', 'main')
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'initial')
    old = git('rev-parse', 'HEAD')
    result = probe_repository(str(repo), 'HEAD', threading.Event(), allow_local=True)
    assert result == {'head': old, 'branch': 'main'}
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'next')
    assert probe_repository(str(repo), 'main', threading.Event(), allow_local=True)['head'] != old
    with pytest.raises(BaselineError) as exc:
        probe_repository(str(repo), 'missing', threading.Event(), allow_local=True)
    assert exc.value.code == 'REPOSITORY_UNAVAILABLE'


def test_real_updates_score_new_commits_without_mutating_previous_result(tmp_path, real_run):  # noqa: F811
    import shutil
    from datetime import datetime, timedelta, timezone
    from jit_baseline.catalog import ModelCatalog
    from jit_baseline.repository_updates import RepositoryUpdates
    from test_end_to_end import _make_repo, _commit
    source = _make_repo(tmp_path / 'source')
    now = datetime.now(timezone.utc)
    _commit(source, 'initial', {'pkg/app.py': 'a = 1\n' * 30}, (now - timedelta(days=2)).isoformat())
    first_head = _commit(source, 'extend', {'pkg/app.py': 'a = 1\n' * 40}, (now - timedelta(days=1)).isoformat())
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    root = tmp_path / 'artifacts'
    shutil.copytree(real_run, root / 'baseline')
    catalog = ModelCatalog(storage, root)
    model_id = catalog.register_key('baseline')['model']['modelId']
    service = SyncService(storage, catalog, allow_local=True, artifact_root=root, dataset_root=tmp_path / 'datasets')
    watcher = RepositoryUpdates(service)
    repo, _ = service.create_repository({'repositoryUrl': str(source)})
    repository_id = repo['repositoryId']
    def finish():
        for _ in range(1500):
            state = watcher.get(repository_id)
            if state['status'] not in ('checking', 'analyzing'):
                assert state['status'] == 'updated', state
                return state['syncId']
            time.sleep(.05)
        pytest.fail('real analysis timeout')
    try:
        watcher.enroll(repository_id)
        first = finish()
        old = service.repository_commits(repository_id, view_sync_id=first)
        assert old['total'] == 2
        assert service.get(first)['headCommit'] == first_head
        _commit(source, 'add service', {'pkg/service.py': 'service = True\n' * 20}, now.isoformat())
        watcher.request(repository_id)
        second = finish()
        assert second != first
        assert service.repository_commits(repository_id, view_sync_id=second)['total'] == 3
        assert service.repository_commits(repository_id, view_sync_id=first) == old
        assert service.get(second)['modelId'] == model_id == service.get(first)['modelId']
        watcher.request(repository_id)
        assert settle(watcher, repository_id)['status'] == 'up-to-date'
        assert service.repository_syncs(repository_id)['total'] == 2
    finally:
        watcher.close()
        service.close()
