import json

from jit_baseline.config import BACKEND
from jit_baseline.data import sha256

from test_artifacts import copied_run, real_run  # noqa: F401


def test_generate_frozen_partition_report_is_identity_bound_and_immutable(copied_run, tmp_path):
    from jit_baseline.model_diagnostics import (DiagnosticReportService, generate_report,
                                                write_report)
    model_before = sha256((copied_run / "model.joblib").read_bytes())
    manifest_before = sha256((copied_run / "manifest.json").read_bytes())
    report = generate_report(copied_run, generated_utc="2026-11-07T00:00:00+00:00")
    assert report["kind"] == "model-partition-diagnostics"
    assert set(report["metricsByPartition"]) == {"train", "validation", "test"}
    assert all(part["counts"]["records"] == report["partitions"][name]["count"]
               for name, part in report["metricsByPartition"].items())
    assert str(copied_run) not in json.dumps(report)
    output = tmp_path / "reports"
    first, path, created = write_report(report, output)
    assert created and path.name == f"{report['artifactRunId']}.json"
    again, same_path, created_again = write_report(
        dict(report, generatedUtc="2026-11-07T01:00:00+00:00"), output)
    assert not created_again and same_path == path and again["generatedUtc"] == first["generatedUtc"]
    assert sha256((copied_run / "model.joblib").read_bytes()) == model_before
    assert sha256((copied_run / "manifest.json").read_bytes()) == manifest_before

    service = DiagnosticReportService([output])
    entry, error = service.for_run(
        report["artifactRunId"], model_sha256=report["modelSha256"],
        dataset_version=report["datasetVersion"], schema=report["schema"],
        metric_set=report["metricSet"])
    assert error is None and entry["report"] == first


def test_report_reader_distinguishes_missing_invalid_and_conflicting_reports(copied_run, tmp_path):
    from jit_baseline.model_diagnostics import (DiagnosticReportService, generate_report,
                                                write_report)
    report = generate_report(copied_run, generated_utc="2026-11-07T00:00:00+00:00")
    root = tmp_path / "reports"
    _, path, _ = write_report(report, root)
    service = DiagnosticReportService([root])
    missing, missing_error = service.for_run(
        "f" * 64, model_sha256=report["modelSha256"],
        dataset_version=report["datasetVersion"], schema=report["schema"],
        metric_set=report["metricSet"])
    assert missing is None and missing_error is None

    conflict, conflict_error = service.for_run(
        report["artifactRunId"], model_sha256="0" * 64,
        dataset_version=report["datasetVersion"], schema=report["schema"],
        metric_set=report["metricSet"])
    assert conflict is None and conflict_error["code"] == "REPORT_CONFLICT"

    invalid = dict(report, metricsByPartition={
        **report["metricsByPartition"],
        "train": {**report["metricsByPartition"]["train"], "counts": {"records": 0}},
    })
    path.write_text(json.dumps(invalid, ensure_ascii=False), encoding="utf-8")
    _, invalid_error = service.for_run(
        report["artifactRunId"], model_sha256=report["modelSha256"],
        dataset_version=report["datasetVersion"], schema=report["schema"],
        metric_set=report["metricSet"])
    assert invalid_error["code"] == "REPORT_INVALID"


def test_nine_frozen_reports_match_bundled_model_identity():
    from jit_baseline.model_diagnostics import _validate
    package_manifest = (BACKEND.parent /
                        "docs/evidence/bundle-trained-models-in-repository/package/model-package.json")
    report_root = BACKEND.parent / "docs/evidence/model-diagnostics"
    if not package_manifest.exists() or not report_root.is_dir():
        return
    package = json.loads(package_manifest.read_text(encoding="utf-8"))
    models = {item["artifactRunId"]: item for item in package["models"]}
    reports = {}
    for path in report_root.glob("*.json"):
        report = _validate(json.loads(path.read_text(encoding="utf-8")))
        reports[report["artifactRunId"]] = report
    assert set(reports) == set(models) and len(reports) == 9
    for run_id, model in models.items():
        report = reports[run_id]
        assert report["modelSha256"] == model["model"]["sha256"]
        assert report["datasetVersion"] == model["datasetVersion"]
        assert report["schema"] == model["schema"]
        assert report["metricSet"] == model["metricSet"]
        assert [report["partitions"][name]["count"]
                for name in ("train", "validation", "test")] == [8669, 1852, 1853]


def test_current_benefit_reports_bind_to_the_packaged_nine_models():
    package_manifest = (BACKEND.parent /
                        "docs/evidence/bundle-trained-models-in-repository/package/model-package.json")
    benefit_root = BACKEND.parent / "docs/evidence/model-card-benefits"
    if not package_manifest.exists() or not benefit_root.is_dir():
        return
    package = json.loads(package_manifest.read_text(encoding="utf-8"))
    for model in package["models"]:
        report = json.loads((benefit_root / model["artifactKey"] / "benefit-report.json")
                            .read_text(encoding="utf-8"))
        assert report["artifact"]["runId"] == model["artifactRunId"]
        assert report["artifact"]["modelSha256"] == model["model"]["sha256"]
        assert report["artifact"]["datasetVersion"] == model["datasetVersion"]
