"""后台导入任务。进度独立于目录库的批量写入事务。"""
import json
import os
import re
import tempfile
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from hashlib import sha256 as digest
from pathlib import Path

from .. import datasets, store
from ..api_errors import LOGGER
from ..catalog_storage import utc_now
from ..config import BACKEND, USER_DATASET_LIMIT
from ..data import BaselineError, sha256
from ..schemas import KAMEI_2013_SCHEMA
from .published_dataset_imports import import_projects

ACTIVE = {"queued", "running"}
MAX_ACTIVE = 4
LEGACY_PREFIX = "legacy-"
LEGACY_GROUP_WINDOW = timedelta(minutes=15)


def _timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError):
        return datetime.now(timezone.utc)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _legacy_source(manifest, dataset_name):
    upload = (manifest.get("benchmark") or {}).get("upload")
    if isinstance(upload, str) and upload.strip():
        return Path(upload.replace("\\", "/")).name
    url = manifest.get("url")
    if isinstance(url, str) and url.startswith("upload://"):
        return Path(url.replace("\\", "/")).name
    path = (manifest.get("file") or {}).get("path")
    return Path(path or dataset_name).name


def _import_name(value, username, filename):
    raw = value if isinstance(value, str) and value.strip() else Path(filename).stem
    slug = re.sub(r'[^a-z0-9._-]+', '-', raw.lower()).strip('-._')[:64] or 'dataset'
    if value is None or not str(value).strip():
        account = re.sub(r'[^a-z0-9._-]+', '-', username.lower()).strip('-._') or 'user'
        return f'import-{account}-{slug}'[:80]
    return slug


def import_csv(storage, root, username, filename, blob, *, schema, dataset=None, report=None):
    if schema == KAMEI_2013_SCHEMA:
        return import_projects(storage, root, username, filename, blob, zipped=False, report=report)

    name = _import_name(dataset, username, filename)
    source_name = re.sub(r'[^A-Za-z0-9._-]+', '-', filename)[:120] or 'upload.csv'
    provenance = {'publisher': 'user-upload', 'revision': '0' * 40, 'url': f'upload://{username}/{source_name}',
                  'citation': '用户导入的 CSV；未提供发布者观察与成熟声明'}
    if report:
        report(total=1, stage='validating', currentFile=filename)
    if storage.dataset_owner_count(username) >= USER_DATASET_LIMIT:
        raise BaselineError('QUOTA_EXCEEDED', f'每人最多保留 {USER_DATASET_LIMIT} 个数据版本，请先清理')
    with tempfile.TemporaryDirectory(prefix='jit-user-import-') as temporary:
        source = Path(temporary) / 'source.csv'
        source.write_bytes(blob)
        probe = datasets.build_manifest(source, schema=schema, dataset=name, provenance=provenance,
                                        extra={'usage': 'import'})
    version = probe['version']
    root_path = root or datasets.DATASETS
    room = root_path / name
    owners = storage.dataset_owners(version)
    if owners and username not in owners:
        raise BaselineError('DATASET_FORBIDDEN', '同内容数据集属于其他用户')
    if not owners and (room / f'{version}.json').exists():
        raise BaselineError('DATASET_EXISTS', '同内容数据已登记为共享版本，请更换数据集名称后再导入')

    def import_after(entry, csv_path):
        path = Path(entry['path'])
        return store.import_dataset(csv_path, path if path.is_absolute() else BACKEND / path, storage,
                                    progress=(lambda written: report(rowsWritten=written)) if report else None)

    if report:
        report(stage='importing', rowsTotal=probe['quality']['includedRows'])
    registered = store.publish_unique(
        room, name, version, blob, schema=schema, cohort=probe['cohort'], provenance=provenance,
        extra={'usage': 'import'}, root=root_path, after=import_after,
    )
    if report:
        report(stage='registering', processed=1, currentFile=None, rowsTotal=None, rowsWritten=0)
    created = storage.add_dataset_owner(registered['version'], username, limit=USER_DATASET_LIMIT)
    path = Path(registered['path'])
    return [datasets.load_manifest(path if path.is_absolute() else BACKEND / path)], int(created)


