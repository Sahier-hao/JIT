"""Cached public GitHub metadata for the repository overview page.

This is repository activity, not model output and not a defect rate. It never
reads labels, runs a model or changes the project's current analysis.
"""
import json
from datetime import datetime, timedelta, timezone

from .catalog_storage import utc_now
from .errors import BaselineError
from .pr_review import github_request, github_source

FORMAT = 'repository-overview-v4'
CACHE_SECONDS = 600
WEEKS = 12
ACTIVITY_WEEKS = 52
RECENT = 10


def _week_start(value):
    return value.date() - timedelta(days=value.weekday())


def _commit_date(item):
    try:
        return datetime.fromisoformat(str(item['commit']['author']['date']).replace('Z', '+00:00')).astimezone(timezone.utc)
    except (KeyError, TypeError, ValueError):
        return None


def _stats_activity(stats):
    """GitHub 周统计的宽松解析：任何一项不可信都返回 None，由调用方回退到提交聚合。"""
    if not isinstance(stats, list) or len(stats) < 2:
        return None
    items = []
    for entry in stats:
        if not isinstance(entry, dict):
            return None
        week, total = entry.get('week'), entry.get('total')
        if isinstance(week, bool) or not isinstance(week, int) or isinstance(total, bool) or not isinstance(total, int) or total < 0:
            return None
        try:
            start = datetime.fromtimestamp(week, timezone.utc).date()
        except (OverflowError, OSError, ValueError):
            return None
        items.append(dict(weekStart=start.isoformat(), commits=total))
    items.sort(key=lambda item: item['weekStart'])
    return items[-ACTIVITY_WEEKS:]


