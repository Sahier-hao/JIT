"""可中断恢复的多仓库采集批处理。

只负责编排：任务清单、固定 revision、阶段状态、取消、重试与内容身份幂等。
标签仍由既有 `collect.collect_repository` 与 SZZ 实现产生，产出新的数据版本；
既有 CSV 与描述文件不被覆盖。
"""
from __future__ import annotations

import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .collect import collect_repository
from .config import BACKEND
from .data import BaselineError
from .datasets import load_manifest

FORMAT = "jit-collection-batch-v1"
INDEX_NAME = "index.json"
STAGES = ("pending", "collecting", "completed", "failed", "cancelled")
TASK_FIELDS = ("repo", "branch", "since", "until", "limit", "szz", "dataset", "language")
DEFAULT_SZZ = "full"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _dump(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _digest(value) -> str:
    return hashlib.sha256(_dump(value).encode("utf-8")).hexdigest()


def _text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise BaselineError("INPUT_INVALID", f"任务缺少 {field}")
    return value.strip()


def normalize_task(entry, index):
    """校验一条任务；只保留影响数据内容与登记身份的字段。"""
    if not isinstance(entry, dict):
        raise BaselineError("INPUT_INVALID", f"第 {index} 条任务必须是对象")
    unknown = set(entry) - set(TASK_FIELDS)
    if unknown:
        raise BaselineError("INPUT_INVALID", f"第 {index} 条任务包含未知字段：{sorted(unknown)}")
    task = {
        "repo": _text(entry.get("repo"), "repo"),
        "branch": entry.get("branch") or "HEAD",
        "since": entry.get("since"),
        "until": entry.get("until"),
        "limit": entry.get("limit"),
        "szz": entry.get("szz") or DEFAULT_SZZ,
        "dataset": entry.get("dataset"),
        "language": entry.get("language"),
    }
    if task["szz"] not in ("full", "line", "simple"):
        raise BaselineError("INPUT_INVALID", f"第 {index} 条任务的 szz 不受支持")
    dataset = task.get("dataset")
    if dataset is not None:
        if (not isinstance(dataset, str) or not dataset or dataset.startswith(".")
                or ".." in dataset or "/" in dataset or "\\" in dataset
                or any(ord(char) < 32 for char in dataset)):
            raise BaselineError("INPUT_INVALID", f"第 {index} 条任务的 dataset 名称无效")
    if task["limit"] is not None and (isinstance(task["limit"], bool)
                                      or not isinstance(task["limit"], int)
                                      or task["limit"] < 1):
        raise BaselineError("INPUT_INVALID", f"第 {index} 条任务的 limit 必须是正整数")
    return task


def task_identity(task) -> str:
    """影响采集内容与登记身份的字段；显示名与语言不参与。"""
    payload = {key: task.get(key) for key in ("repo", "branch", "since", "until", "limit", "szz", "dataset")}
    payload["repo"] = payload["repo"].rstrip("/").lower()
    return _digest(payload)


class BatchCollection:
    """一个目录保存全部批次状态；每次状态变化原子写盘，进程重启后可继续。"""

    def __init__(self, state_root, *, dataset_root=None, collector=collect_repository):
        self.root = Path(state_root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.dataset_root = Path(dataset_root) if dataset_root is not None else BACKEND / "data/datasets"
        self.collector = collector

    # ---- 状态读写 -------------------------------------------------------
    def _path(self, batch_id) -> Path:
        if not isinstance(batch_id, str) or not batch_id or "/" in batch_id or "\\" in batch_id:
            raise BaselineError("INPUT_INVALID", "批次标识无效")
        return self.root / f"{batch_id}.json"

    def _write(self, state, *, adopt=True):
        if adopt:
            self._adopt_cancellation(state)
        state["updatedAt"] = _now()
        target = self._path(state["batchId"])
        temporary = target.with_name(target.name + ".tmp")
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True),
                             encoding="utf-8")
        os.replace(temporary, target)

    def _index(self):
        path = self.root / INDEX_NAME
        if not path.exists():
            return {}
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return value if isinstance(value, dict) else {}

    def _write_index(self, index):
        path = self.root / INDEX_NAME
        temporary = path.with_name(path.name + ".tmp")
        temporary.write_text(json.dumps(index, ensure_ascii=False, indent=2, sort_keys=True),
                             encoding="utf-8")
        os.replace(temporary, path)

    def _adopt_cancellation(self, state):
        """另一个进程可能已写入取消意图；写回前先采纳，避免整文件覆盖丢失。"""
        try:
            current = self.load(state["batchId"])
        except BaselineError:
            return
        cancelled_at = current.get("cancelledAt")
        if cancelled_at and not state.get("cancelledAt"):
            state["cancelledAt"] = cancelled_at
            for entry in state["repos"]:
                if entry["stage"] == "pending":
                    entry["stage"] = "cancelled"
                    entry["finishedAt"] = cancelled_at

    def load(self, batch_id):
        path = self._path(batch_id)
        if not path.exists():
            raise BaselineError("BATCH_UNKNOWN", "批次不存在")
        state = json.loads(path.read_text(encoding="utf-8"))
        if state.get("format") != FORMAT:
            raise BaselineError("BATCH_UNKNOWN", "批次格式不受支持")
        return state

    # ---- 创建与执行 -----------------------------------------------------
    def create(self, tasks, *, register=True):
        """按内容身份创建或复用批次；相同清单返回同一批次。"""
        if not isinstance(tasks, list) or not tasks:
            raise BaselineError("INPUT_INVALID", "任务清单不能为空")
        normalized = [normalize_task(entry, index) for index, entry in enumerate(tasks)]
        identities = [task_identity(task) for task in normalized]
        if len(set(identities)) != len(identities):
            raise BaselineError("INPUT_INVALID", "任务清单包含重复仓库与参数")
        key = _digest({"tasks": identities, "register": bool(register)})
        index = self._index()
        existing = index.get(key)
        if existing and self._path(existing).exists():
            return self.load(existing), False
        batch_id = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
        state = {
            "format": FORMAT, "batchId": batch_id, "contentKey": key,
            "createdAt": _now(), "updatedAt": _now(), "register": bool(register),
            "cancelledAt": None,
            "repos": [
                {**task, "identity": identity, "index": order, "stage": "pending",
                 "attempts": 0, "startedAt": None, "finishedAt": None,
                 "error": None, "errorCode": None, "datasetVersion": None,
                 "records": None, "positiveLabels": None, "includedRows": None,
                 "quality": None, "output": None}
                for order, (task, identity) in enumerate(zip(normalized, identities, strict=True))
            ],
        }
        self._write(state)
        index[key] = batch_id
        self._write_index(index)
        return state, True

    def cancel(self, batch_id):
        state = self.load(batch_id)
        if state.get("cancelledAt") is None:
            state["cancelledAt"] = _now()
            for entry in state["repos"]:
                if entry["stage"] == "pending":
                    entry["stage"] = "cancelled"
                    entry["finishedAt"] = state["cancelledAt"]
        self._write(state)
        return state

    def run(self, batch_id, *, retry_failed=False, max_repos=None, cancel_check=None):
        """按清单顺序执行；中断后再次调用只继续未完成项。"""
        state = self.load(batch_id)
        if state.get("cancelledAt"):
            if not retry_failed:
                return state
            # 显式恢复：清理取消意图，把被取消的未开始项重新排队。
            state["cancelledAt"] = None
            for entry in state["repos"]:
                if entry["stage"] == "cancelled":
                    entry["stage"] = "pending"
                    entry["finishedAt"] = None
            self._write(state, adopt=False)
        processed = 0
        for entry in state["repos"]:
            if cancel_check is not None and cancel_check():
                state["cancelledAt"] = _now()
                break
            if entry["stage"] == "completed":
                continue
            if entry["stage"] == "failed" and not retry_failed:
                continue
            if entry["stage"] == "cancelled":
                continue
            if max_repos is not None and processed >= max_repos:
                break
            processed += 1
            self._run_one(state, entry)
        if state.get("cancelledAt"):
            for entry in state["repos"]:
                if entry["stage"] == "pending":
                    entry["stage"] = "cancelled"
                    entry["finishedAt"] = state["cancelledAt"]
        self._write(state)
        return state

    def _run_one(self, state, entry):
        entry["stage"] = "collecting"
        entry["attempts"] += 1
        entry["startedAt"] = _now()
        entry["finishedAt"] = None
        entry["error"] = None
        entry["errorCode"] = None
        self._write(state)
        dataset = entry.get("dataset") or None
        output = self.root / "work" / state["batchId"] / f"{entry['index']:02d}-{dataset or 'dataset'}.csv"
        try:
            result = self.collector(
                entry["repo"], since=entry.get("since"), until=entry.get("until"),
                branch=entry.get("branch") or "HEAD", output=output, dataset=dataset,
                register=bool(state.get("register", True)), limit=entry.get("limit"),
                root=self.dataset_root, szz=entry.get("szz") or DEFAULT_SZZ,
            )
            entry["records"] = result.get("records")
            published = result.get("dataset") or {}
            entry["datasetVersion"] = published.get("version")
            entry["output"] = (result.get("csv") or {}).get("path")
            quality = None
            if published.get("path"):
                try:
                    manifest = load_manifest(BACKEND / published["path"])
                    quality = manifest.get("quality")
                    entry["datasetVersion"] = manifest.get("version")
                except (OSError, ValueError, KeyError):
                    quality = None
            entry["quality"] = quality
            entry["includedRows"] = (quality or {}).get("includedRows")
            entry["positiveLabels"] = (quality or {}).get("positiveLabels")
            entry["stage"] = "completed"
        except BaselineError as exc:
            entry["stage"] = "failed"
            entry["errorCode"] = exc.code
            entry["error"] = str(exc)
        except Exception as exc:  # 未归类异常也要留在批次里，不中断其他仓库
            entry["stage"] = "failed"
            entry["errorCode"] = "UNEXPECTED"
            entry["error"] = f"{type(exc).__name__}: {exc}"
        entry["finishedAt"] = _now()
        self._write(state)

    # ---- 汇总 -----------------------------------------------------------
    @staticmethod
    def summary(state):
        repos = state.get("repos") or []
        counts = {stage: 0 for stage in STAGES}
        for entry in repos:
            counts[entry.get("stage", "pending")] = counts.get(entry.get("stage", "pending"), 0) + 1
        status = "completed" if counts["completed"] == len(repos) and repos else (
            "cancelled" if state.get("cancelledAt") else
            "partial" if counts["completed"] and (counts["failed"] or counts["pending"]) else
            "failed" if counts["failed"] and not counts["completed"] else "running")
        return dict(batchId=state["batchId"], status=status, counts=counts,
                    cancelledAt=state.get("cancelledAt"), repos=repos)
