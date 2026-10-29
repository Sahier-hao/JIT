"""隔离目录库、可控检查 worker 和 GitHub 夹具覆盖 PR 自动跟踪状态迁移。"""
from concurrent.futures import Future, ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest

from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.errors import BaselineError
from jit_baseline.pr_review import PullRequestReview
from jit_baseline.pr_updates import PullRequestUpdates
from jit_baseline.sync import SyncService


class Clock:
    def __init__(self):
        self.value = datetime(2026, 10, 29, tzinfo=timezone.utc)

    def __call__(self):
        return self.value

    def advance(self, seconds):
        self.value += timedelta(seconds=seconds)


class Worker:
    def __init__(self):
        self.tasks = []

    def submit(self, fn, *args):
        future = Future()
        self.tasks.append((future, fn, args))
        return future

    def run(self):
        while self.tasks:
            future, fn, args = self.tasks.pop(0)
            try:
                future.set_result(fn(*args))
            except Exception as exc:
                future.set_exception(exc)
                raise

    def shutdown(self, wait=True):
        self.tasks.clear()


class GitHub:
    def __init__(self):
        self.repos = {}
        self.calls = []
        self.failure = None
        self.private = False
        self.before_detail = None

    def add(self, name='project', number=1, *, draft=False, fork=False):
        pr = dict(number=number, title=f'修复 {number}', body='公开说明', state='open', merged=False,
            draft=draft, user={'login': 'author'}, updated_at='2026-10-29T00:00:00Z',
            base={'sha': 'a' * 40, 'ref': 'main', 'repo': {'full_name': 'example/' + name, 'private': False}},
            head={'sha': f'{number:040x}', 'ref': 'feature', 'repo': {'full_name': 'fork/' + name if fork else 'example/' + name, 'private': False}},
            changed_files=1, commits=1)
        self.repos.setdefault(name, {})[number] = pr
        return pr

    def __call__(self, path):
        self.calls.append(path)
        if self.failure:
            raise self.failure
        url = urlparse(path)
        parts = url.path.strip('/').split('/')
        name = parts[2]
        if len(parts) == 3:
            return {'private': self.private}
        if parts[3] == 'compare':
            return {'status': 'ahead'}
        if len(parts) == 4:
            params = parse_qs(url.query)
            state, page = params['state'][0], int(params['page'][0])
            prs = [pr for pr in self.repos.get(name, {}).values() if state == 'all' or pr['state'] == state]
            prs.sort(key=lambda pr: pr['number'])
            return deepcopy(prs[(page - 1) * 30:page * 30])
        number = int(parts[4])
        pr = self.repos[name][number]
        if len(parts) == 5:
            if self.before_detail:
                self.before_detail()
            return deepcopy(pr)
        if parts[5] == 'files':
            return [dict(filename='src/app.py', sha='f' * 40, status='modified', additions=1, deletions=1, patch='@@ -1 +1 @@\n-old\n+new')]
        if parts[5] == 'commits':
            return [{'sha': pr['head']['sha'], 'commit': {'message': '修复', 'author': {'date': '2026-10-29T00:00:00Z'}}}]
        raise AssertionError(path)


class Environment:
    def __init__(self, watcher, service, github, clock, worker, review):
        self.watcher, self.service, self.github = watcher, service, github
        self.clock, self.worker, self.review = clock, worker, review

    def repository(self, name='project'):
        return self.service.create_repository({'repositoryUrl': 'https://github.com/example/' + name})[0]['repositoryId']

    def enable(self, repository_id, model='fixed-model'):
        return self.watcher.configure(repository_id, {'enabled': True, 'modelId': model, 'confirmExisting': True})

    def check(self, repository_id):
        self.watcher.request(repository_id)
        self.worker.run()
        return self.watcher.get(repository_id)

    def jobs(self, repository_id):
        return self.service.repository_syncs(repository_id)['syncs']

    def complete(self, job, risk=.3):
        source = self.review.get(job['sourceSnapshotId'])
        self.service.sync.update(job['syncId'], status='completed', stage='completed', model_id=job['resolvedModelId'],
                                 head_commit=source['headSha'], completed_at=self.watcher._now())
        self.service.sync.write_commits(job['syncId'], [dict(id=source['headSha'], epoch=1793232000,
            risk=risk, addedLines=1, deletedLines=1, files=1, features={}, label=0)])

    def fail(self, job, code='REPOSITORY_UNAVAILABLE', status='failed'):
        self.service.sync.update(job['syncId'], status=status, error_code=code, error_message='测试故障', completed_at=self.watcher._now())


