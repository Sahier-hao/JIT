"""模型运行谱系：核对冻结的训练成员，并给出提交在其中的分区标签。

分区只来自模型运行自己保存的 `split.json` 成员列表，并逐项核对：

- 模型目录库能加载该模型（目录身份、后继文件哈希由目录库校验）；
- 摘要声明的切分策略与切分文件的 `policy` 完全相同；
- 训练/验证/测试成员的摘要与策略里的 `memberSha256` 一致；
- 模型的数据版本与请求方引用的数据版本一致。

任一项不满足就返回 ``unknown`` 与原因，不用时间边界推断“这条提交参与过训练”。
时间边界只在成员之外用于“训练截止之后的近期留出”这一显式时间视图。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .data import BaselineError
from .splits import PARTITIONS, membership_digest
from .trends import LOCAL

VERIFIED = "verified"
EXTERNAL = "external"
UNKNOWN = "unknown"
COUNT_FIELDS = ("records", "positives", "start", "end")


def coverage(status=UNKNOWN, reason=None, **values):
    """一份分区覆盖说明；缺省即“未知”，调用方不必补任何推断。"""
    entry = dict(status=status, reason=reason, preset=None, timezone=None, boundaries=[],
                 partitions={}, modelId=None, runId=None, datasetVersion=None)
    entry.update(values)
    return entry


def unknown_coverage(reason, **values):
    return coverage(UNKNOWN, reason, **values)


def _boundary(value):
    """切分边界统一为 {epoch, time}；旧运行只记录 epoch。"""
    if isinstance(value, dict) and isinstance(value.get("epoch"), int):
        return {"epoch": value["epoch"], "time": str(value.get("time") or "")}
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return {"epoch": int(value),
                "time": datetime.fromtimestamp(int(value), timezone.utc)
                .isoformat(timespec="seconds").replace("+00:00", "Z")}
    return None


def _holdout_cutoff(summary, policy):
    holdout = summary.get("holdout")
    cutoff = holdout.get("epoch") if isinstance(holdout, dict) else None
    if cutoff is None:
        test_end = ((policy.get("partitionCounts") or {}).get("test") or {}).get("end")
        if isinstance(test_end, str):
            try:
                cutoff = int(datetime.fromisoformat(
                    test_end.replace("Z", "+00:00")).timestamp())
            except ValueError:
                cutoff = None
    return cutoff


def _labels(split, coverage_entry):
    """成员列表 → {提交: 分区}；结构无效或成员重叠时返回 None。"""
    labels = {}
    for name in PARTITIONS:
        ids = split["partitions"].get(name, {}).get("ids") or []
        if not isinstance(ids, list):
            coverage_entry["reason"] = "模型切分成员结构无效，不能推断分区"
            return None
        for commit_id in ids:
            if not isinstance(commit_id, str) or not commit_id:
                coverage_entry["reason"] = "模型切分成员结构无效，不能推断分区"
                return None
            if commit_id in labels:
                coverage_entry["reason"] = "模型切分成员重叠，不能推断分区"
                return None
            labels[commit_id] = name
    return labels


def verified_membership(catalog, model_id, dataset_version):
    """返回 ``(coverage, {提交: 分区})``；只有 ``status == verified`` 时标签可用。"""
    if not model_id:
        return unknown_coverage("该分析没有绑定模型运行，无法核对训练成员"), {}
    if not dataset_version:
        return unknown_coverage("该分析没有绑定数据版本，无法核对训练成员",
                                modelId=model_id), {}
    result = unknown_coverage("模型切分谱系不可用，不能推断分区",
                              modelId=model_id, datasetVersion=dataset_version)
    if catalog is None:
        result["reason"] = "模型目录不可用，不能核对切分成员"
        return result, {}
    try:
        snapshot, _ = catalog.load_model(model_id)
        directory = Path(catalog.model_directory(model_id))
        split = json.loads((directory / "split.json").read_text(encoding="utf-8"))
        policy = snapshot.summary.get("splitPolicy")
        partitions = split.get("partitions")
        if (not isinstance(partitions, dict)
                or snapshot.summary.get("datasetVersion") != dataset_version
                or (policy is not None and not isinstance(policy, dict))
                or (isinstance(policy, dict) and split.get("policy") != policy)):
            result["reason"] = "模型数据版本或切分成员与本项目分析不一致"
            return result, {}
        digest = policy.get("memberSha256") if isinstance(policy, dict) else None
        if digest is not None and membership_digest(partitions) != digest:
            result["reason"] = "模型数据版本或切分成员与本项目分析不一致"
            return result, {}
    except (BaselineError, OSError, ValueError, TypeError, KeyError):
        result["reason"] = "模型切分谱系不可用，不能推断分区"
        return result, {}
    labels = _labels(split, result)
    if labels is None:
        result["labels"] = {}
        return result, {}
    if digest is None:
        # 迁移 030 之前的运行：成员列表没有摘要，但文件本身由清单哈希保护，
        # 且每个分区都记录了成员数，可以据此核对成员与声明的计数一致。
        for name in PARTITIONS:
            entry = partitions.get(name) or {}
            ids = entry.get("ids") or []
            if (not isinstance(entry.get("count"), int)
                    or isinstance(entry.get("count"), bool)
                    or entry["count"] != len(ids)):
                result["reason"] = "旧模型分区计数与成员列表不一致"
                return result, {}
    cutoff = _holdout_cutoff(snapshot.summary, policy or {})
    if isinstance(policy, dict):
        recorded = {
            name: {key: value for key, value in
                   (policy.get("partitionCounts") or {}).get(name, {}).items()
                   if key in COUNT_FIELDS}
            for name in PARTITIONS
        }
        boundaries = policy.get("boundaries") or []
        preset, timezone_name = policy.get("id"), policy.get("timezone")
    else:
        recorded = {
            name: {key: (partitions.get(name) or {}).get(key) for key in COUNT_FIELDS}
            for name in PARTITIONS
        }
        for name in PARTITIONS:
            entry = recorded[name]
            entry["records"] = (partitions.get(name) or {}).get("count")
            entry["positives"] = (partitions.get(name) or {}).get("positiveCount")
            entry.pop("count", None)
            entry.pop("positiveCount", None)
        boundaries = [entry for entry in
                      (_boundary(value) for value in split.get("boundaries") or [])
                      if entry is not None]
        preset, timezone_name = None, None
    result.update(
        status=VERIFIED, reason=None, preset=preset, timezone=timezone_name,
        boundaries=boundaries, runId=snapshot.manifest.get("runId"),
        memberVerification="digest" if digest is not None else "counts",
        partitions=recorded,
        # 时间视图：模型训练截止之后。它不是测试集，也不代表一定未参与训练。
        holdoutCutoffEpoch=cutoff,
        holdoutFrom=(datetime.fromtimestamp(cutoff, LOCAL).isoformat(timespec="seconds")
                     if cutoff is not None else None),
    )
    return result, labels
