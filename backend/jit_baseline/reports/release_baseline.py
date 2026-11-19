"""Build the current-schema, multi-project model release baseline."""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from .. import artifacts, collect, datasets

from ..algorithms import ALGORITHMS
from ..catalog_storage import CatalogStorage
from ..config import BACKEND
from ..data import BaselineError, parse_source, sha256
from ..label_maturity import apply_label_maturity
from ..model_packages import CURRENT_SCHEMA_PACKAGE_PATH, export_model_package
from .release_qualification import (
    POLICY_ID,
    approve_release_default,
    build_release_report,
    write_release_report,
)
from ..schemas import resolve
from ..splits import DEFAULT_PRESET, policy_for_partitions, split_records
from ..training import TrainingExecutor

PROJECT_SCHEMA = "kamei14-git-v2"
DEFAULT_METHODS = tuple(ALGORITHMS)


def _load_project(path):
    path = Path(path)
    manifest = datasets.load_manifest(path)
    if manifest["schemaName"] != PROJECT_SCHEMA:
        raise BaselineError(
            "PROJECT_COHORT_INVALID",
            f"当前 schema 基线要求 {PROJECT_SCHEMA}，实际为 {manifest['schemaName']}",
        )
    csv_path = Path(manifest["file"]["path"])
    csv_path = csv_path if csv_path.is_absolute() else BACKEND / csv_path
    blob = csv_path.read_bytes()
    if sha256(blob) != manifest["file"]["sha256"]:
        raise BaselineError("DATASET_INVALID", f"项目数据哈希不匹配：{manifest['dataset']}")
    records, quality = parse_source(blob, PROJECT_SCHEMA, manifest["cohort"])
    if quality != manifest["quality"]:
        raise BaselineError("DATASET_INVALID", f"项目质量统计不一致：{manifest['dataset']}")
    records, maturity = apply_label_maturity(records, "mature-only")
    split, boundaries, policy = split_records(records, DEFAULT_PRESET)
    return {
        "manifestPath": path.resolve(),
        "manifest": manifest,
        "manifestSha256": sha256(path.read_bytes()),
        "records": records,
        "maturity": maturity,
        "split": split,
        "boundaries": boundaries,
        "splitPolicy": policy,
    }


def _synthetic_id(project, commit_id):
    return hashlib.sha256(f"{project}:{commit_id}".encode("utf-8")).hexdigest()[:40]


def build_pooled_dataset(dataset_manifests, *, output_dir, dataset_root,
                         dataset_name="jit-current-v2-pooled"):
    projects = [_load_project(path) for path in dataset_manifests]
    if len(projects) != 4:
        raise BaselineError("PROJECT_COHORT_INVALID", "当前 schema 基线必须使用四个项目")
    names = [project["manifest"]["dataset"] for project in projects]
    if len(set(names)) != 4:
        raise BaselineError("PROJECT_COHORT_INVALID", "四个项目名称必须唯一")
    cohorts = {json.dumps(project["manifest"]["cohort"], sort_keys=True)
               for project in projects}
    if len(cohorts) != 1:
        raise BaselineError("PROJECT_COHORT_INVALID", "四个项目必须使用同一采集窗口")
    combined = {"train": [], "validation": [], "test": []}
    source_projects = []
    status_counts = {"positive": 0, "unobserved": 0, "immature": 0}
    for project in projects:
        manifest = project["manifest"]
        metadata = {
            "dataset": manifest["dataset"],
            "version": manifest["version"],
            "manifestSha256": project["manifestSha256"],
            "sourceSha256": manifest["file"]["sha256"],
            "url": manifest["url"],
            "revision": manifest["revision"],
            "maturity": project["maturity"],
            "partitions": {
                name: {
                    "records": len(project["split"][name]),
                    "positives": sum(record["label"] for record in project["split"][name]),
                    "ids": [_synthetic_id(manifest["dataset"], record["id"])
                            for record in project["split"][name]],
                }
                for name in combined
            },
        }
        source_projects.append(metadata)
        for name in combined:
            for record in project["split"][name]:
                item = dict(record)
                item["originalId"] = record["id"]
                item["project"] = manifest["dataset"]
                item["id"] = _synthetic_id(manifest["dataset"], record["id"])
                combined[name].append(item)
                status_counts[record["labelStatus"]] += 1
    fields = list(resolve(PROJECT_SCHEMA).in_model_names())
    csv_blob = collect._csv_bytes(
        [record for name in ("train", "validation", "test") for record in combined[name]],
        fields,
    )
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / f"{dataset_name}.csv"
    if csv_path.exists():
        raise BaselineError("OUTPUT_EXISTS", "合并训练集输出已存在")
    csv_path.write_bytes(csv_blob)
    observed = max(project["maturity"]["observedThroughEpoch"] for project in projects)
    maturity_days = projects[0]["maturity"]["maturityDays"]
    collection = {
        "kind": "pooled-release-baseline",
        "window": projects[0]["manifest"]["cohort"],
        "sourceProjects": source_projects,
        "label": {
            "kind": "simplified-szz",
            "rule": "szz-simple-v1",
            "version": "szz-simple-v1",
            "observedThrough": observed,
            "maturityDays": maturity_days,
            "statusCounts": status_counts,
        },
    }
    registered = datasets.register(
        csv_path,
        schema=PROJECT_SCHEMA,
        dataset=dataset_name,
        root=dataset_root,
        cohort=projects[0]["manifest"]["cohort"],
        provenance={
            "publisher": "multi-project-pooled",
            "revision": ",".join(project["manifest"]["revision"] for project in projects),
            "url": ",".join(project["manifest"]["url"] for project in projects),
            "citation": "当前 14 维 schema 四项目合并训练基线",
        },
        extra={
            "collection": collection,
            "sourceProjects": source_projects,
            "labelRule": "简化 SZZ；正式训练与评价排除 immature 标签",
        },
    )
    manifest_path = Path(registered["path"])
    manifest_path = manifest_path if manifest_path.is_absolute() else BACKEND / manifest_path
    policy = policy_for_partitions(combined, DEFAULT_PRESET)
    split_override = {
        "partitions": {name: [record["id"] for record in combined[name]]
                       for name in ("train", "validation", "test")},
        "boundaries": [],
        "policy": policy,
        "rule": "four project-local temporal-70-15-15 partitions; mature labels only",
    }
    artifacts.write_json(output_dir / "pooled-index.json", {
        "datasetVersion": registered["version"],
        "manifestPath": datasets.manifest_relative(manifest_path),
        "manifestSha256": sha256(manifest_path.read_bytes()),
        "csvPath": str(csv_path.resolve()),
        "csvSha256": sha256(csv_blob),
        "sourceProjects": source_projects,
        "split": split_override,
    })
    return {
        "manifestPath": manifest_path,
        "datasetVersion": registered["version"],
        "manifestSha256": sha256(manifest_path.read_bytes()),
        "csvPath": csv_path,
        "csvSha256": sha256(csv_blob),
        "records": combined,
        "splitOverride": split_override,
        "sourceProjects": source_projects,
    }


