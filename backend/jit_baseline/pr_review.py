"""Public GitHub source snapshots. Personal review work never enters this store."""
import base64
import json
import os
import re
import socket
import threading
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .catalog_storage import utc_now
from .errors import BaselineError

NAME = re.compile(r'^[A-Za-z0-9_.-]{1,100}$')
SHA = re.compile(r'^[a-f0-9]{40,64}$')


def github_source(url):
    if not isinstance(url, str):
        raise BaselineError('INPUT_INVALID', '请输入公开 GitHub 仓库或 PR 地址')
    parsed = urlparse(url.strip().rstrip('/'))
    parts = parsed.path.strip('/').split('/')
    if (parsed.scheme != 'https' or parsed.netloc.lower() != 'github.com' or parsed.query or parsed.fragment
            or len(parts) not in (2, 4) or any(not NAME.fullmatch(part) or part in ('.', '..') for part in parts[:2])
            or len(parts) == 4 and (parts[2] != 'pull' or not parts[3].isdigit() or int(parts[3]) < 1)):
        raise BaselineError('INPUT_INVALID', '只支持公开 GitHub 仓库和具体 PR 地址')
    return parts[0], parts[1].removesuffix('.git'), int(parts[3]) if len(parts) == 4 else None


class GitHubRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlparse(newurl).netloc != 'api.github.com' or urlparse(newurl).scheme != 'https':
            raise BaselineError('PR_SOURCE_UNAVAILABLE', '来源重定向不受支持')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def github_request(path):
    request = Request('https://api.github.com' + path, headers={
        'Accept': 'application/vnd.github+json', 'User-Agent': 'JIT-Personal-Review',
        'X-GitHub-Api-Version': '2022-11-28'})
    token = os.environ.get('JIT_GITHUB_TOKEN')
    if token:
        request.add_header('Authorization', 'Bearer ' + token)
    try:
        with build_opener(GitHubRedirect()).open(request, timeout=15) as response:
            data = response.read(8 * 1024 * 1024 + 1)
            if len(data) > 8 * 1024 * 1024:
                raise BaselineError('PR_SOURCE_TOO_LARGE', '远端响应超过读取上限')
            return json.loads(data)
    except HTTPError as exc:
        code = 'PR_RATE_LIMITED' if exc.code in (403, 429) else 'PR_SOURCE_UNAVAILABLE'
        raise BaselineError(code, 'GitHub 读取失败，请稍后重试') from exc
    except (URLError, socket.timeout, TimeoutError, ValueError) as exc:
        raise BaselineError('PR_SOURCE_UNAVAILABLE', 'GitHub 读取失败，请重试') from exc


def summary(pr, owner, name):
    return dict(number=pr['number'], title=pr['title'], author=pr['user']['login'],
                url=f'https://github.com/{owner}/{name}/pull/{pr["number"]}',
                updatedAt=pr['updated_at'], remoteState='merged' if pr.get('merged') or pr.get('merged_at') else pr['state'])


