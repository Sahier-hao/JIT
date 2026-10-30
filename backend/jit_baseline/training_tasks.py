"""Persistent administrator training jobs and their process lifecycle."""
import json
import sys
import tempfile
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .algorithms import get_algorithm
from .catalog import ModelCatalog
from .catalog_storage import CatalogStorage, utc_now
from .config import BACKEND
from .data import BaselineError, sha256
from .datasets import load_all, load_manifest, manifest_relative
from .metrics import get_metric_set
from .task_process import OwnedProcess
from .training import TrainingExecutor

ACTIVE = ("queued", "running")
TERMINAL = ("succeeded", "failed", "cancelled", "interrupted")
RETRYABLE = ("failed", "cancelled", "interrupted")
TRAINING_TIMEOUT = 1800

COLUMNS = (
    "id", "dataset_version", "dataset_manifest", "manifest_sha256", "algorithm",
    "metric_set", "status", "stage", "error_code", "error_message", "parent_task_id",
    "created_by", "request_id", "artifact_key", "artifact_run_id", "run_id", "model_id",
    "feature_schema_version", "metrics_json", "created_at", "updated_at", "started_at",
    "deadline_at", "cancel_requested_at", "completed_at",
)


def worker_command():
    return [sys.executable, "-m", "jit_baseline.training_worker"]


def _view(row):
    item = dict(row)
    error = None
    if item["error_code"]:
        error = {"code": item["error_code"], "message": item["error_message"]}
    metrics = json.loads(item["metrics_json"]) if item.get("metrics_json") else None
    return {
        "taskId": item["id"],
        "datasetVersion": item["dataset_version"],
        "datasetManifest": item["dataset_manifest"],
        "manifestSha256": item["manifest_sha256"],
        "method": item["algorithm"],
        "metricSet": item["metric_set"],
        "status": item["status"],
        "stage": item["stage"],
        "error": error,
        "parentTaskId": item.get("parent_task_id"),
        "createdBy": item["created_by"],
        "requestId": item.get("request_id"),
        "artifactKey": item.get("artifact_key"),
        "artifactRunId": item.get("artifact_run_id"),
        "runId": item.get("run_id"),
        "modelId": item.get("model_id"),
        "featureSchemaVersion": item.get("feature_schema_version"),
        "metrics": metrics,
        "createdAt": item["created_at"],
        "updatedAt": item["updated_at"],
        "startedAt": item.get("started_at"),
        "deadlineAt": item.get("deadline_at"),
        "cancelRequestedAt": item.get("cancel_requested_at"),
        "completedAt": item.get("completed_at"),
        "queuePosition": None,
    }