@pytest.fixture
def env(tmp_path, monkeypatch):
    storage = CatalogStorage(tmp_path / 'pr-updates.sqlite3')
    storage.initialize()
    service = SyncService(storage, allow_local=True, collect_fn=lambda **kw: None)
    monkeypatch.setattr(service.catalog, 'default_model_id', lambda: 'fixed-model')
    monkeypatch.setattr(service, '_generic_model', lambda model_id: ({}, {'featureSchemaVersion': 'kamei14-git-v1'}))
    monkeypatch.setattr(service, '_execute', lambda sync_id: None)
    github, clock, worker = GitHub(), Clock(), Worker()
    review = PullRequestReview(service, request=github)
    watcher = PullRequestUpdates(service, review, clock=clock, executor=worker)
    yield Environment(watcher, service, github, clock, worker, review)
    watcher.close()
    service.close()


def test_get_and_list_are_read_only_and_non_github_is_honest(env):
    repo = env.repository()
    assert env.watcher.get(repo)['enabled'] is False
    assert env.watcher.list_prs(repo)['pullRequests'] == []
    assert env.github.calls == []
    with env.watcher.storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM pr_watch').fetchone()[0] == 0
    other = env.service.create_repository({'repositoryUrl': 'https://gitlab.com/example/project'})[0]['repositoryId']
    assert env.watcher.list_prs(other)['supported'] is False
    assert env.watcher.refresh_list(other)['pullRequests'] == []
    assert env.github.calls == []
    with pytest.raises(BaselineError):
        env.enable(other)


def test_first_enable_requires_confirmation_and_pins_real_model(env, monkeypatch):
    repo = env.repository()
    with pytest.raises(BaselineError) as error:
        env.watcher.configure(repo, {'enabled': True})
    assert error.value.code == 'INPUT_INVALID'
    monkeypatch.setattr(env.service.catalog, 'default_model_id', lambda: None)
    with pytest.raises(BaselineError) as error:
        env.watcher.configure(repo, {'enabled': True, 'confirmExisting': True})
    assert error.value.code == 'DEFAULT_MODEL_REQUIRED'
    result = env.enable(repo)
    assert result['modelId'] == 'fixed-model' and result['intervalSeconds'] == 300
    monkeypatch.setattr(env.service.catalog, 'default_model_id', lambda: 'new-default')
    assert env.watcher.configure(repo, {'intervalSeconds': 600})['modelId'] == 'fixed-model'
    for payload in ({'intervalSeconds': 1}, {'enabled': 1}, {'modelId': ''}, {'confirmExisting': 'yes'}, {'privateNotes': '拒绝'}):
        with pytest.raises(BaselineError):
            env.watcher.configure(repo, payload)


def test_disabled_immediate_check_only_refreshes_and_does_not_confirm_enable(env):
    repo = env.repository()
    env.github.add()
    assert env.watcher.request(repo)['status'] == 'checking'
    assert env.jobs(repo) == []
    env.worker.run()
    assert env.watcher.get(repo)['enabled'] is False
    assert env.jobs(repo) == []
    assert env.watcher.list_prs(repo)['pullRequests'][0]['snapshotId']
    with pytest.raises(BaselineError):
        env.watcher.configure(repo, {'enabled': True})


def test_list_refresh_is_project_bound_public_only_and_preserves_stale_cache(env):
    repo = env.repository()
    env.github.add(fork=True)
    listed = env.watcher.refresh_list(repo)
    assert listed['pullRequests'][0]['draft'] is False
    assert env.service.repositories()['total'] == 1
    calls = len(env.github.calls)
    assert env.watcher.list_prs(repo) == listed
    assert len(env.github.calls) == calls
    env.github.private = True
    stale = env.watcher.refresh_list(repo)
    assert stale['pullRequests'] == listed['pullRequests']
    assert stale['checkedAt'] == listed['checkedAt']
    assert stale['errorCode'] == 'PR_SOURCE_UNAVAILABLE'
    assert env.jobs(repo) == []


