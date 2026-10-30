"""Private process entrypoint for one persistent training task."""
import json
import sys
import tempfile


def main():
    payload = json.load(sys.stdin)
    tempfile.tempdir = payload["workRoot"]
    from .catalog import ModelCatalog
    from .catalog_storage import CatalogStorage
    from .training_tasks import TrainingTaskService

    storage = CatalogStorage(payload["database"])
    service = TrainingTaskService(
        storage,
        ModelCatalog(storage, payload["artifactRoot"]),
        artifact_root=payload["artifactRoot"],
    )
    try:
        service._run(payload["taskId"])
    finally:
        service._executor.shutdown(wait=True)


if __name__ == "__main__":
    main()
