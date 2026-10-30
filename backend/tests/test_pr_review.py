"""Real-source contracts using deterministic GitHub responses, without personal server data."""
import base64
import json
import sqlite3
from copy import deepcopy

import pytest

from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.errors import BaselineError
from jit_baseline.sync import SyncService


@pytest.fixture
def review(tmp_path):
    from jit_baseline.pr_review import PullRequestReview
    storage = CatalogStorage(tmp_path / 'pr.sqlite3')
    storage.initialize()
    sync = SyncService(storage)
    pr = {'number': 12, 'title': 'Reset token', 'body': 'Handle expiry and add a test.', 'state': 'open',
          'merged': False, 'user': {'login': 'author'}, 'updated_at': '2026-10-26T00:00:00Z',
          'base': {'sha': 'a' * 40, 'ref': 'main', 'repo': {'full_name': 'example/project'}},
          'head': {'sha': 'b' * 40, 'ref': 'token', 'repo': {'full_name': 'example/project'}},
          'changed_files': 1, 'commits': 1}
    files = [{'filename': 'src/token.py', 'sha': 'c' * 40, 'status': 'modified', 'additions': 1,
              'deletions': 1, 'patch': '@@ -1 +1 @@\n-old\n+new'}]
    calls = []
    def request(path):
        calls.append(path)
        if '/contents/' in path:
            return {'type': 'file', 'encoding': 'base64', 'size': 4, 'content': base64.b64encode(b'new\n').decode()}
        if '/files?' in path:
            return deepcopy(files)
        if '/commits?' in path:
            return [{'sha': pr['head']['sha'], 'commit': {'message': 'handle expiry'}}]
        if '/pulls?' in path:
            return [deepcopy(pr)]
        return deepcopy(pr)
    service = PullRequestReview(sync, request=request)
    yield service, pr, files, calls, storage
    sync.close()


def test_intake_list_and_immutable_versions(review):
    service, pr, files, _, _ = review
    listed = service.intake({'url': 'https://github.com/example/project'})
    assert listed['pullRequests'][0]['author'] == 'author'
    first = service.intake({'url': 'https://github.com/example/project/pull/12'})['snapshot']
    assert first['headSha'] == 'b' * 40 and first['files'][0]['patchComplete']
    assert service.refresh('example', 'project', 12)['snapshot']['snapshotId'] == first['snapshotId']
    pr['head']['sha'] = 'd' * 40
    files[0]['sha'] = 'e' * 40
    second = service.refresh('example', 'project', 12)['snapshot']
    assert second['snapshotId'] != first['snapshotId']
    assert service.get(first['snapshotId']) == first
    assert first['repositoryId'] == second['repositoryId']


def test_context_uses_saved_sha_and_path_membership(review):
    service, _, _, calls, _ = review
    source = service.refresh('example', 'project', 12)['snapshot']
    assert service.context(source['snapshotId'], 'src/token.py', 'head')['content'] == 'new\n'
    assert 'ref=' + 'b' * 40 in calls[-1]
    service.context(source['snapshotId'], 'src/token.py', 'head')
    assert sum('/contents/' in path for path in calls) == 1
    with pytest.raises(BaselineError):
        service.context(source['snapshotId'], '../private', 'head')


def test_race_and_remote_failure_do_not_replace_snapshot(review):
    service, pr, _, _, _ = review
    first = service.refresh('example', 'project', 12)['snapshot']
    pr['head']['sha'] = 'd' * 40
    original = service.request
    def changing(path):
        if '/files?' in path:
            pr['head']['sha'] = 'e' * 40
        return original(path)
    service.request = changing
    with pytest.raises(BaselineError) as error:
        service.refresh('example', 'project', 12)
    assert error.value.code == 'PR_VERSION_CHANGED'
    assert service.get(first['snapshotId']) == first


def test_closed_state_and_missing_patch_are_honest(review):
    service, pr, files, _, _ = review
    pr.update(state='closed', merged=True)
    files[0].pop('patch')
    result = service.refresh('example', 'project', 12)
    assert result['remoteState'] == 'merged'
    assert result['snapshot']['files'][0]['patchComplete'] is False


