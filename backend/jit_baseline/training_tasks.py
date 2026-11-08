"""Persistent administrator training jobs and their process lifecycle."""
import json
import sys
import tempfile
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .algorithms import get_algorithm, param_specs, resolve_params
from .catalog import ModelCatalog
from .catalog_storage import CatalogStorage, utc_now
from .config import BACKEND
from .data import BaselineError, sha256
from .datasets import load_all, load_manifest, manifest_relative
from .metrics import get_metric_set
from .task_process import OwnedProcess
from .training import TrainingExecutor
from .splits import resolve_preset
from .split_preview import validate_dataset_split

ACTIVE = ("queued", "running")
TERMINAL = ("succeeded", "failed", "cancelled", "interrupted")
RETRYABLE = ("failed", "cancelled", "interrupted")
TRAINING_TIMEOUT = 1800

COLUMNS = (
    "id", "dataset_version", "dataset_manifest", "manifest_sha256", "algorithm",
    "metric_set", "status", "stage", "error_code", "error_message", "parent_task_id",
    "created_by", "request_id", "artifact_key", "artifact_run_id", "run_id", "model_id",
    "feature_schema_version", "metrics_json", "created_at", "updated_at", "started_at",
    "deadline_at", "cancel_requested_at", "completed_at", "class_policy_json",
    "class_policy_summary_json", "metrics_by_partition_json", "split_json", "split_rule",
    "data_scale_json", "training_performance_json", "split_preset", "split_policy_json",
    "experiment_id", "params_json", "history_json",
)

EXPERIMENT_COLUMNS = (
    "id", "dataset_version", "dataset_manifest", "manifest_sha256", "metric_set",
    "split_preset", "class_policy_json", "seed", "signature", "request_id",
    "created_by", "created_at",
)

DEFAULT_EXPERIMENT_SEED = 2026


def worker_command():
    return [sys.executable, "-m", "jit_baseline.training_worker"]


