"""review-benefit-v3：整提交预算、排序并列、异常成本与配对区间。"""
import math

import pytest

from jit_baseline import budget
from jit_baseline.data import BaselineError


def record(identity, *, risk=0.5, label=0, cost=10, epoch=1_700_000_000):
    return {"id": identity, "epoch": epoch, "label": label, "risk": risk,
            "metrics": {"la": cost, "ld": 0}}


def test_whole_commit_budget_skips_overflow_and_prefix_stop_stops():
    records = budget.prepare([
        record("a", risk=0.9, cost=100, label=1),
        record("b", risk=0.8, cost=5, label=1),
        record("c", risk=0.7, cost=30, label=0),
    ])
    total = sum(item["cost"] for item in records)
    order = budget.model_order(records)
    skipped, coverage = budget.select(records, order, budget_fraction=0.2,
                                      skip_overflow=True)
    stopped, stopped_coverage = budget.select(records, order, budget_fraction=0.2,
                                              skip_overflow=False)
    assert total == 135
    assert skipped["value"] == 0.5 and coverage["selected"] == ["b"]
    assert coverage["usedLoc"] == 5 and coverage["budgetLoc"] == 27
    assert stopped["value"] == 0 and stopped_coverage["selected"] == []
    assert stopped_coverage["reason"] is None


def test_ordering_ties_are_stable_and_random_ignores_input_order():
    records = budget.prepare([
        record("b", risk=0.5, epoch=10),
        record("a", risk=0.5, epoch=10),
        record("c", risk=0.5, epoch=20),
    ])
    assert [records[index]["id"] for index in budget.model_order(records)] == ["c", "a", "b"]
    assert [records[index]["id"] for index in budget.time_order(records)] == ["c", "a", "b"]
    shuffled = budget.prepare([
        record("c", risk=0.5, epoch=20),
        record("a", risk=0.5, epoch=10),
        record("b", risk=0.5, epoch=10),
    ])
    assert ([shuffled[index]["id"] for index in budget.random_order(shuffled, 7, 3)]
            == [records[index]["id"] for index in budget.random_order(records, 7, 3)])


def test_zero_cost_makes_cost_metrics_undefined_without_inventing_values():
    records = budget.prepare([
        record("a", risk=0.9, label=1, cost=0),
        record("b", risk=0.1, label=0, cost=5),
    ])
    density, reason = budget.density_order(records)
    assert density is None and "零成本" in reason
    result = budget.evaluate(records, random_runs=2)
    assert result["strategies"]["density"]["recall20Loc"]["reason"]
    assert result["strategies"]["model"]["popt"]["value"] is None
    assert result["strategies"]["model"]["ifa"]["value"] == 0
    assert result["strategies"]["model"]["recall20Loc"]["value"] == 1


def test_negative_and_non_finite_costs_are_rejected():
    with pytest.raises(BaselineError) as negative:
        budget.prepare([record("a", cost=-1)])
    assert negative.value.code == "EVALUATION_INVALID"
    broken = record("a")
    broken["metrics"] = {"la": math.inf, "ld": 0}
    with pytest.raises(BaselineError):
        budget.prepare([broken])


def test_bootstrap_requires_enough_blocks_and_positives():
    few_blocks = budget.prepare([record(f"{i:040x}", epoch=1_700_000_000 + i * 86_400,
                                        label=1, cost=5) for i in range(4)])
    interval = budget.bootstrap_delta(few_blocks, list(range(4)), list(range(4)))
    assert interval["validRuns"] == 0 and "时间块不足" in interval["reason"]
    few_positives = budget.prepare([record(f"{i:040x}", epoch=1_700_000_000 + i * 7 * 86_400,
                                           label=1 if i == 0 else 0, cost=5)
                                    for i in range(10)])
    interval = budget.bootstrap_delta(few_positives, list(range(10)), list(range(10)))
    assert interval["validRuns"] == 0 and "正例" in interval["reason"]


def test_bootstrap_is_deterministic_and_keeps_paired_blocks():
    records = []
    for index in range(80):
        records.append(record(f"{index:040x}", risk=0.9 - index / 100,
                              label=1 if index % 7 == 0 else 0,
                              cost=3 + index % 5,
                              epoch=1_700_000_000 + index * 86_400))
    prepared = budget.prepare(records)
    first = budget.bootstrap_delta(prepared, budget.model_order(prepared),
                                   budget.time_order(prepared), seed=11, runs=40)
    second = budget.bootstrap_delta(prepared, budget.model_order(prepared),
                                    budget.time_order(prepared), seed=11, runs=40)
    assert first == second
    assert first["validRuns"] == 40 and first["low"] <= first["high"]


def test_report_and_matrix_share_the_same_protocol_hash():
    from jit_baseline import benefit, evaluation_matrix
    assert benefit.PROTOCOL == budget.PROTOCOL
    assert evaluation_matrix.review_budget.protocol_sha256() == budget.protocol_sha256()