def upload_name(value, kind):
    name = (value or '').replace('\\', '/').rsplit('/', 1)[-1].strip()
    name = re.sub(r'[\x00-\x1f<>:"|?*]', '-', name).rstrip('. ')[:120]
    suffix = f'.{kind}'
    return (name if name.lower().endswith(suffix) else name + suffix) if name else 'upload' + suffix


class DatasetImportJobs:
    def __init__(self, storage, root):
        self.storage = storage
        self.root = root
        self.directory = storage.path.with_name(f'.{storage.path.name}.imports')
        self._lock = threading.RLock()
        self._worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix='dataset-import')
        self._closing = False

    def _tasks(self):
        return [json.loads(path.read_text(encoding='utf-8')) for path in self.directory.glob('*.json')]

    def _legacy_tasks(self, owner, covered):
        """把导入任务落盘前登记的旧数据还原成只读历史记录。"""
        with self.storage.connection() as db:
            rows = db.execute(
                'SELECT o.dataset_version, o.created_at AS owned_at, d.dataset_name, d.manifest_json '
                'FROM dataset_owner o JOIN dataset_record d '
                'ON d.dataset_version=o.dataset_version WHERE o.username=? ORDER BY o.created_at',
                (owner,),
            ).fetchall()
        groups = []
        for row in rows:
            if row['dataset_version'] in covered:
                continue
            try:
                manifest = json.loads(row['manifest_json'])
            except (TypeError, ValueError):
                continue
            if manifest.get('usage') != 'import':
                continue
            owned_at = _timestamp(row['owned_at'])
            filename = _legacy_source(manifest, row['dataset_name'])
            version = {
                'version': row['dataset_version'],
                'project': (manifest.get('benchmark') or {}).get('project'),
                'dataset': manifest.get('dataset') or row['dataset_name'],
                'records': manifest.get('quality', {}).get('includedRows', 0),
            }
            previous = groups[-1] if groups else None
            if (previous is not None and previous['filename'] == filename
                    and owned_at - previous['lastAt'] <= LEGACY_GROUP_WINDOW):
                previous['versions'].append(version)
                previous['lastAt'] = owned_at
                continue
            groups.append({
                'filename': filename,
                'firstAt': owned_at,
                'lastAt': owned_at,
                'versions': [version],
            })
        tasks = []
        for group in groups:
            first = group['firstAt'].isoformat()
            task_id = LEGACY_PREFIX + digest(
                f"{owner}\0{group['filename']}\0{first}".encode('utf-8')
            ).hexdigest()[:32]
            tasks.append({
                'taskId': task_id,
                'filename': group['filename'],
                'status': 'completed',
                'stage': 'completed',
                'processed': len(group['versions']),
                'total': len(group['versions']),
                'currentFile': None,
                'rowsTotal': None,
                'rowsWritten': 0,
                'versions': group['versions'],
                'preferredVersion': group['versions'][-1]['version'],
                'createdCount': len(group['versions']),
                'error': None,
                'createdAt': first,
                'updatedAt': group['lastAt'].isoformat(),
                'legacy': True,
            })
        return tasks

    def _write(self, task):
        target = self.directory / f"{task['taskId']}.json"
        temporary = target.with_suffix('.tmp')
        temporary.write_text(json.dumps(task, ensure_ascii=False), encoding='utf-8')
        os.replace(temporary, target)

    def _read(self, task_id):
        if not re.fullmatch(r'[0-9a-f]{32}', task_id):
            raise BaselineError('NOT_FOUND', '导入任务不存在')
        path = self.directory / f'{task_id}.json'
        try:
            return json.loads(path.read_text(encoding='utf-8'))
        except FileNotFoundError as exc:
            raise BaselineError('NOT_FOUND', '导入任务不存在') from exc

    @staticmethod
    def _view(task):
        view = {key: value for key, value in task.items() if key not in {'owner', 'digest', 'dataset'}}
        view['legacy'] = bool(task.get('legacy'))
        return view

    def _payload(self, task_id):
        return self.directory / f'{task_id}.upload'

    def _update(self, task_id, **fields):
        with self._lock:
            task = self._read(task_id)
            task.update(fields, updatedAt=utc_now())
            self._write(task)

    def get(self, owner, task_id):
        with self._lock:
            if task_id.startswith(LEGACY_PREFIX):
                jobs = self._tasks()
                covered = {item['version'] for task in jobs for item in task.get('versions', [])}
                for task in self._legacy_tasks(owner, covered):
                    if task['taskId'] == task_id:
                        return self._view(task)
                raise BaselineError('NOT_FOUND', '导入任务不存在')
            task = self._read(task_id)
            if task['owner'] != owner:
                raise BaselineError('NOT_FOUND', '导入任务不存在')
            return self._view(task)

    def list(self, owner, active_only=False):
        with self._lock:
            jobs = self._tasks()
            tasks = [task for task in jobs if task['owner'] == owner
                     and (not active_only or task['status'] in ACTIVE)]
            if not active_only:
                covered = {item['version'] for task in jobs for item in task.get('versions', [])}
                tasks.extend(self._legacy_tasks(owner, covered))
        return [self._view(task) for task in sorted(tasks, key=lambda row: row['createdAt'], reverse=True)[:20]]

    def create(self, owner, blob, *, filename, kind, schema, dataset):
        digest = sha256(blob)
        with self._lock:
            if self._closing:
                raise BaselineError('TASK_SERVICE_STOPPING', '导入服务正在停止')
            active = [task for task in self._tasks() if task['status'] in ACTIVE]
            same_user = next((task for task in active if task['owner'] == owner), None)
            if same_user:
                if all(same_user[key] == value for key, value in {
                        'digest': digest, 'filename': filename, 'format': kind, 'schema': schema,
                        'dataset': dataset}.items()):
                    return self._view(same_user)
                raise BaselineError('QUOTA_EXCEEDED', '当前账户已有正在导入的任务')
            if len(active) >= MAX_ACTIVE:
                raise BaselineError('QUOTA_EXCEEDED', '导入队列已满')
            task_id = uuid.uuid4().hex
            timestamp = utc_now()
            task = dict(taskId=task_id, owner=owner, filename=filename, format=kind, schema=schema,
                        dataset=dataset, digest=digest, status='queued', stage='queued', processed=0,
                        total=None, currentFile=None, rowsTotal=None, rowsWritten=0,
                        versions=[], preferredVersion=None, createdCount=0, error=None,
                        createdAt=timestamp, updatedAt=timestamp)
            self.directory.mkdir(parents=True, exist_ok=True)
            self._payload(task_id).write_bytes(blob)
            self._write(task)
            self._worker.submit(self._run, task)
            return self._view(task)

    def _run(self, task):
        task_id = task['taskId']

        def report(**fields):
            self._update(task_id, **fields)

        try:
            report(status='running', stage='validating')
            blob = self._payload(task_id).read_bytes()
            args = self.storage, self.root, task['owner'], task['filename'], blob
            if task['format'] == 'zip':
                manifests, created = import_projects(*args, zipped=True, report=report)
            else:
                manifests, created = import_csv(*args, schema=task['schema'], dataset=task['dataset'], report=report)
            versions = [{'version': item['version'], 'project': (item.get('benchmark') or {}).get('project'),
                         'dataset': item['dataset'], 'records': item['quality']['includedRows']}
                        for item in manifests]
            preferred = versions[0]
            if 0 < created < len(versions):
                preferred = max(versions, key=lambda item: (self.storage.dataset(item['version']) or {}).get('importedAt', ''))
            report(status='completed', stage='completed', processed=len(versions), total=len(versions),
                   versions=versions, preferredVersion=preferred['version'], createdCount=created)
        except BaselineError as exc:
            report(status='failed', error={'code': exc.code, 'message': str(exc)})
        except Exception:
            LOGGER.exception('dataset import failed taskId=%s', task_id)
            report(status='failed', error={'code': 'DATASET_UNAVAILABLE', 'message': '导入失败，请查看服务日志。'})
        finally:
            self._payload(task_id).unlink(missing_ok=True)

    def recover(self):
        with self._lock:
            for task in self._tasks():
                if task['status'] in ACTIVE:
                    self._update(task['taskId'], status='interrupted',
                                 error={'code': 'DATASET_IMPORT_INTERRUPTED', 'message': '服务已重启，请重新上传文件。'})
            for path in self.directory.glob('*.upload'):
                path.unlink()

    def close(self):
        with self._lock:
            self._closing = True
        self._worker.shutdown(wait=True, cancel_futures=True)
        self.recover()
