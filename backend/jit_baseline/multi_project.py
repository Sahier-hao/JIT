"""Four-project training protocols and cross-project robustness report."""
import json
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .algorithms import get_algorithm
from .artifacts import environment, write_json
from .config import BACKEND
from .data import BaselineError, parse_source, sha256
from .datasets import load_manifest, manifest_relative
from .metrics import evaluate, get_metric_set
from .model import fit_model, predict_risks, temporal_split
from .suite import SUITE_METRIC_SET, label_semantics, select_methods

REPORT_KIND = "multi-project-training-report"
REPORT_VERSION = 1
REQUIRED_PROJECTS = 4
PROTOCOLS = ("local", "pooled", "leave-one-project-out", "global+local")
CLASSIC_METHODS = (
    "logistic-regression-l2-v1",
    "decision-tree-v1",
    "random-forest-v1",
    "gaussian-naive-bayes-v1",
    "gradient-boosting-v1",
)
AGGREGATE_METRICS = {
    "averagePrecision": "maximize",
    "rocAuc": "maximize",
    "recall20Loc": "maximize",
    "popt": "maximize",
    "f1": "maximize",
    "ifa": "minimize",
}
BLEND_GRID = tuple(index / 20 for index in range(21))
SOURCE_FILES = ("multi_project.py", "model.py", "metrics.py", "schemas.py", "algorithms.py")


def _failure(stage, exc, *, method=None, protocol=None, project=None, **extra):
    return {
        "status": "failed",
        "stage": stage,
        "code": getattr(exc, "code", "MODEL_INVALID"),
        "message": str(exc),
        "method": method,
        "protocol": protocol,
        "project": project,
        **extra,
    }


def _ids_digest(records):
    encoded = json.dumps([record["id"] for record in records], separators=(",", ":"),
                         ensure_ascii=False).encode("utf-8")
    return sha256(encoded)


def _project_summary(manifest, records, split, boundaries):
    return {
        "status": "succeeded",
        "name": manifest["dataset"],
        "dataset": manifest["dataset"],
        "version": manifest["version"],
        "manifestSha256": sha256(Path(manifest["manifestPath"]).read_bytes())
        if Path(manifest["manifestPath"]).is_absolute()
        else sha256((BACKEND / manifest["manifestPath"]).read_bytes()),
        "url": manifest["url"],
        "revision": manifest["revision"],
        "csvSha256": manifest["file"]["sha256"],
        "schema": manifest["schemaName"],
        "includedRows": manifest["quality"]["includedRows"],
        "positiveLabels": manifest["quality"]["positiveLabels"],
        "labelSemantics": label_semantics(manifest),
        "splitRule": "UTC distinct timestamps, floor(0.70G), floor(0.85G)",
        "boundaryEpochs": list(boundaries),
        "partitions": {
            name: {
                "count": len(part),
                "positiveCount": sum(record["label"] for record in part),
                "idDigest": _ids_digest(part),
                "firstEpoch": part[0]["epoch"],
                "lastEpoch": part[-1]["epoch"],
            }
            for name, part in split.items()
        },
    }