def test_same_snapshot_model_reuses_and_base_change_creates_new_intent_without_fork_project(env):
    repo = env.repository()
    pr = env.github.add(fork=True)
    env.enable(repo)
    env.check(repo)
    first = env.jobs(repo)[0]
    assert first['repositoryId'] == repo and first['origin'] == 'automatic'
    assert first['sourceKind'] == 'pr' and first['repositoryUrl'] == 'https://github.com/fork/project'
    assert env.service.sync.repository_get(repo)['latestSyncId'] is None
    env.check(repo)
    assert len(env.jobs(repo)) == 1
    env.complete(first)
    env.check(repo)
    assert len(env.jobs(repo)) == 1
    pr['base']['sha'] = 'c' * 40
    env.check(repo)
    assert len(env.jobs(repo)) == 2
    assert env.jobs(repo)[0]['sourceSnapshotId'] != first['sourceSnapshotId']
    assert env.service.repositories()['total'] == 1
    assert env.service.sync.repository_get(repo)['viewSyncId'] is None


def test_deep_budget_persistent_rotation_and_initial_summary_coalescing(env):
    repo = env.repository()
    for number in range(1, 46):
        env.github.add(number=number)
    env.enable(repo)
    env.check(repo)
    with env.watcher.storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM pr_snapshot').fetchone()[0] == 20
        assert db.execute('SELECT deep_cursor FROM pr_watch WHERE repository_id=?', (repo,)).fetchone()[0] == 20
    assert env.watcher.list_prs(repo)['hasMore'] is True
    assert env.watcher.events(repo)['events'] == []
    env.check(repo)
    with env.watcher.storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM pr_snapshot').fetchone()[0] == 40
    events = env.watcher.events(repo)['events']
    assert len(events) == 1 and events[0]['kind'] == 'pr-initial-summary'
    assert events[0]['discoveredCount'] == 45
    env.check(repo)
    with env.watcher.storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM pr_snapshot').fetchone()[0] == 45
        assert db.execute("SELECT COUNT(*) FROM pr_cache WHERE remote_state='open'").fetchone()[0] == 45
    assert len([event for event in env.watcher.events(repo)['events'] if event['kind'] == 'pr-initial-summary']) == 1


def test_global_queue_budget_project_fairness_and_manual_jobs_are_untouched(env):
    repos = []
    for name in ('alpha', 'beta', 'gamma'):
        repo = env.repository(name)
        env.github.add(name, 1)
        env.github.add(name, 2)
        env.enable(repo)
        repos.append(repo)
    for _ in range(3):
        assert env.watcher.tick() == 1
        env.worker.run()
    assert [len(env.jobs(repo)) for repo in repos] == [1, 1, 0]
    first = env.jobs(repos[0])[0]
    env.service.sync.update(first['syncId'], status='collecting')
    env.clock.advance(300)
    assert env.watcher.tick() == 1
    env.worker.run()
    assert sum(job['status'] == 'queued' and job['origin'] == 'automatic' for repo in repos for job in env.jobs(repo)) <= 2
    manual, _ = env.service.create({'repositoryUrl': 'https://github.com/example/manual', 'strategy': 'generic-model', 'modelId': 'fixed-model'})
    for repo in repos:
        env.check(repo)
    assert env.service.get(manual['syncId'])['status'] == 'queued'


def test_rapid_pushes_cancel_only_old_automatic_queue_and_keep_latest_pending(env):
    repo = env.repository()
    pr = env.github.add()
    env.enable(repo)
    env.check(repo)
    first = env.jobs(repo)[0]
    pr['head']['sha'] = 'b' * 40
    env.check(repo)
    assert env.service.get(first['syncId'])['status'] == 'cancelled'
    second = env.jobs(repo)[0]
    env.service.sync.update(second['syncId'], status='collecting')
    pr['head']['sha'] = 'c' * 40
    env.check(repo)
    pr['head']['sha'] = 'd' * 40
    env.check(repo)
    assert len(env.jobs(repo)) == 2
    with env.watcher.storage.connection() as db:
        assert db.execute("SELECT COUNT(*) FROM pr_auto_intent WHERE status='pending'").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM pr_auto_intent WHERE status='superseded'").fetchone()[0] == 2
    env.complete(second)
    env.check(repo)
    assert len(env.jobs(repo)) == 3
    latest = env.jobs(repo)[0]
    assert env.review.get(latest['sourceSnapshotId'])['headSha'] == 'd' * 40
    ready = next(event for event in env.watcher.events(repo)['events'] if event['kind'] == 'pr-analysis-ready')
    assert ready['syncId'] == second['syncId'] and ready['isCurrent'] is False


