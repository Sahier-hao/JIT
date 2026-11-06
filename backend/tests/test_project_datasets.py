"""Project-scoped dataset projection and exports (DSR-09/10, FPR-01/14)."""
import csv
import io
import zipfile

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from jit_baseline import datasets, project_datasets
from jit_baseline.api import create_app
from jit_baseline.catalog import ModelCatalog
from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.sync import SyncService, utc_now

SYNC = '11111111-1111-4111-8111-111111111111'
OTHER_SYNC = '22222222-2222-4222-8222-222222222222'
REUSED_SYNC = '33333333-3333-4333-8333-333333333333'
URL = 'https://github.com/example/project'
OTHER_URL = 'https://github.com/example/other'


def _csv_bytes():
    stream = io.StringIO()
    fields = ["commit_id", "author_date", "bugcount", "fixcount", "ns", "nd", "nf", "ent", "la", "ld", "rexp"]
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerows([
        {"commit_id": "a" * 40, "author_date": "1350000000", "bugcount": "1",
         "fixcount": "0", "ns": "1", "nd": "2", "nf": "3", "ent": "0.7", "la": "4", "ld": "5", "rexp": "1"},
        {"commit_id": "b" * 40, "author_date": "1350086400", "bugcount": "0",
         "fixcount": "1", "ns": "2", "nd": "3", "nf": "2", "ent": "0.4", "la": "8", "ld": "1", "rexp": "2"},
    ])
    return stream.getvalue().encode()


@pytest.fixture
def project_dataset(tmp_path):
    registry = tmp_path / 'datasets'
    source = tmp_path / 'source.csv'
    source.write_bytes(_csv_bytes())
    registered = datasets.register(
        source, schema='openstack-six-v1', dataset='demo', root=registry,
        provenance={"publisher": "fixture", "revision": "a" * 40, "url": URL},
        extra={"usage": "branch", "sourceSyncId": SYNC, "collection": {
            "repository": {"path": str(tmp_path / 'internal-clone.git'), "branch": "main",
                           "resolvedBranch": "main", "head": "a" * 40},
        }},
    )
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    artifacts = tmp_path / 'artifacts'
    artifacts.mkdir()
    catalog = ModelCatalog(storage, artifacts)
    service = SyncService(storage, catalog, dataset_root=registry, artifact_root=artifacts,
                          allow_local=True, collect_fn=lambda *args, **kwargs: None)
    first = service.create_repository({"repositoryUrl": URL})[0]
    other = service.create_repository({"repositoryUrl": OTHER_URL})[0]
    now = utc_now()
    service.sync.create({
        "id": SYNC, "repository_url": first["url"], "repository_id": first["repositoryId"],
        "branch": "main", "requested_strategy": "generic-model", "status": "completed",
        "stage": "completed", "dataset_version": registered["version"], "source_kind": "branch",
        "created_at": now, "updated_at": now,
    })
    service.sync.create({
        "id": OTHER_SYNC, "repository_url": other["url"], "repository_id": other["repositoryId"],
        "branch": "main", "requested_strategy": "generic-model", "status": "failed",
        "stage": "failed", "dataset_version": registered["version"], "source_kind": "branch",
        "created_at": now, "updated_at": now,
    })
    service.sync.create({
        "id": REUSED_SYNC, "repository_url": first["url"], "repository_id": first["repositoryId"],
        "branch": "main", "requested_strategy": "generic-model", "status": "completed",
        "stage": "completed", "dataset_version": registered["version"], "source_kind": "branch",
        "created_at": now, "updated_at": now,
    })
    app = create_app(database=storage.path, artifact_root=artifacts,
                     dataset_root=registry, sync_service=service)
    with TestClient(app) as client:
        yield client, first, registry, source, registered
    service.close()


def _metadata_url(project):
    return f"/api/v1/repositories/{project['repositoryId']}/analyses/{SYNC}/dataset"


def test_metadata_is_scoped_and_excludes_internal_paths(project_dataset):
    client, project, _registry, source, registered = project_dataset
    response = client.get(_metadata_url(project))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["syncId"] == SYNC
    assert body["datasetId"] == "demo"
    assert body["version"] == registered["version"]
    assert body["schema"] == "openstack-six-v1"
    assert body["quality"]["includedRows"] == 2
    assert body["file"]["sha256"] == datasets.load_manifest(
        _registry / "demo" / f"{registered['version']}.json")["file"]["sha256"]
    assert str(source.parent) not in response.text
    assert "manifestPath" not in body
    assert client.get('/api/v1/datasets').status_code == 401