def test_force_push_history_is_explicit_and_old_source_is_kept(review):
    service, pr, _, _, _ = review
    first = service.refresh('example', 'project', 12)['snapshot']
    original = service.request
    service.request = lambda path: {'status': 'diverged'} if '/compare/' in path else original(path)
    pr['head']['sha'] = 'e' * 40
    latest = service.refresh('example', 'project', 12)['snapshot']
    assert latest['historyRelation'] == 'diverged'
    assert latest['previousSnapshotId'] == first['snapshotId']
    assert service.get(first['snapshotId']) == first


def test_model_clues_are_bound_to_exact_pr_head_and_do_not_change_manual_data(review, monkeypatch):
    service, _, _, _, _ = review
    source = service.refresh('example', 'project', 12)['snapshot']
    monkeypatch.setattr(service.sync, '_generic_model', lambda _: ({}, {'featureSchemaVersion': 'fixture-schema'}))
    monkeypatch.setattr(service.sync, '_execute', lambda _: None)
    result = service.analyze(source['snapshotId'], {'modelId': 'chosen-model'})
    job = result['analyses'][0]['sync']
    assert job['branch'] == source['headSha'] and job['resolvedModelId'] == 'chosen-model'
    service.sync.sync.complete(job['syncId'], source['repositoryId'], [], head_commit=source['headSha'],
                               model_id='chosen-model', run_id='fixture-run', dataset_version='fixture-data')
    assert service.analyses(source['snapshotId'])['analyses'][0]['contextValid'] is True
    service.sync.sync.update(job['syncId'], head_commit='f' * 40)
    result = service.analyses(source['snapshotId'])
    assert result['analyses'][0]['contextValid'] is False and result['analyses'][0]['scores'] == []
    assert service.get(source['snapshotId']) == source


def test_public_pr_api_keeps_maintenance_protected_and_returns_request_ids(review):
    from fastapi.testclient import TestClient
    from jit_baseline.api import create_app
    service, _, _, _, storage = review
    app = create_app(database=storage.path, sync_service=service.sync)
    app.state.pr_review.request = service.request
    with TestClient(app) as client:
        response = client.post('/api/v1/review-sources', json={'url': 'https://github.com/example/project/pull/12'})
        assert response.status_code == 200
        source = response.json()['snapshot']
        assert response.headers['X-Request-Id']
        import jsonschema
        from test_openapi import document
        doc = document()
        def validate(value, schema):
            jsonschema.Draft202012Validator({'$ref': f'#/components/schemas/{schema}', 'components': doc['components']}).validate(value)
        validate(response.json(), 'PRPrepared')
        validate(source, 'PRSourceSnapshot')
        validate(client.get('/api/v1/pr-snapshots/' + source['snapshotId'] + '/context', params={'path': 'src/token.py', 'side': 'head'}).json(), 'PRFileContext')
        validate(client.get('/api/v1/pr-snapshots/' + source['snapshotId'] + '/analyses').json(), 'PRAnalyses')
        assert doc['paths']['/api/v1/review-sources']['post']['security'] == []
        assert client.get('/api/v1/pr-snapshots/' + source['snapshotId']).json()['headSha'] == 'b' * 40
        assert client.get('/api/v1/models').status_code == 401
        invalid = client.post('/api/v1/review-sources', json={'url': 'file:///x'})
        assert invalid.status_code == 422 and invalid.json()['error']['requestId']
        assert client.post('/api/v1/review-sources', json={'url': 'https://github.com/example/project', 'privateNotes': 'not accepted'}).status_code == 422
        missing = client.get('/api/v1/pr-snapshots/missing/context', params={'path': 'src/token.py'})
        assert missing.status_code == 404 and missing.json()['error']['requestId']


@pytest.mark.parametrize('url', ['https://evil.example/a/b/pull/1', 'https://github.com/a/b/../pull/1', 'https://user:pass@github.com/a/b', 'file:///x', 'https://github.com/a/b/issues/2'])
def test_intake_rejects_non_public_github_source(review, url):
    with pytest.raises(BaselineError):
        review[0].intake({'url': url})


