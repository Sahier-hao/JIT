"""JIT release qualification: evidence-based, project-aware and not auto-ranking."""
from __future__ import annotations

import os
import statistics
from datetime import datetime, timezone
from pathlib import Path

from .. import artifacts

from .benefit import (
    BUDGET_FRACTION,
    DEFAULT_RANDOM_RUNS,
    DEFAULT_SEED,
    _density_order,
    _model_order,
    _random_order,
    _random_summary,
    _strategy,
    _time_order,
)
from ..config import BACKEND
from ..data import BaselineError, parse_source, review_cost, sha256
from ..datasets import load_manifest
from ..label_maturity import apply_label_maturity
from ..metrics import evaluate, get_metric_set
from ..model import predict_risks
from ..splits import split_records

REPORT_KIND = "jit-model-release-report"
REPORT_VERSION = 1
REPORT_FILE = "release-report.json"
APPROVAL_FILE = "release-approval.json"
POLICY_ID = "jit-release-v1"
MIN_TEST_POSITIVES = 20
MIN_ROC_AUC = 0.65
REQUIRED_POLICY = {
    "id": POLICY_ID,
    "metricSet": "metric-set-v2",
    "splitPreset": "temporal-70-15-15",
    "threshold": 0.5,
    "minTestPositives": MIN_TEST_POSITIVES,
    "minRocAuc": MIN_ROC_AUC,
    "effortBudgetFraction": BUDGET_FRACTION,
    "randomRuns": DEFAULT_RANDOM_RUNS,
    "randomSeed": DEFAULT_SEED,
}
ARTIFACT_IDENTITY_FIELDS = (
    "runId",
    "modelSha256",
    "schema",
    "datasetVersion",
    "datasetSha256",
    "splitSha256",
    "maturity",
)


def _number(entry):
    value = entry.get("value") if isinstance(entry, dict) else entry
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _accuracy(metrics):
    confusion = metrics.get("confusion") or {}
    counts = metrics.get("counts") or {}
    tp, fp = confusion.get("tp"), confusion.get("fp")
    tn, fn = confusion.get("tn"), confusion.get("fn")
    records = counts.get("records")
    positives = counts.get("positive")
    if not all(isinstance(value, int) and not isinstance(value, bool)
               for value in (tp, fp, tn, fn, records, positives)) or not records:
        return {"accuracy": None, "majorityAccuracy": None, "positiveRate": None,
                "reason": "混淆矩阵或样本数无效"}
    return {
        "accuracy": (tp + tn) / records,
        "majorityAccuracy": max(positives, records - positives) / records,
        "positiveRate": positives / records,
        "reason": None,
    }


def release_identity_payload(artifact, projects, policy):
    """Identity inputs that invalidate a release decision when evidence changes."""
    if not isinstance(artifact, dict) or not isinstance(projects, list):
        raise BaselineError("REPORT_INVALID", "发布报告缺少身份输入")
    return {
        "artifact": {
            name: artifact.get(name)
            for name in ARTIFACT_IDENTITY_FIELDS
        },
        "targets": [
            project.get("metadata") if isinstance(project, dict) else None
            for project in projects
        ],
        "releasePolicy": policy,
    }


def assess_projects(projects, *, policy=None):
    """Assess already-computed project evaluations against jit-release-v1."""
    policy = dict(policy or REQUIRED_POLICY)
    gates = []
    for project in projects:
        name = project.get("project")
        metrics = project.get("metrics") or {}
        counts = metrics.get("counts") or {}
        positives = counts.get("positive")
        ap = _number(metrics.get("averagePrecision"))
        no_information = _number((metrics.get("reference") or {}).get("apNoInformation"))
        roc = _number(metrics.get("rocAuc"))
        passed = (
            isinstance(positives, int) and positives >= policy["minTestPositives"]
            and ap is not None and no_information is not None and ap > no_information
            and roc is not None and roc >= policy["minRocAuc"]
        )
        reasons = []
        if not isinstance(positives, int) or positives < policy["minTestPositives"]:
            reasons.append(f"test positives {positives!r} < {policy['minTestPositives']}")
        if ap is None or no_information is None or ap <= no_information:
            reasons.append("averagePrecision did not exceed the no-information baseline")
        if roc is None or roc < policy["minRocAuc"]:
            reasons.append(f"rocAuc is below {policy['minRocAuc']}")
        gates.append({
            "id": f"project:{name}",
            "passed": passed,
            "reasons": reasons,
            "values": {
                "testPositives": positives,
                "averagePrecision": ap,
                "apNoInformation": no_information,
                "rocAuc": roc,
            },
        })
    required = ("recall20Loc", "popt")
    baseline_values = {}
    macro_values = {}
    for metric in required:
        model_values = [_number(((project.get("metrics") or {}).get(metric)))
                        for project in projects]
        time_values = [_number((((project.get("baselines") or {}).get("time") or {}).get(metric)))
                       for project in projects]
        random_values = [_number((((project.get("baselines") or {}).get("random") or {}).get(metric, {}).get("mean"))
                          if isinstance((((project.get("baselines") or {}).get("random") or {}).get(metric)), dict)
                          else None)
                         for project in projects]
        if all(value is not None for value in model_values):
            macro_values[metric] = statistics.fmean(model_values)
        else:
            macro_values[metric] = None
        baseline_values[metric] = {
            "time": statistics.fmean(time_values) if all(value is not None for value in time_values) else None,
            "random": statistics.fmean(random_values) if all(value is not None for value in random_values) else None,
        }
    effort_passes = []
    for metric in required:
        value = macro_values[metric]
        baseline = baseline_values[metric]
        effort_passes.append(
            value is not None and baseline["time"] is not None and baseline["random"] is not None
            and value >= baseline["time"] and value >= baseline["random"]
        )
    effort_gate = {
        "id": "macro-effort",
        "passed": any(effort_passes),
        "reasons": [] if any(effort_passes) else [
            "macro Recall@20%LOC and Popt both failed to meet time and random baselines"
        ],
        "values": {"model": macro_values, "baselines": baseline_values},
    }
    gates.append(effort_gate)
    qualified = bool(gates) and all(gate["passed"] for gate in gates)
    return {
        "policy": policy,
        "qualified": qualified,
        "status": "qualified" if qualified else "unqualified",
        "gates": gates,
        "macro": {"metrics": macro_values, "baselines": baseline_values},
        "failedProjectCount": sum(not gate["passed"] for gate in gates
                                  if gate["id"].startswith("project:")),
    }