def load_projects(dataset_manifests):
    """Load exactly four compatible Git datasets and their deterministic splits."""
    paths = [Path(path) for path in dataset_manifests]
    if len(paths) != REQUIRED_PROJECTS:
        raise BaselineError("PROJECT_COHORT_INVALID",
                            f"多项目训练需要恰好 {REQUIRED_PROJECTS} 个项目，实际 {len(paths)} 个")
    if len({path.resolve() for path in paths}) != len(paths):
        raise BaselineError("PROJECT_COHORT_INVALID", "多项目训练不能重复使用同一数据集")
    projects = []
    manifests = []
    for path in paths:
        manifest = load_manifest(path)
        manifest["manifestPath"] = manifest_relative(path)
        manifests.append(manifest)
    names = [manifest["dataset"] for manifest in manifests]
    if len(set(names)) != len(names):
        raise BaselineError("PROJECT_COHORT_INVALID", "多项目训练的项目名称必须唯一")
    schemas = {manifest["schemaName"] for manifest in manifests}
    cohorts = {json.dumps(manifest["cohort"], sort_keys=True) for manifest in manifests}
    labels = {json.dumps(label_semantics(manifest), sort_keys=True, ensure_ascii=False)
              for manifest in manifests}
    if len(schemas) != 1:
        raise BaselineError("PROJECT_COHORT_INVALID", "四个项目必须使用同一特征 schema")
    if len(cohorts) != 1:
        raise BaselineError("PROJECT_COHORT_INVALID", "四个项目必须使用同一采集窗口和纳入规则")
    if len(labels) != 1 or next(iter(label_semantics(manifest))) != "kind":
        raise BaselineError("PROJECT_COHORT_INVALID", "四个项目必须使用同一标签规则")
    semantics = label_semantics(manifests[0])
    if semantics["kind"] != "simplified-szz":
        raise BaselineError("PROJECT_COHORT_INVALID", "多项目 Git 训练要求简化 SZZ 标签")
    if manifests[0]["schemaName"] != "kamei14-git-v1":
        raise BaselineError("PROJECT_COHORT_INVALID", "多项目 Git 训练要求 kamei14-git-v1")
    windows = [(manifest.get("collection") or {}).get("window") for manifest in manifests]
    if any(window != windows[0] for window in windows[1:]) or not windows[0]:
        raise BaselineError("PROJECT_COHORT_INVALID", "四个项目必须使用同一 Git 采集窗口")
    for manifest in manifests:
        csv_path = Path(manifest["file"]["path"])
        csv_path = csv_path if csv_path.is_absolute() else BACKEND / csv_path
        try:
            blob = csv_path.read_bytes()
        except OSError as exc:
            raise BaselineError("DATASET_UNAVAILABLE", f"项目 CSV 不可用：{csv_path.name}") from exc
        if sha256(blob) != manifest["file"]["sha256"]:
            raise BaselineError("DATASET_INVALID", f"项目 CSV 哈希不符：{manifest['dataset']}")
        records, quality = parse_source(blob, manifest["schemaName"], manifest["cohort"])
        if quality != manifest["quality"]:
            raise BaselineError("DATASET_INVALID", f"项目质量统计无法重算：{manifest['dataset']}")
        try:
            split, boundaries = temporal_split(records)
        except BaselineError as exc:
            projects.append({
                "name": manifest["dataset"],
                "manifest": manifest,
                "records": records,
                "split": None,
                "failure": _failure("split", exc, project=manifest["dataset"]),
            })
            continue
        projects.append({
            "name": manifest["dataset"],
            "manifest": manifest,
            "records": records,
            "split": split,
            "failure": None,
            "summary": _project_summary(manifest, records, split, boundaries),
        })
    return projects


def _with_project(records, project):
    return [dict(record, project=project) for record in records]


def _risk_list(model, records, schema, predictor):
    if not records:
        raise BaselineError("EVALUATION_INVALID", "预测记录为空")
    risks = predictor(model, records, schema)
    values = np.asarray(risks, dtype=np.float64)
    if values.shape != (len(records),) or not np.isfinite(values).all() or (values < 0).any() or (values > 1).any():
        raise BaselineError("INFERENCE_ERROR", "预测风险数量或数值无效")
    return values


def choose_blend_weight(global_risks, local_risks, validation_labels):
    """Choose the fixed-grid blend on validation Brier score, never on test."""
    global_risks = np.asarray(global_risks, dtype=np.float64)
    local_risks = np.asarray(local_risks, dtype=np.float64)
    labels = np.asarray(validation_labels, dtype=np.float64)
    if (global_risks.shape != local_risks.shape or global_risks.shape != labels.shape
            or not len(labels)):
        raise BaselineError("EVALUATION_INVALID", "验证集融合风险数量不一致或为空")
    scores = []
    for alpha in BLEND_GRID:
        risks = alpha * global_risks + (1 - alpha) * local_risks
        scores.append((float(np.mean((risks - labels) ** 2)), alpha))
    brier, alpha = min(scores, key=lambda item: (item[0], item[1]))
    return alpha, brier


def aggregate_results(project_metrics):
    """Macro average, population variance and per-metric worst project."""
    aggregate = {}
    for metric, direction in AGGREGATE_METRICS.items():
        values = []
        undefined = []
        for project, metrics in project_metrics:
            entry = metrics.get(metric)
            value = entry.get("value") if isinstance(entry, dict) else None
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                values.append((project, float(value)))
            else:
                undefined.append({
                    "project": project,
                    "reason": (entry or {}).get("reason") or "指标未定义",
                })
        if values:
            numbers = [value for _, value in values]
            worst_value = (max(value for _, value in values) if direction == "minimize"
                           else min(value for _, value in values))
            worst_project = min(project for project, value in values if value == worst_value)
            aggregate[metric] = {
                "direction": direction,
                "definedCount": len(values),
                "macroMean": statistics.fmean(numbers),
                "populationVariance": statistics.pvariance(numbers),
                "worstProject": {"project": worst_project, "value": worst_value},
                "undefined": undefined,
            }
        else:
            aggregate[metric] = {
                "direction": direction,
                "definedCount": 0,
                "macroMean": None,
                "populationVariance": None,
                "worstProject": None,
                "undefined": undefined,
            }
    primary = aggregate["averagePrecision"]["worstProject"]
    return {
        "metrics": aggregate,
        "worstProjectByPrimaryMetric": {
            "metric": "averagePrecision",
            **(primary or {"project": None, "value": None}),
        },
    }


