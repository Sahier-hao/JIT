"""Fresh isolated backend for Playwright: reset catalog, seed models, then serve."""
import json
import hashlib
import csv
import io
import os
import shutil
import sys
import zipfile
from pathlib import Path

import uvicorn


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
DATABASE = Path(os.environ["JIT_CATALOG_DATABASE"])
ARTIFACT_ROOT = Path(os.environ["JIT_ARTIFACT_ROOT"])
DATASET_ROOT = Path(os.environ["JIT_DATASET_ROOT"])
MODELS = (
    "baseline",
    "decision-tree-v1",
    "random-forest-v1",
    "gaussian-naive-bayes-v1",
    "gradient-boosting-v1",
    "mlp-v1",
    "tabular-resnet-v1",
    "ft-transformer-v1",
    "wide-deep-v1",
)
EXPERIMENT_MODE = os.environ.get("JIT_E2E_EXPERIMENT_MODE") == "1"
PACKAGE_MODE = os.environ.get("JIT_E2E_MODEL_PACKAGE_MODE") == "1"
BUNDLED_MODEL_MODE = os.environ.get("JIT_E2E_BUNDLED_MODEL_MODE") == "1"
CURRENT_SCHEMA_MODE = os.environ.get("JIT_E2E_CURRENT_SCHEMA_MODE") == "1"
TRAINING_EVALUATION_MODE = os.environ.get("JIT_E2E_TRAINING_EVALUATION_MODE") == "1"
PREDICTION_MODE = os.environ.get("JIT_E2E_PREDICTION_MODE") == "1"
PREDICTION_DATASET = "e2e-prediction"
PREDICTION_VERSION = "e2e-prediction-2024-01-01_2024-01-12"


def _rewrite_run_identity(directory, marker):
    """Change a copied run's declared provenance and synchronize its identity."""
    from jit_baseline.artifacts import identity, read_json, verify_run, write_json
    from jit_baseline.data import sha256

    manifest = read_json(directory / "manifest.json")
    manifest["config"].setdefault("sourceCode", {})["package-e2e.py"] = sha256(marker.encode())
    manifest["runId"] = identity(manifest["config"])
    summary = read_json(directory / "summary.json")
    summary["runId"] = manifest["runId"]
    write_json(directory / "summary.json", summary)
    manifest["files"]["summary.json"] = sha256((directory / "summary.json").read_bytes())
    write_json(directory / "manifest.json", manifest)
    verify_run(directory)


