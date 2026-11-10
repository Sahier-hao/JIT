"""项目分析口径：模型、数据集、时间切分与每条提交所在的评估分区。

只读取已保存的同步记录、数据集投影和训练产物，不重新训练、不改写分析结果。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import project_datasets

TRAINED = "repository-trained"
PARTITIONS = ("train", "validation", "test", "holdout")
HIGH = 0.25
MEDIUM = 0.10
REQUIRED_FEATURES = ("ns", "nd", "nf", "entropy", "la", "ld", "lt", "fix",
                     "ndev", "age", "nuc", "exp", "rexp", "sexp")


def _read_json(path: Path | None) -> dict[str, Any] | None:
    if path is None:
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeError):
        return None
    return value if isinstance(value, dict) else None


def _epoch(value: Any) -> int | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value)
    if isinstance(value, str):
        try:
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
        except ValueError:
            return None
    return None


def _iso(epoch: int | None) -> str | None:
    if epoch is None:
        return None
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


def _metric(value: Any) -> float | None:
    if isinstance(value, dict):
        value = value.get("value")
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _distribution(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"high": 0, "medium": 0, "low": 0, "unknown": 0}
    for row in rows:
        risk = row.get("risk")
        if not isinstance(risk, (int, float)) or isinstance(risk, bool):
            counts["unknown"] += 1
        elif risk >= HIGH:
            counts["high"] += 1
        elif risk >= MEDIUM:
            counts["medium"] += 1
        else:
            counts["low"] += 1
    return counts


def _rows(service, sync_id: str) -> list[dict[str, Any]]:
    with service.sync.storage.connection() as db:
        return [dict(row) for row in db.execute(
            "SELECT commit_id,epoch,risk,label,added_lines,deleted_lines,files,features_json "
            "FROM repository_commit WHERE sync_id=?", (sync_id,))]


def _dataset(service, item: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    version = item.get("datasetVersion")
    repository_id = item.get("repositoryId")
    if not version or not repository_id:
        return None, "该分析没有绑定数据集"
    try:
        resolved = project_datasets.resolve_project_dataset(
            repository_id, item["syncId"], service, service.dataset_root)
        return project_datasets.public_view(resolved), None
    except Exception as exc:  # 数据集是补充信息，缺失时仍展示模型与分区
        return None, getattr(exc, "code", "DATASET_UNAVAILABLE")


def _included(row: dict[str, Any]) -> bool:
    """与数据集构建相同的纳入规则：有新增行、变更与文件数不超限、14 维特征齐全。"""
    added = row.get("added_lines")
    deleted = row.get("deleted_lines")
    files = row.get("files")
    if not isinstance(added, (int, float)) or added <= 0:
        return False
    if not isinstance(deleted, (int, float)) or added + deleted > 10000:
        return False
    if not isinstance(files, (int, float)) or files > 100:
        return False
    try:
        features = json.loads(row.get("features_json") or "{}")
    except (TypeError, ValueError):
        return False
    return all(isinstance(features.get(name), (int, float)) for name in REQUIRED_FEATURES)


def _model(service, item: dict[str, Any]) -> dict[str, Any]:
    model_id = item.get("modelId")
    name = None
    limitations: list[str] = []
    if model_id:
        try:
            description = service.catalog.describe(model_id)
            name = description.get("name")
            limitations = [value for value in description.get("limitations") or []
                           if isinstance(value, str)]
        except Exception:
            pass
    return {
        "id": model_id,
        "name": name,
        "strategy": item.get("modelStrategy"),
        "algorithm": item.get("algorithm"),
        "algorithmName": item.get("algorithmName"),
        "featureSchemaVersion": item.get("featureSchemaVersion"),
        "limitations": limitations,
    }


def _split(service, sync_id: str, rows: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, dict[str, Any] | None, int | None]:
    artifact = service.artifact_root / f"repository-sync-{sync_id[:8]}"
    split = _read_json(artifact / "split.json")
    summary = _read_json(artifact / "summary.json")
    metrics = _read_json(artifact / "metrics.json")
    holdout_epoch = (summary or {}).get("holdout", {}).get("epoch")
    holdout_epoch = _epoch(holdout_epoch)
    if split is None:
        return None, metrics, holdout_epoch
    parts = split.get("partitions") if isinstance(split.get("partitions"), dict) else {}
    result = {"preset": None, "holdout": {"count": 0, "positives": 0,
                                          "startEpoch": holdout_epoch, "start": _iso(holdout_epoch)}}
    for name in ("train", "validation", "test"):
        value = parts.get(name) or {}
        result[name] = {
            "count": value.get("count"),
            "end": value.get("end"),
            "endEpoch": _epoch(value.get("end")),
        }
    if holdout_epoch is not None:
        hold = [row for row in rows if isinstance(row.get("epoch"), (int, float)) and row["epoch"] >= holdout_epoch]
        result["holdout"]["count"] = len(hold)
        result["holdout"]["positives"] = sum(1 for row in hold if row.get("label") == 1)
    return result, metrics, holdout_epoch


def _metrics(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    counts = value.get("counts") if isinstance(value.get("counts"), dict) else {}
    return {
        "records": counts.get("records"),
        "positives": counts.get("positive"),
        "rocAuc": _metric(value.get("rocAuc")),
        "averagePrecision": _metric(value.get("averagePrecision")),
        "precision": _metric(value.get("precision")),
        "recall": _metric(value.get("recall")),
        "f1": _metric(value.get("f1")),
        "referenceAp": (value.get("reference") or {}).get("apNoInformation"),
        "confusion": value.get("confusion"),
    }


def build_scope(service, item: dict[str, Any]) -> dict[str, Any]:
    """构造一次分析的可展示口径；任何补充材料缺失都不伪造数字。"""
    sync_id = item["syncId"]
    strategy = item.get("modelStrategy")
    model = _model(service, item)
    rows = _rows(service, sync_id)
    if item.get("sourceKind") == "pr":
        return {
            "strategy": strategy, "model": model, "dataset": None,
            "datasetError": "PR 固定分析没有分支训练切分", "split": None, "metrics": None,
            "excludedCommitIds": [], "limitations": [],
            "distributions": {"all": _distribution(rows)},
        }
    dataset, dataset_error = (None, "该分析未训练本项目模型")
    if strategy == TRAINED:
        dataset, dataset_error = _dataset(service, item)
    split, raw_metrics, holdout_epoch = (_split(service, sync_id, rows)
                                         if strategy == TRAINED else (None, None, None))
    if split is not None:
        split["preset"] = item.get("splitPreset")
    excluded = ([row["commit_id"] for row in rows if not _included(row)]
                if strategy == TRAINED else [])
    scope = {
        "strategy": strategy,
        "model": model,
        "dataset": dataset,
        "datasetError": dataset_error,
        "split": split,
        "metrics": _metrics(raw_metrics),
        "excludedCommitIds": excluded,
        "limitations": [value for value in (dataset or {}).get("limitations") or []
                        if isinstance(value, str)],
    }
    groups: dict[str, list[dict[str, Any]]] = {name: [] for name in (*PARTITIONS, "excluded", "unassigned", "scored")}
    for row in rows:
        groups[partition_for(scope, row["commit_id"], row.get("epoch"))].append(row)
    scope["distributions"] = {
        "all": _distribution(rows),
        "trainable": _distribution(groups["train"] + groups["validation"] + groups["test"]),
        **{name: _distribution(groups[name]) for name in (*PARTITIONS, "excluded")},
    }
    return scope


def partition_for(scope: dict[str, Any] | None, commit_id: str, epoch: Any) -> str:
    """按时间边界与数据集纳入范围判定提交所属分区。"""
    if not scope:
        return "unassigned"
    if scope.get("strategy") != TRAINED:
        return "scored"
    if commit_id in set(scope.get("excludedCommitIds") or []):
        return "excluded"
    split = scope.get("split") or {}
    holdout = split.get("holdout") or {}
    value = epoch if isinstance(epoch, (int, float)) and not isinstance(epoch, bool) else None
    if value is None:
        return "unassigned"
    if holdout.get("startEpoch") is not None and value >= holdout["startEpoch"]:
        return "holdout"
    test = split.get("test") or {}
    if test.get("endEpoch") is not None and value > test["endEpoch"]:
        return "unassigned"
    if test.get("endEpoch") is not None and value <= test["endEpoch"]:
        validation = split.get("validation") or {}
        if validation.get("endEpoch") is not None and value <= validation["endEpoch"]:
            train = split.get("train") or {}
            if train.get("endEpoch") is not None and value <= train["endEpoch"]:
                return "train"
            return "validation"
        return "test"
    return "unassigned"