def run_current_schema_baseline(dataset_manifests, *, output_dir, dataset_root,
                                artifact_root, storage=None, methods=None,
                                approve_default_method=None, approved_by=None,
                                dataset_name="jit-current-v2-pooled"):
    output_dir = Path(output_dir)
    if output_dir.exists():
        raise BaselineError("OUTPUT_EXISTS", "发布基线输出目录已存在")
    output_dir.mkdir(parents=True)
    artifact_root = Path(artifact_root)
    artifact_root.mkdir(parents=True, exist_ok=True)
    storage = storage or CatalogStorage()
    storage.initialize()
    from ..catalog import ModelCatalog
    catalog = ModelCatalog(storage, artifact_root)
    executor = TrainingExecutor(catalog, artifact_root)
    pooled = build_pooled_dataset(
        dataset_manifests, output_dir=output_dir / "dataset",
        dataset_root=dataset_root, dataset_name=dataset_name,
    )
    methods = tuple(methods or DEFAULT_METHODS)
    if not methods or any(method not in ALGORITHMS for method in methods):
        raise BaselineError("ALGORITHM_UNKNOWN", "发布基线包含未注册方法")
    results = []
    failures = []
    for method in methods:
        try:
            trained = executor.run(
                pooled["manifestPath"], method, "metric-set-v2",
                output_key=f"{dataset_name}-{method}",
                channel="release-baseline",
                maturity_policy="mature-only",
                split_preset=DEFAULT_PRESET,
                split_override=pooled["splitOverride"],
            )
            run_dir = artifact_root / trained["artifactKey"]
            report, report_path = write_release_report(
                run_dir, target_manifests=dataset_manifests,
            )
            category = ALGORITHMS[method]["category"]
            results.append({
                "method": method,
                "category": category,
                "status": report["status"],
                "modelId": trained["modelId"],
                "runId": trained["runId"],
                "artifactRunId": trained["artifactRunId"],
                "artifactKey": trained["artifactKey"],
                "releaseReportId": report["reportId"],
                "releaseReportPath": datasets.manifest_relative(report_path),
                "gates": report["assessment"]["gates"],
                "macro": report["assessment"].get("macro"),
            })
        except Exception as exc:
            if os.environ.get("JIT_RELEASE_BASELINE_DEBUG") == "1":
                raise
            failures.append({
                "method": method,
                "code": getattr(exc, "code", "MODEL_INVALID"),
                "message": str(exc),
            })
    qualified = [item for item in results if item["status"] == "qualified"]
    classic = sum(item["category"] == "classic" for item in qualified)
    deep = sum(item["category"] == "deep" for item in qualified)
    coverage_ok = len(qualified) >= 8 and classic >= 4 and deep >= 3
    approved = None
    if approve_default_method:
        if not approved_by or not approved_by.strip():
            raise BaselineError("INPUT_INVALID", "批准默认候选时必须记录批准人")
        selected = next(
            (item for item in qualified if item["method"] == approve_default_method),
            None,
        )
        if selected is None:
            raise BaselineError("RELEASE_UNQUALIFIED", "默认候选方法没有通过发布门槛")
        approved, approval_path = approve_release_default(
            artifact_root / selected["artifactKey"], selected["modelId"], approved_by.strip(),
        )
        selected["approvalPath"] = datasets.manifest_relative(approval_path)
    package = None
    if coverage_ok and approve_default_method:
        model_ids = [item["modelId"] for item in qualified]
        package_path = output_dir / CURRENT_SCHEMA_PACKAGE_PATH.name
        package = export_model_package(catalog, model_ids, package_path)
    if coverage_ok and not approve_default_method:
        status = "awaiting-default-approval"
    elif coverage_ok:
        status = "qualified"
    else:
        status = "quality-failed"
    baseline = {
        "kind": "current-schema-model-release-baseline",
        "reportVersion": 1,
        "generatedUtc": datetime.now(timezone.utc).isoformat(),
        "releasePolicy": POLICY_ID,
        "dataset": {
            "name": dataset_name,
            "version": pooled["datasetVersion"],
            "manifestPath": datasets.manifest_relative(pooled["manifestPath"]),
            "manifestSha256": pooled["manifestSha256"],
            "csvSha256": pooled["csvSha256"],
            "sourceProjects": pooled["sourceProjects"],
        },
        "methodsRequested": list(methods),
        "results": results,
        "failures": failures,
        "coverage": {
            "qualified": len(qualified),
            "classic": classic,
            "deep": deep,
            "passed": coverage_ok,
        },
        "approvedDefault": approved,
        "package": package,
        "status": status,
        "approvedDefaultMethod": approve_default_method,
    }
    artifacts.write_json(output_dir / "release-baseline.json", baseline)
    return baseline


