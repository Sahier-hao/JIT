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
