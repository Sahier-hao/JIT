"""Persistent collection-only dataset build tasks, isolated from project analysis."""
import json
import sys
import tempfile
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import collect
from .catalog_storage import CatalogStorage, utc_now
from .config import BACKEND
from .data import BaselineError, sha256
from .datasets import load_manifest
from .repository_datasets import dataset_manifest_path, persist_collected_dataset
from .task_process import OwnedProcess

ACTIVE = ("queued", "running")
TERMINAL = ("completed", "failed", "cancelled", "interrupted")
RETRYABLE = ("failed", "cancelled", "interrupted")
DEFAULT_LIMIT = 50000
MAX_LIMIT = 50000
BUILD_TIMEOUT = 600

COLUMNS = (
    "id", "repository_id", "repository_url", "branch", "since", "until", "commit_limit",
    "status", "stage", "error_code", "error_message", "parent_task_id", "created_by",
    "request_id", "dataset_name", "dataset_version", "dataset_manifest", "manifest_sha256",
    "quality_json", "collection_json", "reused", "head_commit", "created_at", "updated_at",
    "started_at", "deadline_at", "cancel_requested_at", "completed_at",
)


def worker_command():
    return [sys.executable, "-m", "jit_baseline.dataset_build_worker"]


def _json(value):
    return json.loads(value) if value else None


def _view(row):
    item = dict(row)
    return {
        "taskId": item["id"],
        "repositoryId": item["repository_id"],
        "repositoryUrl": item["repository_url"],
        "branch": item["branch"],
        "since": item["since"],
        "until": item["until"],
        "commitLimit": item["commit_limit"],
        "status": item["status"],
        "stage": item["stage"],
        "error": ({"code": item["error_code"], "message": item["error_message"]}
                  if item["error_code"] else None),
        "parentTaskId": item["parent_task_id"],
        "createdBy": item["created_by"],
        "requestId": item["request_id"],
        "datasetName": item["dataset_name"],
        "datasetVersion": item["dataset_version"],
        "datasetManifest": item["dataset_manifest"],
        "manifestSha256": item["manifest_sha256"],
        "quality": _json(item["quality_json"]),
        "collection": _json(item["collection_json"]),
        "reused": bool(item["reused"]),
        "headCommit": item["head_commit"],
        "createdAt": item["created_at"],
        "updatedAt": item["updated_at"],
        "startedAt": item["started_at"],
        "deadlineAt": item["deadline_at"],
        "cancelRequestedAt": item["cancel_requested_at"],
        "completedAt": item["completed_at"],
        "queuePosition": None,
    }