def _project_evaluation(snapshot, records, project, metadata=None):
    risks = predict_risks(snapshot.model, records, snapshot.schema)
    metric_set = snapshot.manifest["config"].get("metricSet") or "metric-set-v2"
    metrics = evaluate(records, risks, metric_set)
    evaluation = [
        dict(record, risk=float(risk),
             cost=review_cost(record))
        for record, risk in zip(records, risks, strict=True)
    ]
    total = sum(record["cost"] for record in evaluation)
    positives = sum(record["label"] for record in evaluation)
    budget = BUDGET_FRACTION * total
    model = _strategy(evaluation, _model_order(evaluation),
                      ordering="score-desc,time-desc,id-asc",
                      total=total, budget=budget, positives=positives)
    density = _strategy(evaluation, _density_order(evaluation),
                        ordering="risk-per-loc-desc,time-desc,id-asc",
                        total=total, budget=budget, positives=positives)
    time = _strategy(evaluation, _time_order(evaluation),
                     ordering="time-desc,id-asc",
                     total=total, budget=budget, positives=positives)
    random_results = [
        _strategy(evaluation, _random_order(evaluation, DEFAULT_SEED, run),
                  ordering=f"random(seed={DEFAULT_SEED},run={run})",
                  total=total, budget=budget, positives=positives)
        for run in range(DEFAULT_RANDOM_RUNS)
    ]
    random = _random_summary(random_results, DEFAULT_RANDOM_RUNS, DEFAULT_SEED)
    diagnostics = _accuracy(metrics)
    return {
        "project": project,
        "metadata": metadata or {},
        "counts": metrics["counts"],
        "metrics": metrics,
        "diagnostics": diagnostics,
        "baselines": {
            "density": density,
            "time": time,
            "random": random,
        },
        "testSha256": sha256(
            "\n".join(record["id"] for record in records).encode("ascii")
        ),
    }


def _target_records(manifest_path, maturity_policy, split_preset):
    manifest = load_manifest(manifest_path)
    csv_path = Path(manifest["file"]["path"])
    csv_path = csv_path if csv_path.is_absolute() else BACKEND / csv_path
    blob = csv_path.read_bytes()
    if sha256(blob) != manifest["file"]["sha256"]:
        raise BaselineError("DATASET_INVALID", f"目标数据哈希不匹配：{manifest['dataset']}")
    records, quality = parse_source(blob, manifest["schemaName"], manifest["cohort"])
    if quality != manifest["quality"]:
        raise BaselineError("DATASET_INVALID", f"目标数据质量统计不一致：{manifest['dataset']}")
    records, maturity = apply_label_maturity(records, maturity_policy)
    split, boundaries, split_policy = split_records(records, split_preset)
    return split["test"], {
        "dataset": manifest["dataset"],
        "datasetVersion": manifest["version"],
        "manifestSha256": sha256(Path(manifest_path).read_bytes()),
        "dataSha256": manifest["file"]["sha256"],
        "labelSemantics": manifest.get("labelRule") or (manifest.get("label") or {}).get("kind"),
        "maturity": maturity,
        "split": {
            "preset": split_preset,
            "boundaries": boundaries,
            "policy": split_policy,
            "test": {
                "records": len(split["test"]),
                "positives": sum(record["label"] for record in split["test"]),
            },
        },
    }