def test_draft_transition_close_merge_and_reopen(env):
    repo = env.repository()
    pr = env.github.add(draft=True)
    env.enable(repo)
    env.check(repo)
    assert env.jobs(repo) == []
    pr['draft'] = False
    env.check(repo)
    assert len(env.jobs(repo)) == 1
    first = env.jobs(repo)[0]
    env.complete(first)
    pr.update(state='closed', merged=True, updated_at='2026-10-29T01:00:00Z')
    pr['head']['sha'] = 'b' * 40
    env.check(repo)
    assert len(env.jobs(repo)) == 1
    assert any(event['kind'] == 'pr-merged' for event in env.watcher.events(repo)['events'])
    pr.update(state='open', merged=False)
    env.check(repo)
    assert len(env.jobs(repo)) == 2


def test_pause_does_not_cancel_submitted_or_enable_on_manual_check(env):
    repo = env.repository()
    pr = env.github.add()
    env.enable(repo)
    env.check(repo)
    first = env.jobs(repo)[0]
    env.watcher.configure(repo, {'enabled': False})
    pr['head']['sha'] = 'b' * 40
    env.check(repo)
    assert env.service.get(first['syncId'])['status'] == 'queued'
    assert len(env.jobs(repo)) == 1
    assert env.watcher.tick() == 0
    assert env.watcher.get(repo)['nextCheckAt'] is None
    env.watcher.configure(repo, {'enabled': True})
    env.check(repo)
    assert env.service.get(first['syncId'])['status'] == 'cancelled'
    assert len(env.jobs(repo)) == 2


def test_cancel_and_restart_interruption_never_resurrect_same_intent(env):
    repo = env.repository()
    pr = env.github.add()
    env.enable(repo)
    env.check(repo)
    first = env.jobs(repo)[0]
    env.service.cancel(first['syncId'])
    env.check(repo)
    assert len(env.jobs(repo)) == 1
    assert env.watcher.list_prs(repo)['pullRequests'][0]['analysisStatus'] == 'cancelled'
    pr['head']['sha'] = 'b' * 40
    env.check(repo)
    second = env.jobs(repo)[0]
    env.service.sync.interrupted()
    restarted = PullRequestUpdates(env.service, env.review, clock=env.clock, executor=Worker())
    try:
        restarted.tick()
        restarted.request(repo)
        restarted.executor.run()
        assert len(env.jobs(repo)) == 2
        assert env.service.get(second['syncId'])['status'] == 'interrupted'
        assert len([event for event in restarted.events(repo)['events'] if event['kind'] == 'pr-analysis-failed']) == 2
        restarted.tick()
        assert len([event for event in restarted.events(repo)['events'] if event['kind'] == 'pr-analysis-failed']) == 2
    finally:
        restarted.close()


def test_explicit_retry_is_adopted_with_same_model_and_manual_model_does_not_override(env):
    repo = env.repository()
    env.github.add()
    env.enable(repo)
    env.check(repo)
    first = env.jobs(repo)[0]
    env.service.cancel(first['syncId'])
    env.check(repo)
    env.review.analyze(first['sourceSnapshotId'], {'modelId': 'personal-model'})
    env.check(repo)
    assert env.watcher.get(repo)['modelId'] == 'fixed-model'
    assert env.watcher.list_prs(repo)['pullRequests'][0]['analysisStatus'] == 'cancelled'
    env.review.analyze(first['sourceSnapshotId'], {'modelId': 'fixed-model'}, retry=True)
    env.check(repo)
    item = env.watcher.list_prs(repo)['pullRequests'][0]
    assert item['analysisStatus'] == 'queued' and item['syncId'] != first['syncId']
    assert item['modelId'] == 'fixed-model'


