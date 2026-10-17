"""时间桶聚合的单元测试：分桶边界、稀疏规则、分区拆分与校验。

对应 change `add-historical-trend-dashboard` 的 tasks 1.1 与 1.3。
"""
from datetime import datetime, timedelta, timezone

import pytest

from jit_baseline import trends
from jit_baseline.data import BaselineError

SHANGHAI = timezone(timedelta(hours=8))


def moment(text):
    return datetime.fromisoformat(text)


def epoch(text):
    return int(moment(text).timestamp())


def record(text, label, name):
    return {"id": name, "epoch": epoch(text), "label": label, "time": text, "metrics": {"la": 1, "ld": 0}}


def split_of(partitions):
    return {name: [record(*item) for item in rows] for name, rows in partitions.items()}


def aggregate(partitions, risks=(), **kwargs):
    return trends.build_trend_buckets(split_of(partitions), list(risks), **kwargs)


def stats_and_quality(split):
    stats = {name: {"count": len(rows), "positiveCount": sum(r["label"] for r in rows)}
             for name, rows in split.items()}
    quality = {"includedRows": sum(s["count"] for s in stats.values()),
               "positiveLabels": sum(s["positiveCount"] for s in stats.values())}
    return stats, quality


def test_month_boundary_uses_fixed_offset():
    """桶边界按固定 UTC+08:00 的自然月：同一瞬间在本地时区归属唯一。"""
    built = aggregate({"train": [
        ("2011-11-30T23:59:59+08:00", 0, "a"),
        ("2011-12-01T00:00:00+08:00", 1, "b")]})
    first, second = built["buckets"]
    assert first["start"] == "2011-11-01T00:00:00+08:00" and first["commits"] == 1
    assert second["start"] == "2011-12-01T00:00:00+08:00" and second["commits"] == 1


def test_same_second_records_share_one_bucket():
    built = aggregate({"train": [
        ("2012-03-05T10:00:00+08:00", 1, "a"),
        ("2012-03-05T10:00:00+08:00", 0, "b")]})
    assert len(built["buckets"]) == 1
    assert built["buckets"][0]["commits"] == 2 and built["buckets"][0]["positives"] == 1


def test_buckets_are_continuous_including_empty_months():
    built = aggregate({"train": [
        ("2012-01-15T00:00:00+08:00", 0, "a"),
        ("2012-04-15T00:00:00+08:00", 0, "b")]})
    starts = [b["start"] for b in built["buckets"]]
    assert starts == ["2012-01-01T00:00:00+08:00", "2012-02-01T00:00:00+08:00",
                      "2012-03-01T00:00:00+08:00", "2012-04-01T00:00:00+08:00"]
    assert [b["commits"] for b in built["buckets"]] == [1, 0, 0, 1]


def test_sparse_bucket_reports_null_rate_with_reason():
    built = aggregate({"train": [("2012-01-15T00:00:00+08:00", 0, "a")]}, min_sample=20)
    rate = built["buckets"][0]["observedRate"]
    assert rate["value"] is None and "少于最小样本 20" in rate["reason"]


def test_dense_bucket_reports_rate():
    rows = [(f"2012-01-{day:02d}T00:00:00+08:00", 1 if day <= 5 else 0, f"c{day}") for day in range(1, 21)]
    built = aggregate({"train": rows}, min_sample=20)
    assert built["buckets"][0]["observedRate"] == {"value": 0.25, "reason": None}


def test_risk_only_covers_test_partition():
    built = aggregate({"train": [("2012-01-10T00:00:00+08:00", 0, "a")],
                       "test": [(f"2012-02-{day:02d}T00:00:00+08:00", 0, f"t{day}") for day in range(1, 21)]},
                      risks=[0.1] * 20)
    january, february = built["buckets"]
    assert january["risk"] is None and january["byPartition"]["test"]["commits"] == 0
    assert february["risk"]["count"] == 20 and february["risk"]["median"] == 0.1


def test_sparse_test_partition_reports_null_risk_with_reason():
    built = aggregate({"test": [("2012-02-01T00:00:00+08:00", 1, "t1")]}, risks=[0.4], min_sample=20)
    risk = built["buckets"][0]["risk"]
    assert risk == {"count": 1, "median": None, "p90": None,
                    "reason": "桶内测试提交数 1 少于最小样本 20，风险分布不足以比较"}


def test_aggregate_carries_no_record_identity_or_label():
    built = aggregate({"test": [("2012-02-01T00:00:00+08:00", 1, "deadbeef")]}, risks=[0.4], min_sample=1)
    text = str(built)
    assert "deadbeef" not in text and "'label'" not in text and "features" not in text


def test_build_rejects_inconsistent_inputs():
    with pytest.raises(BaselineError) as info:
        aggregate({"test": [("2012-02-01T00:00:00+08:00", 1, "t1")]}, risks=[])
    assert info.value.code == "TREND_INVALID"
    with pytest.raises(BaselineError) as info:
        aggregate({"test": [("2012-02-01T00:00:00+08:00", 1, "t1")]}, risks=[1.4])
    assert info.value.code == "TREND_INVALID"
    with pytest.raises(BaselineError):
        aggregate({"test": [("2012-02-01T00:00:00+08:00", 1, "t1")]}, risks=[0.4], min_sample=0)


