"""Four-project protocol, aggregation and failure-isolation tests."""
import csv
import io
import json
from datetime import datetime, timezone

import pytest


FIELDS = ("ns", "nd", "nf", "entropy", "la", "ld", "lt", "fix",
          "ndev", "age", "nuc", "exp", "rexp", "sexp")


def _csv_bytes(offset=0):
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(("commit_id", "author_date", "bugcount", *FIELDS))
    for index in range(20):
        epoch = 1640995200 + offset + index * 86400
        label = 1 if index in (2, 17, 19) else 0
        values = (1 + index % 3, 2 + index % 2, 1, 0.5, 4, 5, 3, 0,
                  2, 1.5, 3, 4, 2.0, 3)
        writer.writerow((f"{index + offset:040x}", epoch, label, *values))
    return stream.getvalue().encode("utf-8")


def write_project(root, name, *, label_kind=None):
    from jit_baseline.datasets import build_manifest

    csv_path = root / f"{name}.csv"
    csv_path.write_bytes(_csv_bytes(offset=len(name)))
    start = datetime.fromtimestamp(1640995200 + len(name), tz=timezone.utc).date().isoformat()
    end = datetime.fromtimestamp(
        1640995200 + len(name) + 19 * 86400, tz=timezone.utc).date().isoformat()
    manifest = build_manifest(
        csv_path, schema="kamei14-git-v1", dataset=name,
        version=f"{name}-{start}_{end}",
        cohort={
            "addedLinesGreaterThan": 0,
            "startEpochInclusive": 1640995200,
            "endEpochExclusive": 1735689600,
            "maxChurnInclusive": 100000,
            "maxFilesInclusive": 1000,
        },
        provenance={
            "publisher": "collected",
            "revision": "a" * 40,
            "url": f"https://github.com/example/{name}",
            "citation": "由 Git 仓库采集生成",
        },
        extra={
            "collection": {
                "kind": "git-repository",
                "window": {"since": "2022-01-01", "until": "2025-01-01",
                           "startEpoch": 1640995200, "endEpoch": 1735689600},
                "repository": {"head": "a" * 40},
                "limitations": ["提交级聚合", "简化 SZZ"],
            },
            **({"label": {"kind": label_kind, "rule": "test", "limitations": ["test"]}}
               if label_kind else {}),
        },
    )
    path = root / f"{name}.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


@pytest.fixture
def project_paths(tmp_path):
    return [write_project(tmp_path, name)
            for name in ("commons-lang", "vue-core", "redis", "scikit-learn")]


def fake_runtime():
    calls = []

    def fitter(records, *, schema, algorithm):
        sources = sorted({record["project"] for record in records})
        calls.append((algorithm, tuple(sources), len(records)))
        return {"sources": frozenset(sources), "algorithm": algorithm}

    def predictor(model, records, schema):
        return [0.9 if record["label"] else 0.1 for record in records]

    def evaluator(records, risks, metric_set):
        project = records[0]["project"]
        values = {
            "commons-lang": 0.9,
            "vue-core": 0.7,
            "redis": 0.5,
            "scikit-learn": 0.3,
        }
        value = values[project]
        return {
            "averagePrecision": {"value": value, "reason": None},
            "rocAuc": {"value": value, "reason": None},
            "recall20Loc": {"value": value, "reason": None},
            "popt": {"value": value, "reason": None},
            "f1": {"value": value, "reason": None},
            "ifa": {"value": round((1 - value) * 10), "reason": None},
            "counts": {"records": len(records)},
        }

    return calls, fitter, predictor, evaluator


def test_load_projects_validates_count_window_and_labels(tmp_path):
    from jit_baseline.data import BaselineError
    from jit_baseline.multi_project import load_projects

    paths = [write_project(tmp_path, name)
             for name in ("commons-lang", "vue-core", "redis")]
    with pytest.raises(BaselineError) as info:
        load_projects(paths)
    assert info.value.code == "PROJECT_COHORT_INVALID"

    paths.append(write_project(tmp_path, "scikit-learn"))
    manifest = json.loads(paths[0].read_text(encoding="utf-8"))
    manifest["collection"]["window"]["until"] = "2026-01-01"
    paths[0].write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(BaselineError) as info:
        load_projects(paths)
    assert info.value.code == "PROJECT_COHORT_INVALID"

    paths[0] = write_project(tmp_path, "commons-lang", label_kind="publisher-labels")
    with pytest.raises(BaselineError) as info:
        load_projects(paths)
    assert info.value.code == "PROJECT_COHORT_INVALID"