@pytest.fixture
def bound_review(review, monkeypatch):
    service = review[0]
    monkeypatch.setattr(service.sync, '_generic_model', lambda _: ({}, {'featureSchemaVersion': 'kamei14-git-v1'}))
    monkeypatch.setattr(service.sync, '_execute', lambda _: None)
    return review


def finish_job(service, source, job):
    service.sync.sync.complete(job['syncId'], source['repositoryId'],
        [dict(id=source['headSha'], epoch=1, risk=.4, addedLines=1, deletedLines=1,
              files=1, features={'nf': 1}, label=0)], head_commit=source['headSha'],
        model_id=job['resolvedModelId'], run_id='fixture-run', dataset_version='fixture-data',
        feature_schema_version='kamei14-git-v1')


@pytest.mark.parametrize('fork', [False, True])
def test_pr_creation_and_completion_never_publish_branch_or_fork_project(bound_review, fork):
    service, pr, _, _, storage = bound_review
    branch, _ = service.sync.create({'repositoryUrl': 'https://github.com/example/project', 'branch': 'main'})
    repository_id = branch['repositoryId']
    service.sync.sync.complete(branch['syncId'], repository_id, [], head_commit='a'*40,
        model_id='branch-model', run_id='branch-run', dataset_version='branch-data')
    before = service.sync.sync.repository_get(repository_id)
    if fork:
        pr['head']['repo']['full_name'] = 'someone/fork'
    source = service.refresh('example', 'project', 12, repository_id)['snapshot']
    job = service.analyze(source['snapshotId'], {'modelId': 'chosen-model'})['analyses'][0]['sync']
    assert job['repositoryId'] == repository_id
    assert job['repositoryUrl'].endswith('someone/fork' if fork else 'example/project')
    assert job['sourceKind'] == 'pr' and job['sourceSnapshotId'] == source['snapshotId']
    assert service.sync.sync.repository_get(repository_id) == before
    finish_job(service, source, job)
    assert service.sync.sync.repository_get(repository_id) == before
    with storage.connection() as db:
        assert db.execute('SELECT count(*) FROM repository').fetchone()[0] == 1
        assert db.execute('SELECT snapshot_id,sync_id FROM pr_analysis').fetchone()[:] == (source['snapshotId'], job['syncId'])
        assert db.execute('SELECT snapshot_id,model_id,sync_id FROM pr_analysis_intent').fetchone()[:] == (source['snapshotId'], 'chosen-model', job['syncId'])
    with pytest.raises(BaselineError) as failure:
        service.sync.select_view(repository_id, {'viewSyncId': job['syncId']})
    assert failure.value.code == 'CONTEXT_MISMATCH'


def test_exact_snapshot_model_reuses_active_success_and_separates_base_and_manual_analysis(bound_review):
    service, pr, _, _, _ = bound_review
    source = service.refresh('example', 'project', 12)['snapshot']
    first = service.analyze(source['snapshotId'], {'modelId': 'chosen-model'})['analyses'][0]['sync']
    assert service.analyze(source['snapshotId'], {'modelId': 'chosen-model'})['analyses'][0]['sync']['syncId'] == first['syncId']
    finish_job(service, source, first)
    assert service.analyze(source['snapshotId'], {'modelId': 'chosen-model', 'retry': True})['analyses'][0]['sync']['syncId'] == first['syncId']
    ordinary, created = service.sync.create({'repositoryUrl': first['repositoryUrl'], 'branch': first['branch'],
        'strategy': 'generic-model', 'modelId': 'chosen-model'})
    assert created and ordinary['syncId'] != first['syncId'] and ordinary['sourceKind'] == 'branch'
    pr['base']['sha'] = 'e'*40
    changed = service.refresh('example', 'project', 12)['snapshot']
    next_job = service.analyze(changed['snapshotId'], {'modelId': 'chosen-model'})['analyses'][0]['sync']
    assert changed['headSha'] == source['headSha'] and changed['snapshotId'] != source['snapshotId']
    assert next_job['syncId'] != first['syncId']
    other = service.analyze(source['snapshotId'], {'modelId': 'other-model'})['analyses']
    assert any(item['sync']['resolvedModelId'] == 'other-model' for item in other)


