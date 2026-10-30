"""多数据集套件编排与跨项目报告（MDE-01..MDE-06）。"""
import json
from pathlib import Path

import pytest

from jit_baseline.config import BACKEND

OPENSTACK_MANIFEST = (BACKEND / "data/datasets/openstack-six-v1/"
                      "openstack-six-v1-2011-11-29_2014-02-28.json")


def fake_runner(calls, fail=None):
    def run(source_dir, target, schema, algorithm, metric_set, dataset_manifest=None):
        calls.append((schema, algorithm, metric_set, str(dataset_manifest)))
        if fail == algorithm:
            from jit_baseline.data import BaselineError
            raise BaselineError("MODEL_NOT_CONVERGED", "注入的失败")
        Path(target).mkdir(parents=True)
        return {"runId": f"run-{algorithm}"}
    return run


def test_run_suite_records_every_method(tmp_path):
    from jit_baseline.suite import SUITE_FILE, run_suite
    calls = []
    suite = run_suite(OPENSTACK_MANIFEST, tmp_path / "suite", runner=fake_runner(calls))
    assert suite["kind"] == "multi-dataset-suite"
    assert suite["metricSet"] == "metric-set-v2"
    assert suite["status"] == "complete"
    assert len(suite["methods"]) == 9
    assert all(item["status"] == "succeeded" for item in suite["methods"])
    assert {item["runId"] for item in suite["methods"]} == {f"run-{item['method']}" for item in suite["methods"]}
    assert all(call[0] == "openstack-six-v1" for call in calls)
    stored = json.loads((tmp_path / "suite" / SUITE_FILE).read_text(encoding="utf-8"))
    assert stored["datasetManifest"]["sha256"] == suite["datasetManifest"]["sha256"]
    assert stored["labelSemantics"]["kind"] == "publisher-labels"


def test_run_suite_failure_is_recorded_and_others_continue(tmp_path):
    from jit_baseline.suite import run_suite
    calls = []
    suite = run_suite(OPENSTACK_MANIFEST, tmp_path / "suite",
                      methods=["decision-tree-v1", "random-forest-v1"],
                      runner=fake_runner(calls, fail="decision-tree-v1"))
    assert suite["status"] == "partial"
    failed = next(item for item in suite["methods"] if item["method"] == "decision-tree-v1")
    assert failed["status"] == "failed" and failed["code"] == "MODEL_NOT_CONVERGED"
    succeeded = [item for item in suite["methods"] if item["status"] == "succeeded"]
    assert [item["method"] for item in succeeded] == ["random-forest-v1"]
    assert len(calls) == 2


def test_run_suite_rejects_unknown_method_and_existing_output(tmp_path):
    from jit_baseline.data import BaselineError
    from jit_baseline.suite import run_suite
    with pytest.raises(BaselineError) as info:
        run_suite(OPENSTACK_MANIFEST, tmp_path / "x", methods=["not-a-method"], runner=fake_runner([]))
    assert info.value.code == "ALGORITHM_UNKNOWN"
    target = tmp_path / "existing"
    target.mkdir()
    with pytest.raises(BaselineError) as info:
        run_suite(OPENSTACK_MANIFEST, target, runner=fake_runner([]))
    assert info.value.code == "OUTPUT_EXISTS"


def write_fake_run(root, method, *, dataset_version, schema, metric_set, test_ids=("a", "b")):
    directory = root / method
    directory.mkdir(parents=True)
    (directory / "summary.json").write_text(json.dumps({
        "runId": f"run-{method}", "datasetVersion": dataset_version,
        "featureSchema": {"name": schema}, "threshold": 0.5,
        "metrics": {"rocAuc": {"value": 0.7, "reason": None}}, "trainingSeconds": 1.0,
    }), encoding="utf-8")
    (directory / "manifest.json").write_text(json.dumps({
        "runId": f"run-{method}", "config": {"metricSet": metric_set}}), encoding="utf-8")
    (directory / "split.json").write_text(json.dumps({
        "partitions": {"test": {"ids": list(test_ids), "count": len(test_ids)}}}), encoding="utf-8")


def write_fake_suite(root, *, dataset, version, schema, metric_set, label_kind,
                     methods, dataset_version):
    root.mkdir(parents=True)
    entries = []
    for method in methods:
        write_fake_run(root, method, dataset_version=dataset_version, schema=schema,
                       metric_set=metric_set)
        entries.append({"method": method, "status": "succeeded", "runId": f"run-{method}",
                        "path": method})
    (root / "suite.json").write_text(json.dumps({
        "kind": "multi-dataset-suite", "dataset": dataset, "version": version,
        "schemaName": schema, "metricSet": metric_set,
        "labelSemantics": {"kind": label_kind, "rule": "r", "limitations": ["限制"]},
        "methods": entries, "status": "complete",
    }), encoding="utf-8")
    return root


def test_compare_projects_groups_and_never_ranks_across_projects(tmp_path):
    from jit_baseline.suite import compare_projects
    first = write_fake_suite(tmp_path / "a", dataset="openstack", version="v1",
                             schema="openstack-six-v1", metric_set="metric-set-v2",
                             label_kind="publisher-labels", methods=["m1", "m2"],
                             dataset_version="openstack-v1")
    second = write_fake_suite(tmp_path / "b", dataset="repo", version="v2",
                              schema="kamei14-git-v1", metric_set="metric-set-v2",
                              label_kind="simplified-szz", methods=["m1", "m2"],
                              dataset_version="repo-v2")
    report = compare_projects([first, second])
    assert report["kind"] == "cross-project-report"
    assert report["directlyRankable"] is False
    assert report["reasons"]
    assert {project["dataset"] for project in report["projects"]} == {"openstack", "repo"}
    assert all(project["withinProject"]["directlyRankable"] for project in report["projects"])
    assert report["projects"][1]["labelSemantics"]["kind"] == "simplified-szz"
    assert any("特征 schema" in reason or "标签语义" in reason for reason in report["reasons"])


def test_within_project_detects_metric_set_mismatch(tmp_path):
    from jit_baseline.suite import compare_projects
    root = write_fake_suite(tmp_path / "suite", dataset="p", version="v", schema="openstack-six-v1",
                            metric_set="metric-set-v2", label_kind="publisher-labels",
                            methods=["m1"], dataset_version="p-v")
    write_fake_run(root, "m2", dataset_version="p-v", schema="openstack-six-v1",
                   metric_set="metric-set-v1")
    suite = json.loads((root / "suite.json").read_text(encoding="utf-8"))
    suite["methods"].append({"method": "m2", "status": "succeeded", "runId": "run-m2", "path": "m2"})
    (root / "suite.json").write_text(json.dumps(suite), encoding="utf-8")
    report = compare_projects([root])
    assert report["projects"][0]["withinProject"]["directlyRankable"] is False
    assert any("指标集" in reason for reason in report["projects"][0]["withinProject"]["reasons"])


def test_compare_projects_rejects_empty_input():
    from jit_baseline.data import BaselineError
    from jit_baseline.suite import compare_projects
    with pytest.raises(BaselineError) as info:
        compare_projects([])
    assert info.value.code == "EVALUATION_INVALID"


def test_declared_label_semantics_override_publisher_default():
    from jit_baseline.suite import label_semantics
    result = label_semantics({
        "schemaName": "kamei14-benchmark-v1",
        "label": {"kind": "jit-fine-is-buggy-commit", "rule": "binary",
                  "limitations": ["declared limitation"]},
    })
    assert result == {"kind": "jit-fine-is-buggy-commit", "rule": "binary",
                      "limitations": ["declared limitation"]}
