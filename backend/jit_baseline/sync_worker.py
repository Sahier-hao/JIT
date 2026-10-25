"""Private process entrypoint. Receives paths, never credentials, over stdin."""
import json
import sys


def main():
    payload = json.load(sys.stdin)
    import tempfile
    tempfile.tempdir = payload['workRoot']
    from .catalog import ModelCatalog
    from .catalog_storage import CatalogStorage
    from .sync import SyncService
    storage = CatalogStorage(payload['database'])
    service = SyncService(storage, ModelCatalog(storage, payload['artifactRoot']),
                          dataset_root=payload['datasetRoot'], artifact_root=payload['artifactRoot'],
                          allow_local=payload['allowLocal'], timeout=payload['timeout'])
    # Recovery belongs to the service owner; never interrupt another queued task here.
    try:
        service._run(payload['syncId'])
    finally:
        service._executor.shutdown(wait=True)


if __name__ == '__main__':
    main()