def sample_split():
    return split_of({
        "train": [("2012-01-10T00:00:00+08:00", 1, "a"), ("2012-02-10T00:00:00+08:00", 0, "b")],
        "validation": [("2012-03-10T00:00:00+08:00", 1, "c")],
        "test": [("2012-04-10T00:00:00+08:00", 1, "d"), ("2012-04-11T00:00:00+08:00", 0, "e")],
    })


def test_structure_check_accepts_valid_aggregate_and_rejects_tampering():
    split = sample_split()
    built = trends.build_trend_buckets(split, [0.5, 0.6], min_sample=1)
    trends.validate_structure(built)

    def tamper(mutate):
        import copy
        broken = copy.deepcopy(built)
        mutate(broken)
        with pytest.raises(BaselineError) as info:
            trends.validate_structure(broken)
        assert info.value.code == "ARTIFACT_INVALID"

    tamper(lambda a: a["buckets"][0].__setitem__("positives", 99))
    tamper(lambda a: a["buckets"][0]["byPartition"]["train"].__setitem__("commits", 0))
    tamper(lambda a: a["buckets"][0]["observedRate"].update({"value": 0.5, "reason": "还有原因"}))
    tamper(lambda a: a["buckets"].pop(1))
    tamper(lambda a: a.__setitem__("grain", "week"))
    tamper(lambda a: a["buckets"][-1].__setitem__("risk", {"count": 0, "median": None, "p90": None, "reason": "x"}))


def test_structure_check_enforces_sparse_bucket_linkage():
    """样本不足与空值的联动：稀疏桶不许给出比例，含测试记录的桶必须有风险分布（D4）。"""
    tight = trends.build_trend_buckets(split_of({"train": [
        ("2012-01-10T00:00:00+08:00", 1, "a"), ("2012-01-11T00:00:00+08:00", 0, "b")]}), [], min_sample=20)
    trends.validate_structure(tight)
    assert tight["buckets"][0]["observedRate"]["value"] is None

    import copy
    forged = copy.deepcopy(tight)
    forged["buckets"][0]["observedRate"] = {"value": 0.5, "reason": None}
    with pytest.raises(BaselineError) as info:
        trends.validate_structure(forged)
    assert info.value.code == "ARTIFACT_INVALID" and "观测比例必须为空值" in str(info.value)

    with_test = trends.build_trend_buckets(split_of({"test": [
        (f"2012-02-{day:02d}T00:00:00+08:00", 0, f"t{day}") for day in range(1, 21)]}), [0.2] * 20, min_sample=20)
    missing_risk = copy.deepcopy(with_test)
    missing_risk["buckets"][0]["risk"] = None
    with pytest.raises(BaselineError) as info:
        trends.validate_structure(missing_risk)
    assert "却没有风险分布" in str(info.value)

    sparse_risk = copy.deepcopy(with_test)
    sparse_risk["minSample"] = 21
    sparse_risk["buckets"][0]["observedRate"] = {"value": None, "reason": "样本不足"}
    with pytest.raises(BaselineError) as info:
        trends.validate_structure(sparse_risk)
    assert "风险分布必须为空值" in str(info.value)


def test_aggregate_check_recomputes_test_buckets_and_conservation():
    split = sample_split()
    risks = [0.5, 0.6]
    built = trends.build_trend_buckets(split, risks, min_sample=1)
    stats, quality = stats_and_quality(split)
    assert trends.check_aggregate(built, split["test"], risks, stats, quality) is True

    # 篡改测试分区的桶：重算不通过。
    import copy
    broken = copy.deepcopy(built)
    broken["buckets"][-1]["byPartition"]["test"]["positives"] = 0
    broken["buckets"][-1]["positives"] -= 1
    with pytest.raises(BaselineError) as info:
        trends.check_aggregate(broken, split["test"], risks, stats, quality)
    assert info.value.code == "ARTIFACT_INVALID"

    # 守恒不符：总数被改。
    broken = copy.deepcopy(built)
    broken["buckets"][0]["commits"] += 1
    broken["buckets"][0]["byPartition"]["train"]["commits"] += 1
    with pytest.raises(BaselineError) as info:
        trends.check_aggregate(broken, split["test"], risks, stats, quality)
    assert "合计" in str(info.value)

    # 分区统计不符：把训练分区的一个样本挪到验证分区的桶里。
    broken = copy.deepcopy(built)
    source = broken["buckets"][0]["byPartition"]["train"]
    target = broken["buckets"][0]["byPartition"]["validation"]
    target["commits"] += 1
    source["commits"] -= 1
    with pytest.raises(BaselineError) as info:
        trends.check_aggregate(broken, split["test"], risks, stats, quality)
    assert "分区" in str(info.value)