def _outcome(project, training_projects, training_seconds, metrics, **extra):
    return {
        "project": project,
        "status": "succeeded",
        "trainingProjects": list(training_projects),
        "trainingSeconds": round(training_seconds, 6),
        "metrics": metrics,
        **extra,
    }


def _evaluate_model(model, target, schema, predictor, evaluator, metric_set, training_projects,
                    training_seconds, **extra):
    started = time.perf_counter()
    test = _with_project(target["split"]["test"], target["name"])
    risks = _risk_list(model, test, schema, predictor)
    prediction_seconds = time.perf_counter() - started
    metrics = evaluator(test, risks.tolist(), metric_set)
    return _outcome(target["name"], training_projects, training_seconds, metrics,
                    targetTest=target["summary"]["partitions"]["test"],
                    predictionSeconds=round(prediction_seconds, 6), **extra)


def _run_local(projects, schema, method, fitter, predictor, evaluator, metric_set, failures):
    outcomes = []
    for target in projects:
        try:
            started = time.perf_counter()
            train = _with_project(target["split"]["train"], target["name"])
            model = fitter(train, schema=schema, algorithm=method)
            seconds = time.perf_counter() - started
            outcomes.append(_evaluate_model(model, target, schema, predictor, evaluator, metric_set,
                                            [target["name"]], seconds))
        except Exception as exc:
            failures.append(_failure("local", exc, method=method, protocol="local",
                                     project=target["name"], trainingProjects=[target["name"]]))
    return outcomes


def _run_pooled(projects, schema, method, fitter, predictor, evaluator, metric_set, failures):
    train = [record for project in projects for record in _with_project(
        project["split"]["train"], project["name"])]
    sources = [project["name"] for project in projects]
    try:
        started = time.perf_counter()
        model = fitter(train, schema=schema, algorithm=method)
        seconds = time.perf_counter() - started
    except Exception as exc:
        for target in projects:
            failures.append(_failure("fit", exc, method=method, protocol="pooled",
                                     project=target["name"], trainingProjects=sources))
        return []
    outcomes = []
    for target in projects:
        try:
            outcomes.append(_evaluate_model(model, target, schema, predictor, evaluator, metric_set,
                                            sources, seconds))
        except Exception as exc:
            failures.append(_failure("evaluate", exc, method=method, protocol="pooled",
                                     project=target["name"], trainingProjects=sources))
    return outcomes


def _run_lopo(projects, schema, method, fitter, predictor, evaluator, metric_set, failures):
    outcomes = []
    models = {}
    for target in projects:
        sources = [project for project in projects if project["name"] != target["name"]]
        source_names = [project["name"] for project in sources]
        train = [record for project in sources for record in _with_project(
            project["split"]["train"], project["name"])]
        try:
            started = time.perf_counter()
            model = fitter(train, schema=schema, algorithm=method)
            seconds = time.perf_counter() - started
            models[target["name"]] = (model, seconds)
            outcomes.append(_evaluate_model(model, target, schema, predictor, evaluator, metric_set,
                                            source_names, seconds))
        except Exception as exc:
            failures.append(_failure("fit-or-evaluate", exc, method=method,
                                     protocol="leave-one-project-out",
                                     project=target["name"], trainingProjects=source_names))
    return outcomes, models


def _run_global_local(projects, schema, method, fitter, predictor, evaluator, metric_set,
                      failures, global_models):
    outcomes = []
    for target in projects:
        source_names = [project["name"] for project in projects if project["name"] != target["name"]]
        if target["name"] not in global_models:
            failures.append(_failure("global-fit", BaselineError(
                "MODEL_INVALID", "对应的留一全局模型不可用"), method=method,
                protocol="global+local", project=target["name"], trainingProjects=source_names))
            continue
        global_model, global_seconds = global_models[target["name"]]
        try:
            started = time.perf_counter()
            local_train = _with_project(target["split"]["train"], target["name"])
            local_model = fitter(local_train, schema=schema, algorithm=method)
            local_seconds = time.perf_counter() - started
            global_validation = _risk_list(
                global_model, _with_project(target["split"]["validation"], target["name"]),
                schema, predictor)
            local_validation = _risk_list(
                local_model, _with_project(target["split"]["validation"], target["name"]),
                schema, predictor)
            labels = [record["label"] for record in target["split"]["validation"]]
            alpha, brier = choose_blend_weight(global_validation, local_validation, labels)
            test = _with_project(target["split"]["test"], target["name"])
            global_test = _risk_list(global_model, test, schema, predictor)
            local_test = _risk_list(local_model, test, schema, predictor)
            blended = (alpha * global_test + (1 - alpha) * local_test).tolist()
            metrics = evaluator(test, blended, metric_set)
            outcomes.append(_outcome(
                target["name"], source_names + [target["name"]],
                global_seconds + local_seconds, metrics,
                targetTest=target["summary"]["partitions"]["test"],
                globalTrainingProjects=source_names,
                localTrainingProject=target["name"],
                blend={"alphaGlobal": alpha, "alphaLocal": 1 - alpha,
                       "validationCount": len(labels),
                       "validationPositiveCount": sum(labels),
                       "validationBrier": brier,
                       "selectionData": "target-validation"},
            ))
        except Exception as exc:
            failures.append(_failure("global-local-fit-or-blend", exc, method=method,
                                     protocol="global+local", project=target["name"],
                                     trainingProjects=source_names + [target["name"]]))
    return outcomes


