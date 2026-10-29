"""Task control uses disposable stores and real owned processes."""
import json
import os
import sqlite3
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from jit_baseline.catalog_storage import CatalogStorage, MIGRATIONS, utc_now
from jit_baseline.errors import BaselineError
from jit_baseline.sync import SyncService


@pytest.fixture
def service(tmp_path):
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    result = SyncService(storage, artifact_root=tmp_path / 'artifacts',
                         dataset_root=tmp_path / 'datasets', timeout=10)
    yield result
    result.close()


def seed(service, identity, status='queued'):
    now = utc_now()
    service.sync.create(dict(id=identity, repository_url='https://example.com/repo', branch='main',
                             requested_strategy='auto', status=status, stage=status,
                             created_at=now, updated_at=now))


def wait_for(test, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = test()
        if result:
            return result
        time.sleep(.02)
    raise AssertionError('state transition timed out')


def test_queue_cancel_is_idempotent_and_updates_positions(service):
    seed(service, 'first')
    seed(service, 'second')
    assert service.get('second')['queuePosition'] == 2
    cancelled = service.cancel('first')
    assert cancelled['status'] == 'cancelled'
    assert cancelled['cancelRequestedAt'] and cancelled['completedAt']
    assert service.cancel('first')['status'] == 'cancelled'
    assert service.get('second')['queuePosition'] == 1
    assert service.pages()['syncs'][0]['queuePosition'] == 1
    service._run('first')
    assert service.get('first')['status'] == 'cancelled'


def test_repeated_queued_creation_returns_the_same_live_queue_position(service):
    release = threading.Event()
    service._executor.submit(release.wait)
    try:
        payload = {'repositoryUrl': 'https://example.com/repo', 'strategy': 'auto'}
        first, created = service.create(payload)
        again, created_again = service.create(payload)
        assert created and not created_again
        assert first['syncId'] == again['syncId']
        assert first['queuePosition'] == again['queuePosition'] == 1
    finally:
        release.set()
        service.cancel(first['syncId'])


@pytest.mark.parametrize('status', ['completed', 'failed', 'interrupted'])
def test_terminal_jobs_cannot_be_cancelled(service, status):
    seed(service, 'terminal', status)
    with pytest.raises(BaselineError) as error:
        service.cancel('terminal')
    assert error.value.code == 'SYNC_NOT_ACTIVE'
    assert service.get('terminal')['status'] == status


def test_cancel_wins_against_late_success_and_failure(service):
    seed(service, 'running', 'scoring')
    service.cancel('running')
    with pytest.raises(BaselineError) as error:
        service.sync.complete('running', None, [], head_commit='a' * 40,
                              dataset_version='fixture', run_id='run', model_id='model')
    assert error.value.code == 'SYNC_CANCELLED'
    service.sync.finish('running', 'cancelled', 'SYNC_CANCELLED', '已取消')
    service.sync.finish('running', 'failed', 'INTERNAL_ERROR', 'late failure')
    assert service.get('running')['status'] == 'cancelled'
    assert service.commits('running')['total'] == 0


def test_running_cancel_and_timeout_stop_owned_process_and_release_queue(service, monkeypatch, tmp_path):
    import jit_baseline.sync as sync
    pidfile = tmp_path / 'pid.json'
    script = (
        'import sys,json,os,time,subprocess; json.load(sys.stdin); '
        'child=subprocess.Popen([sys.executable,"-c","import time; time.sleep(120)"]); '
        f'open({str(pidfile)!r},"w").write(json.dumps([os.getpid(),child.pid])); '
        'time.sleep(120)'
    )
    monkeypatch.setattr(sync, 'worker_command', lambda: [sys.executable, '-c', script])
    payload = {'repositoryUrl': 'https://example.com/repo', 'strategy': 'auto'}
    first, _ = service.create(payload)
    wait_for(pidfile.exists)
    pids = json.loads(pidfile.read_text())
    service.timeout = .25
    second, _ = service.create(dict(payload, branch='other'))
    assert service.get(second['syncId'])['queuePosition'] == 1
    response = service.cancel(first['syncId'])
    assert response['cancelRequestedAt']
    wait_for(lambda: service.get(first['syncId'])['status'] == 'cancelled')
    from jit_baseline.task_process import process_alive
    assert all(not process_alive(pid) for pid in pids)
    wait_for(lambda: service.get(second['syncId'])['status'] == 'failed')
    assert service.get(second['syncId'])['error']['code'] == 'SYNC_TIMEOUT'
    assert service.get(first['syncId'])['status'] == 'cancelled'


def test_cancel_endpoint_public_idempotent_and_has_error_envelope(service):
    from jit_baseline.api import create_app
    app = create_app(database=service.sync.storage.path, artifact_root=service.artifact_root,
                     sync_service=service)
    seed(service, 'queued')
    seed(service, 'completed', 'completed')
    seed(service, 'running', 'collecting')
    with TestClient(app) as client:
        response = client.post('/api/v1/repository-syncs/queued/cancel')
        assert response.status_code == 200
        assert response.json()['status'] == 'cancelled'
        assert client.post('/api/v1/repository-syncs/queued/cancel').status_code == 200
        pending = client.post('/api/v1/repository-syncs/running/cancel')
        assert pending.status_code == 202
        assert pending.json()['cancelRequestedAt'] and pending.json()['status'] == 'collecting'
        assert client.post('/api/v1/repository-syncs/running/cancel').status_code == 202
        assert client.delete('/api/v1/repository-syncs/running').status_code == 409
        ended = client.post('/api/v1/repository-syncs/completed/cancel')
        assert ended.status_code == 409 and ended.json()['error']['code'] == 'SYNC_NOT_ACTIVE'
        missing = client.post('/api/v1/repository-syncs/missing/cancel')
        assert missing.status_code == 404 and missing.json()['error']['requestId']


def test_expired_task_cannot_publish_a_success(service):
    seed(service, 'expired', 'scoring')
    service.sync.update('expired', deadline_at=(datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat())
    with pytest.raises(BaselineError) as error:
        service.sync.complete('expired', None, [], head_commit='a' * 40,
                              dataset_version='data', run_id='run', model_id='model')
    assert error.value.code == 'SYNC_TIMEOUT'


def test_restart_preserves_requested_cancellation_and_does_not_restart_jobs(service):
    seed(service, 'cancel-pending', 'training')
    seed(service, 'stale', 'scoring')
    service.cancel('cancel-pending')
    assert service.recover() == 2
    assert service.get('cancel-pending')['status'] == 'cancelled'
    assert service.get('cancel-pending')['error']['code'] == 'SYNC_CANCELLED'
    assert service.get('stale')['status'] == 'interrupted'
    assert service.get('stale')['completedAt']


def test_worker_exit_is_diagnostic_and_shutdown_releases_running_and_queued_jobs(service, monkeypatch):
    import jit_baseline.sync as sync
    monkeypatch.setattr(sync, 'worker_command', lambda: [sys.executable, '-c', 'import sys; sys.stdin.read(); sys.exit(3)'])
    payload = {'repositoryUrl': 'https://example.com/repo'}
    exited, _ = service.create(payload)
    wait_for(lambda: service.get(exited['syncId'])['status'] == 'failed')
    assert service.get(exited['syncId'])['error']['code'] == 'SYNC_WORKER_EXITED'
    monkeypatch.setattr(sync, 'worker_command', lambda: [sys.executable, '-c', 'import sys,time; sys.stdin.read(); time.sleep(120)'])
    running, _ = service.create(payload)
    wait_for(lambda: service.get(running['syncId'])['status'] == 'collecting')
    queued, _ = service.create(dict(payload, branch='other'))
    service.close()
    assert service.get(running['syncId'])['status'] == 'interrupted'
    assert service.get(queued['syncId'])['status'] == 'interrupted'
    with pytest.raises(BaselineError) as error:
        service.create(payload)
    assert error.value.code == 'SYNC_SERVICE_STOPPING'


def test_dataset_collision_never_overwrites_an_existing_csv(tmp_path):
    from test_repository_sync import _small_repo, SINCE, UNTIL
    from jit_baseline import collect
    from jit_baseline.sync import _register_unique
    collected = collect.collect(_small_repo(tmp_path), since=SINCE, until=UNTIL)
    dataset = 'kamei14-git-v1-control'
    version = f'{dataset}-2024-01-01_2024-01-07'
    room = tmp_path / 'datasets' / dataset
    room.mkdir(parents=True)
    original = room / f'{version}.csv'
    original.write_bytes(b'protected-previous-data')
    result = _register_unique(room, dataset, version, collected['csv'], schema=collect.SCHEMA_NAME,
                              cohort=collect.cohort(SINCE, UNTIL), root=room.parent)
    assert original.read_bytes() == b'protected-previous-data'
    assert result['version'].startswith(version + '-')


def test_migration_preserves_v8_rows_children_model_identity_and_foreign_keys(tmp_path):
    database = tmp_path / 'old.sqlite3'
    with sqlite3.connect(database) as db:
        for number, path in MIGRATIONS:
            if number <= 8:
                db.executescript(path.read_text(encoding='utf-8'))
        db.execute("INSERT INTO schema_migration VALUES (8, 'fixture')")
        db.execute("INSERT INTO repository_sync(id,repository_url,branch,requested_strategy,status,stage,"
                   "created_at,updated_at,requested_model_id,resolved_model_id) "
                   "VALUES ('old','https://example.com/repo','main','auto','completed','completed',"
                   "'fixture','fixture','selected','bound')")
        db.execute("INSERT INTO repository_commit VALUES ('old','commit',1,.2,1,0,1,'{}',0,NULL,'title','author')")
        before = tuple(db.execute('SELECT * FROM repository_sync').fetchone())
        children = db.execute('SELECT * FROM repository_commit').fetchall()
    storage = CatalogStorage(database)
    storage.initialize()
    storage.initialize()
    with storage.connection() as db:
        assert tuple(db.execute('SELECT * FROM repository_sync').fetchone())[:len(before)] == before
        assert [tuple(row)[:len(children[0])] for row in db.execute('SELECT * FROM repository_commit')] == children
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        assert db.execute('SELECT version FROM schema_migration').fetchone()[0] == MIGRATIONS[-1][0]
        assert db.execute('SELECT count(*) FROM repository_watch').fetchone()[0] == 0