def build_release_report(run_dir, target_manifests=None):
    run_dir = Path(run_dir)
    artifacts.verify_run(run_dir)
    snapshot = artifacts.Snapshot.load(run_dir)
    summary = snapshot.summary
    maturity = summary.get("maturity") or {}
    policy_name = maturity.get("requestedPolicy") or "mature-only"
    projects = []
    if target_manifests:
        if len(target_manifests) not in (1, 4):
            raise BaselineError("PROJECT_COHORT_INVALID", "发布资格要求一个或四个目标项目")
        for path in target_manifests:
            records, metadata = _target_records(
                path, policy_name, REQUIRED_POLICY["splitPreset"]
            )
            projects.append(_project_evaluation(
                snapshot, records, metadata["dataset"], metadata
            ))
        scope = "multi-project" if len(projects) == 4 else "single-project"
    else:
        labels = artifacts.read_json(run_dir / "test-labels.json")
        label_by_id = {item["id"]: item["label"] for item in labels}
        test_records = [
            dict(record, label=label_by_id[record["id"]])
            for record in snapshot.records
        ]
        projects.append(_project_evaluation(
            snapshot, test_records, summary["datasetVersion"], {
                "dataset": summary["datasetVersion"],
                "datasetVersion": summary["datasetVersion"],
                "dataSha256": (summary.get("source") or {}).get("sha256"),
                "split": summary.get("split"),
                "maturity": maturity,
            },
        ))
        scope = "artifact-test"
    assessment = assess_projects(projects)
    if maturity.get("releaseEligible") is False:
        assessment["qualified"] = False
        assessment["status"] = "unqualified"
        assessment["gates"].insert(0, {
            "id": "maturity-policy",
            "passed": False,
            "reasons": ["run is legacy-unrecorded or an include-immature sensitivity analysis"],
            "values": maturity,
        })
    generated = datetime.now(timezone.utc).isoformat()
    artifact = {
        "runId": snapshot.manifest["runId"],
        "artifactKey": run_dir.name,
        "artifactPath": run_dir.as_posix(),
        "modelId": None,
        "modelSha256": snapshot.manifest["config"]["modelSha256"],
        "method": snapshot.manifest["config"].get("algorithmVersion"),
        "schema": snapshot.schema.name,
        "datasetVersion": summary.get("datasetVersion"),
        "datasetSha256": (summary.get("source") or {}).get("sha256"),
        "splitSha256": sha256((run_dir / "split.json").read_bytes()),
        "metricSet": snapshot.manifest["config"].get("metricSet"),
        "maturity": maturity,
        "serviceCompatibility": (
            "repository-analysis"
            if snapshot.schema.name in ("openstack-six-v1", "kamei14-git-v1",
                                         "kamei14-git-v2") else "offline-only"
        ),
    }
    report_id = artifacts.identity(
        release_identity_payload(artifact, projects, REQUIRED_POLICY)
    )
    report = {
        "kind": REPORT_KIND,
        "reportVersion": REPORT_VERSION,
        "reportId": report_id,
        "generatedUtc": generated,
        "scope": scope,
        "artifact": artifact,
        "projects": projects,
        "assessment": assessment,
        "status": assessment["status"],
        "approvedDefault": None,
        "limitations": [
            "发布资格基于冻结历史测试分区，不代表在线缺陷概率或因果效果。",
            "普通 accuracy 只作诊断，不参与发布门槛。",
            "跨项目比较要求和基线未通过时不得宣布整体合格。",
        ],
    }
    return report


def write_release_report(run_dir, output=None, target_manifests=None, *, replace=False):
    run_dir = Path(run_dir)
    report = build_release_report(run_dir, target_manifests)
    path = Path(output) if output else run_dir / REPORT_FILE
    if path.suffix.lower() != ".json":
        path = path / REPORT_FILE
    if path.exists() and not replace:
        raise BaselineError("OUTPUT_EXISTS", "发布报告已存在，请使用新的输出路径")
    path.parent.mkdir(parents=True, exist_ok=True)
    if replace:
        temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        try:
            artifacts.write_json(temporary, report)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
    else:
        artifacts.write_json(path, report)
    return report, path


def approve_release_default(run_dir, model_id, approved_by):
    """Record an explicit human approval without rewriting the release report."""
    run_dir = Path(run_dir)
    report_path = run_dir / REPORT_FILE
    report = artifacts.read_json(report_path)
    from .release_reports import validate_report
    validate_report(report)
    if report["status"] != "qualified":
        raise BaselineError("RELEASE_UNQUALIFIED", "未通过发布门槛的模型不能成为默认候选")
    approval = {
        "kind": "jit-release-default-approval",
        "modelId": model_id,
        "artifactRunId": report["artifact"]["runId"],
        "modelSha256": report["artifact"]["modelSha256"],
        "releaseReportId": report["reportId"],
        "approvedBy": approved_by,
        "approvedAt": datetime.now(timezone.utc).isoformat(),
    }
    path = run_dir / APPROVAL_FILE
    if path.exists():
        existing = artifacts.read_json(path)
        if existing == {**approval, "approvedAt": existing.get("approvedAt")}:
            return existing, path
        raise BaselineError("OUTPUT_EXISTS", "该运行已经有人工默认候选批准记录")
    artifacts.write_json(path, approval)
    return approval, path
