"""Fresh isolated backend for Playwright: reset catalog, seed models, then serve."""
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


def main():
    DATABASE.unlink(missing_ok=True)
    shutil.rmtree(ARTIFACT_ROOT, ignore_errors=True)
    shutil.rmtree(DATASET_ROOT, ignore_errors=True)
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    shutil.copytree(BACKEND / "data" / "datasets", DATASET_ROOT)
    for name in MODELS:
        shutil.copytree(BACKEND / "artifacts" / name, ARTIFACT_ROOT / name)
    from jit_baseline.catalog import ModelCatalog
    from jit_baseline.catalog_storage import CatalogStorage

    storage = CatalogStorage(DATABASE)
    storage.initialize()
    catalog = ModelCatalog(storage, ARTIFACT_ROOT)
    for name in MODELS:
        catalog.register_key(name)
    uvicorn.run("jit_baseline.api:app", host="127.0.0.1", port=int(sys.argv[1]), workers=1)


if __name__ == "__main__":
    main()
