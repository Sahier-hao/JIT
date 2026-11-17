"""Release qualification catches imbalance and worst-project failures."""

from jit_baseline.release_qualification import assess_projects


def metric(value):
    return {"value": value, "reason": None}


def project(name, *, positives=40, ap=0.5, roc=0.75, recall20=0.3, popt=0.8):
    records = 100
    return {
        "project": name,
        "metrics": {
            "averagePrecision": metric(ap),
            "rocAuc": metric(roc),
            "recall20Loc": metric(recall20),
            "popt": metric(popt),
            "counts": {"records": records, "positive": positives,
                       "negative": records - positives},
            "confusion": {"tp": 1, "fp": 1, "tn": records - positives - 1,
                           "fn": positives - 1},
            "reference": {"apNoInformation": positives / records},
        },
        "baselines": {
            "time": {"recall20Loc": metric(0.2), "popt": metric(0.6)},
            "random": {
                "recall20Loc": {"mean": 0.15},
                "popt": {"mean": 0.5},
            },
        },
    }


def test_all_project_and_macro_gates_must_pass():
    result = assess_projects([project(name) for name in "abcd"])
    assert result["qualified"] is True
    assert result["status"] == "qualified"
    assert all(gate["passed"] for gate in result["gates"])


def test_high_accuracy_cannot_hide_bad_ap():
    item = project("a", positives=5, ap=0.04, roc=0.9)
    result = assess_projects([item, project("b"), project("c"), project("d")])
    assert result["qualified"] is False
    assert result["failedProjectCount"] == 1
    reasons = " ".join(result["gates"][0]["reasons"])
    assert "test positives" in reasons
    assert "averagePrecision" in reasons


def test_worst_project_failure_is_not_hidden_by_macro_average():
    items = [project(name, ap=0.8, roc=0.9) for name in "abc"]
    items.append(project("d", ap=0.1, roc=0.7))
    result = assess_projects(items)
    assert result["qualified"] is False
    assert result["gates"][-2]["passed"] is False


def test_both_effort_metrics_below_baselines_fail():
    items = [
        project(name, recall20=0.1, popt=0.3)
        for name in "abcd"
    ]
    result = assess_projects(items)
    assert result["qualified"] is False
    effort = next(gate for gate in result["gates"] if gate["id"] == "macro-effort")
    assert effort["passed"] is False


def test_no_test_positives_and_undefined_roc_are_failures_not_zeroes():
    item = project("a", positives=0, ap=None, roc=None)
    item["metrics"]["counts"]["negative"] = 100
    item["metrics"]["confusion"] = {"tp": 0, "fp": 0, "tn": 100, "fn": 0}
    result = assess_projects([item, project("b"), project("c"), project("d")])
    assert result["qualified"] is False
    reasons = " ".join(result["gates"][0]["reasons"])
    assert "test positives" in reasons
    assert "rocAuc" in reasons
    assert result["gates"][0]["values"]["testPositives"] == 0
    assert result["gates"][0]["values"]["rocAuc"] is None


def test_one_effort_metric_above_both_baselines_satisfies_the_effort_gate():
    items = [
        project(name, recall20=0.1, popt=0.8)
        for name in "abcd"
    ]
    result = assess_projects(items)
    effort = next(gate for gate in result["gates"] if gate["id"] == "macro-effort")
    assert effort["passed"] is True
    assert result["qualified"] is True
