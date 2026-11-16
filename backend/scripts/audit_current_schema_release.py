"""Audit current-schema datasets, release reports and CPU-only inference evidence."""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jit_baseline import artifacts
from jit_baseline.algorithms import ALGORITHMS
from jit_baseline.data import parse_source, sha256
from jit_baseline.datasets import load_manifest
from jit_baseline.label_maturity import apply_label_maturity
from jit_baseline.release_qualification import APPROVAL_FILE, REPORT_FILE
from jit_baseline.release_reports import validate_report
from jit_baseline.schemas import resolve
from jit_baseline.splits import DEFAULT_PRESET, split_records

SCHEMA = "kamei14-git-v2"
FEATURES = set(resolve(SCHEMA).in_model_names())
LABEL_FIELDS = {"label_status", "observed_through_epoch", "maturity_days"}


def _read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _project_audit(path):
    manifest = load_manifest(path)
    csv_path = Path(manifest["file"]["path"])
    csv_path = csv_path if csv_path.is_absolute() else path.parents[3] / csv_path
    blob = csv_path.read_bytes()
    header = next(csv.reader(io.StringIO(blob.decode("utf-8-sig"))))
    missing = sorted((FEATURES | LABEL_FIELDS) - set(header))
    records, quality = parse_source(blob, SCHEMA, manifest["cohort"])
    filtered, maturity = apply_label_maturity(records, "mature-only")
    split, boundaries, split_policy = split_records(filtered, DEFAULT_PRESET)
    statuses = Counter(record["labelStatus"] for record in records)
    epochs = [record["epoch"] for record in records]
    return {
        "dataset": manifest["dataset"],
        "version": manifest["version"],
        "url": manifest["url"],
        "revision": manifest["revision"],
        "schema": manifest["schemaName"],
        "manifestSha256": sha256(Path(path).read_bytes()),
        "csvSha256": sha256(blob),
        "requiredFieldsPresent": not missing,
        "missingFields": missing,
        "qualityMatches": quality == manifest["quality"],
        "statusCounts": dict(sorted(statuses.items())),
        "formalRecordCount": len(filtered),
        "maturity": maturity,
        "timeRange": {
            "firstEpoch": min(epochs),
            "lastEpoch": max(epochs),
            "first": datetime.fromtimestamp(min(epochs), timezone.utc).isoformat(),
            "last": datetime.fromtimestamp(max(epochs), timezone.utc).isoformat(),
        },
        "split": {
            "preset": DEFAULT_PRESET,
            "boundaries": boundaries,
            "policy": split_policy,
            "partitions": {
                name: {
                    "records": len(part),
                    "positives": sum(record["label"] for record in part),
                }
                for name, part in split.items()
            },
        },
    }


def _run_audit(artifact_root, result):
    run_dir = Path(artifact_root) / result["artifactKey"]
    artifacts.verify_run(run_dir)
    snapshot = artifacts.Snapshot.load(run_dir)
    report = _read_json(run_dir / REPORT_FILE)
    validate_report(report)
    if report["status"] != result["status"]:
        raise ValueError(f"发布报告状态与基线不一致：{result['method']}")
    if report["reportId"] != result["releaseReportId"]:
        raise ValueError(f"发布报告身份与基线不一致：{result['method']}")
    approval = None
    if (run_dir / APPROVAL_FILE).is_file():
        approval = _read_json(run_dir / APPROVAL_FILE)
    return {
        "method": result["method"],
        "category": result["category"],
        "artifactKey": result["artifactKey"],
        "runId": result["runId"],
        "artifactRunId": result["artifactRunId"],
        "modelSha256": snapshot.manifest["config"]["modelSha256"],
        "status": report["status"],
        "releaseReportId": report["reportId"],
        "testRecords": len(snapshot.records),
        "cpuInferenceVerified": True,
        "approvedDefault": approval,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--package", type=Path, default=None)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    baseline = _read_json(args.baseline)
    projects = []
    for source in baseline["dataset"]["sourceProjects"]:
        path = args.dataset_root / source["dataset"] / f"{source['version']}.json"
        projects.append(_project_audit(path))
    runs = [_run_audit(args.artifact_root, item) for item in baseline["results"]]
    qualified = [item for item in runs if item["status"] == "qualified"]
    classic = sum(ALGORITHMS[item["method"]]["category"] == "classic" for item in qualified)
    deep = sum(ALGORITHMS[item["method"]]["category"] == "deep" for item in qualified)
    package = None
    if args.package and args.package.is_file():
        package = {
            "path": args.package.resolve().as_posix(),
            "sha256": sha256(args.package.read_bytes()),
            "bytes": args.package.stat().st_size,
        }
    audit = {
        "kind": "current-schema-release-audit",
        "generatedUtc": datetime.now(timezone.utc).isoformat(),
        "schema": SCHEMA,
        "projects": projects,
        "runs": runs,
        "coverage": {
            "qualified": len(qualified),
            "classic": classic,
            "deep": deep,
            "passed": len(qualified) >= 8 and classic >= 4 and deep >= 3,
        },
        "package": package,
    }
    audit["passed"] = (
        len(projects) == 4
        and all(item["schema"] == SCHEMA and item["requiredFieldsPresent"]
                and item["qualityMatches"] and item["maturity"]["releaseEligible"]
                for item in projects)
        and all(item["cpuInferenceVerified"] for item in runs)
        and audit["coverage"]["passed"]
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(audit, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "passed": audit["passed"],
        "coverage": audit["coverage"],
        "output": str(args.output),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
