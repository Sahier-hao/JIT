"""Collection-only dataset jobs stay separate from project analysis and models."""
import io
import time
import csv
from fastapi.testclient import TestClient

from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.dataset_builds import DatasetBuildService
from jit_baseline.sync import SyncService
from jit_baseline import datasets
from jit_baseline.api import create_app


URL = "https://github.com/example/dataset-build"


def _csv_bytes():
    stream = io.StringIO()
    fields = ["commit_id", "author_date", "bugcount", "ns", "nd", "nf", "entropy",
              "la", "ld", "lt", "fix", "ndev", "age", "nuc", "exp", "rexp", "sexp"]
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    for index, epoch in enumerate((1_350_000_000, 1_350_086_400, 1_350_172_800)):
        writer.writerow({
            "commit_id": f"{index:040x}", "author_date": str(epoch),
            "bugcount": str(index % 2), "ns": "1", "nd": "1", "nf": "1",
            "entropy": "0.5", "la": str(index + 1), "ld": "1", "lt": "10",
            "fix": "0", "ndev": "1", "age": "1", "nuc": "1", "exp": "1",
            "rexp": "1", "sexp": "1",
        })
    return stream.getvalue().encode()


def collected(*args, **kwargs):
    records = [
        {"id": f"{index:040x}", "epoch": epoch,
         "time": f"2012-10-{index + 1:02d}T00:00:00Z", "label": index % 2}
        for index, epoch in enumerate((1_350_000_000, 1_350_086_400, 1_350_172_800))
    ]
    return {
        "rawRecords": records,
        "blob": _csv_bytes(),
        "collection": {
            "repository": {"head": "f" * 40, "branch": "main", "resolvedBranch": "main"},
            "window": {"since": "2012-01-01T00:00:00+00:00",
                       "until": "2013-01-01T00:00:00+00:00"},
            "szz": {"rule": "szz-simple-v1"},
            "limitations": ["fixture"],
        },
    }


def wait_for(test, timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = test()
        if value:
            return value
        time.sleep(0.02)
    raise AssertionError("dataset build did not finish")


def harness(tmp_path):
    storage = CatalogStorage(tmp_path / "catalog.sqlite3")
    storage.initialize()
    sync = SyncService(
        storage, dataset_root=tmp_path / "datasets", artifact_root=tmp_path / "artifacts",
        allow_local=True, collect_fn=collected)
    repository, _ = sync.create_repository({"repositoryUrl": URL})
    service = DatasetBuildService(
        storage, tmp_path / "datasets", allow_local=True, collect_fn=collected)
    return storage, sync, repository, service


def test_build_returns_only_dataset_and_reuses_identical_content(tmp_path):
    storage, sync, repository, service = harness(tmp_path)
    try:
        first, created = service.create(
            repository["repositoryId"],
            {"branch": "main", "since": "2012-01-01", "until": "2013-01-01"},
            created_by="project",
        )
        assert created is True
        done = wait_for(lambda: (lambda item: item if item["status"] == "completed" else None)(
            service.get(repository["repositoryId"], first["taskId"])))
        assert done["datasetVersion"].startswith("kamei14-git-v2-")
        assert done["quality"]["includedRows"] == 3
        assert done["reused"] is False
        with storage.connection() as db:
            assert db.execute("SELECT COUNT(*) FROM repository_sync").fetchone()[0] == 0
            assert db.execute("SELECT COUNT(*) FROM model_version").fetchone()[0] == 0
            assert db.execute("SELECT view_sync_id FROM repository WHERE id=?",
                              (repository["repositoryId"],)).fetchone()[0] is None

        second, _ = service.create(
            repository["repositoryId"],
            {"branch": "main", "since": "2012-01-01", "until": "2013-01-01"},
            created_by="project",
        )
        repeated = wait_for(lambda: (lambda item: item
                                     if item["status"] == "completed" else None)(
            service.get(repository["repositoryId"], second["taskId"])))
        assert repeated["datasetVersion"] == done["datasetVersion"]
        assert repeated["reused"] is True
    finally:
        service.close()
        sync.close()


def test_same_active_request_is_reused_and_can_be_cancelled(tmp_path):
    storage, sync, repository, service = harness(tmp_path)
    release = __import__("threading").Event()
    service._executor.submit(release.wait)
    try:
        first, created = service.create(
            repository["repositoryId"], {"branch": "main"}, created_by="project")
        again, created_again = service.create(
            repository["repositoryId"], {"branch": "main"}, created_by="project")
        assert created and not created_again
        assert first["taskId"] == again["taskId"]
        cancelled = service.cancel(repository["repositoryId"], first["taskId"])
        assert cancelled["status"] == "cancelled"
        assert cancelled["error"]["code"] == "DATASET_BUILD_CANCELLED"
    finally:
        release.set()
        service.close()
        sync.close()


def test_project_api_creates_and_reads_only_a_bound_dataset_task(tmp_path):
    storage = CatalogStorage(tmp_path / "catalog.sqlite3")
    storage.initialize()
    registry = tmp_path / "datasets"
    source = tmp_path / "fixture.csv"
    source.write_bytes(_csv_bytes())
    registered = datasets.register(
        source, schema="kamei14-git-v2", dataset="fixture",
        root=registry,
        provenance={"publisher": "fixture", "revision": "a" * 40, "url": URL},
    )
    sync = SyncService(
        storage, dataset_root=registry, artifact_root=tmp_path / "artifacts",
        allow_local=True, collect_fn=collected)
    repository, _ = sync.create_repository({"repositoryUrl": URL})
    service = DatasetBuildService(
        storage, registry, allow_local=True, collect_fn=collected)
    app = create_app(database=storage.path, artifact_root=tmp_path / "artifacts",
                     dataset_root=registry, sync_service=sync,
                     dataset_build_service=service)
    try:
        with TestClient(app) as client:
            response = client.post(
                f"/api/v1/repositories/{repository['repositoryId']}/dataset-builds",
                json={"branch": "main", "since": "2012-01-01", "until": "2013-01-01"},
            )
            assert response.status_code == 202, response.text
            task_id = response.json()["taskId"]
            done = wait_for(lambda: (lambda body: body
                                     if body["status"] == "completed" else None)(
                client.get(
                    f"/api/v1/repositories/{repository['repositoryId']}/dataset-builds/{task_id}"
                ).json()
                if client.get(
                    f"/api/v1/repositories/{repository['repositoryId']}/dataset-builds/{task_id}"
                ).status_code == 200 else None))
            assert done["datasetVersion"] != registered["version"]
            listed = client.get(
                f"/api/v1/repositories/{repository['repositoryId']}/dataset-builds"
            ).json()
            assert listed["total"] == 1
            rejected = client.post(
                f"/api/v1/repositories/{repository['repositoryId']}/dataset-builds",
                json={"repositoryUrl": "https://github.com/example/other"},
            )
            assert rejected.status_code == 422
            assert rejected.json()["error"]["code"] == "INPUT_INVALID"
    finally:
        service.close()
        sync.close()
