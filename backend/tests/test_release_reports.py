"""Release reports are immutable, run-bound lookup artifacts."""

import json

import pytest

from jit_baseline.data import BaselineError
from jit_baseline.release_qualification import (
    approve_release_default,
    build_release_report,
    write_release_report,
)
from jit_baseline.release_reports import ReleaseReportService

from test_artifacts import copied_run, real_run  # noqa: F401


def test_release_report_is_run_bound_and_read_back(copied_run, tmp_path):
    report = build_release_report(copied_run)
    assert report["kind"] == "jit-model-release-report"
    assert report["artifact"]["runId"]
    assert report["assessment"]["policy"]["id"] == "jit-release-v1"
    assert report["status"] == "unqualified"
    assert any(gate["id"] == "maturity-policy" for gate in report["assessment"]["gates"])

    target = tmp_path / "reports"
    written, path = write_release_report(copied_run, output=target)
    service = ReleaseReportService([target])
    entry, error = service.for_run(written["artifact"]["runId"])
    assert error is None
    assert entry["report"]["reportId"] == written["reportId"]
    assert entry["reportId"] == written["reportId"]
    assert path.name == "release-report.json"


def test_invalid_release_report_is_reported(tmp_path):
    path = tmp_path / "release-report.json"
    path.write_text(json.dumps({"kind": "wrong"}), encoding="utf-8")
    service = ReleaseReportService([tmp_path])
    entry, error = service.for_run("run")
    assert entry is None
    assert error is None


def test_release_lookup_requires_matching_model_hash(copied_run, tmp_path):
    report = build_release_report(copied_run)
    target = tmp_path / "reports"
    write_release_report(copied_run, output=target)
    service = ReleaseReportService([target])
    entry, error = service.for_run(
        report["artifact"]["runId"],
        model_sha256="0" * 64,
        schema=report["artifact"]["schema"],
    )
    assert entry is None and error is None


def test_release_report_identity_changes_with_split_evidence(copied_run, tmp_path):
    first = build_release_report(copied_run)
    split_path = copied_run / "split.json"
    split = json.loads(split_path.read_text(encoding="utf-8"))
    split["partitions"]["test"]["ids"] = split["partitions"]["test"]["ids"][:-1]
    split_path.write_text(json.dumps(split), encoding="utf-8")
    with pytest.raises(BaselineError):
        build_release_report(copied_run)


def test_release_report_replacement_is_explicit_and_does_not_keep_stale_gates(
        copied_run, tmp_path):
    target = tmp_path / "reports"
    first, path = write_release_report(copied_run, output=target)
    with pytest.raises(BaselineError) as error:
        write_release_report(copied_run, output=target)
    assert error.value.code == "OUTPUT_EXISTS"
    second, replaced = write_release_report(
        copied_run, output=target, replace=True,
    )
    assert replaced == path
    assert second["reportId"] == first["reportId"]


def test_default_approval_is_idempotent_only_for_the_same_human_and_report(
        tmp_path):
    from jit_baseline import artifacts
    from jit_baseline.release_qualification import (
        POLICY_ID,
        REPORT_KIND,
        REPORT_VERSION,
        REQUIRED_POLICY,
        release_identity_payload,
    )

    run = tmp_path / "run"
    run.mkdir()
    artifact = {
        "runId": "a" * 64,
        "modelSha256": "b" * 64,
        "schema": "kamei14-git-v2",
        "datasetVersion": "dataset-v1",
        "datasetSha256": "c" * 64,
        "splitSha256": "d" * 64,
        "maturity": {
            "requestedPolicy": "mature-only",
            "effectivePolicy": "mature-only",
        },
    }
    report = {
        "kind": REPORT_KIND,
        "reportVersion": REPORT_VERSION,
        "reportId": artifacts.identity(
            release_identity_payload(artifact, [], REQUIRED_POLICY)
        ),
        "status": "qualified",
        "artifact": artifact,
        "assessment": {"policy": REQUIRED_POLICY},
        "projects": [],
    }
    assert report["assessment"]["policy"]["id"] == POLICY_ID
    artifacts.write_json(run / "release-report.json", report)

    first, path = approve_release_default(run, "model-1", "徐卓航")
    repeated, repeated_path = approve_release_default(run, "model-1", "徐卓航")
    assert repeated == first
    assert repeated_path == path
    with pytest.raises(BaselineError) as error:
        approve_release_default(run, "model-1", "其他人")
    assert error.value.code == "OUTPUT_EXISTS"
