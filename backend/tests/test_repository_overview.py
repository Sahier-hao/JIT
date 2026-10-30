"""Repository overview is cached public GitHub activity, never model output or labels."""
from datetime import datetime, timedelta, timezone

import pytest

from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.errors import BaselineError
from jit_baseline.repository_overview import RepositoryOverview
from jit_baseline.sync import SyncService


def iso(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat().replace('+00:00', 'Z')


def payloads():
    meta = dict(full_name='example/project', description='Demo repository', default_branch='main', private=False,
                stargazers_count=12, forks_count=3, open_issues_count=5, subscribers_count=8,
                pushed_at=iso(1), created_at=iso(400), topics=['review', 'jit'], license={'spdx_id': 'MIT'},
                homepage=None, html_url='https://github.com/example/project')
    languages = {'Python': 750, 'TypeScript': 250}
    commits = [dict(sha='a' * 40, html_url='https://github.com/example/project/commit/' + 'a' * 40,
                    commit=dict(message='fix: handle token\n\nbody', author=dict(date=iso(1), name='Alice')),
                    author=dict(login='alice')),
               dict(sha='b' * 40, html_url='https://github.com/example/project/commit/' + 'b' * 40,
                    commit=dict(message='test: cover expiry', author=dict(date=iso(8), name='Bob')),
                    author=dict(login='bob')),
               dict(sha='c' * 40, html_url='https://github.com/example/project/commit/' + 'c' * 40,
                    commit=dict(message='docs: update', author=dict(date=iso(20), name='Alice')),
                    author=dict(login='alice'))]
    return meta, languages, commits


def stats_payload():
    base = datetime(2025, 11, 2, tzinfo=timezone.utc)
    return [dict(week=int((base + timedelta(weeks=index)).timestamp()), total=3 if index == 51 else 1,
                 days=[0, 0, 0, 0, 0, 0, 3 if index == 51 else 1]) for index in range(52)]


def request(meta, languages, commits, stats):
    def call(path):
        if path.endswith('/languages'):
            return languages
        if path.endswith('/stats/commit_activity'):
            return stats
        if '/commits?' in path:
            return commits
        return meta
    return call


@pytest.fixture
def overview(tmp_path):
    storage = CatalogStorage(tmp_path / 'overview.sqlite3')
    storage.initialize()
    service = SyncService(storage, allow_local=False, collect_fn=lambda **kw: None)
    repo, _ = service.create_repository({'repositoryUrl': 'https://github.com/example/project'})
    meta, languages, commits = payloads()
    service_overview = RepositoryOverview(service, request=request(meta, languages, commits, stats_payload()))
    yield service_overview, service, repo['repositoryId'], meta
    service.close()


def test_reads_public_metadata_languages_and_activity(overview):
    service_overview, _, repo, meta = overview
    value = service_overview.get(repo)
    assert value['supported'] is True
    assert value['metadata']['stars'] == meta['stargazers_count'] == 12
    assert value['metadata']['license'] == 'MIT'
    assert [item['name'] for item in value['languages']] == ['Python', 'TypeScript']
    assert [item['percent'] for item in value['languages']] == [75.0, 25.0]
    assert len(value['activity']) == 52
    assert value['activity'][0] == dict(weekStart='2025-11-02', commits=1)
    assert value['activity'][-1] == dict(weekStart='2026-10-25', commits=3)
    assert value['activityCoverage'] == 'last-52-weeks'
    assert value['recentCommits'][0]['message'] == 'fix: handle token'
    assert value['recentCommits'][0]['author'] == 'alice'
    assert value['fetchedAt']


def test_stats_failure_falls_back_to_recent_commits(overview):
    service_overview, _, repo, _ = overview
    meta, languages, commits = payloads()
    def unavailable(path):
        if path.endswith('/stats/commit_activity'):
            raise BaselineError('PR_SOURCE_UNAVAILABLE', 'stats unavailable')
        if path.endswith('/languages'):
            return languages
        if '/commits?' in path:
            return commits
        return meta
    service_overview.request = unavailable
    value = service_overview.get(repo)
    assert len(value['activity']) == 12
    assert value['activityCoverage'] == 'last-100-commits'
    assert sum(item['commits'] for item in value['activity']) == 3
    assert value['metadata']['stars'] == 12


def test_cache_is_reused_and_rate_limit_keeps_old_payload(overview):
    service_overview, _, repo, _ = overview
    first = service_overview.get(repo)
    def limited(path):
        raise BaselineError('PR_RATE_LIMITED', 'limited')
    service_overview.request = limited
    cached = service_overview.get(repo)
    assert cached == first
    stale = service_overview.get(repo, refresh=True)
    assert stale['stale'] is True and stale['errorCode'] == 'PR_RATE_LIMITED'
    assert stale['metadata'] == first['metadata']
    assert stale['fetchedAt'] == first['fetchedAt']


def test_rate_limit_without_cache_is_explicit(overview):
    service_overview, _, repo, _ = overview
    def limited(path):
        raise BaselineError('PR_RATE_LIMITED', 'limited')
    service_overview.request = limited
    value = service_overview.get(repo)
    assert value['supported'] is True and value['metadata'] is None
    assert value['errorCode'] == 'PR_RATE_LIMITED'
    assert value['languages'] == [] and value['activity'] == []


def test_non_github_repository_is_unsupported(overview):
    service_overview, service, _, _ = overview
    repo, _ = service.create_repository({'repositoryUrl': 'https://example.com/example/repo.git'})
    value = service_overview.get(repo['repositoryId'])
    assert value['supported'] is False
    assert value['metadata'] is None
    assert value['displayName']