def test_cross_project_and_failed_analysis_are_rejected(project_dataset):
    client, project, _registry, _source, _registered = project_dataset
    wrong_project = client.get(
        f"/api/v1/repositories/{project['repositoryId']}/analyses/{OTHER_SYNC}/dataset")
    assert wrong_project.status_code == 404
    assert wrong_project.json()["error"]["code"] == "REPOSITORY_ANALYSIS_UNKNOWN"
    client.app.state.sync.sync.update(SYNC, status="failed")
    failed = client.get(_metadata_url(project))
    assert failed.status_code == 409
    assert failed.json()["error"]["code"] == "REPOSITORY_ANALYSIS_UNAVAILABLE"


def test_reused_dataset_version_can_be_read_by_a_later_analysis(project_dataset):
    client, project, _registry, _source, registered = project_dataset
    response = client.get(
        f"/api/v1/repositories/{project['repositoryId']}/analyses/{REUSED_SYNC}/dataset")
    assert response.status_code == 200, response.text
    assert response.json()["syncId"] == REUSED_SYNC
    assert response.json()["version"] == registered["version"]


def test_zip_contains_verified_files_and_portable_manifest(project_dataset):
    client, project, _registry, source, registered = project_dataset
    response = client.get(_metadata_url(project) + '/export/zip')
    assert response.status_code == 200, response.text
    assert response.headers['content-type'] == 'application/zip'
    manifest = datasets.load_manifest(_registry / "demo" / f"{registered['version']}.json")
    assert f"{registered['version']}-{manifest['file']['sha256'][:8]}.zip" in response.headers['content-disposition']
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
        assert 'source.csv' in names
        assert f"{registered['version']}.json" in names
        assert 'SHA256SUMS' in names
        manifest = __import__('json').loads(archive.read(f"{registered['version']}.json"))
        assert manifest['file']['path'] == 'source.csv'
        assert str(source.parent) not in archive.read(f"{registered['version']}.json").decode()
        sums = archive.read('SHA256SUMS').decode()
        assert f"{manifest['file']['sha256']}  source.csv" in sums


def test_xlsx_has_metadata_and_data_sheets(project_dataset):
    client, project, _registry, _source, registered = project_dataset
    response = client.get(_metadata_url(project) + '/export/xlsx')
    assert response.status_code == 200, response.text
    assert 'spreadsheetml' in response.headers['content-type']
    workbook = load_workbook(io.BytesIO(response.content), read_only=True)
    assert workbook.sheetnames == ['metadata', 'data']
    metadata = list(workbook['metadata'].values)
    data = list(workbook['data'].values)
    assert any(row[0] == '版本' and row[1] == registered['version'] for row in metadata)
    assert any(row[0] == 'CSV SHA-256' for row in metadata)
    assert data[0][0] == 'commit_id'
    assert len(data) == 3


def test_corrupt_or_missing_files_fail_before_download(project_dataset):
    client, project, registry, source, registered = project_dataset
    source.write_bytes(b'changed')
    broken = client.get(_metadata_url(project) + '/export/zip')
    assert broken.status_code == 503
    assert broken.json()['error']['code'] == 'DATASET_INTEGRITY_ERROR'
    source.unlink()
    missing = client.get(_metadata_url(project))
    assert missing.status_code == 503
    assert missing.json()['error']['code'] == 'DATASET_UNAVAILABLE'


def test_export_limits_return_actionable_errors(project_dataset, monkeypatch):
    client, project, _registry, _source, _registered = project_dataset
    monkeypatch.setattr(project_datasets, 'MAX_EXPORT_BYTES', 10)
    too_large = client.get(_metadata_url(project) + '/export/zip')
    assert too_large.status_code == 413
    assert too_large.json()['error']['code'] == 'DATASET_EXPORT_LIMIT_EXCEEDED'
    monkeypatch.setattr(project_datasets, 'MAX_EXPORT_BYTES', 64 * 1024 * 1024)
    monkeypatch.setattr(project_datasets, 'MAX_XLSX_ROWS', 1)
    too_many = client.get(_metadata_url(project) + '/export/xlsx')
    assert too_many.status_code == 413
    assert too_many.json()['error']['code'] == 'DATASET_EXPORT_LIMIT_EXCEEDED'


def test_arbitrary_dataset_or_export_format_is_rejected(project_dataset):
    client, project, _registry, _source, _registered = project_dataset
    invalid = client.get(_metadata_url(project) + '/export/csv')
    assert invalid.status_code == 422
    assert invalid.json()['error']['code'] == 'INPUT_INVALID'