def test_transient_analysis_retries_exactly_three_times_with_1_5_15_minute_backoff(env):
    repo = env.repository()
    env.github.add()
    env.enable(repo)
    env.check(repo)
    for index, delay in enumerate((60, 300, 900)):
        latest = env.jobs(repo)[0]
        env.fail(latest)
        env.watcher.tick()
        env.worker.run()
        with env.watcher.storage.connection() as db:
            intent = dict(db.execute('SELECT * FROM pr_auto_intent').fetchone())
        assert intent['status'] == 'backoff'
        assert intent['retry_count'] == index
        assert intent['retry_at'] == env.watcher._after(delay)
        env.clock.advance(delay - 1)
        env.check(repo)
        assert len(env.jobs(repo)) == index + 1
        env.clock.advance(1)
        env.check(repo)
        assert len(env.jobs(repo)) == index + 2
    env.fail(env.jobs(repo)[0])
    env.watcher.tick()
    assert env.watcher.list_prs(repo)['pullRequests'][0]['analysisStatus'] == 'failed'
    env.clock.advance(3600)
    env.check(repo)
    assert len(env.jobs(repo)) == 4
    assert len([event for event in env.watcher.events(repo)['events'] if event['kind'] == 'pr-analysis-failed']) == 1
    assert all(job['requestedModelId'] == 'fixed-model' for job in env.jobs(repo))


def test_discovery_rate_limit_honors_retry_after_and_does_not_fan_out_failed_jobs(env):
    repo = env.repository()
    env.github.add()
    env.enable(repo)
    env.check(repo)
    error = BaselineError('PR_RATE_LIMITED', '限流')
    error.retry_after = 1200
    env.github.failure = error
    state = env.check(repo)
    assert state['errorCode'] == 'PR_RATE_LIMITED'
    assert state['nextCheckAt'] == env.watcher._after(1200)
    assert state['retryNotBefore'] == env.watcher._after(1200)
    calls = len(env.github.calls)
    env.check(repo)
    assert len(env.github.calls) == calls
    assert len(env.jobs(repo)) == 1
    assert all(event['kind'] != 'pr-analysis-failed' for event in env.watcher.events(repo)['events'])
    env.github.failure = None
    env.clock.advance(1200)
    assert env.watcher.tick() == 1
    env.worker.run()
    assert env.watcher.get(repo)['errorCode'] is None


def test_model_failure_requires_user_action_without_fallback(env, monkeypatch):
    repo = env.repository()
    env.github.add()
    env.enable(repo)
    monkeypatch.setattr(env.service, '_generic_model', lambda model_id: (_ for _ in ()).throw(BaselineError('MODEL_DISABLED', '停用')))
    env.check(repo)
    assert env.jobs(repo) == []
    item = env.watcher.list_prs(repo)['pullRequests'][0]
    assert item['analysisStatus'] == 'failed' and item['modelId'] == 'fixed-model'
    event = next(event for event in env.watcher.events(repo)['events'] if event['kind'] == 'pr-analysis-failed')
    assert event['modelId'] == 'fixed-model' and event['errorCode'] == 'MODEL_DISABLED'
    env.clock.advance(1800)
    env.check(repo)
    assert env.jobs(repo) == []


def test_completion_events_use_only_exact_source_scores_and_expose_coverage(env):
    repo = env.repository()
    pr = env.github.add()
    pr['commits'] = 2
    env.enable(repo)
    env.check(repo)
    job = env.jobs(repo)[0]
    env.complete(job, .4)
    env.watcher.tick()
    event = next(event for event in env.watcher.events(repo)['events'] if event['kind'] == 'pr-analysis-ready')
    assert event['highScoreCount'] == 1 and event['coverageComplete'] is False
    assert event['scoredCount'] == 1 and event['totalCommits'] == 2
    assert '整体' not in event['message'] and 'risk' not in event
    assert '不能视为低风险' in event['message']
    env.watcher.tick()
    assert len([event for event in env.watcher.events(repo)['events'] if event['kind'] == 'pr-analysis-ready']) == 1
    pr['head']['sha'] = 'b' * 40
    env.check(repo)
    event = next(event for event in env.watcher.events(repo)['events'] if event['kind'] == 'pr-analysis-ready')
    assert event['isCurrent'] is False
    assert event['snapshotId'] == job['sourceSnapshotId'] and event['syncId'] == job['syncId']


def test_wrong_completed_head_is_not_reported_as_ready(env):
    repo = env.repository()
    env.github.add()
    env.enable(repo)
    env.check(repo)
    job = env.jobs(repo)[0]
    env.complete(job)
    env.service.sync.update(job['syncId'], head_commit='e' * 40)
    env.watcher.tick()
    events = env.watcher.events(repo)['events']
    assert not any(event['kind'] == 'pr-analysis-ready' for event in events)
    assert next(event for event in events if event['kind'] == 'pr-analysis-failed')['errorCode'] == 'PR_ANALYSIS_CONTEXT_INVALID'