@pytest.mark.parametrize('terminal', ['failed', 'cancelled', 'interrupted'])
def test_terminal_pr_requires_explicit_retry_and_keeps_fixed_model(bound_review, terminal):
    service = bound_review[0]
    source = service.refresh('example', 'project', 12)['snapshot']
    job = service.analyze(source['snapshotId'], {'modelId': 'chosen-model'})['analyses'][0]['sync']
    service.sync.sync.finish(job['syncId'], terminal, 'SYNC_INTERRUPTED', '测试终态')
    same = service.analyze(source['snapshotId'], {'modelId': 'chosen-model'})['analyses'][0]['sync']
    assert same['syncId'] == job['syncId'] and same['status'] == terminal
    result = service.analyze(source['snapshotId'], {'modelId': 'chosen-model', 'retry': True})
    jobs = [item['sync'] for item in result['analyses']]
    fresh = next(item for item in jobs if item['syncId'] != job['syncId'])
    assert fresh['resolvedModelId'] == 'chosen-model' and fresh['sourceSnapshotId'] == source['snapshotId']
    assert service.sync.get(job['syncId'])['status'] == terminal


def test_concurrent_manual_and_automatic_share_single_atomic_task(bound_review):
    from concurrent.futures import ThreadPoolExecutor
    service, _, _, _, storage = bound_review
    source = service.refresh('example', 'project', 12)['snapshot']
    with ThreadPoolExecutor(max_workers=8) as workers:
        list(workers.map(lambda index: service.analyze(source['snapshotId'], {'modelId': 'chosen-model'}, automatic=bool(index % 2)), range(8)))
    with storage.connection() as db:
        assert db.execute('SELECT count(*) FROM pr_analysis').fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM repository_sync WHERE source_kind='pr'").fetchone()[0] == 1


def test_same_sha_refresh_exposes_current_metadata_without_mutating_snapshot(review):
    service, pr, _, _, _ = review
    first = service.refresh('example', 'project', 12)
    pr.update(draft=True, title='新版标题', updated_at='2026-10-29T01:00:00Z')
    refreshed = service.refresh('EXAMPLE', 'PROJECT', 12)
    assert refreshed['snapshot'] == first['snapshot']
    assert refreshed['draft'] is True and refreshed['pullRequest']['title'] == '新版标题'
    pr.update(draft=False)
    assert service.refresh('example', 'project', 12)['draft'] is False


def test_duplicate_case_projects_keep_scoped_snapshots_and_old_identity(review):
    from uuid import uuid4
    from jit_baseline.catalog_storage import utc_now
    service, _, _, _, storage = review
    first = service.sync.create_repository({'repositoryUrl': 'https://github.com/Example/Project'})[0]
    original = service.refresh('example', 'project', 12, first['repositoryId'])['snapshot']
    duplicate_id = str(uuid4())
    service.sync.sync.repository_create(dict(id=duplicate_id, url='https://github.com/EXAMPLE/PROJECT', display_name='重复项目',
        created_at=utc_now(), updated_at=utc_now(), commit_count=0,
        high_count=0, medium_count=0, low_count=0, unknown_count=0))
    other = service.refresh('example', 'project', 12, duplicate_id)['snapshot']
    assert other['repositoryId'] == duplicate_id and other['snapshotId'] != original['snapshotId']
    assert service.get(original['snapshotId']) == original
    with storage.connection() as db:
        assert db.execute('SELECT count(*) FROM pr_latest').fetchone()[0] == 2
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []


