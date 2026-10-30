"""公开 PR 的持久跟踪、固定分析意图与站内事件；不保存个人审查状态。"""
import json
import logging
import math
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from .errors import BaselineError
from .pr_review import github_source
from .sync import DISTRIBUTION_RULE, PROGRESS, distribution_of

LOGGER = logging.getLogger('jit.catalog')
RETRY_DELAYS = (60, 300, 900)
TRANSIENT = {'PR_RATE_LIMITED', 'PR_SOURCE_UNAVAILABLE', 'PR_VERSION_CHANGED',
             'REPOSITORY_UNAVAILABLE', 'REPOSITORY_CHECK_TIMEOUT', 'NETWORK_ERROR'}
TERMINAL = {'completed', 'failed', 'cancelled', 'interrupted'}
SCORING_CONTRACT = 'pr-commits-v1:' + DISTRIBUTION_RULE
DEEP_LIMIT = 20
QUEUE_LIMIT = 2
LEASE_SECONDS = 600


def _dump(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)


class PullRequestUpdates:
    def __init__(self, sync_service, pr_review, *, clock=None, executor=None):
        self.service = sync_service
        self.review = pr_review
        self.storage = sync_service.sync.storage
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.executor = executor or ThreadPoolExecutor(max_workers=1, thread_name_prefix='pr-check')
        self.stop = threading.Event()
        self.lock = threading.RLock()
        self.thread = None

    def _now(self):
        value = self.clock()
        return value if isinstance(value, str) else value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')

    def _after(self, seconds):
        return (datetime.fromisoformat(self._now().replace('Z', '+00:00')) + timedelta(seconds=seconds)).isoformat().replace('+00:00', 'Z')

    def start(self):
        with self.lock:
            if self.thread is None and not self.stop.is_set():
                self._recover_leases()
                self.thread = threading.Thread(target=self._loop, daemon=True, name='pr-schedule')
                self.thread.start()

    def _loop(self):
        while not self.stop.is_set():
            try:
                self.tick()
            except BaselineError as exc:
                if exc.code != 'STORAGE_UNAVAILABLE':
                    LOGGER.warning('PR 跟踪检查失败：%s', exc.code)
            except Exception:
                LOGGER.exception('PR 跟踪调度失败')
            self.stop.wait(5)

    def close(self):
        self.stop.set()
        if self.thread is not None:
            self.thread.join(timeout=10)
        self.executor.shutdown(wait=True)

    def _repository(self, repository_id):
        repository = self.service.sync.repository_get(repository_id)
        if repository is None:
            raise BaselineError('REPOSITORY_UNKNOWN', '项目不存在')
        try:
            owner, name, number = github_source(repository['url'])
            supported = number is None
        except BaselineError:
            owner, name, supported = None, None, False
        return repository, owner, name, supported

    def _row(self, repository_id):
        with self.storage.connection() as db:
            row = db.execute('SELECT * FROM pr_watch WHERE repository_id=?', (repository_id,)).fetchone()
        return dict(row) if row else dict(repository_id=repository_id, enabled=0, ever_enabled=0, model_id=None,
            interval_seconds=300, status='idle', last_checked_at=None, next_check_at=None,
            error_code=None, retry_not_before=None, discovery_complete=0, initial_done=0)

    def _recover_leases(self):
        with self.storage.connection(write=True) as db:
            return db.execute("UPDATE pr_watch SET status='error',error_code='SYNC_INTERRUPTED',"
                'check_token=NULL,lease_until=NULL WHERE status=\'checking\' AND (lease_until IS NULL OR lease_until<=?)',
                (self._now(),)).rowcount

    def get(self, repository_id):
        _, _, _, supported = self._repository(repository_id)
        row = self._row(repository_id)
        with self.storage.connection() as db:
            cached = db.execute("SELECT COUNT(*),COALESCE(SUM(draft=0),0) FROM pr_cache WHERE repository_id=? AND remote_state='open'", (repository_id,)).fetchone()
            pending = db.execute('SELECT COUNT(*) FROM pr_auto_intent i JOIN pr_cache c ON c.repository_id=i.repository_id AND c.number=i.number '
                "WHERE i.repository_id=? AND i.model_id=? AND c.snapshot_id=i.snapshot_id AND c.remote_state='open' AND c.draft=0 "
                "AND i.status IN ('pending','backoff')", (repository_id, row['model_id'])).fetchone()[0]
        return dict(repositoryId=repository_id, supported=supported, enabled=bool(row['enabled']),
            modelId=row['model_id'], intervalSeconds=row['interval_seconds'], status=row['status'],
            lastCheckedAt=row['last_checked_at'], nextCheckAt=row['next_check_at'] if row['enabled'] else None,
            errorCode=row['error_code'], retryNotBefore=row['retry_not_before'],
            discoveryComplete=bool(row['discovery_complete']), initialScanComplete=bool(row['initial_done']),
            publicOnly=True, maxDeepChecks=DEEP_LIMIT, maxAutomaticQueued=QUEUE_LIMIT,
            openCachedCount=cached[0], eligibleCachedCount=cached[1], pendingCount=pending,
            discoveryPage=row.get('discovery_page', 1))

    def configure(self, repository_id, payload):
        allowed = {'enabled', 'modelId', 'intervalSeconds', 'confirmExisting'}
        if (not isinstance(payload, dict) or not payload or set(payload) - allowed
                or 'enabled' in payload and type(payload['enabled']) is not bool
                or 'confirmExisting' in payload and type(payload['confirmExisting']) is not bool
                or 'modelId' in payload and (not isinstance(payload['modelId'], str) or not payload['modelId'].strip())
                or 'intervalSeconds' in payload and (type(payload['intervalSeconds']) is not int or not 300 <= payload['intervalSeconds'] <= 86400)):
            raise BaselineError('INPUT_INVALID', 'PR 跟踪设置无效，检查间隔至少五分钟')
        with self.lock:
            _, _, _, supported = self._repository(repository_id)
            row = self._row(repository_id)
            enabled = payload.get('enabled', bool(row['enabled']))
            model_id = payload.get('modelId', row['model_id'])
            if enabled and not supported:
                raise BaselineError('PR_SOURCE_UNAVAILABLE', '自动 PR 跟踪只支持公开 GitHub 项目')
            if enabled and not row['ever_enabled'] and not payload.get('confirmExisting'):
                raise BaselineError('INPUT_INVALID', '首次开启需确认分析当前开放且非草稿的 PR')
            if row['status'] == 'checking' and model_id != row['model_id']:
                raise BaselineError('CONFLICT_ACTIVE_SYNC', '正在检查 PR，请稍后修改模型')
            if enabled and not model_id:
                model_id = self.service.catalog.default_model_id()
                if not model_id:
                    raise BaselineError('DEFAULT_MODEL_REQUIRED', '请选择兼容模型或先设置默认模型')
            if 'modelId' in payload or enabled:
                self.service._generic_model(model_id)
            interval = payload.get('intervalSeconds', row['interval_seconds'])
            now = self._now()
            with self.storage.connection(write=True) as db:
                db.execute('INSERT OR IGNORE INTO pr_watch(repository_id) VALUES (?)', (repository_id,))
                db.execute('UPDATE pr_watch SET enabled=?,ever_enabled=MAX(ever_enabled,?),model_id=?,interval_seconds=?,next_check_at=?, '
                    "status=CASE WHEN status='checking' THEN status ELSE ? END,error_code=NULL WHERE repository_id=?",
                    (int(enabled), int(enabled), model_id, interval, max(now, row['retry_not_before'] or now) if enabled else None,
                     'idle' if enabled else 'paused', repository_id))
            return self.get(repository_id)

    @staticmethod
    def _pagination(state, page):
        if state not in ('open', 'closed', 'all') or type(page) is not int or not 1 <= page <= 100:
            raise BaselineError('INPUT_INVALID', 'PR 列表参数无效')

    def list_prs(self, repository_id, state='open', page=1):
        """只读取持久缓存；GET 不访问远端，也不补建配置或项目。"""
        self._pagination(state, page)
        _, owner, name, supported = self._repository(repository_id)
        result = dict(repositoryId=repository_id, supported=supported, pullRequests=[], page=page,
                      hasMore=False, checkedAt=None, publicOnly=True, discoveryComplete=False)
        if not supported:
            return result
        result.update(owner=owner, name=name)
        with self.storage.connection() as db:
            saved = db.execute('SELECT * FROM pr_list_page WHERE repository_id=? AND state=? AND page=?',
                               (repository_id, state, page)).fetchone()
            watch = db.execute('SELECT * FROM pr_watch WHERE repository_id=?', (repository_id,)).fetchone()
            result['discoveryComplete'] = bool(watch and watch['discovery_complete'])
            if saved is None:
                return result
            result.update(checkedAt=saved['checked_at'], hasMore=bool(saved['has_more']), errorCode=saved['error_code'])
            for number in json.loads(saved['numbers_json']):
                row = db.execute('SELECT * FROM pr_cache WHERE repository_id=? AND number=?', (repository_id, number)).fetchone()
                if row is None:
                    continue
                item = dict(number=row['number'], title=row['title'], author=row['author'], url=row['url'],
                            updatedAt=row['updated_at'], remoteState=row['remote_state'], draft=bool(row['draft']))
                snapshot_id = row['snapshot_id']
                if snapshot_id is None:
                    # 用户手动查看后保存的快照在 pr_latest；列表也要能关联它的分析。
                    latest = db.execute('SELECT snapshot_id FROM pr_latest WHERE repository_id=? AND lower(owner)=? '
                                        'AND lower(name)=? AND number=?', (repository_id, owner, name, number)).fetchone()
                    snapshot_id = latest['snapshot_id'] if latest else None
                if snapshot_id:
                    item['snapshotId'] = snapshot_id
                    intent = None
                    if row['snapshot_id']:
                        intent = db.execute('SELECT * FROM pr_auto_intent WHERE repository_id=? AND number=? AND snapshot_id=? '
                            'AND model_id=? ORDER BY updated_at DESC LIMIT 1',
                            (repository_id, number, row['snapshot_id'], watch['model_id'] if watch else None)).fetchone()
                    if intent:
                        item.update(analysisStatus=intent['status'], modelId=intent['model_id'], syncId=intent['sync_id'])
                        if intent['sync_id']:
                            job = db.execute('SELECT status FROM repository_sync WHERE id=?', (intent['sync_id'],)).fetchone()
                            if job and job[0] in PROGRESS:
                                item['analysisStatus'] = 'queued' if job[0] == 'queued' else 'running'
                    analysis_sync = intent['sync_id'] if intent and intent['sync_id'] else None
                    if analysis_sync is None:
                        manual = db.execute('SELECT s.id AS sync_id FROM pr_analysis a JOIN repository_sync s ON s.id=a.sync_id '
                                            "WHERE a.snapshot_id=? AND s.status='completed' "
                                            'ORDER BY a.created_at DESC, s.rowid DESC LIMIT 1',
                                            (snapshot_id,)).fetchone()
                        if manual:
                            analysis_sync = manual['sync_id']
                            item.update(analysisStatus='completed', syncId=analysis_sync)
                    if analysis_sync:
                        snapshot = db.execute('SELECT payload_json FROM pr_snapshot WHERE id=?', (snapshot_id,)).fetchone()
                        shas = [commit.get('sha') for commit in (json.loads(snapshot['payload_json']).get('commits', []) if snapshot else []) if commit.get('sha')]
                        if shas:
                            marks = ','.join('?' for _ in shas)
                            stats = db.execute(f'SELECT COUNT(*), MAX(risk) FROM repository_commit WHERE sync_id=? AND commit_id IN ({marks})',
                                               (analysis_sync, *shas)).fetchone()
                            if stats and stats[0]:
                                item.update(scoredCommits=stats[0], maxRisk=stats[1])
                result['pullRequests'].append(item)
        return result

    def refresh_list(self, repository_id, state='open', page=1):
        self._pagination(state, page)
        if not self._repository(repository_id)[3]:
            return self.list_prs(repository_id, state, page)
        try:
            self._refresh_list(repository_id, state, page)
        except BaselineError as exc:
            self._list_error(repository_id, state, page, exc.code)
        return self.list_prs(repository_id, state, page)

    def _list_error(self, repository_id, state, page, code):
        with self.storage.connection(write=True) as db:
            db.execute("INSERT INTO pr_list_page(repository_id,state,page,numbers_json,error_code) VALUES (?,?,?,'[]',?) "
                'ON CONFLICT(repository_id,state,page) DO UPDATE SET error_code=excluded.error_code',
                (repository_id, state, page, code))

    def _refresh_list(self, repository_id, state, page, token=None):
        # 不能调用 intake：它会登记项目；公开性及基项目身份由此专用入口再次校验。
        result = self.review.list_for_repository(repository_id, state=state, page=page)
        _, owner, name, _ = self._repository(repository_id)
        if (result.get('repositoryId') != repository_id or result.get('owner', '').lower() != owner.lower()
                or result.get('name', '').lower() != name.lower()):
            raise BaselineError('INPUT_INVALID', 'PR 列表不属于当前基项目')
        now = self._now()
        with self.storage.connection(write=True) as db:
            if token and not self._owns(db, repository_id, token):
                return None
            numbers = []
            for item in result['pullRequests']:
                number = item['number']
                numbers.append(number)
                db.execute('INSERT INTO pr_cache(repository_id,number,title,author,url,updated_at,remote_state,draft,checked_at) '
                    'VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(repository_id,number) DO UPDATE SET title=excluded.title,'
                    'author=excluded.author,url=excluded.url,updated_at=excluded.updated_at,remote_state=excluded.remote_state,'
                    'draft=excluded.draft,checked_at=excluded.checked_at',
                    (repository_id, number, item['title'], item['author'], item['url'], item['updatedAt'],
                     item['remoteState'], int(bool(item.get('draft'))), now))
            db.execute('INSERT INTO pr_list_page VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(repository_id,state,page) DO UPDATE SET '
                'numbers_json=excluded.numbers_json,has_more=excluded.has_more,checked_at=excluded.checked_at,error_code=NULL',
                (repository_id, state, page, _dump(numbers), int(result['hasMore']), now))
        return result

    @staticmethod
    def _owns(db, repository_id, token):
        return db.execute("SELECT 1 FROM pr_watch WHERE repository_id=? AND check_token=? AND status='checking'",
                          (repository_id, token)).fetchone() is not None

    def _renew(self, repository_id, token):
        with self.storage.connection(write=True) as db:
            return db.execute("UPDATE pr_watch SET lease_until=? WHERE repository_id=? AND check_token=? AND status='checking'",
                              (self._after(LEASE_SECONDS), repository_id, token)).rowcount == 1

    def request(self, repository_id):
        with self.lock:
            if self.stop.is_set():
                raise BaselineError('SYNC_SERVICE_STOPPING', 'PR 检查服务正在停止')
            if not self._repository(repository_id)[3]:
                return self.get(repository_id)
            self._recover_leases()
            row, now = self._row(repository_id), self._now()
            if row['status'] == 'checking' or row['retry_not_before'] and row['retry_not_before'] > now:
                return self.get(repository_id)
            token = str(uuid.uuid4())
            with self.storage.connection(write=True) as db:
                db.execute('INSERT OR IGNORE INTO pr_watch(repository_id) VALUES (?)', (repository_id,))
                claimed = db.execute("UPDATE pr_watch SET status='checking',check_token=?,lease_until=?,last_attempt_at=?,error_code=NULL "
                    "WHERE repository_id=? AND status!='checking'", (token, self._after(LEASE_SECONDS), now, repository_id)).rowcount
            if claimed:
                try:
                    self.executor.submit(self._check, repository_id, token)
                except RuntimeError as exc:
                    with self.storage.connection(write=True) as db:
                        db.execute("UPDATE pr_watch SET status='error',check_token=NULL,lease_until=NULL,error_code='SYNC_INTERRUPTED' "
                                   'WHERE repository_id=? AND check_token=?', (repository_id, token))
                    raise BaselineError('SYNC_SERVICE_STOPPING', 'PR 检查服务正在停止') from exc
            return self.get(repository_id)

    def tick(self):
        with self.lock:
            if self.stop.is_set():
                return 0
            self._recover_leases()
            self._observe()
            with self.storage.connection() as db:
                # 已有检查尚未结束时不再领取，避免执行器队列把项目租约耗尽。
                if db.execute("SELECT 1 FROM pr_watch WHERE status='checking'").fetchone():
                    return 0
                due = db.execute("SELECT repository_id FROM pr_watch WHERE enabled=1 AND status!='checking' "
                    'AND (next_check_at IS NULL OR next_check_at<=?) AND (retry_not_before IS NULL OR retry_not_before<=?) '
                    'ORDER BY last_attempt_at,repository_id LIMIT 1', (self._now(), self._now())).fetchone()
            if due:
                self.request(due[0])
                return 1
            return 0

    def _check(self, repository_id, token):
        error, retry_after, completed = None, 0, False
        try:
            if self.stop.is_set() or not self._renew(repository_id, token):
                return
            row = self._row(repository_id)
            _, owner, name, _ = self._repository(repository_id)
            page = row['discovery_page']
            result = self._refresh_list(repository_id, 'open', page, token)
            if result is None:
                return
            with self.storage.connection(write=True) as db:
                if not self._owns(db, repository_id, token):
                    return
                db.execute('UPDATE pr_watch SET discovery_page=?,discovery_complete=? WHERE repository_id=?',
                    (page + 1 if result['hasMore'] and page < 100 else 1,
                     int(not result['hasMore']), repository_id))
                cached = db.execute('SELECT number FROM pr_cache WHERE repository_id=? '
                    'ORDER BY CASE WHEN number>? THEN 0 ELSE 1 END,number LIMIT ?',
                    (repository_id, row['deep_cursor'], DEEP_LIMIT)).fetchall()
            for cached_row in cached:
                if self.stop.is_set() or not self._renew(repository_id, token):
                    return
                # 暂停不取消已提交分析，但停止随后远端深入检查和新入队。
                if row['enabled'] and not self._row(repository_id)['enabled']:
                    break
                try:
                    self._deep(repository_id, owner, name, cached_row['number'], token)
                except BaselineError as exc:
                    if exc.code in {'PR_RATE_LIMITED', 'STORAGE_UNAVAILABLE', 'REPOSITORY_UNKNOWN'}:
                        raise
                    error = exc.code
                    retry_after = max(retry_after, self._retry_after(exc))
                finally:
                    # 单个来源暂时不可读也推进游标，不能永久饿死其后的 PR。
                    with self.storage.connection(write=True) as db:
                        if self._owns(db, repository_id, token):
                            db.execute('UPDATE pr_watch SET deep_cursor=? WHERE repository_id=?', (cached_row['number'], repository_id))
                if self._row(repository_id).get('check_token') != token:
                    return
            self._announce(repository_id, token)
            self._observe()
            self._schedule(repository_id, token)
            completed = True
        except BaselineError as exc:
            error = exc.code
            retry_after = self._retry_after(exc)
        except Exception:
            LOGGER.exception('PR 项目检查失败')
            error = 'PR_SOURCE_UNAVAILABLE'
        finally:
            with self.lock, self.storage.connection(write=True) as db:
                row = db.execute('SELECT * FROM pr_watch WHERE repository_id=? AND check_token=?', (repository_id, token)).fetchone()
                if row:
                    delay = max(row['interval_seconds'], retry_after)
                    retry = db.execute('SELECT MIN(i.retry_at) FROM pr_auto_intent i JOIN pr_cache c '
                        'ON c.repository_id=i.repository_id AND c.number=i.number WHERE i.repository_id=? '
                        "AND i.status='backoff' AND i.model_id=? AND c.snapshot_id=i.snapshot_id AND c.remote_state='open' AND c.draft=0",
                        (repository_id, row['model_id'])).fetchone()[0]
                    next_at = self._after(delay)
                    if retry and not error:
                        next_at = min(next_at, max(self._after(5), retry))
                    db.execute('UPDATE pr_watch SET status=?,error_code=?,check_token=NULL,lease_until=NULL,'
                        'last_checked_at=CASE WHEN ? THEN ? ELSE last_checked_at END,next_check_at=?,retry_not_before=? WHERE repository_id=?',
                        ('error' if error else ('unchanged' if row['enabled'] else 'paused'), error,
                         int(completed), self._now(), next_at if row['enabled'] else None,
                         self._after(retry_after) if retry_after else None, repository_id))

    @staticmethod
    def _retry_after(value):
        raw = getattr(value, 'retry_after', 0) if not isinstance(value, dict) else value.get('retryAfter', value.get('retry_after', 0))
        try:
            seconds = float(raw or 0)
            return max(0, math.ceil(seconds)) if math.isfinite(seconds) else 0
        except (ValueError, TypeError):
            return 0

    def _deep(self, repository_id, owner, name, number, token):
        prepared = self.review.refresh(owner, name, number, repository_id=repository_id)
        source = prepared['snapshot']
        if (source.get('repositoryId') != repository_id or source.get('owner', '').lower() != owner.lower()
                or source.get('name', '').lower() != name.lower() or source.get('number') != number):
            raise BaselineError('INPUT_INVALID', 'PR 快照不属于当前基项目')
        state, now = prepared['remoteState'], self._now()
        snapshot_id = source['snapshotId']
        with self.storage.connection(write=True) as db:
            if not self._owns(db, repository_id, token):
                return
            old = db.execute('SELECT * FROM pr_cache WHERE repository_id=? AND number=?', (repository_id, number)).fetchone()
            watch = db.execute('SELECT * FROM pr_watch WHERE repository_id=?', (repository_id,)).fetchone()
            latest = prepared.get('pullRequest', {})
            draft = bool(prepared.get('draft', latest.get('draft', old['draft'])))
            updated_at = latest.get('updatedAt', old['updated_at'])
            db.execute('UPDATE pr_cache SET title=?,updated_at=?,remote_state=?,draft=?,snapshot_id=?,checked_at=? '
                'WHERE repository_id=? AND number=?', (latest.get('title', old['title']), updated_at, state,
                 int(draft), snapshot_id, now, repository_id, number))
            if old['snapshot_id'] and old['snapshot_id'] != snapshot_id and watch['initial_done']:
                self._event(db, repository_id, 'pr-updated', f'version:{repository_id}:{number}:{snapshot_id}',
                    'PR 有新版本', '作者或基准版本已变化；原审查和固定结果保持不变。',
                    number=number, snapshot_id=snapshot_id)
            if old['announced_state'] != state and watch['initial_done'] and state in ('closed', 'merged'):
                self._event(db, repository_id, 'pr-' + state, f'state:{repository_id}:{number}:{state}:{updated_at}',
                    'PR 已合并' if state == 'merged' else 'PR 已关闭', '停止新增自动分析，历史记录仍可阅读。',
                    number=number, snapshot_id=snapshot_id)
            db.execute('UPDATE pr_cache SET announced_state=? WHERE repository_id=? AND number=?', (state, repository_id, number))
            if watch['enabled'] and state == 'open' and not draft:
                identity = str(uuid.uuid5(uuid.NAMESPACE_URL, f'{repository_id}:{number}:{snapshot_id}:{watch["model_id"]}:{SCORING_CONTRACT}'))
                db.execute('INSERT OR IGNORE INTO pr_auto_intent(id,repository_id,number,snapshot_id,model_id,scoring_contract,created_at,updated_at) '
                    'VALUES (?,?,?,?,?,?,?,?)', (identity, repository_id, number, snapshot_id, watch['model_id'], SCORING_CONTRACT, now, now))
                # 只保留最新待处理目标。正在执行的旧版本仍可完成，手动任务不受影响。
                db.execute("UPDATE pr_auto_intent SET status='superseded',retry_at=NULL,updated_at=? WHERE repository_id=? AND number=? AND id!=? "
                           "AND status IN ('pending','backoff')", (now, repository_id, number, identity))
        self._supersede_queued(repository_id, number, snapshot_id, token)
        self._adopt_existing(repository_id, number, snapshot_id)

    def _supersede_queued(self, repository_id, number, snapshot_id, token):
        # 条件更新保证 worker 已领取时不被自动取消，也不把手动分析改成过时任务。
        with self.service._lock, self.storage.connection(write=True) as db:
            watch = db.execute('SELECT model_id,enabled FROM pr_watch WHERE repository_id=?', (repository_id,)).fetchone()
            latest = db.execute('SELECT snapshot_id FROM pr_cache WHERE repository_id=? AND number=?', (repository_id, number)).fetchone()
            if (not watch or not watch['enabled'] or not latest or latest[0] != snapshot_id
                    or not self._owns(db, repository_id, token)):
                return
            rows = db.execute('SELECT i.id,i.sync_id FROM pr_auto_intent i JOIN repository_sync s ON s.id=i.sync_id '
                "WHERE i.repository_id=? AND i.number=? AND (i.snapshot_id!=? OR i.model_id!=?) AND s.status='queued' "
                "AND s.source_kind='pr' AND s.origin='automatic'", (repository_id, number, snapshot_id, watch[0])).fetchall()
            for row in rows:
                changed = db.execute("UPDATE repository_sync SET status='cancelled',cancel_requested_at=?,completed_at=?,updated_at=?,"
                    "error_code='SYNC_CANCELLED',error_message='已有更新的 PR 自动分析目标' WHERE id=? AND status='queued'",
                    (self._now(), self._now(), self._now(), row['sync_id'])).rowcount
                if changed:
                    db.execute("UPDATE pr_auto_intent SET status='superseded',retry_at=NULL WHERE id=?", (row['id'],))

    def _adopt_existing(self, repository_id, number, snapshot_id):
        """手动与自动同来源同模型共用结果；主动重试由 PR 服务创建，不改个人模型选择。"""
        row = self._row(repository_id)
        if not row['enabled'] or not row['model_id']:
            return
        records = self.review.analyses(snapshot_id)['analyses']
        matching = [record['sync'] for record in records if self._model(record['sync']) == row['model_id']]
        if not matching:
            return
        preferred = next((job for job in matching if job['status'] in PROGRESS), None)
        preferred = preferred or next((job for job in matching if job['status'] == 'completed'), None) or matching[0]
        with self.storage.connection(write=True) as db:
            intent = db.execute('SELECT * FROM pr_auto_intent WHERE repository_id=? AND number=? AND snapshot_id=? AND model_id=? AND scoring_contract=?',
                (repository_id, number, snapshot_id, row['model_id'], SCORING_CONTRACT)).fetchone()
            if intent and intent['sync_id'] != preferred['syncId']:
                self._attach(db, intent['id'], preferred)

    @staticmethod
    def _model(job):
        return job.get('modelId') or job.get('resolvedModelId') or job.get('requestedModelId')

    def _attach(self, db, intent_id, job):
        now = self._now()
        db.execute('UPDATE pr_auto_intent SET sync_id=?,status=?,retry_at=NULL,error_code=NULL,updated_at=? WHERE id=?',
            (job['syncId'], 'queued' if job['status'] == 'queued' else 'running', now, intent_id))
        db.execute('INSERT OR IGNORE INTO pr_auto_attempt(intent_id,sync_id,created_at) VALUES (?,?,?)',
                   (intent_id, job['syncId'], now))

    def _announce(self, repository_id, token):
        with self.storage.connection(write=True) as db:
            if not self._owns(db, repository_id, token):
                return
            watch = db.execute('SELECT * FROM pr_watch WHERE repository_id=?', (repository_id,)).fetchone()
            rows = db.execute('SELECT * FROM pr_cache WHERE repository_id=? AND announced=0 ORDER BY number', (repository_id,)).fetchall()
            if not watch['initial_done']:
                if not watch['discovery_complete']:
                    return
                eligible = sum(row['remote_state'] == 'open' and not row['draft'] for row in rows)
                self._event(db, repository_id, 'pr-initial-summary', 'initial:' + repository_id,
                    'PR 初次检查完成', f'已发现 {len(rows)} 个 PR，其中 {eligible} 个开放非草稿 PR；按资源上限轮转检查和分析。',
                    payload=dict(discoveredCount=len(rows), eligibleCount=eligible, maxDeepChecks=DEEP_LIMIT))
                db.execute('UPDATE pr_watch SET initial_done=1 WHERE repository_id=?', (repository_id,))
            else:
                for row in rows:
                    self._event(db, repository_id, 'pr-discovered', f'discovered:{repository_id}:{row["number"]}',
                        '发现新 PR', row['title'], number=row['number'], snapshot_id=row['snapshot_id'])
            db.execute('UPDATE pr_cache SET announced=1 WHERE repository_id=?', (repository_id,))

    def _schedule(self, repository_id, token):
        with self.lock, self.service._lock:
            with self.storage.connection() as db:
                watch = db.execute('SELECT * FROM pr_watch WHERE repository_id=?', (repository_id,)).fetchone()
                if not watch or not watch['enabled'] or not self._owns(db, repository_id, token) or self.stop.is_set():
                    return
                queued = db.execute("SELECT COUNT(*) FROM repository_sync WHERE source_kind='pr' AND origin='automatic' AND status='queued'").fetchone()[0]
                if queued >= QUEUE_LIMIT:
                    return
                candidates = db.execute('SELECT i.* FROM pr_auto_intent i JOIN pr_cache c ON c.repository_id=i.repository_id AND c.number=i.number '
                    "WHERE i.repository_id=? AND c.remote_state='open' AND c.draft=0 AND c.snapshot_id=i.snapshot_id AND i.model_id=? "
                    "AND (i.status='pending' OR i.status='backoff' AND i.retry_at<=?) ORDER BY i.updated_at,i.number",
                    (repository_id, watch['model_id'], self._now())).fetchall()
            for row in candidates:
                with self.storage.connection() as db:
                    active = db.execute('SELECT 1 FROM pr_auto_intent i JOIN repository_sync s ON s.id=i.sync_id '
                        f'WHERE i.repository_id=? AND i.number=? AND s.status IN ({",".join("?" for _ in PROGRESS)})',
                        (repository_id, row['number'], *PROGRESS)).fetchone()
                    # 暂停可随时发生，入队前最后一次核对配置及领取身份。
                    current = db.execute('SELECT enabled,check_token,model_id FROM pr_watch WHERE repository_id=?', (repository_id,)).fetchone()
                if not current or not current['enabled'] or current['check_token'] != token or current['model_id'] != row['model_id']:
                    return
                if active:
                    continue
                try:
                    self.service._generic_model(row['model_id'])
                    envelope = self.review.analyze(row['snapshot_id'], {'modelId': row['model_id']},
                                                   retry=row['status'] == 'backoff', automatic=True)
                    jobs = [record['sync'] for record in envelope['analyses'] if self._model(record['sync']) == row['model_id']]
                    if not jobs:
                        raise BaselineError('PR_SOURCE_UNAVAILABLE', '分析未返回固定模型的任务')
                    job = next((job for job in jobs if job['status'] in PROGRESS), jobs[0])
                    with self.storage.connection(write=True) as db:
                        self._attach(db, row['id'], job)
                        if row['status'] == 'backoff':
                            db.execute('UPDATE pr_auto_intent SET retry_count=retry_count+1 WHERE id=?', (row['id'],))
                        db.execute('UPDATE pr_watch SET last_scheduled_at=? WHERE repository_id=?', (self._now(), repository_id))
                except BaselineError as exc:
                    with self.storage.connection(write=True) as db:
                        self._failure(db, dict(row), exc.code, self._retry_after(exc), count_attempt=True)
                return  # 每项目每轮至多提交一个分析。

    def _observe(self):
        with self.storage.connection() as db:
            rows = db.execute('SELECT a.sync_id AS attempt_sync_id,i.* FROM pr_auto_attempt a JOIN pr_auto_intent i ON i.id=a.intent_id '
                              'WHERE a.observed=0 ORDER BY a.created_at,a.sync_id').fetchall()
        for row in rows:
            job = self.service.sync.get(row['attempt_sync_id'])
            if job and job['status'] not in TERMINAL:
                continue
            row = dict(row)
            status = job['status'] if job else 'interrupted'
            facts = None
            if status == 'completed':
                envelope = self.review.analyses(row['snapshot_id'])
                record = next((record for record in envelope['analyses'] if record['sync']['syncId'] == row['attempt_sync_id']), None)
                if record and record.get('contextValid') and self._model(record['sync']) == row['model_id']:
                    source = self.review.get(row['snapshot_id'])
                    scores = record.get('scores', [])
                    counts = distribution_of([item.get('risk') for item in scores])
                    scored = sum(item.get('risk') is not None for item in scores)
                    facts = dict(highScoreCount=counts['high'], scoredCount=scored, totalCommits=source.get('totalCommits'),
                        coverageComplete=bool(source.get('commitsComplete') and scored == source.get('totalCommits')),
                        filesComplete=bool(source.get('filesComplete')), distributionRule=DISTRIBUTION_RULE)
                else:
                    status = 'failed'
            with self.storage.connection(write=True) as db:
                fresh = db.execute('SELECT observed FROM pr_auto_attempt WHERE intent_id=? AND sync_id=?',
                                   (row['id'], row['attempt_sync_id'])).fetchone()
                if not fresh or fresh[0]:
                    continue
                db.execute('UPDATE pr_auto_attempt SET observed=1 WHERE intent_id=? AND sync_id=?', (row['id'], row['attempt_sync_id']))
                current_intent = db.execute('SELECT sync_id,status,retry_count FROM pr_auto_intent WHERE id=?', (row['id'],)).fetchone()
                if current_intent is None:
                    continue
                row.update(dict(current_intent))
                is_latest = row['sync_id'] == row['attempt_sync_id']
                if status == 'completed':
                    current = db.execute('SELECT c.snapshot_id,w.model_id FROM pr_cache c LEFT JOIN pr_watch w ON w.repository_id=c.repository_id '
                                         'WHERE c.repository_id=? AND c.number=?', (row['repository_id'], row['number'])).fetchone()
                    is_current = bool(current and current['snapshot_id'] == row['snapshot_id'] and current['model_id'] == row['model_id'])
                    facts['isCurrent'] = is_current
                    message = ('当前固定版本' if is_current else '历史固定版本') + '分析已就绪；'
                    message += f'有 {facts["highScoreCount"]} 个高分提交。' if facts['highScoreCount'] else '已评分提交中没有高分提交。'
                    if not facts['coverageComplete']:
                        message += '提交覆盖或评分不完整，不能视为低风险结论。'
                    self._event(db, row['repository_id'], 'pr-analysis-ready', 'ready:' + row['attempt_sync_id'],
                        'PR 分析已就绪' if is_current else 'PR 历史分析已就绪', message, number=row['number'],
                        snapshot_id=row['snapshot_id'], sync_id=row['attempt_sync_id'], model_id=row['model_id'], payload=facts)
                    if is_latest:
                        db.execute("UPDATE pr_auto_intent SET status='completed',retry_at=NULL,error_code=NULL,updated_at=? WHERE id=?", (self._now(), row['id']))
                elif is_latest and row['status'] != 'superseded':
                    error = (job or {}).get('error') or {}
                    code = error.get('code') or ('PR_ANALYSIS_CONTEXT_INVALID' if status == 'failed' else 'SYNC_' + status.upper())
                    if status == 'failed':
                        self._failure(db, row, code, self._retry_after(error))
                    else:
                        db.execute('UPDATE pr_auto_intent SET status=?,error_code=?,retry_at=NULL,updated_at=? WHERE id=?',
                                   (status, code, self._now(), row['id']))
                        self._failure_event(db, row, code)

    def _failure(self, db, row, code, retry_after=0, *, count_attempt=False):
        retries = row['retry_count']
        if count_attempt and row['status'] == 'backoff':
            retries += 1
        retry = self._after(max(RETRY_DELAYS[retries], retry_after)) if code in TRANSIENT and retries < len(RETRY_DELAYS) else None
        db.execute('UPDATE pr_auto_intent SET status=?,retry_count=?,retry_at=?,error_code=?,updated_at=? WHERE id=?',
                   ('backoff' if retry else 'failed', retries, retry, code, self._now(), row['id']))
        if retry:
            db.execute('UPDATE pr_watch SET next_check_at=CASE WHEN next_check_at IS NULL OR next_check_at>? THEN ? ELSE next_check_at END '
                       'WHERE repository_id=? AND enabled=1', (retry, retry, row['repository_id']))
        else:
            self._failure_event(db, row, code)

    def _failure_event(self, db, row, code):
        self._event(db, row['repository_id'], 'pr-analysis-failed', f'failed:{row["id"]}:{code}',
            'PR 分析需要处理', '固定模型和来源已保留；可查看错误并主动重试，不会自动更换模型。',
            number=row['number'], snapshot_id=row['snapshot_id'], sync_id=row['attempt_sync_id'] if 'attempt_sync_id' in row else row['sync_id'],
            model_id=row['model_id'], payload=dict(errorCode=code))

    def _event(self, db, repository_id, kind, key, title, message, *, number=None, snapshot_id=None,
               sync_id=None, model_id=None, payload=None):
        db.execute('INSERT OR IGNORE INTO project_event VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            (str(uuid.uuid5(uuid.NAMESPACE_URL, key)), repository_id, kind, key, number, snapshot_id,
             sync_id, model_id, title, message, _dump(payload or {}), self._now()))

    def events(self, repository_id=None, limit=20, offset=0):
        if type(limit) is not int or not 1 <= limit <= 100 or type(offset) is not int or offset < 0:
            raise BaselineError('INPUT_INVALID', '事件分页参数无效')
        if repository_id is not None:
            self._repository(repository_id)
        where, params = ('WHERE e.repository_id=?', [repository_id]) if repository_id else ('', [])
        with self.storage.connection() as db:
            total = db.execute(f'SELECT COUNT(*) FROM project_event e {where}', params).fetchone()[0]
            rows = db.execute('SELECT e.*,r.url AS repository_url,r.head_commit AS current_head,c.snapshot_id AS current_snapshot,w.model_id AS current_model FROM project_event e '
                'JOIN repository r ON r.id=e.repository_id LEFT JOIN pr_cache c ON c.repository_id=e.repository_id AND c.number=e.number '
                'LEFT JOIN pr_watch w ON w.repository_id=e.repository_id '
                f'{where} ORDER BY e.created_at DESC,e.id DESC LIMIT ? OFFSET ?', (*params, limit, offset)).fetchall()
        result = []
        for row in rows:
            item = dict(eventId=row['id'], repositoryId=row['repository_id'], kind=row['kind'], createdAt=row['created_at'],
                        title=row['title'], message=row['message'], **json.loads(row['payload_json']))
            for column, key in (('number', 'number'), ('snapshot_id', 'snapshotId'), ('sync_id', 'syncId'), ('model_id', 'modelId')):
                if row[column] is not None:
                    item[key] = row[column]
            if row['snapshot_id']:
                item['isCurrent'] = (row['snapshot_id'] == row['current_snapshot']
                                     and (not row['model_id'] or row['model_id'] == row['current_model']))
            elif row['kind'] == 'branch-updated':
                item['isCurrent'] = item.get('head') != row['current_head']
            try:
                item['owner'], item['name'], _ = github_source(row['repository_url'])
            except BaselineError:
                pass
            result.append(item)
        return dict(events=result, total=total, limit=limit, offset=offset)