def _protocol_summary(results, failures, protocol):
    project_metrics = [(result["project"], result["metrics"])
                       for result in results if result["status"] == "succeeded"]
    protocol_failures = [failure for failure in failures if failure.get("protocol") == protocol]
    if not results:
        status = "failed"
    elif protocol_failures or len(results) != REQUIRED_PROJECTS:
        status = "partial"
    else:
        status = "complete"
    return {"status": status, "targets": results, "summary": aggregate_results(project_metrics)}


def run_multi_project(dataset_manifests, output, methods=None, metric_set=None,
                      fitter=None, predictor=None, evaluator=None):
    """Run four protocols across four projects and write one machine-readable report."""
    metric_set = metric_set or SUITE_METRIC_SET
    get_metric_set(metric_set)
    method_names = select_methods(methods or CLASSIC_METHODS)
    for method in method_names:
        get_algorithm(method)
    projects = load_projects(dataset_manifests)
    ready = [project for project in projects if project.get("split")]
    failures = [project["failure"] for project in projects if project.get("failure")]
    fitter = fitter or fit_model
    predictor = predictor or predict_risks
    evaluator = evaluator or evaluate
    report = {
        "kind": REPORT_KIND,
        "reportVersion": REPORT_VERSION,
        "generatedUtc": datetime.now(timezone.utc).isoformat(),
        "schema": projects[0]["manifest"]["schemaName"] if projects else None,
        "metricSet": metric_set,
        "protocols": list(PROTOCOLS),
        "methods": list(method_names),
        "projects": [project.get("summary") or {
            "name": project["name"],
            "dataset": project["name"],
            "version": project["manifest"]["version"],
            "status": "failed",
            "failure": project["failure"],
        } for project in projects],
        "results": {},
        "failures": failures,
        "sourceCode": {
            name: sha256((Path(__file__).parent / name).read_bytes())
            for name in SOURCE_FILES
        },
        "environment": environment(),
        "boundary": {
            "offlineOnly": True,
            "automaticModelSelection": False,
            "defaultModelChanged": False,
            "bestMethodDeclared": False,
            "crossProjectMetricsAreMacroAverages": True,
        },
    }
    for method in method_names:
        method_results = {}
        if len(ready) < 2:
            method_failures = [
                project["failure"] for project in projects if project.get("failure")
            ]
            for protocol in PROTOCOLS:
                method_results[protocol] = {
                    "status": "failed",
                    "targets": [],
                    "summary": aggregate_results([]),
                }
            failures.extend(method_failures)
            report["results"][method] = method_results
            continue
        method_failures = []
        local = _run_local(ready, project_schema(ready), method, fitter, predictor,
                           evaluator, metric_set, method_failures)
        pooled = _run_pooled(ready, project_schema(ready), method, fitter, predictor,
                             evaluator, metric_set, method_failures)
        lopo, global_models = _run_lopo(
            ready, project_schema(ready), method, fitter, predictor,
            evaluator, metric_set, method_failures)
        combined = _run_global_local(
            ready, project_schema(ready), method, fitter, predictor,
            evaluator, metric_set, method_failures, global_models)
        method_results["local"] = _protocol_summary(local, method_failures, "local")
        method_results["pooled"] = _protocol_summary(pooled, method_failures, "pooled")
        method_results["leave-one-project-out"] = _protocol_summary(
            lopo, method_failures, "leave-one-project-out")
        method_results["global+local"] = _protocol_summary(
            combined, method_failures, "global+local")
        report["results"][method] = method_results
        failures.extend(method_failures)
    report["status"] = "complete" if not failures else "complete-with-failures"
    output = Path(output)
    if output.exists():
        raise BaselineError("OUTPUT_EXISTS", "多项目报告已存在，请换一个新路径")
    output.parent.mkdir(parents=True, exist_ok=True)
    write_json(output, report)
    return report


def project_schema(projects):
    schemas = {project["manifest"]["schemaName"] for project in projects}
    if len(schemas) != 1:
        raise BaselineError("PROJECT_COHORT_INVALID", "项目 schema 不一致")
    return next(iter(schemas))
