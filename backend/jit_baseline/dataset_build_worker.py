"""Private process entrypoint for one collection-only dataset build."""
import json
import sys
import tempfile


def main():
    payload = json.load(sys.stdin)
    tempfile.tempdir = payload["workRoot"]
    from .catalog_storage import CatalogStorage
    from .dataset_builds import DatasetBuildService

    storage = CatalogStorage(payload["database"])
    service = DatasetBuildService(
        storage,
        payload["datasetRoot"] or None,
        allow_local=payload["allowLocal"],
    )
    try:
        service._run(payload["taskId"])
    finally:
        service._executor.shutdown(wait=True)


if __name__ == "__main__":
    main()
