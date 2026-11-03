"""Fresh isolated backend for Playwright: reset catalog, seed models, then serve."""
import json
import hashlib
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
    changed.replace(mixed_package)
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


def main():
    DATABASE.unlink(missing_ok=True)
    shutil.rmtree(ARTIFACT_ROOT, ignore_errors=True)
    shutil.rmtree(DATASET_ROOT, ignore_errors=True)
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    shutil.copytree(BACKEND / "data" / "datasets", DATASET_ROOT)
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
    uvicorn.run("jit_baseline.api:app", host="127.0.0.1", port=int(sys.argv[1]), workers=1)


if __name__ == "__main__":
    main()