def _package_recovery_setup():
    """Build, import and then exercise a real nine-model recovery package."""
    from jit_baseline.catalog import ModelCatalog
    from jit_baseline.catalog_storage import CatalogStorage
    from jit_baseline.model_packages import export_model_package, import_model_package

    package_root = DATABASE.parent / "model-packages"
    shutil.rmtree(package_root, ignore_errors=True)
    package_root.mkdir(parents=True)
    source_artifacts = DATABASE.parent / "model-package-source-artifacts"
    shutil.rmtree(source_artifacts, ignore_errors=True)
    shutil.copytree(ARTIFACT_ROOT, source_artifacts)
    extra = source_artifacts / "package-extra"
    shutil.copytree(source_artifacts / "decision-tree-v1", extra)
    _rewrite_run_identity(extra, "package-extra")
    corrupt_new = source_artifacts / "package-corrupt"
    shutil.copytree(source_artifacts / "decision-tree-v1", corrupt_new)
    _rewrite_run_identity(corrupt_new, "package-corrupt")

    source_storage = CatalogStorage(DATABASE)
    source_storage.initialize()
    source_catalog = ModelCatalog(source_storage, source_artifacts)
    base_models = [source_catalog.register_key(name)["model"] for name in MODELS]
    extra_model = source_catalog.register_key("package-extra")["model"]
    corrupt_new_model = source_catalog.register_key("package-corrupt")["model"]
    base_package = package_root / "jit-nine-models.zip"
    export_model_package(source_catalog, [model["modelId"] for model in base_models], base_package)

    conflict_model = base_models[MODELS.index("random-forest-v1")]
    mixed_package = package_root / "jit-partial-package.zip"
    export_model_package(
        source_catalog,
        [extra_model["modelId"], conflict_model["modelId"], corrupt_new_model["modelId"]],
        mixed_package,
    )

    DATABASE.unlink(missing_ok=True)
    shutil.rmtree(ARTIFACT_ROOT, ignore_errors=True)
    ARTIFACT_ROOT.mkdir(parents=True)
    storage = CatalogStorage(DATABASE)
    storage.initialize()
    catalog = ModelCatalog(storage, ARTIFACT_ROOT)
    recovered = import_model_package(catalog, base_package)
    if recovered["status"] != "completed" or recovered["registeredCount"] != 9:
        raise RuntimeError(f"九模型包恢复失败：{recovered}")
    suite = ARTIFACT_ROOT / "suites" / "jit-package-e2e"
    suite.mkdir(parents=True)
    (suite / "suite.json").write_text(json.dumps({
        "kind": "multi-dataset-suite",
        "dataset": "公开大型 JIT 基准",
        "version": "jit-package-e2e-v1",
        "schemaName": "openstack-six-v1",
        "metricSet": "metric-set-v2",
        "status": "complete",
        "methods": [{
            "method": model["method"],
            "status": "succeeded",
            "runId": model["artifactRunId"],
            "artifactKey": MODELS[index],
        } for index, model in enumerate(base_models)],
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    with zipfile.ZipFile(mixed_package) as original:
        package_manifest = json.loads(original.read("model-package.json"))
        conflict_item = next(item for item in package_manifest["models"]
                             if item["sourceModelId"] == conflict_model["modelId"])
        corrupt_item = next(item for item in package_manifest["models"]
                            if item["sourceModelId"] == corrupt_new_model["modelId"])
        # A same-run package pointing at a different target location must conflict.
        conflict_item["artifactKey"] = "decision-tree-v1"
        corrupt_model_path = f"{corrupt_item['packagePath']}/model.joblib"
        corrupt_bytes = b"e2e corrupt model"
        corrupt_entry = next(entry for entry in corrupt_item["files"]
                             if entry["path"] == "model.joblib")
        corrupt_entry["sha256"] = hashlib.sha256(corrupt_bytes).hexdigest()
        corrupt_entry["size"] = len(corrupt_bytes)
        changed = package_root / "jit-partial-package.changed.zip"
        with zipfile.ZipFile(changed, "w", compression=zipfile.ZIP_DEFLATED) as target:
            for info in original.infolist():
                data = (json.dumps(package_manifest, ensure_ascii=False,
                                   sort_keys=True).encode("utf-8")
                        if info.filename == "model-package.json"
                        else corrupt_bytes if info.filename == corrupt_model_path
                        else original.read(info.filename))
                target.writestr(info, data)
    mixed_package = changed
    mixed_sha = hashlib.sha256(mixed_package.read_bytes()).hexdigest()
    mixed_package.with_name(mixed_package.name + ".sha256").write_text(
        f"{mixed_sha}  {mixed_package.name}\n", encoding="ascii")
    mixed = import_model_package(catalog, mixed_package)
    if mixed["status"] != "partial":
        raise RuntimeError(f"部分模型包验收未产生预期部分结果：{mixed}")

    evidence = {
        "baseModelIds": [model["modelId"] for model in base_models],
        "baseArtifactRunIds": [model["artifactRunId"] for model in base_models],
        "basePackageSha256": recovered["packageSha256"],
        "mixedPackageSha256": mixed_sha,
        "recovered": recovered,
        "mixed": mixed,
    }
    (package_root / "recovery-evidence.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")


def _bundled_model_setup():
    """Initialize the real application data solely from the committed bundle."""
    from jit_baseline.catalog import ModelCatalog
    from jit_baseline.catalog_storage import CatalogStorage
    from jit_baseline.model_packages import (
        BUNDLED_PACKAGE_PATH,
        import_bundled_model_package,
        inspect_bundled_model_package,
    )

    inspected = inspect_bundled_model_package(BUNDLED_PACKAGE_PATH)
    storage = CatalogStorage(DATABASE)
    storage.initialize()
    catalog = ModelCatalog(storage, ARTIFACT_ROOT)
    imported = import_bundled_model_package(catalog)
    if imported["status"] != "completed":
        raise RuntimeError(f"仓库内置模型包初始化失败：{imported}")
    for model in catalog.registered_models():
        storage.set_model_share(model["modelId"], True, "e2e-admin")
    suite = ARTIFACT_ROOT / "suites" / "jit-bundled"
    suite.mkdir(parents=True)
    (suite / "suite.json").write_text(json.dumps({
        "kind": "multi-dataset-suite",
        "dataset": "仓库内置九模型",
        "version": "jit-bundled-v1",
        "schemaName": "openstack-six-v1",
        "metricSet": "metric-set-v2",
        "status": "complete",
        "methods": [{
            "method": item["method"],
            "status": "succeeded",
            "runId": item["artifactRunId"],
            "artifactKey": item["artifactKey"],
        } for item in inspected["models"]],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    evidence = {
        "packageName": inspected["packageName"],
        "packageSha256": inspected["packageSha256"],
        "models": [{
            "sourceModelId": item["sourceModelId"],
            "artifactRunId": item["artifactRunId"],
            "method": item["method"],
        } for item in inspected["models"]],
        "import": imported,
    }
    (DATABASE.parent / "bundled-model-bootstrap.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")


def _current_schema_setup():
    """Initialize only the committed current 14-field release package."""
    from jit_baseline.catalog import ModelCatalog
    from jit_baseline.catalog_storage import CatalogStorage
    from jit_baseline.model_packages import (
        CURRENT_SCHEMA_PACKAGE_PATH,
        import_current_schema_model_package,
    )

    if not CURRENT_SCHEMA_PACKAGE_PATH.is_file():
        raise RuntimeError("当前 schema 正式模型包尚未生成")
    shutil.rmtree(ARTIFACT_ROOT, ignore_errors=True)
    ARTIFACT_ROOT.mkdir(parents=True)
    storage = CatalogStorage(DATABASE)
    storage.initialize()
    catalog = ModelCatalog(storage, ARTIFACT_ROOT)
    imported = import_current_schema_model_package(catalog, CURRENT_SCHEMA_PACKAGE_PATH)
    if imported["status"] != "completed" or not imported.get("defaultModelId"):
        raise RuntimeError(f"当前 schema 模型包初始化失败：{imported}")
    for model in catalog.registered_models():
        storage.set_model_share(model["modelId"], True, "e2e-admin")
    evidence = {
        "packageName": CURRENT_SCHEMA_PACKAGE_PATH.name,
        "import": imported,
    }
    (DATABASE.parent / "current-schema-model-bootstrap.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")


def _training_evaluation_datasets():
    """Seed deterministic mature/immature and legacy datasets without mocked APIs."""
    from jit_baseline import admission, datasets
    from jit_baseline.catalog_storage import CatalogStorage
    from jit_baseline.data import parse_source, sha256

    source = DATASET_ROOT / "model-evaluation-labeled.csv"
    source.parent.mkdir(parents=True, exist_ok=True)
    fields = ["commit_id", "author_date", "bugcount", "ns", "nd", "nf", "entropy",
              "la", "ld", "lt", "fix", "ndev", "age", "nuc", "exp", "rexp", "sexp"]
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    base = 1_600_000_000
    cohort = {
        "startEpochInclusive": base,
        "endEpochExclusive": base + 80 * 7 * 86_400,
        "addedLinesGreaterThan": None, "maxChurnInclusive": None,
        "maxFilesInclusive": None,
    }
    for index in range(80):
        epoch = base + index * 7 * 86_400
        writer.writerow({
            "commit_id": f"{index + 1:040x}", "author_date": str(epoch),
            "bugcount": "1" if index % 2 else "0",
            "ns": str(1 + index % 3), "nd": str(1 + index % 2),
            "nf": str(1 + index % 4), "entropy": f"{0.2 + index / 100:.2f}",
            "la": str(1 + index), "ld": str(1 + index % 5),
            "lt": str(2 + index), "fix": "0", "ndev": str(1 + index % 3),
            "age": str(1 + index % 20), "nuc": str(1 + index % 2),
            "exp": str(1 + index % 7), "rexp": str(1 + index % 9),
            "sexp": str(1 + index % 11),
        })
    source.write_text(stream.getvalue(), encoding="utf-8")

    manifest = datasets.register(
        source, schema="kamei14-git-v1", dataset="model-evaluation-labeled",
        root=DATASET_ROOT, cohort=cohort,
        provenance={"publisher": "e2e-fixture", "revision": "a" * 40,
                    "url": "https://github.com/example/model-evaluation"},
    )
    records, _ = parse_source(source.read_bytes(), "kamei14-git-v1", cohort)
    observed = max(record["epoch"] for record in records) + 10 * 86_400
    status = admission.build_status(records, observed, 90)
    status_blob = admission.status_bytes(status)
    status_digest = hashlib.sha256(status_blob).hexdigest()
    status_path = DATASET_ROOT / "model-evaluation-labeled-status.jsonl"
    status_path.write_bytes(status_blob)
    status_meta = {
        "path": datasets.manifest_relative(status_path),
        "sha256": status_digest,
        "records": len(status),
        "rule": admission.STATUS_RULE,
    }
    labeling = admission.declaration(
        label_rule="szz-full-v1",
        sample_window={"since": None, "until": None, "startEpoch": None, "endEpoch": None},
        observation_window={"fromEpoch": None, "throughEpoch": observed, "through": None},
        observed_through=observed, maturity_days=90,
        revision="a" * 40, revision_epoch=observed,
        history_status="complete",
        coverage={"complete": True, "truncated": False, "historyBounded": False,
                  "unresolvedRanges": 0, "reason": None},
        entries=status, status_file=status_meta,
    )
    registry_manifest = Path(DATASET_ROOT) / manifest["dataset"] / f"{manifest['version']}.json"
    manifest_doc = json.loads(registry_manifest.read_text(encoding="utf-8"))
    manifest_doc["labeling"] = labeling
    manifest_doc["labelStatusFile"] = status_meta
    manifest_doc["label"] = {
        "version": "szz-full-v1",
        "observedThrough": observed,
        "maturityDays": 90,
        "statusCounts": {
            "positive": sum(item["evidenceStatus"] == "positive" for item in status),
            "unobserved": sum(item["evidenceStatus"] == "unobserved"
                              and item["maturityStatus"] == "mature" for item in status),
            "immature": sum(item["maturityStatus"] == "immature" for item in status),
            "unrecorded": 0,
        },
    }
    registry_manifest.write_text(
        json.dumps(manifest_doc, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    manifest_doc["manifestPath"] = datasets.manifest_relative(registry_manifest)

    legacy_source = DATASET_ROOT / "model-evaluation-legacy.csv"
    legacy_source.write_text(stream.getvalue(), encoding="utf-8")
    legacy = datasets.register(
        legacy_source, schema="kamei14-git-v1", dataset="model-evaluation-legacy",
        root=DATASET_ROOT, cohort=cohort,
    )
    legacy_records, _ = parse_source(legacy_source.read_bytes(), "kamei14-git-v1", cohort)
    legacy_manifest_path = Path(legacy["path"])
    if not legacy_manifest_path.is_absolute():
        legacy_manifest_path = BACKEND / legacy_manifest_path
    legacy_manifest = json.loads(legacy_manifest_path.read_text(encoding="utf-8"))
    legacy_manifest["manifestPath"] = datasets.manifest_relative(legacy_manifest_path)

    storage = CatalogStorage(DATABASE)
    storage.initialize()
    storage.import_dataset(manifest_doc, records)
    storage.import_dataset(legacy_manifest, legacy_records)
    storage.set_dataset_share(manifest["version"], True, "e2e-admin")
    storage.set_dataset_share(legacy["version"], True, "e2e-admin")
    evidence = {
        "labeledDatasetVersion": manifest["version"],
        "legacyDatasetVersion": legacy["version"],
        "statusCounts": {
            name: sum(item["maturityStatus"] == name or item["evidenceStatus"] == name
                      for item in status)
            for name in ("positive", "unobserved", "immature")
        },
        "sourceSha256": sha256(source.read_bytes()),
    }
    (DATABASE.parent / "training-evaluation-datasets.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")


def _seed_prediction_dataset(storage):
    """Shared, mature-labeled six-field data for the prediction browser journey."""
    from jit_baseline import datasets
    from jit_baseline.data import parse_source

    csv_path = DATASET_ROOT / PREDICTION_DATASET / "prediction.csv"
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    rows = ["commit_id,author_date,bugcount,ns,nd,nf,ent,la,ld"]
    for index in range(12):
        epoch = 1704067200 + index * 86400
        label = index % 2
        commit_id = f"{index + 1:014x}" + "0" * 26
        rows.append(
            f"{commit_id},{epoch},{label},{index + 1},{index % 3 + 1},"
            f"{index % 2 + 1},{0.2 + index / 20:.2f},{index + 2},1"
        )
    csv_path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    registered = datasets.register(
        csv_path, schema="openstack-six-v1", dataset=PREDICTION_DATASET,
        version=PREDICTION_VERSION, root=DATASET_ROOT,
        cohort={
            "startEpochInclusive": 1704067200,
            "endEpochExclusive": 1705104000,
            "addedLinesGreaterThan": 0,
            "maxChurnInclusive": 10000,
            "maxFilesInclusive": 100,
        },
    )
    manifest = datasets.load_all(DATASET_ROOT)[PREDICTION_VERSION]
    records, _quality = parse_source(
        csv_path.read_bytes(), "openstack-six-v1", manifest["cohort"],
    )
    storage.import_dataset(manifest, records)
    storage.set_dataset_share(PREDICTION_VERSION, True, "e2e-admin")
    with storage.connection(write=True) as db:
        db.execute(
            "UPDATE dataset_record SET observed_through=?,maturity_days=0 "
            "WHERE dataset_version=?",
            (2000000000, PREDICTION_VERSION),
        )
    evidence = {
        "datasetVersion": PREDICTION_VERSION,
        "registered": registered,
        "records": len(records),
        "positives": sum(record["label"] for record in records),
    }
    (DATABASE.parent / "prediction-dataset.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8",
    )


def main():
    DATABASE.unlink(missing_ok=True)
    shutil.rmtree(ARTIFACT_ROOT, ignore_errors=True)
    shutil.rmtree(DATASET_ROOT, ignore_errors=True)
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    shutil.copytree(BACKEND / "data" / "datasets", DATASET_ROOT)
    if CURRENT_SCHEMA_MODE:
        _current_schema_setup()
        uvicorn.run("jit_baseline.api:app", host="127.0.0.1", port=int(sys.argv[1]), workers=1)
        return
    if BUNDLED_MODEL_MODE:
        _bundled_model_setup()
        uvicorn.run("jit_baseline.api:app", host="127.0.0.1", port=int(sys.argv[1]), workers=1)
        return
    for name in MODELS:
        shutil.copytree(BACKEND / "artifacts" / name, ARTIFACT_ROOT / name)
    if EXPERIMENT_MODE:
        suite = ARTIFACT_ROOT / "suites" / "e2e"
        shutil.copytree(ARTIFACT_ROOT / "baseline", suite / "logistic-regression-l2-v1")
        benchmark = ARTIFACT_ROOT / "suites" / "e2e-offline" / "logistic-regression-l2-v1"
        shutil.copytree(
            BACKEND / "artifacts" / "suites" / "jit-fine-kamei14" / "logistic-regression-l2-v1",
            benchmark,
        )
        (suite / "suite.json").write_text(json.dumps({
            "kind": "multi-dataset-suite",
            "dataset": "e2e-large-repo",
            "version": "e2e-v1",
            "schemaName": "kamei14-git-v1",
            "metricSet": "metric-set-v2",
            "status": "partial",
            "methods": [
                {"method": "logistic-regression-l2-v1", "status": "succeeded", "runId": "nested"},
                {"method": "decision-tree-v1", "status": "failed", "code": "MODEL_NOT_CONVERGED",
                 "message": "夹具失败方法"},
            ],
        }, ensure_ascii=False), encoding="utf-8")
        report_root = ARTIFACT_ROOT / "multi-project" / "e2e"
        report_root.mkdir(parents=True)
        (report_root / "multi-project-report.json").write_text("{}", encoding="utf-8")
    from jit_baseline.catalog import ModelCatalog
    from jit_baseline.catalog_storage import CatalogStorage

    if PACKAGE_MODE:
        _package_recovery_setup()
    else:
        storage = CatalogStorage(DATABASE)
        storage.initialize()
        catalog = ModelCatalog(storage, ARTIFACT_ROOT)
        if not EXPERIMENT_MODE:
            for name in MODELS:
                catalog.register_key(name)
    if not EXPERIMENT_MODE:
        # 用户端只显示本人或管理员显式开放的模型；隔离验收把夹具模型全部开放。
        storage = CatalogStorage(DATABASE)
        catalog = ModelCatalog(storage, ARTIFACT_ROOT)
        for model in catalog.registered_models():
            storage.set_model_share(model["modelId"], True, "e2e-admin")
        if PREDICTION_MODE:
            _seed_prediction_dataset(storage)
    if TRAINING_EVALUATION_MODE:
        _training_evaluation_datasets()
    uvicorn.run("jit_baseline.api:app", host="127.0.0.1", port=int(sys.argv[1]), workers=1)


if __name__ == "__main__":
    main()
