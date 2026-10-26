"""Real-source contracts using deterministic GitHub responses, without personal server data."""
import base64
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
    calls = []
    def create(payload):
        calls.append(payload)
        from jit_baseline.sync import utc_now
        now = utc_now()
        service.sync.sync.create({'id': 'bound-job', 'repository_id': source['repositoryId'], 'repository_url': 'https://github.com/example/project',
                                 'branch': source['headSha'], 'requested_strategy': 'generic-model', 'status': 'completed', 'stage': 'completed',
                                 'created_at': now, 'updated_at': now, 'head_commit': source['headSha'], 'model_id': 'chosen-model'})
        return service.sync.get('bound-job'), True
    monkeypatch.setattr(service.sync, 'create', create)
    result = service.analyze(source['snapshotId'], {'modelId': 'chosen-model'})
    assert calls[0]['branch'] == source['headSha'] and calls[0]['modelId'] == 'chosen-model'
    assert result['analyses'][0]['contextValid'] is True
    service.sync.sync.update('bound-job', head_commit='f' * 40)
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