class TrainingTaskStorage:
    def __init__(self, storage=None):
        self.storage = storage if storage is not None else CatalogStorage()

    def create(self, row):
        unknown = set(row) - set(COLUMNS)
        if unknown:
            raise ValueError(f"未知训练任务字段：{sorted(unknown)}")
        with self.storage.connection(write=True) as db:
            db.execute(
                f"INSERT INTO training_task ({','.join(COLUMNS)}) "
                f"VALUES ({','.join('?' for _ in COLUMNS)})",
                tuple(row.get(name) for name in COLUMNS),
            )

    def update(self, task_id, **fields):
        if not fields:
            return
        unknown = set(fields) - set(COLUMNS)
        if unknown:
            raise ValueError(f"未知训练任务字段：{sorted(unknown)}")
        fields["updated_at"] = utc_now()
        assignments = ", ".join(f"{name}=?" for name in fields)
        with self.storage.connection(write=True) as db:
            db.execute(f"UPDATE training_task SET {assignments} WHERE id=?",
                       (*fields.values(), task_id))

    def raw(self, task_id):
        with self.storage.connection() as db:
            return db.execute("SELECT * FROM training_task WHERE id=?", (task_id,)).fetchone()

    def get(self, task_id):
        row = self.raw(task_id)
        return _view(row) if row is not None else None

    def find_active(self, dataset_version, algorithm, metric_set):
        placeholders = ",".join("?" for _ in ACTIVE)
        with self.storage.connection() as db:
            row = db.execute(
                "SELECT * FROM training_task WHERE dataset_version=? AND algorithm=? "
                f"AND metric_set=? AND status IN ({placeholders}) "
                "ORDER BY created_at DESC, id DESC LIMIT 1",
                (dataset_version, algorithm, metric_set, *ACTIVE),
            ).fetchone()
        return _view(row) if row is not None else None

    def pages(self, limit=20, offset=0):
        with self.storage.connection() as db:
            rows = db.execute(
                "SELECT * FROM training_task ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
            total = db.execute("SELECT COUNT(*) FROM training_task").fetchone()[0]
        return [_view(row) for row in rows], total

    def queue_positions(self):
        with self.storage.connection() as db:
            return {
                row[0]: index
                for index, row in enumerate(
                    db.execute("SELECT id FROM training_task WHERE status='queued' ORDER BY rowid"),
                    1,
                )
            }

    def start(self, task_id, timeout):
        now = datetime.now(timezone.utc)
        with self.storage.connection(write=True) as db:
            return db.execute(
                "UPDATE training_task SET status='running',stage='training',started_at=?,"
                "deadline_at=?,updated_at=? WHERE id=? AND status='queued' "
                "AND cancel_requested_at IS NULL",
                (
                    now.isoformat(),
                    (now + timedelta(seconds=timeout)).isoformat(),
                    utc_now(),
                    task_id,
                ),
            ).rowcount == 1

    def cancel(self, task_id):
        with self.storage.connection(write=True) as db:
            row = db.execute("SELECT * FROM training_task WHERE id=?", (task_id,)).fetchone()
            if row is None:
                raise BaselineError("NOT_FOUND", "训练任务不存在")
            if row["status"] == "cancelled":
                return
            if row["status"] not in ACTIVE:
                raise BaselineError("TASK_NOT_ACTIVE", "训练任务已经结束，请刷新记录")
            if row["cancel_requested_at"]:
                return
            now = utc_now()
            db.execute(
                "UPDATE training_task SET cancel_requested_at=?,updated_at=? WHERE id=?",
                (now, now, task_id),
            )
            if row["status"] == "queued":
                db.execute(
                    "UPDATE training_task SET status='cancelled',stage='cancelled',"
                    "completed_at=?,error_code='TRAINING_CANCELLED',"
                    "error_message='排队训练已取消' WHERE id=?",
                    (now, task_id),
                )

    def finish(self, task_id, status, code=None, message=None, **fields):
        with self.storage.connection(write=True) as db:
            row = db.execute("SELECT * FROM training_task WHERE id=?", (task_id,)).fetchone()
            if row is None or row["status"] not in ACTIVE:
                return False
            if row["cancel_requested_at"]:
                status, code, message = "cancelled", "TRAINING_CANCELLED", "训练已取消"
            now = utc_now()
            if status in ("cancelled", "interrupted") and "stage" not in fields:
                fields["stage"] = status
            fields.update(
                status=status,
                error_code=code,
                error_message=message,
                completed_at=now,
                updated_at=now,
            )
            unknown = set(fields) - set(COLUMNS)
            if unknown:
                raise ValueError(f"未知训练任务字段：{sorted(unknown)}")
            assignments = ", ".join(f"{name}=?" for name in fields)
            db.execute(
                f"UPDATE training_task SET {assignments} WHERE id=?",
                (*fields.values(), task_id),
            )
        return True

    def interrupted(self):
        placeholders = ",".join("?" for _ in ACTIVE)
        now = utc_now()
        with self.storage.connection(write=True) as db:
            return db.execute(
                "UPDATE training_task SET status=CASE WHEN cancel_requested_at IS NOT NULL "
                "THEN 'cancelled' ELSE 'interrupted' END, stage=CASE WHEN "
                "cancel_requested_at IS NOT NULL THEN 'cancelled' ELSE 'interrupted' END, "
                "error_code=CASE WHEN cancel_requested_at IS NOT NULL THEN 'TRAINING_CANCELLED' "
                "ELSE 'TRAINING_INTERRUPTED' END, error_message=CASE WHEN "
                "cancel_requested_at IS NOT NULL THEN '训练已取消' ELSE "
                "'服务重启时训练尚未完成，请显式重试' END, completed_at=?,updated_at=? "
                f"WHERE status IN ({placeholders})",
                (now, now, *ACTIVE),
            ).rowcount


class TrainingTaskService:
    def __init__(self, storage=None, catalog=None, artifact_root=None,
                 timeout=TRAINING_TIMEOUT, runner=None):
        self.storage = storage if storage is not None else CatalogStorage()
        self.tasks = TrainingTaskStorage(self.storage)
        self.catalog = catalog or ModelCatalog(self.storage, artifact_root)
        self.artifact_root = Path(
            artifact_root if artifact_root is not None else BACKEND / "artifacts").resolve()
        self.timeout = timeout
        self._runner = runner
        self.training = TrainingExecutor(self.catalog, self.artifact_root)
        self._isolated = runner is None
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

    def _positions(self, items):
        positions = self.tasks.queue_positions()
        for item in items:
            item["queuePosition"] = (
                positions.get(item["taskId"]) if item["status"] == "queued" else None
            )
        return items

    def get(self, task_id):
        item = self.tasks.get(task_id)
        if item is None:
            raise BaselineError("NOT_FOUND", "训练任务不存在")
        return self._positions([item])[0]

    def pages(self, limit=20, offset=0):
        if not 1 <= limit <= 100:
            raise BaselineError("INPUT_INVALID", "limit 必须在 1 到 100 之间")
        if offset < 0:
            raise BaselineError("INPUT_INVALID", "offset 不能为负")
        items, total = self.tasks.pages(limit, offset)
        return {
            "tasks": self._positions(items),
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    @staticmethod
    def _payload(payload):
        if not isinstance(payload, dict) or set(payload) - {
            "datasetVersion", "method", "metricSet"
        }:
            raise BaselineError("INPUT_INVALID", "训练任务只接受 datasetVersion、method 和 metricSet")
        dataset_version = payload.get("datasetVersion")
        method = payload.get("method")
        metric_set = payload.get("metricSet") or "metric-set-v2"
        if not isinstance(dataset_version, str) or not dataset_version.strip():
            raise BaselineError("INPUT_INVALID", "缺少数据集版本")
        if not isinstance(method, str) or not method.strip():
            raise BaselineError("INPUT_INVALID", "缺少训练方法")
        get_algorithm(method)
        get_metric_set(metric_set)
        return dataset_version.strip(), method, metric_set

    def _dataset(self, dataset_version):
        try:
            registered = load_all()
        except BaselineError as exc:
            raise BaselineError("DATASET_REGISTRY_EMPTY", str(exc)) from exc
        dataset = registered.get(dataset_version)
        if dataset is None:
            raise BaselineError("DATASET_INVALID", "数据集版本未登记")
        path = Path(dataset["manifestPath"])
        path = path if path.is_absolute() else BACKEND / path
        manifest = load_manifest(path)
        digest = sha256(path.read_bytes())
        return manifest, path, digest

    def _enqueue(self, *, dataset_version, method, metric_set, created_by, request_id,
                 parent_task_id=None):
        dataset, path, digest = self._dataset(dataset_version)
        if dataset["schemaName"] not in ("openstack-six-v1", "kamei14-v1",
                                          "kamei14-git-v1", "kamei14-benchmark-v1"):
            raise BaselineError("INPUT_SCHEMA_MISMATCH", "数据集 schema 不支持批量训练")
        active = self.tasks.find_active(dataset_version, method, metric_set)
        if active is not None:
            return self.get(active["taskId"]), False
        task_id = str(uuid.uuid4())
        now = utc_now()
        self.tasks.create({
            "id": task_id,
            "dataset_version": dataset_version,
            "dataset_manifest": manifest_relative(path),
            "manifest_sha256": digest,
            "algorithm": method,
            "metric_set": metric_set,
            "status": "queued",
            "stage": "queued",
            "parent_task_id": parent_task_id,
            "created_by": created_by,
            "request_id": request_id,
            "artifact_key": f"training-task-{task_id[:8]}",
            "created_at": now,
            "updated_at": now,
        })
        self._executor.submit(self._execute, task_id)
        return self.get(task_id), True

    def create(self, payload, request_id=None, *, created_by):
        dataset_version, method, metric_set = self._payload(payload)
        with self._lock:
            if self._closing.is_set():
                raise BaselineError("TASK_SERVICE_STOPPING", "训练服务正在停止，请稍后重试")
            return self._enqueue(
                dataset_version=dataset_version,
                method=method,
                metric_set=metric_set,
                created_by=created_by,
                request_id=request_id,
            )

    def retry(self, task_id, request_id=None, *, created_by):
        source = self.get(task_id)
        if source["status"] not in RETRYABLE:
            raise BaselineError("TASK_NOT_RETRYABLE", "只有失败、取消或中断的训练任务可以重试")
        with self._lock:
            return self._enqueue(
                dataset_version=source["datasetVersion"],
                method=source["method"],
                metric_set=source["metricSet"],
                created_by=created_by,
                request_id=request_id,
                parent_task_id=task_id,
            )

    def cancel(self, task_id):
        self.tasks.cancel(task_id)
        return self.get(task_id)

    def _run(self, task_id):
        item = self.tasks.raw(task_id)
        if item is None:
            return
        manifest_path = Path(item["dataset_manifest"])
        manifest_path = manifest_path if manifest_path.is_absolute() else BACKEND / manifest_path
        try:
            runner = self._runner or self.training.run
            result = runner(
                manifest_path,
                item["algorithm"],
                item["metric_set"],
                output_key=item["artifact_key"],
                channel="training-task",
                request_id=item["request_id"],
            )
            result = dict(result)
            result.pop("snapshot", None)
            self.tasks.finish(
                task_id,
                "succeeded",
                None,
                None,
                stage="completed",
                artifact_run_id=result["artifactRunId"],
                run_id=result["runId"],
                model_id=result["modelId"],
                feature_schema_version=result["featureSchemaVersion"],
                metrics_json=json.dumps(
                    result["metrics"], ensure_ascii=False, sort_keys=True, allow_nan=False
                ),
            )
        except BaselineError as exc:
            self.tasks.finish(task_id, "failed", exc.code, str(exc))
        except Exception:
            self.tasks.finish(
                task_id,
                "failed",
                "INTERNAL_ERROR",
                "训练过程中出现未预期错误，请重试或联系维护者",
            )

    def _execute(self, task_id):
        process = None
        try:
            if self._closing.is_set():
                self.tasks.finish(
                    task_id, "interrupted", "TRAINING_INTERRUPTED", "服务已停止，请重试"
                )
                return
            if not self.tasks.start(task_id, self.timeout):
                return
            if not self._isolated:
                self._run(task_id)
                return
            with tempfile.TemporaryDirectory(prefix="jit-training-") as work:
                try:
                    process = OwnedProcess(
                        worker_command(),
                        {
                            "database": str(self.storage.path),
                            "artifactRoot": str(self.artifact_root),
                            "taskId": task_id,
                            "workRoot": str(work),
                        },
                        cwd=BACKEND,
                    )
                    while True:
                        item = self.get(task_id)
                        if self._closing.is_set():
                            process.close()
                            self.tasks.finish(
                                task_id,
                                "interrupted",
                                "TRAINING_INTERRUPTED",
                                "服务已停止，请重试",
                            )
                            return
                        if item["cancelRequestedAt"]:
                            process.close()
                            self.tasks.finish(
                                task_id, "cancelled", "TRAINING_CANCELLED", "训练已取消"
                            )
                            return
                        if item["status"] not in ACTIVE:
                            return
                        if datetime.now(timezone.utc) >= datetime.fromisoformat(
                                item["deadlineAt"]):
                            process.close()
                            self.tasks.finish(
                                task_id,
                                "failed",
                                "TRAINING_TIMEOUT",
                                "训练超过执行时限，已停止",
                            )
                            return
                        if process.poll() is not None:
                            self.tasks.finish(
                                task_id,
                                "failed",
                                "TRAINING_WORKER_EXITED",
                                "训练进程意外退出，请重试",
                            )
                            return
                        self._closing.wait(0.1)
                finally:
                    if process is not None:
                        process.close()
        except Exception:
            self.tasks.finish(
                task_id,
                "failed",
                "TRAINING_WORKER_EXITED",
                "训练进程无法继续，请重试",
            )