def _window(payload, now=None):
    now = now or datetime.now(timezone.utc)
    since, until = payload.get("since"), payload.get("until")
    start = 0 if since is None else (int(collect.parse_time(since)) // 86400) * 86400
    end = (((int(collect.parse_time(until)) if until is not None else int(now.timestamp()))
            // 86400) * 86400 + 86400)
    if start >= end:
        raise BaselineError("INPUT_INVALID", "起始日期必须早于结束日期")
    return (datetime.fromtimestamp(start, timezone.utc).isoformat(timespec="seconds"),
            datetime.fromtimestamp(end, timezone.utc).isoformat(timespec="seconds"))


class DatasetBuildStorage:
    def __init__(self, storage=None):
        self.storage = storage if storage is not None else CatalogStorage()

    def create(self, row):
        unknown = set(row) - set(COLUMNS)
        if unknown:
            raise ValueError(f"未知数据集构建任务字段：{sorted(unknown)}")
        with self.storage.connection(write=True) as db:
            db.execute(
                f"INSERT INTO dataset_build_task ({','.join(COLUMNS)}) "
                f"VALUES ({','.join('?' for _ in COLUMNS)})",
                tuple(row.get(name) for name in COLUMNS),
            )

    def update(self, task_id, **fields):
        if not fields:
            return
        unknown = set(fields) - set(COLUMNS)
        if unknown:
            raise ValueError(f"未知数据集构建任务字段：{sorted(unknown)}")
        fields["updated_at"] = utc_now()
        with self.storage.connection(write=True) as db:
            db.execute(
                f"UPDATE dataset_build_task SET {','.join(f'{name}=?' for name in fields)} WHERE id=?",
                (*fields.values(), task_id),
            )

    def raw(self, task_id):
        with self.storage.connection() as db:
            return db.execute("SELECT * FROM dataset_build_task WHERE id=?", (task_id,)).fetchone()

    def get(self, task_id):
        row = self.raw(task_id)
        return _view(row) if row is not None else None

    def find_active(self, repository_id, branch, since, until, commit_limit):
        with self.storage.connection() as db:
            row = db.execute(
                "SELECT * FROM dataset_build_task WHERE repository_id=? AND branch=? "
                "AND since IS ? AND until IS ? AND commit_limit=? "
                f"AND status IN ({','.join('?' for _ in ACTIVE)}) "
                "ORDER BY created_at DESC,id DESC LIMIT 1",
                (repository_id, branch, since, until, commit_limit, *ACTIVE),
            ).fetchone()
        return _view(row) if row is not None else None

    def pages(self, repository_id, limit=20, offset=0):
        with self.storage.connection() as db:
            rows = db.execute(
                "SELECT * FROM dataset_build_task WHERE repository_id=? "
                "ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
                (repository_id, limit, offset),
            ).fetchall()
            total = db.execute(
                "SELECT COUNT(*) FROM dataset_build_task WHERE repository_id=?",
                (repository_id,),
            ).fetchone()[0]
        return [_view(row) for row in rows], total

    def start(self, task_id, timeout):
        now = datetime.now(timezone.utc)
        with self.storage.connection(write=True) as db:
            return db.execute(
                "UPDATE dataset_build_task SET status='running',stage='collecting',"
                "started_at=?,deadline_at=?,updated_at=? WHERE id=? AND status='queued' "
                "AND cancel_requested_at IS NULL",
                (now.isoformat(), (now + timedelta(seconds=timeout)).isoformat(),
                 utc_now(), task_id),
            ).rowcount == 1

    def cancel(self, task_id):
        with self.storage.connection(write=True) as db:
            row = db.execute("SELECT * FROM dataset_build_task WHERE id=?", (task_id,)).fetchone()
            if row is None:
                raise BaselineError("NOT_FOUND", "数据集构建任务不存在")
            if row["status"] == "cancelled":
                return
            if row["status"] not in ACTIVE:
                raise BaselineError("TASK_NOT_ACTIVE", "数据集构建任务已经结束，请刷新记录")
            if row["cancel_requested_at"]:
                return
            now = utc_now()
            db.execute(
                "UPDATE dataset_build_task SET cancel_requested_at=?,updated_at=? WHERE id=?",
                (now, now, task_id),
            )
            if row["status"] == "queued":
                db.execute(
                    "UPDATE dataset_build_task SET status='cancelled',stage='cancelled',"
                    "error_code='DATASET_BUILD_CANCELLED',error_message='排队构建已取消',"
                    "completed_at=? WHERE id=?",
                    (now, task_id),
                )

    def finish(self, task_id, status, code=None, message=None, **fields):
        with self.storage.connection(write=True) as db:
            row = db.execute("SELECT * FROM dataset_build_task WHERE id=?", (task_id,)).fetchone()
            if row is None or row["status"] not in ACTIVE:
                return False
            if row["cancel_requested_at"]:
                status, code, message = (
                    "cancelled", "DATASET_BUILD_CANCELLED", "数据集构建已取消")
            now = utc_now()
            if status in ("cancelled", "interrupted") and "stage" not in fields:
                fields["stage"] = status
            fields.update(status=status, error_code=code, error_message=message,
                          completed_at=now, updated_at=now)
            unknown = set(fields) - set(COLUMNS)
            if unknown:
                raise ValueError(f"未知数据集构建任务字段：{sorted(unknown)}")
            db.execute(
                f"UPDATE dataset_build_task SET "
                f"{','.join(f'{name}=?' for name in fields)} WHERE id=?",
                (*fields.values(), task_id),
            )
        return True

    def interrupted(self):
        now = utc_now()
        with self.storage.connection(write=True) as db:
            return db.execute(
                "UPDATE dataset_build_task SET "
                "status=CASE WHEN cancel_requested_at IS NOT NULL THEN 'cancelled' ELSE 'interrupted' END,"
                "stage=CASE WHEN cancel_requested_at IS NOT NULL THEN 'cancelled' ELSE 'interrupted' END,"
                "error_code=CASE WHEN cancel_requested_at IS NOT NULL "
                "THEN 'DATASET_BUILD_CANCELLED' ELSE 'DATASET_BUILD_INTERRUPTED' END,"
                "error_message=CASE WHEN cancel_requested_at IS NOT NULL "
                "THEN '数据集构建已取消' ELSE '服务重启时数据集构建尚未完成，请显式重试' END,"
                "completed_at=?,updated_at=? "
                f"WHERE status IN ({','.join('?' for _ in ACTIVE)})",
                (now, now, *ACTIVE),
            ).rowcount


class DatasetBuildService:
    def __init__(self, storage=None, dataset_root=None, *, allow_local=False,
                 timeout=BUILD_TIMEOUT, collect_fn=None, runner=None):
        self.storage = storage if storage is not None else CatalogStorage()
        self.tasks = DatasetBuildStorage(self.storage)
        self.dataset_root = Path(dataset_root) if dataset_root is not None else None
        self.allow_local = allow_local
        self.timeout = timeout
        self.collect = collect_fn or collect.collect_repository
        self._runner = runner
        self._isolated = runner is None and collect_fn is None
        self._executor = ThreadPoolExecutor(max_workers=1)
        self._lock = threading.RLock()
        self._closing = threading.Event()

    def close(self):
        with self._lock:
            self._closing.set()
        self._executor.shutdown(wait=True)

    def recover(self):
        try:
            return self.tasks.interrupted()
        except BaselineError as exc:
            if exc.code == "STORAGE_UNAVAILABLE":
                return 0
            raise

    def _repository(self, repository_id):
        with self.storage.connection() as db:
            row = db.execute("SELECT * FROM repository WHERE id=?", (repository_id,)).fetchone()
        if row is None:
            raise BaselineError("REPOSITORY_UNKNOWN", "项目不存在")
        return row

    @staticmethod
    def _payload(payload):
        if not isinstance(payload, dict) or set(payload) - {
                "branch", "since", "until", "commitLimit"}:
            raise BaselineError(
                "INPUT_INVALID",
                "数据集构建只接受当前项目公开仓库的分支、范围与提交上限",
            )
        branch = payload.get("branch") or "HEAD"
        if not isinstance(branch, str) or not branch.strip():
            raise BaselineError("INPUT_INVALID", "分支必须是非空字符串")
        limit = payload.get("commitLimit", DEFAULT_LIMIT)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_LIMIT:
            raise BaselineError("INPUT_INVALID", f"提交上限必须是 1 到 {MAX_LIMIT} 之间的整数")
        since, until = _window(payload)
        return {
            "branch": branch.strip(),
            "since": since,
            "until": until,
            "commitLimit": limit,
        }

    def _positions(self, items):
        with self.storage.connection() as db:
            positions = {
                row[0]: index
                for index, row in enumerate(
                    db.execute(
                        "SELECT id FROM dataset_build_task WHERE status='queued' ORDER BY rowid"),
                    1,
                )
            }
        for item in items:
            item["queuePosition"] = (
                positions.get(item["taskId"]) if item["status"] == "queued" else None)
        return items

    def get(self, repository_id, task_id):
        item = self.tasks.get(task_id)
        if item is None or item["repositoryId"] != repository_id:
            raise BaselineError("NOT_FOUND", "数据集构建任务不存在")
        return self._positions([item])[0]

    def pages(self, repository_id, limit=20, offset=0):
        if not 1 <= limit <= 100 or offset < 0:
            raise BaselineError("INPUT_INVALID", "分页参数无效")
        self._repository(repository_id)
        items, total = self.tasks.pages(repository_id, limit, offset)
        return {
            "tasks": self._positions(items),
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    def _enqueue(self, repository, data, *, request_id, created_by, parent_task_id=None):
        active = self.tasks.find_active(
            repository["id"], data["branch"], data["since"], data["until"],
            data["commitLimit"])
        if active is not None:
            return self._positions([active])[0], False
        task_id, now = str(uuid.uuid4()), utc_now()
        self.tasks.create({
            "id": task_id,
            "repository_id": repository["id"],
            "repository_url": repository["url"],
            "branch": data["branch"],
            "since": data["since"],
            "until": data["until"],
            "commit_limit": data["commitLimit"],
            "status": "queued",
            "stage": "queued",
            "parent_task_id": parent_task_id,
            "created_by": created_by,
            "request_id": request_id,
            "created_at": now,
            "updated_at": now,
            "reused": 0,
        })
        self._executor.submit(self._execute, task_id)
        return self.get(repository["id"], task_id), True

    def create(self, repository_id, payload, request_id=None, *, created_by):
        repository = self._repository(repository_id)
        collect.validate_source(repository["url"], allow_local=self.allow_local)
        data = self._payload(payload)
        with self._lock:
            if self._closing.is_set():
                raise BaselineError("TASK_SERVICE_STOPPING", "数据集构建服务正在停止")
            return self._enqueue(
                repository, data, request_id=request_id, created_by=created_by)

    def retry(self, repository_id, task_id, request_id=None, *, created_by):
        source = self.get(repository_id, task_id)
        if source["status"] not in RETRYABLE:
            raise BaselineError("TASK_NOT_RETRYABLE", "只有失败、取消或中断的任务可以重试")
        repository = self._repository(repository_id)
        data = {
            "branch": source["branch"],
            "since": source["since"],
            "until": source["until"],
            "commitLimit": source["commitLimit"],
        }
        with self._lock:
            return self._enqueue(
                repository, data, request_id=request_id, created_by=created_by,
                parent_task_id=task_id)

    def cancel(self, repository_id, task_id):
        self.get(repository_id, task_id)
        self.tasks.cancel(task_id)
        return self.get(repository_id, task_id)

    def _check(self, task_id):
        row = self.tasks.raw(task_id)
        if row is None or row["status"] not in ACTIVE:
            raise BaselineError("DATASET_BUILD_CANCELLED", "数据集构建已结束")
        if row["cancel_requested_at"]:
            raise BaselineError("DATASET_BUILD_CANCELLED", "数据集构建已取消")
        if row["deadline_at"] and datetime.now(timezone.utc) >= datetime.fromisoformat(
                row["deadline_at"]):
            raise BaselineError("DATASET_BUILD_TIMEOUT", "数据集构建超过执行时限")
        return row

    def _run(self, task_id):
        row = self.tasks.raw(task_id)
        if row is None:
            return
        try:
            self._check(task_id)
            runner = self._runner or self.collect
            collected = runner(
                row["repository_url"], since=row["since"], until=row["until"],
                branch=row["branch"], limit=row["commit_limit"],
                allow_local=self.allow_local, return_blob=True,
            )
            self._check(task_id)
            self.tasks.update(task_id, stage="registering")
            manifest_path, version, _, created = persist_collected_dataset(
                self.storage, self.dataset_root,
                repository_url=row["repository_url"], since=row["since"], until=row["until"],
                collected=collected, usage="branch", source_id=task_id,
            )
            manifest = load_manifest(dataset_manifest_path(manifest_path))
            self.tasks.finish(
                task_id, "completed", None, None, stage="completed",
                dataset_name=manifest["dataset"],
                dataset_version=version,
                dataset_manifest=str(Path(manifest_path)),
                manifest_sha256=sha256(dataset_manifest_path(manifest_path).read_bytes()),
                quality_json=json.dumps(
                    manifest["quality"], ensure_ascii=False, sort_keys=True),
                collection_json=json.dumps(
                    manifest.get("collection"), ensure_ascii=False, sort_keys=True),
                reused=0 if created else 1,
                head_commit=(manifest.get("collection") or {}).get("repository", {}).get("head"),
            )
        except BaselineError as exc:
            self.tasks.finish(
                task_id,
                "cancelled" if exc.code == "DATASET_BUILD_CANCELLED" else "failed",
                exc.code, str(exc),
            )
        except Exception:
            self.tasks.finish(
                task_id, "failed", "INTERNAL_ERROR",
                "数据集构建过程中出现未预期错误，请重试或联系维护者",
            )

    def _execute(self, task_id):
        process = None
        try:
            if self._closing.is_set():
                self.tasks.finish(
                    task_id, "interrupted", "DATASET_BUILD_INTERRUPTED", "服务已停止，请重试")
                return
            if not self.tasks.start(task_id, self.timeout):
                return
            if not self._isolated:
                self._run(task_id)
                return
            with tempfile.TemporaryDirectory(prefix="jit-dataset-build-") as work:
                try:
                    process = OwnedProcess(
                        worker_command(),
                        {
                            "database": str(self.storage.path),
                            "datasetRoot": str(
                                self.dataset_root.resolve()
                                if self.dataset_root is not None else ""),
                            "allowLocal": self.allow_local,
                            "taskId": task_id,
                            "workRoot": str(work),
                        },
                        cwd=BACKEND,
                    )
                    while True:
                        item = self.tasks.get(task_id)
                        if self._closing.is_set():
                            process.close()
                            self.tasks.finish(
                                task_id, "interrupted", "DATASET_BUILD_INTERRUPTED",
                                "服务已停止，请重试")
                            return
                        if item["cancelRequestedAt"]:
                            process.close()
                            self.tasks.finish(
                                task_id, "cancelled", "DATASET_BUILD_CANCELLED",
                                "数据集构建已取消")
                            return
                        if item["status"] not in ACTIVE:
                            return
                        if datetime.now(timezone.utc) >= datetime.fromisoformat(
                                item["deadlineAt"]):
                            process.close()
                            self.tasks.finish(
                                task_id, "failed", "DATASET_BUILD_TIMEOUT",
                                "数据集构建超过执行时限，已停止")
                            return
                        if process.poll() is not None:
                            self.tasks.finish(
                                task_id, "failed", "DATASET_BUILD_WORKER_EXITED",
                                "数据集构建进程意外退出，请重试")
                            return
                        self._closing.wait(0.1)
                finally:
                    if process is not None:
                        process.close()
        except Exception:
            self.tasks.finish(
                task_id, "failed", "DATASET_BUILD_WORKER_EXITED",
                "数据集构建进程无法继续，请重试")
