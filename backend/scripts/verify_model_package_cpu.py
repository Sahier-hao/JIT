"""Import a model package into an isolated catalog and load every model on CPU."""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jit_baseline.catalog import ModelCatalog
from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.model_packages import import_model_package, inspect_model_package


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    inspected = inspect_model_package(args.package)
    with tempfile.TemporaryDirectory(prefix="jit-package-cpu-") as temporary:
        root = Path(temporary)
        storage = CatalogStorage(root / "catalog.sqlite3")
        storage.initialize()
        catalog = ModelCatalog(storage, root / "artifacts")
        imported = import_model_package(catalog, args.package)
        loaded = []
        for item in imported["items"]:
            if not item.get("modelId") or item["status"] not in {
                    "registered", "reused", "already-registered"}:
                continue
            snapshot, payload = catalog.load_model(item["modelId"])
            loaded.append({
                "modelId": item["modelId"],
                "artifactRunId": payload["artifactRunId"],
                "schema": snapshot.schema.name,
                "method": payload.get("method"),
                "cpuLoaded": True,
            })
        result = {
            "kind": "model-package-cpu-import-verification",
            "package": {
                "path": args.package.resolve().as_posix(),
                "sha256": inspected["packageSha256"],
                "modelCount": inspected["modelCount"],
                "fileCount": inspected["fileCount"],
                "uncompressedBytes": inspected["uncompressedBytes"],
            },
            "importStatus": imported["status"],
            "registeredCount": imported["registeredCount"],
            "failedCount": imported["failedCount"],
            "loadedModels": loaded,
            "passed": (
                imported["status"] == "completed"
                and len(loaded) == inspected["modelCount"]
            ),
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "passed": result["passed"],
        "importStatus": result["importStatus"],
        "loaded": len(loaded),
        "output": str(args.output),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
