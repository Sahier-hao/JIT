"""项目分析口径：冻结成员分区、纳入规则与缺谱系降级。"""
import shutil
from datetime import datetime
from uuid import uuid4

from jit_baseline import model_lineage
from jit_baseline.analysis_scope import build_scope, partition_for, _included
from jit_baseline.artifacts import read_json, write_json
from jit_baseline.catalog import ModelCatalog
from jit_baseline.catalog_storage import CatalogStorage, utc_now
from jit_baseline.collect import SCHEMA_NAME
from jit_baseline.data import sha256
from jit_baseline.sync import SyncService
from test_artifacts import real_run  # noqa: F401


def _scope(status="verified", excluded=(), cutoff=400):
    return {
        "strategy": "repository-trained",
        "excludedCommitIds": list(excluded),
        "partitionCoverage": {"status": status, "holdoutCutoffEpoch": cutoff, "reason": None},
    }


LABELS = {"member-train": "train", "member-validation": "validation", "member-test": "test"}


def test_frozen_membership_wins_over_time_boundaries():
    """成员在训练段内外的真实位置由成员列表决定，不由时间边界推断。"""
    scope = _scope()
    assert partition_for(scope, "member-train", 999, LABELS) == "train"
    assert partition_for(scope, "member-validation", 50, LABELS) == "validation"
    assert partition_for(scope, "member-test", 50, LABELS) == "test"


def test_non_members_are_distinguished_by_reason():
    scope = _scope(excluded=("cleaned",), cutoff=400)
    assert partition_for(scope, "cleaned", 50, LABELS) == "excluded"
    assert partition_for(scope, "recent", 450, LABELS) == "holdout"
    assert partition_for(scope, "before-cutoff", 350, LABELS) == "notIncluded"
    assert partition_for(scope, "no-time", None, LABELS) == "unassigned"


def test_missing_lineage_is_unknown_and_never_labelled_training():
    unknown = _scope(status="unknown")
    assert partition_for(unknown, "member-train", 50, LABELS) == "unknown"
    assert partition_for(unknown, "cleaned", 50, {}) == "unknown"
    assert partition_for(_scope(status="unknown", excluded=("cleaned",)), "cleaned", 50) == "excluded"


def test_generic_model_has_no_training_partitions():
    assert partition_for({"strategy": "generic-model"}, "a", 50) == "scored"
    assert partition_for(None, "a", 50) == "unassigned"


def test_inclusion_matches_dataset_cohort_rules():
    assert _included({"added_lines": 10, "deleted_lines": 2, "files": 3,
                      "features_json": '{"ns":1,"nd":1,"nf":1,"entropy":0.2,"la":10,"ld":2,'
                                       '"lt":10,"fix":0,"ndev":1,"age":1,"nuc":1,"exp":1,'
                                       '"rexp":1,"sexp":1}'})
    assert not _included({"added_lines": 0, "deleted_lines": 2, "files": 3,
                          "features_json": "{}"})
    assert not _included({"added_lines": 10, "deleted_lines": 20000, "files": 3,
                          "features_json": "{}"})
    assert not _included({"added_lines": 10, "deleted_lines": 2, "files": 101,
                          "features_json": "{}"})


