"""项目分析口径：模型、数据集、冻结成员分区与每条提交所在分区。

只读取已保存的同步记录、数据集投影和模型运行产物，不重新训练、不改写分析结果。

分区来自模型运行保存的冻结成员（见 :mod:`model_lineage`），不是时间边界推断：
- 成员内的提交才是训练/验证/测试；
- 成员外、满足纳入规则但未进入本次训练 → ``notIncluded``；
- 成员外、位于训练截止之后 → ``holdout``（显式时间视图，不是测试集）；
- 不满足数据集纳入规则 → ``excluded``；
- 现成模型 → ``scored``；没有可核对谱系 → ``unknown``。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import model_lineage, project_datasets

TRAINED = "repository-trained"
PARTITIONS = ("train", "validation", "test", "holdout", "excluded", "notIncluded",
              "unassigned", "scored", "unknown")
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


def _split(service, item: dict[str, Any], rows: list[dict[str, Any]],
           lineage: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """切分摘要只来自可核对的模型运行，缺谱系时返回空而不是时间推断。"""
    if lineage.get("status") != model_lineage.VERIFIED:
        return None, None
    model_id = item.get("modelId")
    try:
        directory = Path(service.catalog.model_directory(model_id))
    except Exception:
        return None, None
    summary = _read_json(directory / "summary.json")
    if summary is None:
        return None, None
    cutoff = lineage.get("holdoutCutoffEpoch")
    result = {"preset": item.get("splitPreset") or lineage.get("preset"),
              "holdout": {"count": 0, "positives": 0,
                          "startEpoch": cutoff, "start": _iso(cutoff),
                          "kind": "time-view"}}
    for name in ("train", "validation", "test"):
        value = (lineage.get("partitions") or {}).get(name) or {}
        result[name] = {
            "count": value.get("records"),
            "positives": value.get("positives"),
            "end": value.get("end"),
            "endEpoch": _epoch(value.get("end")),
        }
    return result, _metrics(summary.get("metrics"))


def _frozen_identity(service, item: dict[str, Any], lineage: dict[str, Any],
                     dataset: dict[str, Any] | None) -> dict[str, Any] | None:
    """本次结果绑定的冻结运行身份；只在谱系已核对时返回。"""
    if lineage.get("status") != model_lineage.VERIFIED:
        return None
    model_id = item.get("modelId")
    try:
        directory = Path(service.catalog.model_directory(model_id))
    except Exception:
        return None
    summary = _read_json(directory / "summary.json")
    if summary is None:
        return None
    manifest = _read_json(directory / "manifest.json") or {}
    split = _read_json(directory / "split.json") or {}
    partitions = split.get("partitions") if isinstance(split.get("partitions"), dict) else {}
    try:
        member_sha = model_lineage.membership_digest(partitions)
    except Exception:
        member_sha = None
    dataset_source = (dataset or {}).get("source") or {}
    return {
        "modelId": model_id,
        "artifactRunId": lineage.get("runId") or manifest.get("runId"),
        "modelSha256": summary.get("modelSha256")
        or (manifest.get("config") or {}).get("modelSha256"),
        "datasetVersion": summary.get("datasetVersion") or lineage.get("datasetVersion"),
        "datasetSha256": (summary.get("source") or {}).get("sha256")
        or dataset_source.get("sha256"),
        "memberVerification": lineage.get("memberVerification"),
        "memberSha256": member_sha,
        "splitPreset": lineage.get("preset"),
        "holdoutFrom": lineage.get("holdoutFrom"),
    }


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


def build_scope(service, item: dict[str, Any], *, lineage: dict[str, Any] | None = None,
                labels: dict[str, str] | None = None) -> dict[str, Any]:
    """构造一次分析的可展示口径；任何补充材料缺失都不伪造数字。"""
    sync_id = item["syncId"]
    strategy = item.get("modelStrategy")
    model = _model(service, item)
    rows = _rows(service, sync_id)
    if item.get("sourceKind") == "pr":
        return {
            "strategy": strategy, "model": model, "dataset": None,
            "datasetError": "PR 固定分析没有分支训练切分", "split": None, "metrics": None,
            "frozenIdentity": None,
            "excludedCommitIds": [], "limitations": [],
            "partitionCoverage": model_lineage.unknown_coverage("PR 固定分析没有分支训练切分"),
            "distributions": {"all": _distribution(rows)},
        }
    dataset, dataset_error = (None, "该分析未训练本项目模型")
    if lineage is None:
        lineage = model_lineage.unknown_coverage("该分析没有绑定项目自训模型")
    labels = labels or {}
    if strategy == TRAINED:
        if lineage.get("status") == model_lineage.UNKNOWN and lineage.get("modelId") is None:
            dataset, dataset_error = _dataset(service, item)
            lineage, labels = model_lineage.verified_membership(
                getattr(service, "catalog", None), item.get("modelId"),
                item.get("datasetVersion"))
        else:
            dataset, dataset_error = _dataset(service, item)
    split, metrics = (_split(service, item, rows, lineage) if strategy == TRAINED
                      else (None, None))
    excluded = ([row["commit_id"] for row in rows if not _included(row)]
                if strategy == TRAINED else [])
    scope = {
        "strategy": strategy,
        "model": model,
        "dataset": dataset,
        "datasetError": dataset_error,
        "split": split,
        "metrics": metrics,
        "frozenIdentity": _frozen_identity(service, item, lineage, dataset),
        "excludedCommitIds": excluded,
        "partitionCoverage": lineage,
        "limitations": [value for value in (dataset or {}).get("limitations") or []
                        if isinstance(value, str)],
    }
    groups: dict[str, list[dict[str, Any]]] = {name: [] for name in PARTITIONS}
    for row in rows:
        groups[partition_for(scope, row["commit_id"], row.get("epoch"), labels)].append(row)
    if split is not None:
        # 留出是时间视图；数量来自与分区标签相同的总体（排除已清洗的提交）。
        split["holdout"]["count"] = len(groups["holdout"])
        split["holdout"]["positives"] = sum(1 for row in groups["holdout"]
                                            if row.get("label") == 1)
    scope["distributions"] = {
        "all": _distribution(rows),
        "trainable": _distribution(groups["train"] + groups["validation"] + groups["test"]),
        **{name: _distribution(groups[name]) for name in PARTITIONS},
    }
    return scope


def partition_for(scope: dict[str, Any] | None, commit_id: str, epoch: Any,
                  labels: dict[str, str] | None = None) -> str:
    """按冻结成员判定分区；没有可核对成员时返回未知，不用时间边界补标签。"""
    if not scope:
        return "unassigned"
    if scope.get("strategy") != TRAINED:
        return "scored"
    excluded = set(scope.get("excludedCommitIds") or [])
    coverage = scope.get("partitionCoverage") or {}
    if coverage.get("status") == model_lineage.VERIFIED:
        member = (labels or {}).get(commit_id)
        if member:
            return member
        if commit_id in excluded:
            return "excluded"
        cutoff = coverage.get("holdoutCutoffEpoch")
        if cutoff is not None and isinstance(epoch, (int, float)) and not isinstance(epoch, bool) \
                and epoch >= cutoff:
            return "holdout"
        if not isinstance(epoch, (int, float)) or isinstance(epoch, bool):
            return "unassigned"
        return "notIncluded"
    if commit_id in excluded:
        return "excluded"
    return "unknown"
