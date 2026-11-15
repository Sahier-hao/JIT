"""数据级 review-benefit-v3 报告：方法格、案例与跨仓库不足记录。"""
import json

import pytest

from jit_baseline import collect, datasets, review_benefit
from jit_baseline.data import BaselineError
from jit_baseline.schemas import resolve
from label_fixtures import register_labeled

NAMES = resolve("kamei14-git-v2").in_model_names()


def _records(count=200):
    base = dict(ns=1 + 1, nd=2, nf=2, entropy=0.5, la=12, ld=2, lt=80, fix=0,
                ndev=2, age=3, nuc=2, exp=5, rexp=2, sexp=3)
    records = []
    for index in range(count):
        metrics = dict(base)
        metrics["la"] = 4 + index % 20
        metrics["ld"] = index % 5
        metrics["nuc"] = 1 + index % 9
        metrics["fix"] = 1 if index % 11 == 0 else 0
        records.append({"id": f"{index + 1:040x}", "epoch": 1_704_067_200 + index * 86_400,
                        "time": f"2024-01-01T00:00:00Z", "label": 1 if index % 3 == 0 else 0,
                        "metrics": metrics})
    return records


def _dataset(tmp_path):
    source = tmp_path / "review.csv"
    records = _records()
    source.write_bytes(collect._csv_bytes(records, NAMES))
    root = tmp_path / "datasets"
    registered = register_labeled(source, records, schema="kamei14-git-v2",
                                  dataset="review", root=root,
                                  cohort=collect.cohort("2020-01-01", "2030-01-01"))
    manifest = root / "review" / f"{registered['version']}.json"
    return manifest


def test_review_benefit_reports_cells_cases_and_insufficient_cohort(tmp_path):
    manifest = _dataset(tmp_path)
    output = tmp_path / "report.json"
    report = review_benefit.evaluate_datasets(
        [("python", manifest)], output, methods=["logistic-regression-l2-v1"],
        seeds=(42,), random_runs=5)
    assert report["status"] == "complete"
    assert len(report["cells"]) == 1
    cell = report["cells"][0]
    assert cell["status"] == "succeeded"
    assert cell["reviewBenefit"]["protocol"] == "review-benefit-v3"
    assert cell["reviewBenefit"]["comparisons"]["modelVsTime"]["recall20LocInterval"]
    assert len(report["cases"]) == 5
    assert all(case["automaticCheck"]["statusMatchesCsv"] for case in report["cases"])
    assert all(case["humanReview"]["status"] == "pending" for case in report["cases"])
    assert report["crossRepo"]["status"] == "not-run-insufficient-cohort"
    assert report["crossRepo"]["languages"] == {"python": 1}
    assert report["protocolSha256"]
    saved = json.loads(output.read_text(encoding="utf-8"))
    assert saved["protocolSha256"] == report["protocolSha256"]
    assert review_benefit.summarize(report)["succeeded"] == 1


def test_review_benefit_rejects_legacy_szz_without_observation(tmp_path):
    records = _records()
    source = tmp_path / "legacy.csv"
    source.write_bytes(collect._csv_bytes(records, NAMES))
    root = tmp_path / "datasets"
    registered = datasets.register(source, schema="kamei14-git-v2", dataset="legacy",
                                   root=root, cohort=collect.cohort("2020-01-01", "2030-01-01"))
    manifest = root / "legacy" / f"{registered['version']}.json"
    with pytest.raises(BaselineError) as raised:
        review_benefit.evaluate_datasets([("python", manifest)], tmp_path / "report.json",
                                         methods=["logistic-regression-l2-v1"])
    assert raised.value.code == "LABEL_OBSERVATION_UNKNOWN"


def test_zero_cost_dataset_returns_reasons_not_fake_values(tmp_path):
    manifest = _dataset(tmp_path)
    # 将全部成本置零会破坏标签特征，这里直接用预算函数验证原因契约。
    from jit_baseline import budget
    records = budget.prepare([{"id": "a" * 40, "epoch": 1, "label": 1,
                               "metrics": {"la": 0, "ld": 0}, "risk": 0.5}])
    result = budget.evaluate(records, random_runs=2)
    assert result["strategies"]["model"]["recall20Loc"]["reason"]
    assert result["strategies"]["model"]["popt"]["reason"]