def test_project_context_mismatch_and_private_source_are_rejected_before_snapshot(review):
    service, pr, _, _, _ = review
    other = service.sync.create_repository({'repositoryUrl': 'https://github.com/other/project'})[0]
    with pytest.raises(BaselineError) as failure:
        service.refresh('example', 'project', 12, other['repositoryId'])
    assert failure.value.code == 'CONTEXT_MISMATCH'
    pr['base']['repo']['private'] = True
    with pytest.raises(BaselineError) as failure:
        service.refresh('example', 'project', 12)
    assert failure.value.code == 'PR_SOURCE_UNAVAILABLE'


def test_public_analysis_cannot_inject_internal_source_kind(bound_review):
    with pytest.raises(BaselineError) as failure:
        bound_review[0].sync.create({'repositoryUrl': 'https://github.com/example/project', 'sourceKind': 'pr'})
    assert failure.value.code == 'INPUT_INVALID'


@pytest.fixture
def legacy_review(tmp_path):
    """先按012结构保存旧fork任务及真实多快照关联，再执行正向迁移。"""
    from jit_baseline.catalog_storage import MIGRATIONS
    from jit_baseline.pr_review import PullRequestReview
    database = tmp_path / 'legacy-pr.sqlite3'
    head = 'b' * 40
    sources = [dict(snapshotId=identity, repositoryId='base-project', owner='example', name='project', number=12,
        headSha=head, baseSha=base, headRepository='someone/fork', baseRepository='example/project',
        commits=[{'sha': head}], totalCommits=1, commitsComplete=True)
        for identity, base in (('snapshot-a', 'a' * 40), ('snapshot-z', 'c' * 40))]
    old_jobs = {
        'legacy-unresolved': ('completed', head, 'legacy-model', None),
        'legacy-bound': ('completed', head, 'legacy-model', 'legacy-model'),
        'bad-head': ('completed', 'f' * 40, 'legacy-model', 'legacy-model'),
        'bad-model': ('completed', head, 'legacy-model', 'other-model'),
        'missing-model': ('completed', head, None, None),
        'empty-model': ('completed', head, '', None),
        'unfinished': ('failed', head, 'legacy-model', None),
    }
    with sqlite3.connect(database) as db:
        db.execute('PRAGMA foreign_keys=ON')
        for number, path in MIGRATIONS:
            if number <= 12:
                db.executescript(path.read_text(encoding='utf-8'))
        db.execute("INSERT INTO schema_migration VALUES (12,'fixture')")
        for identity, url in (('base-project', 'https://github.com/example/project'), ('fork-project', 'https://github.com/someone/fork')):
            db.execute('INSERT INTO repository(id,url,display_name,created_at,updated_at) VALUES (?,?,?,?,?)',
                       (identity, url, identity, 'fixture', 'fixture'))
        for source in sources:
            db.execute('INSERT INTO pr_snapshot VALUES (?,?,?,?,?,?,?,?,?)',
                       (source['snapshotId'], 'base-project', 'example', 'project', 12, source['baseSha'], head, json.dumps(source), 'fixture'))
        for identity, (status, actual_head, model, resolved) in old_jobs.items():
            db.execute('INSERT INTO repository_sync(id,repository_id,repository_url,branch,requested_strategy,status,stage,'
                'head_commit,model_id,resolved_model_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                (identity, 'fork-project', 'https://github.com/someone/fork', head, 'generic-model', status, status,
                 actual_head, model, resolved, 'fixture', 'fixture'))
            for source in sources:
                db.execute('INSERT INTO pr_analysis VALUES (?,?,?)', (source['snapshotId'], identity, 'fixture'))
            db.execute('INSERT INTO repository_commit(sync_id,commit_id,epoch,risk,added_lines,deleted_lines,files,features_json,label) '
                       "VALUES (?,?,1,.4,1,0,1,'{}',0)", (identity, head))
    storage = CatalogStorage(database)
    storage.initialize()
    service = SyncService(storage)
    yield PullRequestReview(service), sources, old_jobs
    service.close()


