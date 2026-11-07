"""Project trend partition labels are gated by exact model-run provenance."""
import shutil
from datetime import datetime
from uuid import uuid4

from jit_baseline.artifacts import read_json
from jit_baseline.catalog import ModelCatalog
from jit_baseline.catalog_storage import CatalogStorage, utc_now
from jit_baseline.collect import SCHEMA_NAME
from jit_baseline.project_trends import ProjectTrendService
from jit_baseline.sync import SyncService
from test_artifacts import real_run  # noqa: F401


def _repository(sync):
    return sync.create_repository(
        {"repositoryUrl": f"https://github.com/example/trend-{uuid4().hex}"})[0]


def _source(sync, repository, *, model_id, run_id, dataset_version, strategy):
    sync_id, now = str(uuid4()), utc_now()
    sync.sync.create({
        "id": sync_id, "repository_url": repository["url"],
        "repository_id": repository["repositoryId"], "branch": "main",
        "since": "2000-01-01T00:00:00+00:00", "until": "2030-01-01T00:00:00+00:00",
        "commit_limit": 500, "requested_strategy": "generic-model",
        "status": "scoring", "stage": "scoring", "model_strategy": strategy,
        "created_at": now, "updated_at": now,
    })
    return sync_id


def _complete(sync, repository, sync_id, rows, *, model_id, run_id, dataset_version, strategy):
    sync.sync.complete(
        sync_id, repository["repositoryId"], rows,
        head_commit="a" * 40, dataset_version=dataset_version,
        run_id=run_id, model_id=model_id, analysis_branch="main",
        feature_schema_version=SCHEMA_NAME,
    )
    sync.sync.update(sync_id, model_strategy=strategy)


def _row(commit_id, time, risk=0.5):
    epoch = int(datetime.fromisoformat(time.replace("Z", "+00:00")).timestamp())
    return {
        "id": commit_id, "epoch": epoch, "risk": risk, "addedLines": 10,
        "deletedLines": 2, "files": 1,
        "features": {name: 1 for name in (
            "ns", "nd", "nf", "entropy", "la", "ld", "lt", "fix", "ndev",
            "age", "nuc", "exp", "rexp", "sexp")},
        "filePaths": ["src/a.py"], "label": 0, "subject": "fixture",
        "authorName": "fixture",
    }


def _catalog_run(tmp_path, real_run):  # noqa: F811
    storage = CatalogStorage(tmp_path / "catalog.sqlite3")
    storage.initialize()
    root = tmp_path / "artifacts"
    shutil.copytree(real_run, root / "baseline")
    catalog = ModelCatalog(storage, root)
    catalog.register_key("baseline")
    return storage, catalog, catalog.models()[0]


def test_same_project_training_run_exposes_verified_partition_labels(tmp_path, real_run):  # noqa: F811
    storage, catalog, model = _catalog_run(tmp_path, real_run)
    sync = SyncService(storage, catalog, dataset_root=tmp_path / "datasets",
                       artifact_root=catalog.root, collect_fn=lambda *args, **kwargs: None)
    repository = _repository(sync)
    directory = catalog.model_directory(model["modelId"])
    split = read_json(directory / "split.json")
    summary = read_json(directory / "summary.json")
    rows = [
        _row(split["partitions"][name]["ids"][0], summary["split"][name]["start"])
        for name in ("train", "validation", "test")
    ]
    cutoff = int(datetime.fromisoformat(
        summary["split"]["test"]["end"].replace("Z", "+00:00")).timestamp())
    unseen = _row("f" * 40, datetime.fromtimestamp(cutoff + 1).isoformat())
    rows.append(unseen)
    sync_id = _source(
        sync, repository, model_id=model["modelId"], run_id=model["runId"],
        dataset_version=summary["datasetVersion"], strategy="repository-trained")
    _complete(
        sync, repository, sync_id, rows, model_id=model["modelId"],
        run_id=model["runId"], dataset_version=summary["datasetVersion"],
        strategy="repository-trained")
    trends = ProjectTrendService(sync)
    view = trends.create(repository["repositoryId"], {
        "start": "2000-01-01", "end": "2030-01-01", "grain": "month",
    })
    assert view["partitionCoverage"]["status"] == "verified"
    assert view["partitionCoverage"]["preset"] == "temporal-70-15-15"
    counts = {name: 0 for name in (
        "train", "validation", "test", "recentUnseen", "unknown")}
    for bucket in view["buckets"]:
        for name, value in bucket["partitions"].items():
            counts[name] += value
    assert counts == {"train": 1, "validation": 1, "test": 1,
                      "recentUnseen": 1, "unknown": 0}
    commits = trends.commits(repository["repositoryId"], view["viewId"], limit=10)
    assert {item["partition"] for item in commits["commits"]} == {
        "train", "validation", "test", "recent-unseen"}


def test_external_and_missing_lineage_are_not_guessed(tmp_path):
    storage = CatalogStorage(tmp_path / "catalog.sqlite3")
    storage.initialize()
    catalog = ModelCatalog(storage, tmp_path / "artifacts")
    sync = SyncService(storage, catalog, dataset_root=tmp_path / "datasets",
                       artifact_root=catalog.root, collect_fn=lambda *args, **kwargs: None)
    for model_id, strategy, expected in (
            ("external-model", "generic-model", "external"),
            ("legacy-locally-trained", "repository-trained", "unknown")):
        repository = _repository(sync)
        sync_id = _source(
            sync, repository, model_id=model_id, run_id=f"run-{model_id}",
            dataset_version=f"dataset-{model_id}", strategy=strategy)
        _complete(
            sync, repository, sync_id, [_row("a" * 40, "2026-01-02T00:00:00Z")],
            model_id=model_id, run_id=f"run-{model_id}",
            dataset_version=f"dataset-{model_id}", strategy=strategy)
        view = ProjectTrendService(sync).create(repository["repositoryId"], {
            "start": "2026-01-01", "end": "2026-02-01", "grain": "week",
        })
        assert view["partitionCoverage"]["status"] == expected
        assert view["buckets"][0]["partitions"] == {
            "train": 0, "validation": 0, "test": 0,
            "recentUnseen": 0, "unknown": 1,
        }
