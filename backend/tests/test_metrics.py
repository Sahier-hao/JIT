"""Independent hand-computable evaluation oracles."""
import pytest


def examples(costs=(1, 1, 4, 4), labels=(1, 0, 1, 0)):
    return [{"id": f"{i:040x}", "epoch": i, "label": label,
             "metrics": {"la": cost, "ld": 0}}
            for i, (cost, label) in enumerate(zip(costs, labels, strict=True))]


def test_hand_computed_auc_ap_classification_and_effort():
    from jit_baseline.metrics import evaluate
    result = evaluate(examples(), [.9, .8, .2, .1])
    assert result["rocAuc"]["value"] == pytest.approx(.75)
    assert result["averagePrecision"]["value"] == pytest.approx(5 / 6)
    for key in ["precision", "recall", "f1", "recall20Loc"]:
        assert result[key]["value"] == pytest.approx(.5)
    assert result["confusion"] == {"tp": 1, "fp": 1, "tn": 1, "fn": 1}
    assert result["effort"]["usedLoc"] == 2
    assert result["effort"]["selectedCount"] == 2
    assert result["reference"]["apNoInformation"] == .5


def test_whole_commit_budget_stops_at_first_commit_that_exceeds_budget():
    from jit_baseline.metrics import evaluate
    result = evaluate(examples(costs=(9, 1, 0, 0)), [.9, .8, .2, .1])
    assert result["effort"]["usedLoc"] == 0
    assert result["effort"]["selectedCount"] == 0
    assert result["recall20Loc"]["value"] == 0


def test_effort_ties_follow_time_then_identity_without_label_ordering():
    from jit_baseline.metrics import evaluate
    records = examples()
    result = evaluate(records, [.5] * 4)
    # Latest commit costs 4 and cannot fit budget 2: never skip it for positive labels.
    assert result["effort"]["selectedCount"] == 0


def test_no_predicted_positive_precision_is_null_but_f1_is_zero():
    from jit_baseline.metrics import evaluate
    result = evaluate(examples(), [.1] * 4)
    assert result["precision"]["value"] is None and result["precision"]["reason"]
    assert result["recall"]["value"] == 0
    assert result["f1"]["value"] == 0


@pytest.mark.parametrize("labels", [(0, 0, 0, 0), (1, 1, 1, 1)])
def test_single_class_auc_and_ap_are_not_reported_as_valid(labels):
    from jit_baseline.metrics import evaluate
    result = evaluate(examples(labels=labels), [.1] * 4)
    for key in ["rocAuc", "averagePrecision"]:
        assert result[key]["value"] is None and result[key]["reason"]


def test_zero_workload_has_a_reason_instead_of_fake_zero_metric():
    from jit_baseline.metrics import evaluate
    result = evaluate(examples(costs=(0, 0, 0, 0)), [.9, .8, .2, .1])
    assert result["recall20Loc"]["value"] is None
    assert result["recall20Loc"]["reason"]


@pytest.mark.parametrize("risks", [[], [.2] * 3, [.2, .2, .2, float('nan')], [.2, .2, .2, 2]])
def test_evaluation_rejects_incomplete_or_illegal_risks(risks):
    from jit_baseline.metrics import evaluate
    with pytest.raises(ValueError):
        evaluate(examples(), risks)


def test_registered_metric_set_lists_exactly_the_computed_metrics():
    from jit_baseline.metrics import DEFAULT_METRIC_SET, METRIC_SETS, evaluate
    assert set(METRIC_SETS[DEFAULT_METRIC_SET]) == set(evaluate(examples(), [.9, .8, .2, .1]))


def test_evaluation_returns_only_the_declared_metric_set(monkeypatch):
    """校验按运行声明的集合重算，而不是用当前代码能算的全部指标（PDB-12）。"""
    from jit_baseline.metrics import METRIC_SETS, evaluate
    monkeypatch.setitem(METRIC_SETS, "metric-set-subset", ("rocAuc", "averagePrecision"))
    assert set(evaluate(examples(), [.9, .8, .2, .1], "metric-set-subset")) == {"rocAuc", "averagePrecision"}
    # 未声明指标集时按首轮冻结集合（旧运行的解析口径）。
    assert set(evaluate(examples(), [.9, .8, .2, .1])) == set(METRIC_SETS["metric-set-v1"])


def test_unknown_metric_set_is_rejected_without_fallback():
    from jit_baseline.metrics import evaluate
    from jit_baseline.data import BaselineError
    with pytest.raises(BaselineError) as info:
        evaluate(examples(), [.9, .8, .2, .1], "metric-set-v9")
    assert info.value.code == "METRIC_SET_UNKNOWN"


def test_declared_metric_set_must_define_only_known_metrics(monkeypatch):
    from jit_baseline.data import BaselineError
    from jit_baseline.metrics import METRIC_SETS, evaluate
    monkeypatch.setitem(METRIC_SETS, "metric-set-typo", ("rocAuc", "notAMetric"))
    with pytest.raises(BaselineError) as info:
        evaluate(examples(), [.9, .8, .2, .1], "metric-set-typo")
    assert info.value.code == "METRIC_SET_INVALID"
