"""Pinned successful analyses remain stable while later jobs change branch or complete."""
import sqlite3

import pytest

from jit_baseline.catalog_storage import CatalogStorage, MIGRATIONS
from jit_baseline.errors import BaselineError
from jit_baseline.sync import SyncService, SyncStorage, utc_now


@pytest.fixture
def context(tmp_path):
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    service = object.__new__(SyncService)
    service.sync = SyncStorage(storage)
    service._ensure_repository('https://github.com/example/project', 'main', utc_now())
    repo = service.sync.repository_by_url('https://github.com/example/project')['repositoryId']
    return service, repo


def seed(service, repo, sync, branch='main', status='completed', risk=.2):
    now = utc_now()
    service.sync.create(dict(id=sync, repository_url='https://github.com/example/project',
        repository_id=repo, branch=branch, requested_strategy='generic-model', status=status,
        stage=status, created_at=now, updated_at=now, dataset_version=f'data-{sync}'))
    if status == 'completed':
        service.sync.write_commits(sync, [dict(id=f'{i:040x}', epoch=1700000000, risk=risk+i/100,
            addedLines=1, deletedLines=2, files=1, features={'la': 1}, label=0,
            subject='literal %_ title' if i == 25 else f'commit {i}') for i in range(26)])
        service.sync.repository_refresh(repo, sync)
    service.sync.repository_update(repo, latest_sync_id=sync, default_branch=branch)


def test_failed_branch_does_not_change_successful_context(context):
    service, repo = context
    seed(service, repo, 'first')
    seed(service, repo, 'failed', branch='release', status='failed')
    view = service.repository(repo)
    assert view['defaultBranch'] == 'release'  # preserved legacy semantics
    assert view['latestSync']['syncId'] == 'failed'
    assert view['viewContext']['branch'] == 'main'
    assert view['viewContext']['completedAt'] is None
    assert view['viewContext']['headCommit'] is None
    assert view['viewContext']['missingMetadata']


def test_time_ties_and_search_after_page(context):
    service, repo = context
    seed(service, repo, 'first')
    page = service.repository_commits(repo, limit=25, sort='time')
    assert [row['commitId'] for row in page['commits']] == [f'{i:040x}' for i in range(25)]
    assert page['total'] == 26
    result = service.repository_commits(repo, search='%_', sort='time')
    assert result['total'] == 1 and result['commits'][0]['commitId'] == f'{25:040x}'


def test_pinned_analysis_survives_new_success(context):
    service, repo = context
    seed(service, repo, 'first')
    before = service.repository_commits(repo, view_sync_id='first')
    seed(service, repo, 'second', branch='release', risk=.5)
    assert service.repository_commits(repo, view_sync_id='first') == before
    assert service.repository(repo, view_sync_id='first')['viewContext']['branch'] == 'main'
    assert service.repository_summary(repo, view_sync_id='first')['total'] == 26
    detail = service.repository_commit(repo, f'{1:040x}', view_sync_id='first')
    assert detail['risk'] == pytest.approx(.21) and detail['viewSyncId'] == 'first'
    assert service.repository(repo)['viewContext']['syncId'] == 'second'


@pytest.mark.parametrize('which', ['unknown', 'failed', 'other'])
def test_unavailable_analysis_rejected(context, which):
    service, repo = context
    seed(service, repo, 'failed', status='failed')
    other = service._ensure_repository('https://github.com/example/other', 'main', utc_now())
    seed(service, other, 'other')
    with pytest.raises(BaselineError) as exc:
        service.repository(repo, view_sync_id=which)
    assert exc.value.code in ('REPOSITORY_ANALYSIS_UNKNOWN', 'REPOSITORY_ANALYSIS_UNAVAILABLE')


def test_migration_preserves_old_data_and_optional_metadata(tmp_path):
    path = tmp_path / 'old.sqlite3'
    with sqlite3.connect(path) as db:
        for _, migration in MIGRATIONS[:4]:
            db.executescript(migration.read_text(encoding='utf-8'))
        db.execute("INSERT INTO schema_migration VALUES (4,'old')")
        db.execute("INSERT INTO repository_sync(id,repository_url,branch,requested_strategy,status,stage,created_at,updated_at) VALUES ('old','local','main','auto','completed','completed','old','old')")
        db.execute("INSERT INTO repository_commit(sync_id,commit_id,epoch,risk,added_lines,deleted_lines,files,features_json,label) VALUES ('old','sha',1,.81,2,3,1,'{}',0)")
    storage = CatalogStorage(path)
    storage.initialize()
    storage.initialize()
    view = SyncStorage(storage).get('old')
    assert view['completedAt'] is None and view['headCommit'] is None
    assert view['updatedAt'] == 'old'
    commit = SyncStorage(storage).commit('old', 'sha')
    assert commit['risk'] == .81 and commit['authorName'] is None


def test_completion_uses_captured_head_even_when_commit_times_disagree(context):
    service, repo = context
    seed(service, repo, 'first', status='scoring')
    rows = [dict(id='a'*40, epoch=200, risk=.8, addedLines=1, deletedLines=1,
                 files=1, features={}, label=0, authorName='真实作者')]
    service.sync.complete('first', repo, rows, head_commit='b'*40,
                          dataset_version='original-data', run_id='original-run', model_id='original-model')
    view = service.repository(repo)['viewContext']
    assert view['headCommit'] == 'b'*40 and view['completedAt']
    assert view['datasetVersion'] == 'original-data'
    assert service.repository_commits(repo)['commits'][0]['authorName'] == '真实作者'


@pytest.mark.parametrize('url,expected', [
    ('https://github.com/a/b.git', True), ('http://github.com/a/b', False),
    ('https://secret@github.com/a/b', False), ('https://github.com/a/b?token=x', False),
    ('file:///repo', False), ('https://evil.test/a/b', False),
])
def test_original_commit_link_is_safe(context, url, expected):
    from jit_baseline.sync import original_commit_url
    result = original_commit_url(url, 'a'*40)
    assert bool(result) == expected
    if result:
        assert result == 'https://github.com/a/b/commit/' + 'a'*40
    assert original_commit_url(url, 'short') is None
