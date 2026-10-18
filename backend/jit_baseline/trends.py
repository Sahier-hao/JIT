"""固定粒度的观测趋势聚合：离线产生，产物里只有聚合值、没有逐条标签。

对应 change `add-historical-trend-dashboard` 的 design D1/D3/D4/D10 与规格 PDB-21、
DTD-03／DTD-04：

- 分桶在 `run` 阶段完成，服务因此仍不必读取 `test-labels.json`；
- 桶内按运行分区分别记录样本数与观测正标签数，风险分布只覆盖桶内的测试记录；
- 桶内样本数低于声明阈值时，比例与风险分布都以空值加原因呈现，不写成 0；
- 结构校验与聚合核对由 `verify` 调用；`Snapshot.load` **不**校验该键，
  以便坏聚合只让趋势视图不可用，而不把整个批次判为不可用。
"""
import math
import statistics
from datetime import datetime, timedelta, timezone

from .errors import BaselineError

TREND_KEY = "trendBuckets"
GRAIN = "month"
TIMEZONE = "UTC+08:00"
DEFAULT_MIN_SAMPLE = 20
PARTITIONS = ("train", "validation", "test")
LOCAL = timezone(timedelta(hours=8))


def _month_start(epoch):
    local = datetime.fromtimestamp(epoch, LOCAL)
    return datetime(local.year, local.month, 1, tzinfo=LOCAL)


def _next_month(start):
    year, month = (start.year + 1, 1) if start.month == 12 else (start.year, start.month + 1)
    return datetime(year, month, 1, tzinfo=start.tzinfo)


def _stamp(moment):
    return moment.isoformat(timespec="seconds")


def _rate(positives, commits, min_sample):
    if commits < min_sample:
        return {"value": None,
                "reason": f"桶内提交数 {commits} 少于最小样本 {min_sample}，观测比例不足以比较"}
    return {"value": positives / commits, "reason": None}


def _risk(values, min_sample):
    """风险分布：无测试记录为 null；样本不足时中位数与分位数为 null 并附原因。"""
    count = len(values)
    if count == 0:
        return None
    if count < min_sample:
        return {"count": count, "median": None, "p90": None,
                "reason": f"桶内测试提交数 {count} 少于最小样本 {min_sample}，风险分布不足以比较"}
    ordered = sorted(values)
    # 最近秩分位：定义确定、跨机器一致，不做插值。
    p90 = ordered[max(0, math.ceil(0.9 * count) - 1)]
    return {"count": count, "median": statistics.median(ordered), "p90": p90, "reason": None}


def build_trend_buckets(split, test_risks, *, min_sample=DEFAULT_MIN_SAMPLE):
    """按固定 UTC+08:00 月边界聚合全部分区。

    `split` 是 `temporal_split` 的结果，`test_risks` 与 `split["test"]` 逐条对齐。
    只返回计数与风险分布：不含提交身份、标签或特征。
    """
    if not isinstance(min_sample, int) or isinstance(min_sample, bool) or min_sample < 1:
        raise BaselineError("TREND_INVALID", "最小样本数必须为正整数")
    test_records = list(split.get("test") or [])
    risks = list(test_risks)
    if len(risks) != len(test_records):
        raise BaselineError("TREND_INVALID", "测试风险数量与测试分区不一致")
    if not any(split.get(partition) for partition in PARTITIONS):
        raise BaselineError("TREND_INVALID", "缺少可聚合的分区")
    by_id = {}
    for record, risk in zip(test_records, risks, strict=True):
        if isinstance(risk, bool) or not isinstance(risk, (int, float)) or not math.isfinite(risk) or not 0 <= risk <= 1:
            raise BaselineError("TREND_INVALID", "风险必须为有限概率")
        by_id[record["id"]] = float(risk)

    collected = {}
    for partition in PARTITIONS:
        for record in split.get(partition) or []:
            label = record.get("label")
            if label not in (0, 1):
                raise BaselineError("TREND_INVALID", "标签必须为 0 或 1")
            start = _month_start(record["epoch"])
            entry = collected.setdefault(start, {
                "commits": 0, "positives": 0,
                "byPartition": {name: {"commits": 0, "positives": 0} for name in PARTITIONS},
                "risks": []})
            entry["commits"] += 1
            entry["positives"] += label
            entry["byPartition"][partition]["commits"] += 1
            entry["byPartition"][partition]["positives"] += label
            if partition == "test":
                entry["risks"].append(by_id[record["id"]])
    if not collected:
        raise BaselineError("TREND_INVALID", "没有可聚合的记录")

    # 首尾之间逐月连续：空月也保留为 0 样本桶，趋势图上不出现无解释的缺口。
    buckets, start, last = [], min(collected), max(collected)
    while start <= last:
        entry = collected.get(start) or {
            "commits": 0, "positives": 0,
            "byPartition": {name: {"commits": 0, "positives": 0} for name in PARTITIONS},
            "risks": []}
        buckets.append({
            "start": _stamp(start), "end": _stamp(_next_month(start)),
            "commits": entry["commits"], "positives": entry["positives"],
            "observedRate": _rate(entry["positives"], entry["commits"], min_sample),
            "byPartition": entry["byPartition"],
            "risk": _risk(entry["risks"], min_sample)})
        start = _next_month(start)
    return {"grain": GRAIN, "timezone": TIMEZONE, "minSample": min_sample, "buckets": buckets}