def finalize_current_schema_baseline(output_dir, *, artifact_root, database, dataset_root,
                                     approve_default_method, approved_by):
    """Approve one method for the existing baseline and generate its package."""
    output_dir = Path(output_dir)
    report_path = output_dir / "release-baseline.json"
    baseline = artifacts.read_json(report_path)
    if baseline.get("kind") != "current-schema-model-release-baseline":
        raise BaselineError("REPORT_INVALID", "不是当前 schema 发布基线报告")
    results = baseline.get("results") or []
    target_manifests = [
        Path(dataset_root) / project["dataset"] / f"{project['version']}.json"
        for project in baseline["dataset"]["sourceProjects"]
    ]
    if len(target_manifests) != 4 or any(not path.is_file() for path in target_manifests):
        raise BaselineError("DATASET_INVALID", "发布基线引用的四个项目描述文件不完整")
    for result in results:
        run_dir = Path(artifact_root) / result["artifactKey"]
        qualification, qualification_path = write_release_report(
            run_dir, target_manifests=target_manifests, replace=True,
        )
        result.update(
            status=qualification["status"],
            releaseReportId=qualification["reportId"],
            releaseReportPath=datasets.manifest_relative(qualification_path),
            gates=qualification["assessment"]["gates"],
            macro=qualification["assessment"].get("macro"),
        )
    qualified = [item for item in results if item.get("status") == "qualified"]
    classic = sum(item.get("category") == "classic" for item in qualified)
    deep = sum(item.get("category") == "deep" for item in qualified)
    coverage_ok = len(qualified) >= 8 and classic >= 4 and deep >= 3
    if not coverage_ok:
        raise BaselineError("RELEASE_COVERAGE_INSUFFICIENT", "合格模型未达到八种及经典/深度覆盖门槛")
    selected = next(
        (item for item in qualified if item.get("method") == approve_default_method),
        None,
    )
    if selected is None:
        raise BaselineError("RELEASE_UNQUALIFIED", "默认候选方法没有通过发布门槛")
    if not approved_by or not approved_by.strip():
        raise BaselineError("INPUT_INVALID", "批准默认候选时必须记录批准人")
    artifact_root = Path(artifact_root)
    run_dir = artifact_root / selected["artifactKey"]
    approval, approval_path = approve_release_default(
        run_dir, selected["modelId"], approved_by.strip(),
    )
    selected["approvalPath"] = datasets.manifest_relative(approval_path)
    storage = CatalogStorage(database)
    storage.initialize()
    from ..catalog import ModelCatalog
    catalog = ModelCatalog(storage, artifact_root)
    package_path = output_dir / CURRENT_SCHEMA_PACKAGE_PATH.name
    package = export_model_package(
        catalog, [item["modelId"] for item in qualified], package_path,
    )
    baseline.update(
        coverage={
            "qualified": len(qualified),
            "classic": classic,
            "deep": deep,
            "passed": True,
        },
        approvedDefault=approval,
        approvedDefaultMethod=approve_default_method,
        package=package,
        status="qualified",
        finalizedUtc=datetime.now(timezone.utc).isoformat(),
    )
    artifacts.write_json(report_path, baseline)
    return baseline
