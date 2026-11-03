"""Read-only dataset-by-method coverage derived from artifacts and the catalog."""
import os
from pathlib import Path, PurePosixPath

from .algorithms import ALGORITHMS
from .artifacts import identity, read_json
from .errors import BaselineError


def _suite_files(root):
    if not root.exists():
        return []
    found = []
    for current, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = sorted(name for name in dirs
                         if not name.startswith(".")
                         and not (current == str(root) and name == "development"))
        if "suite.json" not in files:
            continue
        path = root / PurePosixPath(*Path(current).relative_to(root).parts) / "suite.json"
        if path.is_symlink():
            continue
        try:
            suite = read_json(path)
        except BaselineError:
            continue
        relative = path.parent.relative_to(root).as_posix()
        found.append((relative, suite))
    return found


def _method_cell(method, entry, run, model):
    metadata = ALGORITHMS.get(method, {})
    cell = {
        "method": method,
        "name": metadata.get("name") or method,
        "category": metadata.get("category"),
        "state": "missing",
        "reason": None,
        "runId": entry.get("runId") if entry else None,
        "modelId": None,
        "modelState": None,
        "enabled": None,
        "metrics": {},
    }
    if entry and entry.get("status") == "failed":
        cell.update(state="failed", reason=entry.get("message") or entry.get("code"))
        return cell
    if run is None:
        cell["reason"] = "套件索引没有对应的完整产物"
        return cell
    cell.update(runId=run.get("artifactRunId"), metrics=run.get("metrics") or {})
    if run.get("artifactState") != "complete":
        cell.update(state="invalid", reason=run.get("artifactStateReason") or "产物不完整")
        return cell
    compatibility = run.get("serviceCompatibility")
    if compatibility == "offline-only":
        cell.update(state="offline-only", reason=run.get("serviceCompatibilityReason"))
    elif compatibility == "input-unsupported":
        cell.update(state="input-unsupported", reason=run.get("serviceCompatibilityReason"))
    elif compatibility == "schema-incompatible":
        cell.update(state="incompatible", reason=run.get("serviceCompatibilityReason"))
    elif run.get("registrationState") == "registered":
        cell.update(modelId=run.get("modelId"), modelState=run.get("modelState"),
                    enabled=run.get("enabled"))
        if run.get("modelState") == "ready" and run.get("enabled"):
            cell["state"] = "registered-ready"
        else:
            reason = (model or {}).get("error", {}).get("message")
            if not reason and run.get("enabled") is False:
                reason = "模型已停用"
            cell.update(state="registered-unavailable",
                        reason=reason or "已登记模型当前不可用")
    else:
        cell["state"] = "complete-unregistered"
    return cell


def _verified_run(catalog, run):
    """Mark a discovered run invalid unless one complete location still verifies."""
    if catalog._run_has_verified_location(run):
        return run
    if run.get("artifactState") != "complete":
        return run
    invalid = dict(run)
    invalid.update(
        artifactState="invalid",
        artifactStateReason="没有可通过完整性校验的产物位置",
    )
    return invalid


def model_coverage(catalog, *, dataset_version=None, limit=50, offset=0):
    """Project real training and registration states without mutating either."""
    runs_page = catalog.experiment_runs(limit=100000)
    runs = runs_page["runs"]
    models = {item.get("modelId"): item for item in catalog.models()}
    by_run_id = {item.get("artifactRunId"): item for item in runs if item.get("artifactRunId")}
    by_artifact_key = {}
    for run in runs:
        for location in run.get("locations") or []:
            if location.get("artifactKey"):
                by_artifact_key[location["artifactKey"]] = run
    groups = {}
    matched_runs = set()
    for suite_key, suite in _suite_files(catalog.root):
        version = suite.get("version")
        schema = suite.get("schemaName")
        if not isinstance(version, str) or not version or not isinstance(schema, str) or not schema:
            continue
        group_key = (version, schema)
        group = groups.setdefault(group_key, {
            "datasetKey": identity({"datasetVersion": version, "schema": schema})[:24],
            "dataset": suite.get("dataset") or version,
            "datasetVersion": version,
            "schema": schema,
            "metricSet": suite.get("metricSet"),
            "source": "suite",
            "suitePath": suite_key,
            "suiteStatus": suite.get("status"),
            "methods": {},
        })
        entries = {entry.get("method"): entry for entry in suite.get("methods") or []
                   if isinstance(entry, dict) and isinstance(entry.get("method"), str)}
        for method, entry in entries.items():
            artifact_key = entry.get("artifactKey")
            if not artifact_key:
                path = entry.get("path") or method
                artifact_key = f"{suite_key}/{path}"
            run = by_run_id.get(entry.get("runId")) or by_artifact_key.get(artifact_key)
            if run:
                matched_runs.add(id(run))
                run = _verified_run(catalog, run)
            groups[group_key]["methods"][method] = _method_cell(
                method, entry, run, models.get(run.get("modelId")) if run else None,
            )
    for run in runs:
        if id(run) in matched_runs or run.get("artifactState") != "complete":
            continue
        version, schema = run.get("datasetVersion"), run.get("featureSchemaVersion")
        if not version or not schema:
            continue
        key = (version, schema)
        group = groups.setdefault(key, {
            "datasetKey": identity({"datasetVersion": version, "schema": schema})[:24],
            "dataset": version,
            "datasetVersion": version,
            "schema": schema,
            "metricSet": run.get("metricSet"),
            "source": "artifacts",
            "suitePath": None,
            "suiteStatus": None,
            "methods": {},
        })
        method = run.get("method")
        if method and method not in group["methods"]:
            run = _verified_run(catalog, run)
            groups[key]["methods"][method] = _method_cell(
                method, {"status": "succeeded", "runId": run.get("artifactRunId")},
                run, models.get(run.get("modelId")),
            )
    datasets = []
    for group in groups.values():
        expected = list(ALGORITHMS)
        for method in sorted(set(group["methods"]) - set(expected)):
            expected.append(method)
        group["methods"] = [_method_cell(
            method, None, None, None,
        ) if method not in group["methods"] else group["methods"][method]
            for method in expected]
        counts = dict.fromkeys((
            "missing", "failed", "invalid", "offline-only", "input-unsupported",
            "incompatible", "complete-unregistered", "registered-ready",
            "registered-unavailable",
        ), 0)
        for cell in group["methods"]:
            counts[cell["state"]] = counts.get(cell["state"], 0) + 1
        group["counts"] = counts
        datasets.append(group)
    datasets.sort(key=lambda item: (item["datasetVersion"], item["schema"], item["datasetKey"]))
    if dataset_version:
        datasets = [item for item in datasets if item["datasetVersion"] == dataset_version]
        if not datasets:
            raise BaselineError("NOT_FOUND", "没有该数据集的训练覆盖记录")
    total = len(datasets)
    return {
        "datasets": datasets[offset:offset + limit],
        "total": total,
        "limit": limit,
        "offset": offset,
        "latestImport": catalog.store.latest_model_package_import(),
    }