def test_v12_legacy_unresolved_model_and_shared_head_snapshots_keep_saved_scores(legacy_review):
    service, sources, old_jobs = legacy_review
    for source in sources:
        records = {item['sync']['syncId']: item for item in service.analyses(source['snapshotId'])['analyses']}
        assert len(records) == len(old_jobs)
        for identity in ('legacy-unresolved', 'legacy-bound'):
            record = records[identity]
            assert record['contextValid'] is True
            assert record['scores'] == [{'commitId': source['headSha'], 'risk': .4, 'files': [], 'addedLines': 1, 'deletedLines': 0, 'fileCount': 1}]
            assert record['bindingKind'] == 'legacy-head-v1'
            assert len(record['bindingLimitations']) == 2
            assert any('独占基项目' in value for value in record['bindingLimitations'])
            assert any('提交前模型绑定' in value for value in record['bindingLimitations'])
            assert record['coverageComplete'] is True and record['scoredCommits'] == record['totalCommits'] == 1
            assert record['sync']['repositoryId'] == 'fork-project'
    with service.storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM pr_legacy_analysis_binding').fetchone()[0] == len(old_jobs) * 2
        assert db.execute("SELECT source_snapshot_id FROM repository_sync WHERE id='legacy-unresolved'").fetchone()[0] == 'snapshot-a'
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []


@pytest.mark.parametrize('identity', ['bad-head', 'bad-model', 'missing-model', 'empty-model', 'unfinished'])
def test_legacy_evidence_never_bypasses_head_model_or_completion(legacy_review, identity):
    service, sources, _ = legacy_review
    for source in sources:
        record = next(item for item in service.analyses(source['snapshotId'])['analyses'] if item['sync']['syncId'] == identity)
        assert record['bindingKind'] == 'legacy-head-v1'
        assert record['contextValid'] is False and record['scores'] == []
        assert record['coverageComplete'] is False and record['scoredCommits'] == 0


def test_new_association_to_legacy_task_cannot_claim_migration_evidence(legacy_review):
    service, sources, _ = legacy_review
    source = dict(sources[0], snapshotId='post-migration-snapshot', baseSha='d' * 40)
    with service.storage.connection(write=True) as db:
        db.execute('INSERT INTO pr_snapshot VALUES (?,?,?,?,?,?,?,?,?)',
                   (source['snapshotId'], source['repositoryId'], 'example', 'project', 12,
                    source['baseSha'], source['headSha'], json.dumps(source), 'new'))
        db.execute('INSERT INTO pr_analysis VALUES (?,?,?)', (source['snapshotId'], 'legacy-unresolved', 'new'))
    service.storage.initialize()
    record = service.analyses(source['snapshotId'])['analyses'][0]
    assert record['bindingKind'] == 'snapshot-model-v1' and record['bindingLimitations'] == []
    assert record['contextValid'] is False and record['scores'] == []
    with service.storage.connection() as db:
        assert db.execute('SELECT 1 FROM pr_legacy_analysis_binding WHERE snapshot_id=?', (source['snapshotId'],)).fetchone() is None


@pytest.mark.parametrize('invalid_field,invalid_value', [('resolved_model_id', None), ('source_snapshot_id', 'another-snapshot'), ('source_kind', 'unknown')])
def test_post_migration_task_missing_strict_binding_is_not_legacy(bound_review, invalid_field, invalid_value):
    service, _, _, _, storage = bound_review
    source = service.refresh('example', 'project', 12)['snapshot']
    job = service.analyze(source['snapshotId'], {'modelId': 'chosen-model'})['analyses'][0]['sync']
    finish_job(service, source, job)
    valid = service.analyses(source['snapshotId'])['analyses'][0]
    assert valid['contextValid'] is True
    assert valid['bindingKind'] == 'snapshot-model-v1' and valid['bindingLimitations'] == []
    service.sync.sync.update(job['syncId'], **{invalid_field: invalid_value})
    invalid = service.analyses(source['snapshotId'])['analyses'][0]
    assert invalid['contextValid'] is False and invalid['scores'] == []
    assert invalid['bindingKind'] == 'snapshot-model-v1' and invalid['bindingLimitations'] == []
    with storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM pr_legacy_analysis_binding').fetchone()[0] == 0
