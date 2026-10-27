"""Persistent per-repository monitoring; each changed HEAD creates a separate analysis."""
import logging
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from .catalog_storage import utc_now
from .errors import BaselineError
from .repository_probe import probe_repository
from .sync import PROGRESS

LOGGER = logging.getLogger('jit.catalog')
FIELDS = {'enabled': 'enabled', 'branch': 'branch', 'modelId': 'model_id', 'intervalSeconds': 'interval_seconds',
          'windowDays': 'window_days', 'commitLimit': 'commit_limit'}


def after(seconds):
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat().replace('+00:00', 'Z')


def valid_branch(value):
    return (isinstance(value, str) and 0 < len(value) <= 200 and not value.startswith(('-', '/'))
            and not value.endswith(('/', '.', '.lock')) and '..' not in value and '@{' not in value
            and '//' not in value and not re.search(r'[\s~^:?*\[\\\x00-\x1f\x7f]', value))


class RepositoryUpdates:
    def __init__(self, service, *, probe=None):
        self.service = service
        self.storage = service.sync.storage
        self.probe = probe or (lambda url, branch, stop: probe_repository(
            url, branch, stop, allow_local=service.allow_local))
        self.stop = threading.Event()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='repository-check')
        self.lock = threading.RLock()
        self.thread = None

    def start(self):
        if self.thread is None:
            self.thread = threading.Thread(target=self._loop, daemon=True, name='repository-schedule')
            self.thread.start()

    def _loop(self):
        while not self.stop.is_set():
            try:
                self.tick()
            except BaselineError as exc:
                if exc.code != 'STORAGE_UNAVAILABLE':
                    LOGGER.warning('repository scheduler: %s', exc.code)
            except Exception:
                LOGGER.exception('repository scheduler failed')
            self.stop.wait(5)

    def close(self):
        self.stop.set()
        if self.thread is not None:
            self.thread.join(timeout=10)
        self.executor.shutdown(wait=True)

    def _row(self, repository_id):
        repository = self.service.sync.repository_get(repository_id)
        if repository is None:
            raise BaselineError('REPOSITORY_UNKNOWN', '仓库不存在')
        source = self.service.sync.get(repository['viewSyncId']) if repository['viewSyncId'] else None
        branch = (source or {}).get('analysisBranch') or (source or {}).get('branch') or 'HEAD'
        if re.fullmatch(r'[a-f0-9]{40}|[a-f0-9]{64}', branch):
            branch = repository.get('defaultBranch') or 'HEAD'
            if re.fullmatch(r'[a-f0-9]{40}|[a-f0-9]{64}', branch):
                branch = 'HEAD'
        model_id = (source or {}).get('modelId')
        with self.storage.connection(write=True) as db:
            db.execute('INSERT OR IGNORE INTO repository_watch(repository_id,branch,model_id) VALUES (?,?,?)',
                       (repository_id, branch, model_id))
            return dict(db.execute('SELECT * FROM repository_watch WHERE repository_id=?', (repository_id,)).fetchone())

    def _write(self, repository_id, **fields):
        assignments = ','.join(f'{key}=?' for key in fields)
        with self.storage.connection(write=True) as db:
            db.execute(f'UPDATE repository_watch SET {assignments} WHERE repository_id=?', (*fields.values(), repository_id))

    def get(self, repository_id):
        with self.lock:
            row = self._row(repository_id)
            if row['status'] == 'checking' and row['lease_until'] and row['lease_until'] < utc_now():
                self._write(repository_id, status='error', error_code='SYNC_INTERRUPTED', check_token=None, lease_until=None)
                row = self._row(repository_id)
            job = self.service.sync.get(row['sync_id']) if row['sync_id'] else None
            if row['status'] == 'analyzing' and (not job or job['status'] not in PROGRESS):
                self._write(repository_id, status='updated' if job and job['status'] == 'completed' else 'error',
                            error_code=None if job and job['status'] == 'completed' else ((job or {}).get('error') or {}).get('code') or 'SYNC_INTERRUPTED')
                row = self._row(repository_id)
            return dict(repositoryId=repository_id, enabled=bool(row['enabled']), branch=row['branch'],
                        modelId=row['model_id'], intervalSeconds=row['interval_seconds'], status=row['status'],
                        windowDays=row['window_days'], commitLimit=row['commit_limit'],
                        lastAttemptAt=row['last_attempt_at'], lastCheckedAt=row['last_checked_at'],
                        nextCheckAt=row['next_check_at'] if row['enabled'] else None, remoteHead=row['remote_head'],
                        resolvedBranch=row['resolved_branch'], syncId=row['sync_id'], errorCode=row['error_code'])

    def configure(self, repository_id, payload):
        if not isinstance(payload, dict) or not payload or set(payload) - set(FIELDS):
            raise BaselineError('INPUT_INVALID', '更新设置无效')
        if ('enabled' in payload and not isinstance(payload['enabled'], bool)
                or 'branch' in payload and not valid_branch(payload['branch'])
                or 'intervalSeconds' in payload and (type(payload['intervalSeconds']) is not int or not 300 <= payload['intervalSeconds'] <= 86400)
                or 'windowDays' in payload and (type(payload['windowDays']) is not int or not 1 <= payload['windowDays'] <= 3650)
                or 'commitLimit' in payload and (type(payload['commitLimit']) is not int or not 1 <= payload['commitLimit'] <= 5000)
                or 'modelId' in payload and (not isinstance(payload['modelId'], str) or not payload['modelId'].strip())):
            raise BaselineError('INPUT_INVALID', '更新设置无效')
        with self.lock:
            row = self._row(repository_id)
            changing_source = any(key in payload and payload[key] != row[FIELDS[key]] for key in ('branch', 'modelId', 'windowDays', 'commitLimit'))
            if changing_source and (self.get(repository_id)['status'] in ('checking', 'analyzing')):
                raise BaselineError('CONFLICT_ACTIVE_SYNC', '更新进行中，请稍后修改分支或模型')
            if 'modelId' in payload:
                self.service._generic_model(payload['modelId'])
            fields = {FIELDS[key]: value for key, value in payload.items()}
            if changing_source:
                fields.update(status='idle', sync_id=None, remote_head=None, resolved_branch=None,
                              last_checked_at=None, error_code=None)
            enabled = payload.get('enabled', row['enabled'])
            fields['next_check_at'] = (row['next_check_at'] or utc_now()) if enabled else None
            self._write(repository_id, **fields)
            return self.get(repository_id)

    def enroll(self, repository_id):
        """New UI projects prepare an initial result; old projects remain opt-in."""
        self.configure(repository_id, {'enabled': True})
        return self.request(repository_id)

    def request(self, repository_id):
        with self.lock:
            if self.stop.is_set():
                raise BaselineError('SYNC_SERVICE_STOPPING', '服务正在停止')
            state = self.get(repository_id)
            if state['status'] in ('checking', 'analyzing'):
                return state
            if self.service.sync.repository_active(repository_id):
                raise BaselineError('CONFLICT_ACTIVE_SYNC', '项目已有进行中的分析')
            token = str(uuid.uuid4())
            with self.storage.connection(write=True) as db:
                changed = db.execute("UPDATE repository_watch SET status='checking', check_token=?, lease_until=?, "
                                     "last_attempt_at=?, error_code=NULL WHERE repository_id=? AND status NOT IN ('checking','analyzing')",
                                     (token, after(120), utc_now(), repository_id)).rowcount
            if changed:
                self.executor.submit(self._check, repository_id, token)
            return self.get(repository_id)

    def tick(self):
        with self.storage.connection() as db:
            due = [row[0] for row in db.execute('SELECT repository_id FROM repository_watch WHERE enabled=1 '
                                               'AND (next_check_at IS NULL OR next_check_at<=?) ORDER BY next_check_at,repository_id', (utc_now(),))]
        count = 0
        for repository_id in due:
            try:
                if self.get(repository_id)['status'] not in ('checking', 'analyzing') and not self.service.sync.repository_active(repository_id):
                    self.request(repository_id)
                    count += 1
                    break
            except BaselineError as exc:
                if exc.code not in ('REPOSITORY_UNKNOWN', 'CONFLICT_ACTIVE_SYNC'):
                    raise
        return count

    def _check(self, repository_id, token):
        error, fields = None, {}
        try:
            row = self._row(repository_id)
            if row['check_token'] != token:
                return
            self._write(repository_id, lease_until=after(120))
            repo = self.service.sync.repository_get(repository_id)
            model_id = row['model_id'] or self.service.catalog.default_model_id()
            if not model_id:
                raise BaselineError('DEFAULT_MODEL_REQUIRED', '请设置或选择仓库更新模型')
            self._write(repository_id, model_id=model_id)
            self.service._generic_model(model_id)
            result = self.probe(repo['url'], row['branch'], self.stop)
            if self.stop.is_set():
                raise BaselineError('SYNC_INTERRUPTED', '检查已停止')
            fields.update(last_checked_at=utc_now(), remote_head=result['head'], resolved_branch=result['branch'])
            previous = self.service.sync.get(row['sync_id']) if row['sync_id'] else None
            if (previous and previous['status'] == 'completed' and previous.get('headCommit') == result['head']
                    and previous.get('modelId') == model_id):
                fields['status'] = 'up-to-date'
            else:
                with self.service._lock:
                    if self._row(repository_id)['check_token'] != token:
                        return
                    if self.service.sync.repository_active(repository_id):
                        raise BaselineError('CONFLICT_ACTIVE_SYNC', '项目已有进行中的分析')
                    job, _ = self.service.create(dict(repositoryUrl=repo['url'], branch=result['branch'],
                                                      strategy='generic-model', modelId=model_id, commitLimit=row['commit_limit'],
                                                      since=(datetime.now(timezone.utc) - timedelta(days=row['window_days'])).date().isoformat()))
                fields.update(status='analyzing', sync_id=job['syncId'])
        except BaselineError as exc:
            error = exc.code
        except Exception:
            LOGGER.exception('repository check failed')
            error = 'REPOSITORY_UNAVAILABLE'
        finally:
            with self.lock:
                with self.storage.connection(write=True) as db:
                    current = db.execute('SELECT * FROM repository_watch WHERE repository_id=? AND check_token=?',
                                         (repository_id, token)).fetchone()
                    if current:
                        fields.update(error_code=error, check_token=None, lease_until=None,
                                      next_check_at=after(current['interval_seconds']) if current['enabled'] else None)
                        if error:
                            fields['status'] = 'error'
                        assignments = ','.join(f'{key}=?' for key in fields)
                        db.execute(f'UPDATE repository_watch SET {assignments} WHERE repository_id=? AND check_token=?',
                                   (*fields.values(), repository_id, token))