class RepositoryOverview:
    def __init__(self, sync_service, *, request=None, clock=None):
        self.sync = sync_service
        self.storage = sync_service.sync.storage
        self.request = request or github_request
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def _cached(self, db, repository_id):
        row = db.execute('SELECT * FROM repository_overview WHERE repository_id=?', (repository_id,)).fetchone()
        if row is None:
            return None
        payload = json.loads(row['payload_json'])
        if payload.get('format') != FORMAT:
            return None
        return payload, row['fetched_at']

    def get(self, repository_id, *, refresh=False):
        repository = self.sync.sync.repository_get(repository_id)
        if repository is None:
            raise BaselineError('REPOSITORY_UNKNOWN', '仓库不存在')
        try:
            owner, name, _ = github_source(repository['url'])
        except BaselineError:
            return dict(repositoryId=repository_id, supported=False, url=repository['url'],
                        displayName=repository['displayName'], metadata=None, languages=[], activity=[],
                        activityCoverage=None, recentCommits=[], fetchedAt=None, errorCode=None,
                        stale=False, retryAfter=None)
        with self.storage.connection() as db:
            cached = self._cached(db, repository_id)
        now = self.clock()
        if cached and not refresh:
            payload, fetched_at = cached
            fetched = datetime.fromisoformat(fetched_at.replace('Z', '+00:00'))
            if (now - fetched).total_seconds() < CACHE_SECONDS:
                return payload
        try:
            payload = self._fetch(repository_id, repository, owner, name, now)
        except BaselineError as exc:
            if cached:
                payload, fetched_at = cached
                return {**payload, 'stale': True, 'errorCode': exc.code,
                        'retryAfter': getattr(exc, 'retry_after', None), 'fetchedAt': fetched_at}
            return dict(repositoryId=repository_id, supported=True, url=repository['url'],
                        displayName=repository['displayName'], metadata=None, languages=[], activity=[],
                        activityCoverage=None, recentCommits=[], fetchedAt=None, errorCode=exc.code,
                        stale=False, retryAfter=getattr(exc, 'retry_after', None))
        with self.storage.connection(write=True) as db:
            db.execute('INSERT INTO repository_overview(repository_id,payload_json,fetched_at) VALUES (?,?,?) '
                       'ON CONFLICT(repository_id) DO UPDATE SET payload_json=excluded.payload_json,fetched_at=excluded.fetched_at',
                       (repository_id, json.dumps(payload, ensure_ascii=False), payload['fetchedAt']))
        return payload

    def _fetch(self, repository_id, repository, owner, name, now):
        prefix = f'/repos/{owner}/{name}'
        meta = self.request(prefix)
        languages = self.request(prefix + '/languages')
        commits = self.request(prefix + '/commits?per_page=100')
        if not isinstance(meta, dict) or not isinstance(languages, dict) or not isinstance(commits, list):
            raise BaselineError('PR_SOURCE_UNAVAILABLE', 'GitHub 仓库概览格式不可识别')
        # 登记时 GitHub 元数据可能因限流失败，默认分支被记成 HEAD；概览读取成功后回填真实分支。
        default_branch = meta.get('default_branch')
        if isinstance(default_branch, str) and default_branch and default_branch != repository.get('defaultBranch'):
            with self.storage.connection(write=True) as db:
                db.execute("UPDATE repository SET default_branch=? WHERE id=? AND (default_branch IS NULL OR default_branch='' OR default_branch='HEAD')",
                           (default_branch, repository_id))
        total = sum(value for value in languages.values() if isinstance(value, (int, float)) and value > 0)
        language_items = [dict(name=str(key), bytes=int(value), percent=round(value * 100 / total, 1))
                          for key, value in sorted(languages.items(), key=lambda item: (-item[1], item[0]))
                          if isinstance(value, (int, float)) and value > 0] if total else []
        try:
            stats = self.request(prefix + '/stats/commit_activity')
        except BaselineError:
            stats = None
        activity = _stats_activity(stats)
        counts = None
        if activity is None:
            current_start = _week_start(now)
            weeks = [current_start - timedelta(weeks=index) for index in range(WEEKS - 1, -1, -1)]
            counts = {start: 0 for start in weeks}
        recent = []
        for item in commits:
            date = _commit_date(item)
            if counts is not None and date is not None:
                start = _week_start(date)
                if start in counts:
                    counts[start] += 1
            if len(recent) < RECENT:
                try:
                    recent.append(dict(sha=item['sha'], message=str(item['commit']['message']).splitlines()[0] or '未提供标题',
                                       author=(item.get('author') or {}).get('login') or item['commit']['author'].get('name') or '未知作者',
                                       date=item['commit']['author']['date'], url=item.get('html_url')))
                except (KeyError, TypeError, IndexError):
                    continue
        if counts is not None:
            activity = [dict(weekStart=start.isoformat(), commits=counts[start]) for start in weeks]
        activity_coverage = 'last-100-commits' if counts is not None else 'last-52-weeks'
        license_info = meta.get('license') or {}
        return dict(
            format=FORMAT, repositoryId=repository_id, supported=True, fetchedAt=utc_now(),
            url=repository['url'], displayName=repository['displayName'],
            metadata=dict(fullName=meta.get('full_name'), description=meta.get('description') or None,
                          defaultBranch=meta.get('default_branch'), private=bool(meta.get('private')),
                          stars=int(meta.get('stargazers_count') or 0), forks=int(meta.get('forks_count') or 0),
                          openIssues=int(meta.get('open_issues_count') or 0),
                          watchers=int(meta.get('subscribers_count') or 0), pushedAt=meta.get('pushed_at'),
                          createdAt=meta.get('created_at'), topics=list(meta.get('topics') or []),
                          license=license_info.get('spdx_id') or None, homepage=meta.get('homepage') or None,
                          htmlUrl=meta.get('html_url')),
            languages=language_items,
            activity=activity,
            activityCoverage=activity_coverage,
            recentCommits=recent,
            rateLimit=dict(limited=False, resetAt=None), stale=False, errorCode=None, retryAfter=None,
        )