def test_overlapping_requests_lease_recovery_pause_race_and_delete_guard(env):
    repo = env.repository()
    env.github.add()
    env.enable(repo)
    with ThreadPoolExecutor(max_workers=5) as executor:
        states = list(executor.map(lambda _: env.watcher.request(repo), range(5)))
    assert len(env.worker.tasks) == 1
    assert all(state['status'] == 'checking' for state in states)
    with pytest.raises(BaselineError) as error:
        env.service.delete_repository(repo)
    assert error.value.code == 'CONFLICT_ACTIVE_SYNC'
    old_token = env.watcher._row(repo)['check_token']
    env.clock.advance(601)
    env.watcher.request(repo)
    new_token = env.watcher._row(repo)['check_token']
    assert old_token != new_token
    env.worker.run()
    assert len(env.jobs(repo)) == 1
    env.github.add(number=2)
    env.github.before_detail = lambda: env.watcher.configure(repo, {'enabled': False})
    env.check(repo)
    assert len(env.jobs(repo)) == 1
    assert env.watcher.get(repo)['enabled'] is False


def test_event_pagination_and_repository_delete_cascade(env):
    repo = env.repository()
    env.github.add()
    env.enable(repo)
    env.check(repo)
    env.complete(env.jobs(repo)[0])
    env.watcher.tick()
    first = env.watcher.events(limit=1)
    second = env.watcher.events(limit=1, offset=1)
    assert first['total'] == 2 and second['total'] == 2
    assert first['events'][0]['eventId'] != second['events'][0]['eventId']
    assert first['events'][0]['owner'] == 'example'
    for kwargs in ({'limit': 0}, {'offset': -1}, {'limit': True}):
        with pytest.raises(BaselineError):
            env.watcher.events(**kwargs)
    env.service.delete_repository(repo)
    with env.watcher.storage.connection() as db:
        for table in ('pr_watch', 'pr_cache', 'pr_list_page', 'pr_auto_intent', 'pr_auto_attempt', 'project_event'):
            assert db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0
    assert env.watcher.events()['events'] == []


def test_rotation_survives_checker_restart_and_lease_is_renewed_per_pr(env):
    repo = env.repository()
    for number in range(1, 46):
        env.github.add(number=number)
    env.enable(repo)
    env.github.before_detail = lambda: env.clock.advance(100)
    env.check(repo)
    assert env.watcher.get(repo)['status'] == 'unchanged'
    env.watcher.close()
    env.worker = Worker()
    env.watcher = PullRequestUpdates(env.service, env.review, clock=env.clock, executor=env.worker)
    env.check(repo)
    with env.watcher.storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM pr_snapshot').fetchone()[0] == 40
        assert db.execute('SELECT deep_cursor FROM pr_watch').fetchone()[0] == 40
    assert env.watcher.get(repo)['openCachedCount'] == 45
    assert env.watcher.get(repo)['pendingCount'] >= 38


def test_public_metadata_can_change_without_mutating_fixed_snapshot(env):
    repo = env.repository()
    pr = env.github.add()
    env.enable(repo)
    env.check(repo)
    snapshot_id = env.jobs(repo)[0]['sourceSnapshotId']
    fixed = env.review.get(snapshot_id)
    pr.update(title='公开标题更新', updated_at='2026-10-29T01:00:00Z', state='closed')
    env.check(repo)
    first_close = next(event for event in env.watcher.events(repo)['events'] if event['kind'] == 'pr-closed')
    pr.update(updated_at='2026-10-29T02:00:00Z', state='open')
    env.check(repo)
    item = env.watcher.list_prs(repo)['pullRequests'][0]
    assert item['title'] == '公开标题更新' and item['updatedAt'] == pr['updated_at']
    assert item['snapshotId'] == snapshot_id
    pr.update(updated_at='2026-10-29T03:00:00Z', state='closed')
    env.check(repo)
    closed = [event for event in env.watcher.events(repo)['events'] if event['kind'] == 'pr-closed']
    assert len(closed) == 2 and len({event['eventId'] for event in closed}) == 2
    assert first_close['snapshotId'] == snapshot_id
    assert env.review.get(snapshot_id) == fixed