def _view(row):
    item = dict(row)
    error = None
    if item["error_code"]:
        error = {"code": item["error_code"], "message": item["error_message"]}
    metrics = json.loads(item["metrics_json"]) if item.get("metrics_json") else None
    metrics_by_partition = (json.loads(item["metrics_by_partition_json"])
                            if item.get("metrics_by_partition_json") else None)
    split = json.loads(item["split_json"]) if item.get("split_json") else None
    split_policy = (json.loads(item["split_policy_json"])
                    if item.get("split_policy_json") else None)
    data_scale = json.loads(item["data_scale_json"]) if item.get("data_scale_json") else None
    training_performance = (json.loads(item["training_performance_json"])
                            if item.get("training_performance_json") else None)
    parameters = json.loads(item["params_json"]) if item.get("params_json") else None
    training_history = (json.loads(item["history_json"])
                        if item.get("history_json") else None)
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
        "metricsByPartition": metrics_by_partition,
        "split": split,
        "splitPreset": item.get("split_preset") or "temporal-70-15-15",
        "splitPolicy": split_policy,
        "splitRule": item.get("split_rule"),
        "dataScale": data_scale,
        "trainingPerformance": training_performance,
        "experimentId": item.get("experiment_id"),
        "parameters": parameters,
        "trainingHistory": training_history,
        "classPolicy": json.loads(item["class_policy_json"]) if item.get("class_policy_json") else None,
        "classPolicySummary": (json.loads(item["class_policy_summary_json"])
                               if item.get("class_policy_summary_json") else None),
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

    def find_active(self, dataset_version, algorithm, metric_set, class_policy_json=None,
                    split_preset=None, params_json=None):
        placeholders = ",".join("?" for _ in ACTIVE)
        with self.storage.connection() as db:
            row = db.execute(
                "SELECT * FROM training_task WHERE dataset_version=? AND algorithm=? "
                f"AND metric_set=? AND class_policy_json IS ? "
                "AND COALESCE(split_preset,'temporal-70-15-15') IS ? "
                "AND params_json IS ? "
                f"AND status IN ({placeholders}) "
                "ORDER BY created_at DESC, id DESC LIMIT 1",
                (dataset_version, algorithm, metric_set, class_policy_json, split_preset,
                 params_json, *ACTIVE),
            ).fetchone()
        return _view(row) if row is not None else None

    def experiment_create(self, row):
        unknown = set(row) - set(EXPERIMENT_COLUMNS)
        if unknown:
            raise ValueError(f"未知实验字段：{sorted(unknown)}")
        with self.storage.connection(write=True) as db:
            db.execute(
                f"INSERT INTO training_experiment ({','.join(EXPERIMENT_COLUMNS)}) "
                f"VALUES ({','.join('?' for _ in EXPERIMENT_COLUMNS)})",
                tuple(row.get(name) for name in EXPERIMENT_COLUMNS),
            )

    def experiment_get(self, experiment_id):
        with self.storage.connection() as db:
            row = db.execute("SELECT * FROM training_experiment WHERE id=?",
                             (experiment_id,)).fetchone()
        return dict(row) if row is not None else None

    def experiment_find_signature(self, signature):
        with self.storage.connection() as db:
            return db.execute(
                "SELECT * FROM training_experiment WHERE signature=? "
                "ORDER BY created_at DESC LIMIT 1", (signature,)).fetchone()

    def experiment_link(self, experiment_id, task_id, created_at):
        with self.storage.connection(write=True) as db:
            db.execute(
                "INSERT OR IGNORE INTO training_experiment_task "
                "(experiment_id, task_id, created_at) VALUES (?, ?, ?)",
                (experiment_id, task_id, created_at),
            )

    def experiment_tasks(self, experiment_id):
        with self.storage.connection() as db:
            rows = db.execute(
                "SELECT t.* FROM training_experiment_task e "
                "JOIN training_task t ON t.id=e.task_id "
                "WHERE e.experiment_id=? ORDER BY e.created_at, t.rowid", (experiment_id,)
            ).fetchall()
        return [_view(row) for row in rows]

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
                 dataset_root=None, timeout=TRAINING_TIMEOUT, runner=None):
        self.storage = storage if storage is not None else CatalogStorage()
        self.tasks = TrainingTaskStorage(self.storage)
        self.catalog = catalog or ModelCatalog(self.storage, artifact_root)
        self.artifact_root = Path(
            artifact_root if artifact_root is not None else BACKEND / "artifacts").resolve()
        self.dataset_root = Path(dataset_root) if dataset_root is not None else None
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
            "datasetVersion", "method", "metricSet", "classPolicy", "splitPreset", "params"
        }:
            raise BaselineError("INPUT_INVALID", "训练任务只接受 datasetVersion、method、metricSet、classPolicy、splitPreset 和 params")
        dataset_version = payload.get("datasetVersion")
        method = payload.get("method")
        metric_set = payload.get("metricSet") or "metric-set-v2"
        class_policy = payload.get("classPolicy")
        split_preset = resolve_preset(payload.get("splitPreset"))
        if not isinstance(dataset_version, str) or not dataset_version.strip():
            raise BaselineError("INPUT_INVALID", "缺少数据集版本")
        if not isinstance(method, str) or not method.strip():
            raise BaselineError("INPUT_INVALID", "缺少训练方法")
        get_algorithm(method)
        get_metric_set(metric_set)
        class_policy = TrainingTaskService._class_policy(class_policy)
        resolved, _ = resolve_params(method, payload.get("params"))
        return dataset_version.strip(), method, metric_set, class_policy, split_preset, resolved

    @staticmethod
    def _class_policy(class_policy):
        if class_policy is not None:
            if not isinstance(class_policy, dict) or class_policy.get("kind") not in ("weights", "sample"):
                raise BaselineError("INPUT_INVALID", "classPolicy.kind 必须是 weights 或 sample")
            if class_policy["kind"] == "sample":
                seed = class_policy.get("seed", 0)
                if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
                    raise BaselineError("INPUT_INVALID", "采样种子必须是非负整数")
        return class_policy

    def _dataset(self, dataset_version):
        try:
            registered = load_all(self.dataset_root)
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

    @staticmethod
    def _overrides(method, params):
        """只保留与冻结声明不同、且受契约声明的参数键。"""
        defaults = get_algorithm(method)["params"]
        specs = param_specs(method)
        return {key: value for key, value in (params or {}).items()
                if key in specs and defaults.get(key) != value}

    def _enqueue(self, *, dataset_version, method, metric_set, created_by, request_id,
                 parent_task_id=None, class_policy=None, split_preset=None, params=None,
                 experiment_id=None):
        dataset, path, digest = self._dataset(dataset_version)
        if dataset["schemaName"] not in ("openstack-six-v1", "kamei14-v1",
                                          "kamei14-git-v1", "kamei14-git-v2",
                                          "kamei14-benchmark-v1"):
            raise BaselineError("INPUT_SCHEMA_MISMATCH", "数据集 schema 不支持批量训练")
        validate_dataset_split(self.dataset_root, dataset_version, split_preset)
        class_policy_json = json.dumps(class_policy, ensure_ascii=False, sort_keys=True) if class_policy else None
        split_preset = resolve_preset(split_preset)
        overrides = self._overrides(method, params)
        params_json = (json.dumps(params, ensure_ascii=False, sort_keys=True)
                       if overrides else None)
        active = self.tasks.find_active(dataset_version, method, metric_set, class_policy_json,
                                        split_preset, params_json)
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
            "class_policy_json": class_policy_json,
            "split_preset": split_preset,
            "experiment_id": experiment_id,
            "params_json": params_json,
        })
        self._executor.submit(self._execute, task_id)
        return self.get(task_id), True

    def create(self, payload, request_id=None, *, created_by):
        dataset_version, method, metric_set, class_policy, split_preset, params = self._payload(payload)
        with self._lock:
            if self._closing.is_set():
                raise BaselineError("TASK_SERVICE_STOPPING", "训练服务正在停止，请稍后重试")
            return self._enqueue(
                dataset_version=dataset_version,
                method=method,
                metric_set=metric_set,
                created_by=created_by,
                request_id=request_id,
                class_policy=class_policy,
                split_preset=split_preset,
                params=params,
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
                class_policy=source.get("classPolicy"),
                split_preset=source.get("splitPreset"),
                params=source.get("parameters"),
                experiment_id=source.get("experimentId"),
            )

    def cancel(self, task_id):
        self.tasks.cancel(task_id)
        return self.get(task_id)

    MAX_EXPERIMENT_METHODS = 8

    @staticmethod
    def _experiment_payload(payload):
        allowed = {"datasetVersion", "metricSet", "classPolicy", "splitPreset", "methods"}
        if not isinstance(payload, dict) or set(payload) - allowed:
            raise BaselineError(
                "INPUT_INVALID",
                "实验只接受 datasetVersion、metricSet、classPolicy、splitPreset 和 methods")
        dataset_version = payload.get("datasetVersion")
        if not isinstance(dataset_version, str) or not dataset_version.strip():
            raise BaselineError("INPUT_INVALID", "缺少数据集版本")
        metric_set = payload.get("metricSet") or "metric-set-v2"
        get_metric_set(metric_set)
        class_policy = TrainingTaskService._class_policy(payload.get("classPolicy"))
        split_preset = resolve_preset(payload.get("splitPreset"))
        methods = payload.get("methods")
        if not isinstance(methods, list) or not methods:
            raise BaselineError("INPUT_INVALID", "实验至少需要一个训练方法")
        if len(methods) > TrainingTaskService.MAX_EXPERIMENT_METHODS:
            raise BaselineError("INPUT_INVALID", f"一次实验最多 {TrainingTaskService.MAX_EXPERIMENT_METHODS} 个方法")
        items, seen = [], set()
        for entry in methods:
            if not isinstance(entry, dict) or set(entry) - {"method", "params"}:
                raise BaselineError("INPUT_INVALID", "每个方法只接受 method 和 params")
            method = entry.get("method")
            if not isinstance(method, str) or not method.strip():
                raise BaselineError("INPUT_INVALID", "缺少训练方法")
            if method in seen:
                raise BaselineError("INPUT_INVALID", f"方法重复：{method}")
            seen.add(method)
            get_algorithm(method)
            resolved, _ = resolve_params(method, entry.get("params"))
            items.append({"method": method, "params": resolved})
        return dataset_version.strip(), metric_set, class_policy, split_preset, items

    def _experiment_signature(self, dataset_version, digest, metric_set, class_policy,
                              split_preset, items):
        record = {
            "datasetVersion": dataset_version,
            "manifestSha256": digest,
            "metricSet": metric_set,
            "splitPreset": split_preset,
            "classPolicy": class_policy,
            "methods": [{"method": item["method"], "params": item["params"]} for item in items],
        }
        return sha256(json.dumps(record, sort_keys=True, ensure_ascii=False,
                                 separators=(",", ":")).encode("utf-8"))

    def _experiment_view(self, row):
        tasks = self._positions(self.tasks.experiment_tasks(row["id"]))
        counts = {status: 0 for status in ("queued", "running", "succeeded", "failed",
                                           "cancelled", "interrupted")}
        for task in tasks:
            counts[task["status"]] = counts.get(task["status"], 0) + 1
        if any(task["status"] in ACTIVE for task in tasks):
            status = "running" if any(task["status"] == "running" for task in tasks) else "queued"
        elif not tasks:
            status = "empty"
        elif counts["succeeded"] == len(tasks):
            status = "succeeded"
        elif counts["succeeded"] == 0:
            status = ("failed" if counts["failed"] else
                      "interrupted" if counts["interrupted"] else "cancelled")
        else:
            status = "partial"
        return {
            "experimentId": row["id"],
            "datasetVersion": row["dataset_version"],
            "datasetManifest": row["dataset_manifest"],
            "manifestSha256": row["manifest_sha256"],
            "metricSet": row["metric_set"],
            "splitPreset": row["split_preset"],
            "classPolicy": json.loads(row["class_policy_json"]) if row["class_policy_json"] else None,
            "seed": row["seed"],
            "requestId": row["request_id"],
            "createdBy": row["created_by"],
            "createdAt": row["created_at"],
            "status": status,
            "statusCounts": counts,
            "tasks": tasks,
        }

    def create_experiment(self, payload, request_id=None, *, created_by):
        dataset_version, metric_set, class_policy, split_preset, items = (
            self._experiment_payload(payload))
        with self._lock:
            if self._closing.is_set():
                raise BaselineError("TASK_SERVICE_STOPPING", "训练服务正在停止，请稍后重试")
            dataset, path, digest = self._dataset(dataset_version)
            if dataset["schemaName"] not in ("openstack-six-v1", "kamei14-v1",
                                              "kamei14-git-v1", "kamei14-git-v2",
                                              "kamei14-benchmark-v1"):
                raise BaselineError("INPUT_SCHEMA_MISMATCH", "数据集 schema 不支持批量训练")
            validate_dataset_split(self.dataset_root, dataset_version, split_preset)
            signature = self._experiment_signature(dataset_version, digest, metric_set,
                                                   class_policy, split_preset, items)
            existing = self.tasks.experiment_find_signature(signature)
            if existing is not None:
                view = self._experiment_view(existing)
                if view["tasks"] and all(task["status"] in ACTIVE for task in view["tasks"]):
                    return view, False
            experiment_id = str(uuid.uuid4())
            now = utc_now()
            self.tasks.experiment_create({
                "id": experiment_id,
                "dataset_version": dataset_version,
                "dataset_manifest": manifest_relative(path),
                "manifest_sha256": digest,
                "metric_set": metric_set,
                "split_preset": split_preset,
                "class_policy_json": (json.dumps(class_policy, ensure_ascii=False, sort_keys=True)
                                      if class_policy else None),
                "seed": DEFAULT_EXPERIMENT_SEED,
                "signature": signature,
                "request_id": request_id,
                "created_by": created_by,
                "created_at": now,
            })
            created = False
            for item in items:
                task, is_new = self._enqueue(
                    dataset_version=dataset_version,
                    method=item["method"],
                    metric_set=metric_set,
                    created_by=created_by,
                    request_id=request_id,
                    class_policy=class_policy,
                    split_preset=split_preset,
                    params=item["params"],
                    experiment_id=experiment_id,
                )
                created = created or is_new
                self.tasks.experiment_link(experiment_id, task["taskId"], utc_now())
            return self._experiment_view(self.tasks.experiment_get(experiment_id)), created

    def get_experiment(self, experiment_id):
        row = self.tasks.experiment_get(experiment_id)
        if row is None:
            raise BaselineError("NOT_FOUND", "训练实验不存在")
        return self._experiment_view(row)

    def compare_experiment(self, experiment_id):
        view = self.get_experiment(experiment_id)
        rows = []
        for task in view["tasks"]:
            performance = task.get("trainingPerformance") or {}
            rows.append({
                "taskId": task["taskId"],
                "method": task["method"],
                "methodName": get_algorithm(task["method"])["name"],
                "category": get_algorithm(task["method"])["category"],
                "parameters": task.get("parameters"),
                "status": task["status"],
                "stage": task["stage"],
                "error": task.get("error"),
                "metrics": task.get("metrics"),
                "metricsByPartition": task.get("metricsByPartition"),
                "trainingSeconds": performance.get("durationSeconds"),
                "runId": task.get("runId"),
                "modelId": task.get("modelId"),
                "manifestSha256": task["manifestSha256"],
                "splitPreset": task.get("splitPreset"),
                "classPolicy": task.get("classPolicy"),
                "metricSet": task["metricSet"],
            })
        successful = [row for row in rows if row["status"] == "succeeded"]
        fingerprints = {(row["manifestSha256"], row["splitPreset"], row["metricSet"],
                         json.dumps(row["classPolicy"], sort_keys=True)) for row in successful}
        comparable = len(fingerprints) <= 1
        notes = []
        if len(successful) < 2:
            notes.append("成功子任务少于两个，比较表仅作状态记录")
        if not comparable:
            notes.append("成功子任务的数据或切分身份不同，不可直接比较")
        return {
            "format": "training-experiment-comparison-v1",
            "experimentId": view["experimentId"],
            "datasetVersion": view["datasetVersion"],
            "manifestSha256": view["manifestSha256"],
            "metricSet": view["metricSet"],
            "splitPreset": view["splitPreset"],
            "classPolicy": view["classPolicy"],
            "seed": view["seed"],
            "status": view["status"],
            "comparable": comparable,
            "notes": notes,
            "methods": rows,
        }

    def _run(self, task_id):
        item = self.tasks.raw(task_id)
        if item is None:
            return
        manifest_path = Path(item["dataset_manifest"])
        manifest_path = manifest_path if manifest_path.is_absolute() else BACKEND / manifest_path
        try:
            runner = self._runner or self.training.run
            extra = {}
            if item["class_policy_json"]:
                extra["class_policy"] = json.loads(item["class_policy_json"])
            extra["split_preset"] = item["split_preset"] or "temporal-70-15-15"
            if item["params_json"]:
                overrides = self._overrides(item["algorithm"],
                                            json.loads(item["params_json"]))
                if overrides:
                    extra["params"] = overrides
            # 多方法实验只产出并校验运行；显式登记由管理员在实验登记页完成。
            extra["register"] = item["experiment_id"] is None
            result = runner(
                manifest_path,
                item["algorithm"],
                item["metric_set"],
                output_key=item["artifact_key"],
                channel="training-task",
                request_id=item["request_id"],
                **extra,
            )
            result = dict(result)
            result.pop("snapshot", None)
            if result.get("classPolicy") is not None:
                self.tasks.update(task_id, class_policy_summary_json=json.dumps(
                    result["classPolicy"], ensure_ascii=False, sort_keys=True))
            split_policy_json = (
                json.dumps(result["splitPolicy"], ensure_ascii=False, sort_keys=True)
                if result.get("splitPolicy") is not None else None
            )
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
                metrics_by_partition_json=json.dumps(
                    result.get("metricsByPartition"), ensure_ascii=False,
                    sort_keys=True, allow_nan=False),
                split_json=json.dumps(
                    result.get("split"), ensure_ascii=False, sort_keys=True, allow_nan=False),
                split_rule=result.get("splitRule"),
                data_scale_json=json.dumps(
                    result.get("dataScale"), ensure_ascii=False,
                    sort_keys=True, allow_nan=False),
                training_performance_json=json.dumps(
                    result.get("trainingPerformance"), ensure_ascii=False,
                    sort_keys=True, allow_nan=False),
                split_policy_json=split_policy_json,
                history_json=(json.dumps(result["trainingHistory"], ensure_ascii=False,
                                         sort_keys=True, allow_nan=False)
                              if result.get("trainingHistory") is not None else None),
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
