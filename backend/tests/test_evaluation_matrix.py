"""评价矩阵：协议冻结、时间外与留一仓库单元格、基线与失败格。"""
import json
from pathlib import Path

import pytest

from jit_baseline import evaluation_matrix
from jit_baseline.data import BaselineError
from jit_baseline.schemas import resolve

SCHEMA = resolve("openstack-six-v1")
FIELDS = list(SCHEMA.in_model_names())


def _records(prefix, count=90, positive_every=3):
    records = []
    for index in range(count):
        label = 1 if index % positive_every == 0 else 0
        metrics = {"ns": 1 + index % 3, "nd": 1 + index % 2, "nf": 1 + index % 4,
                   "ent": 0.5 + (index % 5) / 10, "la": 10 + index % 7, "ld": index % 4}
        records.append({
            "id": f"{prefix}-{index:03d}", "time": f"2017-01-{1 + index % 28:02d}T00:00:00Z",
            "epoch": 1_483_000_000 + index * 86_400, "sourceRow": index + 1,
            "metrics": metrics, "features": [metrics[name] for name in FIELDS],
            "label": label,
        })
    return records


def _dataset(path, *, schema=SCHEMA, records=None):
    name = Path(path).stem
    records = records if records is not None else _records(name)
    return {
        "manifest": {"url": f"https://example.com/{name}", "revision": "a" * 40},
        "manifestSha256": "b" * 64, "csvSha256": "c" * 64, "schema": schema,
        "records": records, "quality": {"includedRows": len(records),
                                        "positiveLabels": sum(r["label"] for r in records)},
        "name": name, "version": f"{name}-v1", "language": None,
    }


def _install(monkeypatch, builder=_dataset):
    monkeypatch.setattr(evaluation_matrix, "load_dataset", lambda path: builder(path))


def test_matrix_runs_temporal_and_leave_one_repo_cells(tmp_path, monkeypatch):
    _install(monkeypatch)
    report = evaluation_matrix.run_matrix(
        [("python", "alpha.json"), ("python", "beta.json"), ("python", "gamma.json")],
        tmp_path / "report.json", methods=["logistic-regression-l2-v1", "decision-tree-v1"])
    assert report["status"] == "complete"
    assert len(report["withinRepo"]) == 6
    assert {cell["dataset"] for cell in report["withinRepo"]} == {"alpha", "beta", "gamma"}
    assert all(cell["status"] == "succeeded" for cell in report["withinRepo"])
    assert len(report["leaveOneRepoOut"]) == 6
    assert {cell["heldOut"] for cell in report["leaveOneRepoOut"]} == {"alpha", "beta", "gamma"}
    assert all(cell["trainDatasets"] and cell["heldOut"] not in cell["trainDatasets"]
               for cell in report["leaveOneRepoOut"])
    # 每个仓库：改动量、时间与三个固定种子的随机基线。
    assert len(report["baselines"]) == 15
    assert {item["seed"] for item in report["baselines"] if item["baseline"] == "random"} == {42, 43, 44}
    assert len(report["calibration"]) == 6
    assert report["protocol"]["seeds"] == [42, 43, 44]
    assert report["protocol"]["locBudget"] == 0.2
    saved = json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))
    assert saved["protocolSha256"] == report["protocolSha256"]
    summary = evaluation_matrix.summarize(report)
    assert summary["withinRepo"]["succeeded"] == 6
    assert summary["leaveOneRepoOut"]["succeeded"] == 6


def test_single_class_dataset_is_reported_not_forced(tmp_path, monkeypatch):
    def builder(path):
        if Path(path).stem == "broken":
            return _dataset(path, records=_records("broken", positive_every=10_000))
        return _dataset(path)
    _install(monkeypatch, builder)
    report = evaluation_matrix.run_matrix(
        [("python", "alpha.json"), ("python", "broken.json")],
        tmp_path / "report.json", methods=["logistic-regression-l2-v1"])
    assert report["status"] == "partial"
    assert report["splitFailures"] and report["splitFailures"][0]["name"] == "broken"
    assert {cell["dataset"] for cell in report["withinRepo"]} == {"alpha"}
    assert report["leaveOneRepoOut"] == []
    assert report["failures"]


def test_mixed_schemas_are_rejected(tmp_path, monkeypatch):
    def builder(path):
        schema = resolve("kamei14-benchmark-v1") if Path(path).stem == "other" else SCHEMA
        return _dataset(path, schema=schema)
    _install(monkeypatch, builder)
    with pytest.raises(BaselineError) as error:
        evaluation_matrix.run_matrix([("python", "alpha.json"), ("python", "other.json")],
                                     tmp_path / "report.json",
                                     methods=["logistic-regression-l2-v1"])
    assert error.value.code == "PROJECT_COHORT_INVALID"


def test_single_dataset_language_cannot_do_leave_one_repo_out(tmp_path):
    with pytest.raises(BaselineError) as error:
        evaluation_matrix.run_matrix([("python", "only.json")], tmp_path / "report.json")
    assert error.value.code == "INPUT_INVALID"


def test_mcc_and_calibration_are_explicit_when_undefined():
    undefined = evaluation_matrix.mcc({"confusion": {"tp": 0, "fp": 0, "tn": 5, "fn": 0}})
    assert undefined["value"] is None and undefined["reason"]
    defined = evaluation_matrix.mcc({"confusion": {"tp": 3, "fp": 1, "tn": 4, "fn": 2}})
    assert defined["value"] == pytest.approx((3 * 4 - 1 * 2) / ((4) * (5) * (5) * (6)) ** 0.5)
    small = evaluation_matrix.calibration_report(
        [{"label": 1}, {"label": 0}], [0.9, 0.1])
    assert small["status"] == "undefined" and small["brier"] is None
    large = evaluation_matrix.calibration_report(
        [{"label": index % 2} for index in range(40)], [0.5] * 40)
    assert large["status"] == "computed"
    assert large["brier"] == pytest.approx(0.25)
    assert len(large["buckets"]) == 5