def test_old_model_completion_is_historical_and_selected_new_model_is_separate(env):
    repo = env.repository()
    env.github.add()
    env.enable(repo)
    env.check(repo)
    first = env.jobs(repo)[0]
    env.service.sync.update(first['syncId'], status='collecting')
    env.watcher.configure(repo, {'modelId': 'second-model'})
    env.check(repo)
    assert len(env.jobs(repo)) == 1
    env.complete(first)
    env.check(repo)
    ready = next(event for event in env.watcher.events(repo)['events'] if event['kind'] == 'pr-analysis-ready')
    assert ready['modelId'] == 'fixed-model' and ready['isCurrent'] is False
    assert env.jobs(repo)[0]['requestedModelId'] == 'second-model'
    assert env.jobs(repo)[0]['sourceSnapshotId'] == first['sourceSnapshotId']


def test_manual_successful_same_source_model_is_reused_without_automatic_job(env):
    repo = env.repository()
    env.github.add()
    snapshot = env.review.refresh('example', 'project', 1, repository_id=repo)['snapshot']
    env.review.analyze(snapshot['snapshotId'], {'modelId': 'fixed-model'})
    manual = env.jobs(repo)[0]
    env.complete(manual, .1)
    env.enable(repo)
    env.check(repo)
    assert len(env.jobs(repo)) == 1
    assert env.jobs(repo)[0]['origin'] == 'manual'
    assert env.watcher.list_prs(repo)['pullRequests'][0]['syncId'] == manual['syncId']
    ready = next(event for event in env.watcher.events(repo)['events'] if event['kind'] == 'pr-analysis-ready')
    assert ready['highScoreCount'] == 0 and ready['coverageComplete'] is True


def test_snapshot_public_source_failure_keeps_old_cache_and_does_not_clone_intents(env):
    repo = env.repository()
    pr = env.github.add()
    env.enable(repo)
    env.check(repo)
    first = env.jobs(repo)[0]
    pr['head']['repo']['private'] = True
    state = env.check(repo)
    assert state['errorCode'] == 'PR_SOURCE_UNAVAILABLE'
    assert len(env.jobs(repo)) == 1
    assert env.watcher.list_prs(repo)['pullRequests'][0]['snapshotId'] == first['sourceSnapshotId']
    with env.watcher.storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM pr_auto_intent').fetchone()[0] == 1


def test_latest_draft_state_blocks_new_target_even_when_saved_snapshot_was_ready(env):
    repo = env.repository()
    pr = env.github.add()
    env.enable(repo)
    env.check(repo)
    first = env.jobs(repo)[0]
    env.complete(first)
    pr['draft'] = True
    env.watcher.configure(repo, {'modelId': 'different-model'})
    env.check(repo)
    assert len(env.jobs(repo)) == 1
    assert env.watcher.list_prs(repo)['pullRequests'][0]['draft'] is True
    pr['draft'] = False
    env.check(repo)
    assert len(env.jobs(repo)) == 2


def test_closed_pr_backoff_does_not_create_busy_polling_or_retry(env):
    repo = env.repository()
    pr = env.github.add()
    env.enable(repo)
    env.check(repo)
    env.fail(env.jobs(repo)[0])
    env.watcher.tick()
    pr.update(state='closed', updated_at='2026-10-29T01:00:00Z')
    env.clock.advance(60)
    state = env.check(repo)
    assert state['nextCheckAt'] == env.watcher._after(300)
    assert len(env.jobs(repo)) == 1
    assert state['pendingCount'] == 0


def test_single_failed_source_advances_cursor_so_other_prs_are_not_starved(env):
    repo = env.repository()
    first = env.github.add(number=1)
    env.github.add(number=2)
    first['head']['repo']['private'] = True
    env.enable(repo)
    assert env.check(repo)['errorCode'] == 'PR_SOURCE_UNAVAILABLE'
    with env.watcher.storage.connection() as db:
        assert db.execute('SELECT deep_cursor FROM pr_watch').fetchone()[0] == 2
    assert len(env.jobs(repo)) == 1
    assert env.review.get(env.jobs(repo)[0]['sourceSnapshotId'])['number'] == 2
    env.check(repo)
    assert len(env.jobs(repo)) == 1