def test_run_multi_project_uses_each_protocol_training_cohort(tmp_path, project_paths):
    from jit_baseline.multi_project import PROTOCOLS, run_multi_project

    calls, fitter, predictor, evaluator = fake_runtime()
    output = tmp_path / "report.json"
    report = run_multi_project(
        project_paths, output, methods=["logistic-regression-l2-v1"],
        fitter=fitter, predictor=predictor, evaluator=evaluator)

    assert set(report["results"]["logistic-regression-l2-v1"]) == set(PROTOCOLS)
    assert len(calls) == 13, report["failures"]
    local_calls = calls[:4]
    assert all(len(sources) == 1 and count > 0 for _, sources, count in local_calls)
    pooled = calls[4]
    assert len(pooled[1]) == 4
    lopo = calls[5:9]
    assert all(len(sources) == 3 for _, sources, _ in lopo)
    global_local = calls[9:]
    assert all(len(sources) == 1 for _, sources, _ in global_local)

    local_results = report["results"]["logistic-regression-l2-v1"]["local"]["targets"]
    assert {tuple(result["trainingProjects"]) for result in local_results} == {
        ("commons-lang",), ("vue-core",), ("redis",), ("scikit-learn",)
    }
    combined = report["results"]["logistic-regression-l2-v1"]["global+local"]["targets"]
    assert all(result["blend"]["selectionData"] == "target-validation" for result in combined)
    assert all(result["blend"]["validationCount"] == 3 for result in combined)
    stored = json.loads(output.read_text(encoding="utf-8"))
    assert stored["boundary"]["automaticModelSelection"] is False
    assert "bestMethod" not in stored


def test_aggregate_uses_population_variance_direction_and_ignores_undefined():
    from jit_baseline.multi_project import aggregate_results

    metrics = [
        ("a", {"averagePrecision": {"value": 0.1, "reason": None},
               "ifa": {"value": 2, "reason": None}}),
        ("b", {"averagePrecision": {"value": 0.5, "reason": None},
               "ifa": {"value": 9, "reason": None}}),
        ("c", {"averagePrecision": {"value": None, "reason": "未定义"},
               "ifa": {"value": 4, "reason": None}}),
    ]
    summary = aggregate_results(metrics)
    ap = summary["metrics"]["averagePrecision"]
    assert ap["definedCount"] == 2
    assert ap["macroMean"] == pytest.approx(0.3)
    assert ap["populationVariance"] == pytest.approx(0.04)
    assert ap["worstProject"] == {"project": "a", "value": 0.1}
    assert ap["undefined"] == [{"project": "c", "reason": "未定义"}]
    ifa = summary["metrics"]["ifa"]
    assert ifa["worstProject"] == {"project": "b", "value": 9}


def test_failure_isolation_records_target_and_continues(tmp_path, project_paths):
    from jit_baseline.multi_project import run_multi_project

    _, fitter, predictor, _ = fake_runtime()

    def evaluator(records, risks, metric_set):
        if records[0]["project"] == "redis":
            from jit_baseline.data import BaselineError
            raise BaselineError("EVALUATION_INVALID", "注入评价失败")
        return {"averagePrecision": {"value": 0.4, "reason": None}}

    report = run_multi_project(
        project_paths, tmp_path / "report.json", methods=["decision-tree-v1"],
        fitter=fitter, predictor=predictor, evaluator=evaluator)
    failures = [item for item in report["failures"] if item["project"] == "redis"]
    assert failures
    assert all(item["status"] == "failed" and item["stage"] for item in failures)
    completed = report["results"]["decision-tree-v1"]["local"]["targets"]
    assert {item["project"] for item in completed} == {
        "commons-lang", "vue-core", "scikit-learn"
    }
    assert report["results"]["decision-tree-v1"]["local"]["status"] == "partial"


def test_project_split_failure_keeps_other_projects_running(tmp_path, project_paths, monkeypatch):
    from jit_baseline import multi_project

    projects = multi_project.load_projects(project_paths)
    projects[-1]["split"] = None
    projects[-1]["failure"] = {
        "status": "failed", "stage": "split", "code": "SPLIT_INVALID",
        "message": "注入切分失败", "method": None, "protocol": None,
        "project": projects[-1]["name"],
    }
    monkeypatch.setattr(multi_project, "load_projects", lambda _: projects)
    calls, fitter, predictor, evaluator = fake_runtime()
    report = multi_project.run_multi_project(
        [], tmp_path / "report.json", methods=["logistic-regression-l2-v1"],
        fitter=fitter, predictor=predictor, evaluator=evaluator)
    assert report["status"] == "complete-with-failures"
    assert {item["project"] for item in report["results"]["logistic-regression-l2-v1"]["local"]["targets"]} == {
        "commons-lang", "vue-core", "redis"
    }
    assert report["results"]["logistic-regression-l2-v1"]["local"]["status"] == "partial"
    assert len(calls) == 10


def test_choose_blend_weight_is_deterministic():
    from jit_baseline.multi_project import choose_blend_weight

    alpha, brier = choose_blend_weight([0.8, 0.9], [0.1, 0.2], [1, 0])
    assert alpha == 0.5
    assert brier <= 0.31