def _invalid(message):
    raise BaselineError("ARTIFACT_INVALID", f"时间桶聚合无效：{message}")


def _count(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _stamp_of(value, index):
    try:
        moment = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        _invalid(f"第 {index} 个桶的时间无法解析")
    if moment.tzinfo is None or moment.utcoffset() is None:
        _invalid(f"第 {index} 个桶的时间缺少时区")
    return moment


def _check_score(value, where):
    if not isinstance(value, dict) or set(value) != {"value", "reason"}:
        _invalid(f"{where}结构不符")
    if value["value"] is None:
        if not isinstance(value["reason"], str) or not value["reason"].strip():
            _invalid(f"{where}为空值但缺少原因")
        return
    if not _number(value["value"]) or value["reason"] is not None:
        _invalid(f"{where}的取值与原因不一致")


def validate_structure(recorded):
    """校验声明提供的时间桶聚合的结构；不合法时以 ARTIFACT_INVALID 失败。"""
    if not isinstance(recorded, dict) or set(recorded) != {"grain", "timezone", "minSample", "buckets"}:
        _invalid("字段集合不符")
    if recorded["grain"] != GRAIN or recorded["timezone"] != TIMEZONE:
        _invalid("粒度或时区与约定不符")
    min_sample = recorded["minSample"]
    if not _count(min_sample) or min_sample < 1:
        _invalid("最小样本数无效")
    buckets = recorded["buckets"]
    if not isinstance(buckets, list) or not buckets:
        _invalid("桶集合为空或格式无效")
    previous_end = None
    for index, bucket in enumerate(buckets):
        if not isinstance(bucket, dict) or set(bucket) != {
                "start", "end", "commits", "positives", "observedRate", "byPartition", "risk"}:
            _invalid(f"第 {index} 个桶的字段集合不符")
        start, end = _stamp_of(bucket["start"], index), _stamp_of(bucket["end"], index)
        if start >= end:
            _invalid(f"第 {index} 个桶的起止时间无效")
        if previous_end is not None and start != previous_end:
            _invalid(f"第 {index} 个桶与前一桶不连续或重叠")
        previous_end = end
        if not _count(bucket["commits"]) or not _count(bucket["positives"]):
            _invalid(f"第 {index} 个桶的计数不是非负整数")
        if bucket["positives"] > bucket["commits"]:
            _invalid(f"第 {index} 个桶的正例数超过样本数")
        parts = bucket["byPartition"]
        if not isinstance(parts, dict) or set(parts) != set(PARTITIONS):
            _invalid(f"第 {index} 个桶缺少分区拆分")
        totals = {"commits": 0, "positives": 0}
        for name in PARTITIONS:
            part = parts[name]
            if not isinstance(part, dict) or set(part) != {"commits", "positives"}:
                _invalid(f"第 {index} 个桶的 {name} 分区字段不符")
            if not _count(part["commits"]) or not _count(part["positives"]) or part["positives"] > part["commits"]:
                _invalid(f"第 {index} 个桶的 {name} 分区计数无效")
            totals["commits"] += part["commits"]
            totals["positives"] += part["positives"]
        if totals["commits"] != bucket["commits"] or totals["positives"] != bucket["positives"]:
            _invalid(f"第 {index} 个桶的分区拆分与总数不符")
        rate = bucket["observedRate"]
        _check_score(rate, f"第 {index} 个桶的观测比例")
        # 样本不足与空值的联动由产出与校验端保证（design D4）：稀疏桶不许给出比例。
        if bucket["commits"] < min_sample and rate["value"] is not None:
            _invalid(f"第 {index} 个桶的样本数少于最小样本，观测比例必须为空值")
        risk = bucket["risk"]
        if risk is None:
            if parts["test"]["commits"] > 0:
                _invalid(f"第 {index} 个桶含测试记录却没有风险分布")
        else:
            if not isinstance(risk, dict) or set(risk) != {"count", "median", "p90", "reason"}:
                _invalid(f"第 {index} 个桶的风险分布字段不符")
            if not _count(risk["count"]) or risk["count"] > parts["test"]["commits"]:
                _invalid(f"第 {index} 个桶的风险样本数与测试分区不符")
            if risk["count"] == 0:
                _invalid(f"第 {index} 个桶没有测试记录却给出风险分布")
            for name in ("median", "p90"):
                if risk[name] is not None and not _number(risk[name]):
                    _invalid(f"第 {index} 个桶的风险 {name} 无效")
            if (risk["median"] is None) != (risk["p90"] is None):
                _invalid(f"第 {index} 个桶的风险分位数缺项")
            if risk["median"] is None and not (isinstance(risk["reason"], str) and risk["reason"].strip()):
                _invalid(f"第 {index} 个桶的风险为空值但缺少原因")
            if risk["median"] is not None and risk["reason"] is not None:
                _invalid(f"第 {index} 个桶的风险取值与原因不一致")
            if risk["count"] < min_sample and risk["median"] is not None:
                _invalid(f"第 {index} 个桶的测试样本数少于最小样本，风险分布必须为空值")
    return recorded


def _rebuild_test_buckets(records, risks, min_sample):
    """用测试分区的逐条标签与风险重建每桶的测试部分。"""
    collected = {}
    for record, risk in zip(records, risks, strict=True):
        start = _month_start(record["epoch"])
        entry = collected.setdefault(start, {"commits": 0, "positives": 0, "risks": []})
        entry["commits"] += 1
        entry["positives"] += record["label"]
        entry["risks"].append(float(risk))
    return {start: (entry["commits"], entry["positives"], _risk(entry["risks"], min_sample))
            for start, entry in collected.items()}


def check_aggregate(recorded, records, risks, partition_stats, quality, expected=None):
    """按声明重算测试分区的桶，并核对全量与分区的守恒关系。

    `records` 为测试分区记录（含 `label`），`risks` 与之一一对应；训练与验证分区
    的逐条标签不进入产物，因此只能做守恒核对，这一点在规格与设计里如实记录。
    `expected` 为各桶应覆盖的（提交数, 正例数）；使用 holdout 时聚合只覆盖可训练
    前缀，调用方传入切分后的合计，缺省仍按全量质量统计核对。
    """
    validate_structure(recorded)
    min_sample = recorded["minSample"]
    rebuilt = _rebuild_test_buckets(records, risks, min_sample)
    totals = {"commits": 0, "positives": 0}
    by_partition = {name: {"commits": 0, "positives": 0} for name in PARTITIONS}
    for index, bucket in enumerate(recorded["buckets"]):
        start = datetime.fromisoformat(bucket["start"])
        want = rebuilt.get(start, (0, 0, None))
        part = bucket["byPartition"]["test"]
        if (part["commits"], part["positives"]) != (want[0], want[1]):
            _invalid(f"第 {index} 个桶的测试分区计数与重算结果不一致")
        if bucket["risk"] != want[2]:
            _invalid(f"第 {index} 个桶的风险分布与重算结果不一致")
        totals["commits"] += bucket["commits"]
        totals["positives"] += bucket["positives"]
        for name in PARTITIONS:
            by_partition[name]["commits"] += bucket["byPartition"][name]["commits"]
            by_partition[name]["positives"] += bucket["byPartition"][name]["positives"]
    if expected is None:
        expected = (quality["includedRows"], quality["positiveLabels"])
    if totals["commits"] != expected[0] or totals["positives"] != expected[1]:
        _invalid("各桶合计与纳入行数或观测正例数不一致")
    for name in PARTITIONS:
        stat = partition_stats.get(name) or {}
        if (by_partition[name]["commits"] != stat.get("count")
                or by_partition[name]["positives"] != stat.get("positiveCount")):
            _invalid(f"按 {name} 分区归并后与分区统计不一致")
    return True