class PullRequestReview:
    def __init__(self, sync_service, *, request=None):
        self.sync = sync_service
        self.storage = sync_service.sync.storage
        self.request = request or github_request
        self.lock = threading.Lock()

    def intake(self, payload):
        if not isinstance(payload, dict) or set(payload) - {'url', 'state', 'page'}:
            raise BaselineError('INPUT_INVALID', '请求无效')
        owner, name, number = github_source(payload.get('url'))
        if number:
            return self.refresh(owner, name, number)
        state, page = payload.get('state', 'open'), payload.get('page', 1)
        if state not in ('open', 'closed', 'all') or type(page) is not int or not 1 <= page <= 100:
            raise BaselineError('INPUT_INVALID', 'PR 列表参数无效')
        if self.request(f'/repos/{owner}/{name}').get('private'):
            raise BaselineError('PR_SOURCE_UNAVAILABLE', '只支持公开仓库')
        items = self.request(f'/repos/{owner}/{name}/pulls?state={state}&sort=updated&direction=desc&per_page=30&page={page}')
        if not isinstance(items, list):
            raise BaselineError('PR_SOURCE_UNAVAILABLE', '无法读取 PR 列表')
        repository, _ = self.sync.create_repository({'repositoryUrl': f'https://github.com/{owner}/{name}'})
        return dict(owner=owner, name=name, repositoryId=repository['repositoryId'], repositoryUrl=repository['url'],
                    pullRequests=[summary(item, owner, name) for item in items], page=page,
                    hasMore=len(items) == 30, checkedAt=utc_now(), state=state)

    def refresh(self, owner, name, number):
        github_source(f'https://github.com/{owner}/{name}/pull/{number}')
        with self.lock:
            prefix = f'/repos/{owner}/{name}/pulls/{number}'
            pr = self.request(prefix)
            if pr['base']['repo'].get('private'):
                raise BaselineError('PR_SOURCE_UNAVAILABLE', '只支持公开仓库')
            base, head = pr['base']['sha'], pr['head']['sha']
            if not SHA.fullmatch(base) or not SHA.fullmatch(head):
                raise BaselineError('PR_SOURCE_UNAVAILABLE', '远端版本无效')
            identity = str(uuid.uuid5(uuid.NAMESPACE_URL, f'{owner.lower()}/{name.lower()}/{number}/{base}/{head}'))
            with self.storage.connection(write=True) as db:
                cached = db.execute('SELECT 1 FROM pr_snapshot WHERE id=?', (identity,)).fetchone()
                if cached:
                    checked, remote_state = utc_now(), summary(pr, owner, name)['remoteState']
                    db.execute('INSERT INTO pr_latest VALUES (?,?,?,?,?,?) ON CONFLICT(owner,name,number) DO UPDATE SET '
                               'snapshot_id=excluded.snapshot_id,remote_state=excluded.remote_state,checked_at=excluded.checked_at',
                               (owner, name, number, identity, remote_state, checked))
            if cached:
                return dict(snapshot=self.get(identity), remoteState=remote_state, checkedAt=checked)
            with self.storage.connection() as db:
                old = db.execute('SELECT snapshot_id FROM pr_latest WHERE owner=? AND name=? AND number=?', (owner, name, number)).fetchone()
            previous = self.get(old[0]) if old else None
            relation = 'first' if not previous else 'unknown'
            if previous and previous['headSha'] == head:
                relation = 'identical'
            elif previous:
                try:
                    comparison = self.request(f'/repos/{owner}/{name}/compare/{previous["headSha"]}...{head}')
                    if comparison.get('status') in ('ahead', 'behind', 'diverged', 'identical'):
                        relation = comparison['status']
                except BaselineError:
                    relation = 'unknown'
            files, started = [], time.monotonic()
            for page in range(1, 31):
                if time.monotonic() - started > 90:
                    raise BaselineError('PR_SOURCE_TOO_LARGE', '文件列表未完整读取，请重试')
                batch = self.request(f'{prefix}/files?per_page=100&page={page}')
                files.extend(batch)
                if len(batch) < 100:
                    break
            commits = self.request(f'{prefix}/commits?per_page=100&page=1')
            current = self.request(prefix)
            if current['base']['sha'] != base or current['head']['sha'] != head:
                raise BaselineError('PR_VERSION_CHANGED', '读取时 PR 版本发生变化，请重新检查')
            repository, _ = self.sync.create_repository({'repositoryUrl': f'https://github.com/{owner}/{name}'})
            identity = str(uuid.uuid5(uuid.NAMESPACE_URL, f'{owner.lower()}/{name.lower()}/{number}/{base}/{head}'))
            prepared = []
            for item in files:
                patch = item.get('patch')
                patch = patch if isinstance(patch, str) and len(patch) <= 200000 else None
                complete = (patch is not None and sum(line.startswith('+') for line in patch.splitlines()) == item['additions']
                            and sum(line.startswith('-') for line in patch.splitlines()) == item['deletions'])
                prepared.append(dict(path=item['filename'], previousPath=item.get('previous_filename'), blobSha=item['sha'],
                                     status=item['status'], additions=item['additions'], deletions=item['deletions'],
                                     patch=patch, patchComplete=complete))
            checked = utc_now()
            snapshot = dict(**summary(pr, owner, name), snapshotId=identity, repositoryId=repository['repositoryId'], owner=owner, name=name,
                            previousSnapshotId=previous['snapshotId'] if previous else None, historyRelation=relation,
                            body=pr.get('body') or '', baseSha=base, headSha=head, baseBranch=pr['base']['ref'], headBranch=pr['head']['ref'],
                            baseRepository=pr['base']['repo']['full_name'],
                            headRepository=(pr['head'].get('repo') or {}).get('full_name'),
                            capturedAt=checked, files=prepared, totalFiles=pr['changed_files'],
                            filesComplete=len(prepared) == pr['changed_files'],
                            commits=[{'sha': item['sha'], 'message': item['commit']['message'], 'time': item['commit'].get('author', {}).get('date')} for item in commits],
                            totalCommits=pr['commits'], commitsComplete=len(commits) == pr['commits'])
            remote_state = summary(current, owner, name)['remoteState']
            with self.storage.connection(write=True) as db:
                db.execute('INSERT OR IGNORE INTO pr_snapshot VALUES (?,?,?,?,?,?,?,?,?)',
                           (identity, repository['repositoryId'], owner, name, number, base, head, json.dumps(snapshot), checked))
                db.execute('INSERT INTO pr_latest VALUES (?,?,?,?,?,?) ON CONFLICT(owner,name,number) DO UPDATE SET '
                           'snapshot_id=excluded.snapshot_id,remote_state=excluded.remote_state,checked_at=excluded.checked_at',
                           (owner, name, number, identity, remote_state, checked))
            return dict(snapshot=self.get(identity), remoteState=remote_state, checkedAt=checked)

    def get(self, snapshot_id):
        with self.storage.connection() as db:
            row = db.execute('SELECT payload_json FROM pr_snapshot WHERE id=?', (snapshot_id,)).fetchone()
        if row is None:
            raise BaselineError('NOT_FOUND', 'PR 版本不存在')
        return json.loads(row[0])

    def analyze(self, snapshot_id, payload):
        source = self.get(snapshot_id)
        if not isinstance(payload, dict) or set(payload) - {'modelId'}:
            raise BaselineError('INPUT_INVALID', '分析参数无效')
        if not source['headRepository']:
            raise BaselineError('PR_SOURCE_UNAVAILABLE', '目标仓库不可用，仍可阅读保存的代码')
        dates = [item['time'][:10] for item in source['commits'] if item.get('time')]
        data = dict(repositoryUrl='https://github.com/' + source['headRepository'], branch=source['headSha'],
                    strategy='generic-model', commitLimit=5000)
        if dates:
            data.update(since=min(dates), until=max(dates))
        if 'modelId' in payload:
            data['modelId'] = payload['modelId']
        job, _ = self.sync.create(data)
        with self.storage.connection(write=True) as db:
            db.execute('INSERT OR IGNORE INTO pr_analysis VALUES (?,?,?)', (snapshot_id, job['syncId'], utc_now()))
        return self.analyses(snapshot_id)

    def analyses(self, snapshot_id):
        source = self.get(snapshot_id)
        with self.storage.connection() as db:
            identities = [row[0] for row in db.execute('SELECT sync_id FROM pr_analysis WHERE snapshot_id=? ORDER BY created_at DESC LIMIT 20', (snapshot_id,))]
        records = []
        for identity in identities:
            job = self.sync.get(identity)
            valid = job['status'] == 'completed' and job.get('headCommit') == source['headSha']
            scores = []
            if valid:
                for item in source['commits']:
                    result = self.sync.sync.commit(identity, item['sha'])
                    if result is not None:
                        scores.append(dict(commitId=item['sha'], risk=result['risk']))
            records.append(dict(sync=job, contextValid=valid, scores=scores))
        return dict(snapshotId=snapshot_id, analyses=records)

    def context(self, snapshot_id, path, side):
        source = self.get(snapshot_id)
        file = next((item for item in source['files'] if item['path'] == path), None)
        if file is None or side not in ('base', 'head'):
            raise BaselineError('INPUT_INVALID', '文件或版本侧无效')
        with self.storage.connection() as db:
            saved = db.execute('SELECT payload_json FROM pr_file_content WHERE snapshot_id=? AND path=? AND side=?', (snapshot_id, path, side)).fetchone()
        if saved:
            return json.loads(saved[0])
        absent = file['status'] == ('added' if side == 'base' else 'removed')
        repository = source[f'{side}Repository']
        if not absent and not repository:
            raise BaselineError('PR_SOURCE_UNAVAILABLE', '该版本仓库已不可访问，仍可阅读保存的 Diff')
        actual_path = file.get('previousPath') or path if side == 'base' else path
        ref = source[f'{side}Sha']
        content = ''
        if not absent:
            data = self.request(f'/repos/{repository}/contents/{quote(actual_path, safe="/")}?ref={ref}')
            if data.get('type') != 'file' or data.get('encoding') != 'base64' or data.get('size', 0) > 1024 * 1024:
                raise BaselineError('PR_CONTENT_UNAVAILABLE', '二进制、过大或非普通文件无法显示')
            try:
                content = base64.b64decode(data['content']).decode('utf-8')
            except (UnicodeError, ValueError) as exc:
                raise BaselineError('PR_CONTENT_UNAVAILABLE', '该文件不是可读取的 UTF-8 文本') from exc
            if '\0' in content:
                raise BaselineError('PR_CONTENT_UNAVAILABLE', '二进制内容不可显示')
        lines = content.splitlines()
        result = dict(snapshotId=snapshot_id, path=path, side=side, ref=ref, absent=absent,
                      content=content if len(lines) <= 10000 else '\n'.join(lines[:10000]), totalLines=len(lines), complete=len(lines) <= 10000)
        with self.storage.connection(write=True) as db:
            db.execute('INSERT OR IGNORE INTO pr_file_content VALUES (?,?,?,?)', (snapshot_id, path, side, json.dumps(result)))
        return result
