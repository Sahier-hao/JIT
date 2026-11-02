"""Fresh isolated backend for Playwright: reset catalog, seed models, then serve."""
import json
import os
import shutil
import sys
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

    storage = CatalogStorage(DATABASE)
    storage.initialize()
    catalog = ModelCatalog(storage, ARTIFACT_ROOT)
    if not EXPERIMENT_MODE:
        for name in MODELS:
            catalog.register_key(name)
    uvicorn.run("jit_baseline.api:app", host="127.0.0.1", port=int(sys.argv[1]), workers=1)


if __name__ == "__main__":
    main()