def _row(commit_id, time, risk=0.5, added=10, features=None):
    epoch = int(datetime.fromisoformat(time.replace("Z", "+00:00")).timestamp())
    return {
        "id": commit_id, "epoch": epoch, "risk": risk, "addedLines": added,
        "deletedLines": 2, "files": 1,
        "features": features if features is not None else {name: 1 for name in (
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
    model = catalog.register_key("baseline")["model"]
    return storage, catalog, model


def _complete_sync(tmp_path, storage, catalog, model, rows):
    sync = SyncService(storage, catalog, dataset_root=tmp_path / "datasets",
                       artifact_root=catalog.root, collect_fn=lambda *args, **kwargs: None)
    repository = sync.create_repository(
        {"repositoryUrl": f"https://github.com/example/scope-{uuid4().hex}"})[0]
    sync_id, now = str(uuid4()), utc_now()
    summary = read_json(catalog.model_directory(model["modelId"]) / "summary.json")
    sync.sync.create({
        "id": sync_id, "repository_url": repository["url"],
        "repository_id": repository["repositoryId"], "branch": "main",
        "since": "2000-01-01T00:00:00+00:00", "until": "2030-01-01T00:00:00+00:00",
        "commit_limit": 500, "requested_strategy": "generic-model",
        "status": "scoring", "stage": "scoring", "model_strategy": "repository-trained",
        "created_at": now, "updated_at": now,
    })
    sync.sync.complete(
        sync_id, repository["repositoryId"], rows, head_commit="a" * 40,
        dataset_version=summary["datasetVersion"], run_id=model["runId"],
        model_id=model["modelId"], analysis_branch="main",
        feature_schema_version=SCHEMA_NAME,
    )
    sync.sync.update(sync_id, model_strategy="repository-trained")
    return sync, sync_id


def test_build_scope_partitions_are_frozen_members_and_counts_conserve(tmp_path, real_run):  # noqa: F811
    storage, catalog, model = _catalog_run(tmp_path, real_run)
    directory = catalog.model_directory(model["modelId"])
    split = read_json(directory / "split.json")
    summary = read_json(directory / "summary.json")
    rows = [_row(split["partitions"][name]["ids"][0], summary["split"][name]["start"])
            for name in ("train", "validation", "test")]
    cutoff = int(datetime.fromisoformat(
        summary["split"]["test"]["end"].replace("Z", "+00:00")).timestamp())
    rows.append(_row("f" * 40, datetime.fromtimestamp(cutoff + 1).isoformat()))
    # 一个不满足纳入规则的提交：有变更但缺 14 维特征。
    rows.append(_row("c" * 40, "2012-06-01T00:00:00Z", features={}))
    sync, sync_id = _complete_sync(tmp_path, storage, catalog, model, rows)

    scope = build_scope(sync, sync.get(sync_id))
    assert scope["partitionCoverage"]["status"] == model_lineage.VERIFIED
    assert scope["split"]["preset"] == summary["splitPolicy"]["id"]
    assert scope["split"]["train"]["count"] == summary["split"]["train"]["count"]
    assert scope["split"]["test"]["count"] == summary["split"]["test"]["count"]
    assert scope["split"]["holdout"]["kind"] == "time-view"
    assert scope["split"]["holdout"]["count"] == 1
    labels = {"train": 1, "validation": 1, "test": 1, "holdout": 1,
              "excluded": 1, "notIncluded": 0, "unassigned": 0, "scored": 0, "unknown": 0}
    assert {name: scope["distributions"][name]["high"] + scope["distributions"][name]["medium"]
            + scope["distributions"][name]["low"] + scope["distributions"][name]["unknown"]
            for name in labels} == labels
    assert sum(scope["distributions"]["all"].values()) == len(rows)


def test_corrupt_split_membership_degrades_to_unknown(tmp_path, real_run):  # noqa: F811
    import shutil
    from jit_baseline.artifacts import identity
    root = tmp_path / "artifacts"
    shutil.copytree(real_run, root / "baseline")
    directory = root / "baseline"
    split = read_json(directory / "split.json")
    summary = read_json(directory / "summary.json")
    rows = [_row(split["partitions"]["test"]["ids"][0], summary["split"]["test"]["start"])]
    # 交付前改写成员但保留策略声明：登记时的完整性校验通过，
    # 成员摘要与策略不再一致，分区必须降级为未知。
    split["partitions"]["train"]["ids"] = split["partitions"]["train"]["ids"][1:]
    write_json(directory / "split.json", split)
    manifest = read_json(directory / "manifest.json")
    manifest["files"]["split.json"] = sha256((directory / "split.json").read_bytes())
    manifest["config"]["coreFiles"]["split.json"] = manifest["files"]["split.json"]
    manifest["runId"] = identity(manifest["config"])
    write_json(directory / "manifest.json", manifest)
    summary["runId"] = manifest["runId"]
    write_json(directory / "summary.json", summary)
    manifest["files"]["summary.json"] = sha256((directory / "summary.json").read_bytes())
    write_json(directory / "manifest.json", manifest)
    storage = CatalogStorage(tmp_path / "catalog.sqlite3")
    storage.initialize()
    catalog = ModelCatalog(storage, root)
    model = catalog.register_key("baseline")["model"]

    sync, sync_id = _complete_sync(tmp_path, storage, catalog, model, rows)
    scope = build_scope(sync, sync.get(sync_id))
    assert scope["partitionCoverage"]["status"] == model_lineage.UNKNOWN
    assert "切分成员" in scope["partitionCoverage"]["reason"]
    assert scope["split"] is None and scope["metrics"] is None
    assert scope["distributions"]["unknown"]["high"] == 1


def test_dataset_version_mismatch_is_unknown_not_guessed(tmp_path, real_run):  # noqa: F811
    storage, catalog, model = _catalog_run(tmp_path, real_run)
    summary = read_json(catalog.model_directory(model["modelId"]) / "summary.json")
    rows = [_row("a" * 40, "2012-06-01T00:00:00Z")]
    sync, sync_id = _complete_sync(tmp_path, storage, catalog, model, rows)
    with sync.sync.storage.connection(write=True) as db:
        db.execute("UPDATE repository_sync SET dataset_version=? WHERE id=?",
                   (summary["datasetVersion"] + "-other", sync_id))
    scope = build_scope(sync, sync.get(sync_id))
    assert scope["partitionCoverage"]["status"] == model_lineage.UNKNOWN
    assert scope["split"] is None
    assert scope["distributions"]["unknown"]["high"] == 1


def test_legacy_run_without_policy_uses_member_counts_not_guesses(tmp_path, real_run):  # noqa: F811
    """迁移 030 之前的运行没有策略摘要：成员仍由清单哈希保护，按分区计数核对。"""
    import shutil
    from jit_baseline.artifacts import identity
    root = tmp_path / "artifacts"
    shutil.copytree(real_run, root / "baseline")
    directory = root / "baseline"
    split = read_json(directory / "split.json")
    summary = read_json(directory / "summary.json")
    manifest = read_json(directory / "manifest.json")
    split.pop("policy", None)
    summary.pop("splitPolicy", None)
    manifest["config"].pop("splitPolicy", None)
    manifest["config"].pop("splitPreset", None)
    write_json(directory / "split.json", split)
    manifest["files"]["split.json"] = sha256((directory / "split.json").read_bytes())
    manifest["config"]["coreFiles"]["split.json"] = manifest["files"]["split.json"]
    manifest["runId"] = identity(manifest["config"])
    write_json(directory / "manifest.json", manifest)
    summary["runId"] = manifest["runId"]
    write_json(directory / "summary.json", summary)
    manifest["files"]["summary.json"] = sha256((directory / "summary.json").read_bytes())
    write_json(directory / "manifest.json", manifest)
    storage = CatalogStorage(tmp_path / "catalog.sqlite3")
    storage.initialize()
    catalog = ModelCatalog(storage, root)
    model = catalog.register_key("baseline")["model"]
    rows = [_row(split["partitions"]["test"]["ids"][0], summary["split"]["test"]["start"])]
    sync, sync_id = _complete_sync(tmp_path, storage, catalog, model, rows)

    scope = build_scope(sync, sync.get(sync_id))
    assert scope["partitionCoverage"]["status"] == model_lineage.VERIFIED
    assert scope["partitionCoverage"]["memberVerification"] == "counts"
    assert scope["partitionCoverage"]["preset"] is None
    assert scope["split"]["test"]["count"] == split["partitions"]["test"]["count"]
    assert scope["distributions"]["test"]["high"] == 1


def test_legacy_member_count_mismatch_is_unknown(tmp_path, real_run):  # noqa: F811
    import shutil
    from jit_baseline.artifacts import identity
    root = tmp_path / "artifacts"
    shutil.copytree(real_run, root / "baseline")
    directory = root / "baseline"
    split = read_json(directory / "split.json")
    summary = read_json(directory / "summary.json")
    manifest = read_json(directory / "manifest.json")
    split.pop("policy", None)
    summary.pop("splitPolicy", None)
    manifest["config"].pop("splitPolicy", None)
    manifest["config"].pop("splitPreset", None)
    split["partitions"]["train"]["count"] -= 1  # 成员数与声明不再一致
    write_json(directory / "split.json", split)
    manifest["files"]["split.json"] = sha256((directory / "split.json").read_bytes())
    manifest["config"]["coreFiles"]["split.json"] = manifest["files"]["split.json"]
    manifest["runId"] = identity(manifest["config"])
    write_json(directory / "manifest.json", manifest)
    summary["runId"] = manifest["runId"]
    write_json(directory / "summary.json", summary)
    manifest["files"]["summary.json"] = sha256((directory / "summary.json").read_bytes())
    write_json(directory / "manifest.json", manifest)
    storage = CatalogStorage(tmp_path / "catalog.sqlite3")
    storage.initialize()
    catalog = ModelCatalog(storage, root)
    model = catalog.register_key("baseline")["model"]
    sync, sync_id = _complete_sync(tmp_path, storage, catalog, model, [])
    scope = build_scope(sync, sync.get(sync_id))
    assert scope["partitionCoverage"]["status"] == model_lineage.UNKNOWN
    assert "计数" in scope["partitionCoverage"]["reason"]
