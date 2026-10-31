"""仓库同步训练截止时间：近期提交只打分、不进入训练分区（RCL-09）。

用注入的采集结果跑完整同步编排（采集结果 → 数据集登记 → 共享训练执行器 →
产物 → 打分与入库），而不是只测截止时间算得对不对。
"""
import json
import time
from pathlib import Path

from jit_baseline.catalog import ModelCatalog
from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.collect import _csv_bytes
from jit_baseline.schemas import resolve
from jit_baseline.sync import HOLDOUT_DAYS, SyncService

DAY = 86400
START = 1_700_000_000
NAMES = resolve("kamei14-git-v1").in_model_names()


def _records(count=310):
    """每天一条提交，每三天一个正例；时间递增且标签两类都有。"""
    records = []
    for index in range(count):
        epoch = START + index * DAY
        label = 1 if index % 3 == 0 else 0
        moment = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))
        records.append({
            "id": f"{index + 1:040x}", "epoch": epoch, "label": label,
            "time": moment, "subject": f"commit {index}", "authorName": "tester",
            "filePaths": ["a.py"], "metrics": {
                "ns": 1, "nd": 1, "nf": 1, "entropy": 0.5, "la": 2, "ld": 0, "lt": 1,
                "fix": label, "ndev": 1, "age": 1, "nuc": 1, "exp": 1, "rexp": 1, "sexp": 1,
            },
            "features": [1, 1, 1, 0.5, 2, 0, 1, label, 1, 1, 1, 1, 1, 1],
            "labelNote": None if label else "未观测到缺陷引入（简化 SZZ），不等于已证实无缺陷",
        })
    return records


def _collect(records):
    def collect(repo, *, since=None, until=None, branch="HEAD", limit=500,
                allow_local=False, return_blob=False):
        return {
            "blob": _csv_bytes(records, NAMES),
            "rawRecords": records,
            "collection": {
                "kind": "git-repository",
                "repository": {"path": repo, "head": records[-1]["id"], "branch": branch,
                               "resolvedBranch": "main"},
                "window": {"since": since, "until": until},
                "counts": {"records": len(records)},
            },
        }
    return collect


def _wait(service, sync_id, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        view = service.get(sync_id)
        if view["status"] in ("completed", "failed", "interrupted"):
            return view
        time.sleep(0.05)
    raise AssertionError(f"作业未在 {timeout} 秒内结束：{service.get(sync_id)}")


def test_sync_training_excludes_recent_commits_from_all_partitions(tmp_path):
    records = _records()
    store = CatalogStorage(tmp_path / "catalog.sqlite3")
    store.initialize()
    root = tmp_path / "artifacts"
    root.mkdir()
    catalog = ModelCatalog(store, root)
    service = SyncService(store, catalog, dataset_root=tmp_path / "datasets",
                          artifact_root=root, allow_local=True, timeout=180,
                          collect_fn=_collect(records))
    try:
        view, created = service.create({
            "repositoryUrl": "https://github.com/example/holdout", "branch": "main",
            "since": "2023-01-01", "until": "2024-12-31", "commitLimit": 500,
            "strategy": "force-train",
        }, request_id="holdout-test")
        assert created is True
        done = _wait(service, view["syncId"])
        assert done["status"] == "completed", done
        assert done["modelStrategy"] == "repository-trained"

        cutoff = records[-1]["epoch"] - HOLDOUT_DAYS * DAY
        artifact = Path(root) / f"repository-sync-{done['syncId'][:8]}"
        summary = json.loads((artifact / "summary.json").read_text(encoding="utf-8"))
        assert summary["holdout"]["epoch"] == cutoff
        assert summary["holdout"]["trainableRecords"] == sum(
            1 for record in records if record["epoch"] < cutoff)
        assert summary["holdout"]["trainableRecords"] == done["trainRecords"]

        partitioned = []
        for part in ("train", "validation", "test"):
            stat = summary["split"][part]
            assert stat["count"] > 0
            partitioned.append(stat)
        assert sum(stat["count"] for stat in partitioned) == summary["holdout"]["trainableRecords"]
        membership = json.loads((artifact / "split.json").read_text(encoding="utf-8"))["partitions"]
        member_ids = [identity for stat in membership.values() for identity in stat["ids"]]
        assert len(member_ids) == len(set(member_ids)) == summary["holdout"]["trainableRecords"]
        assert all(int(identity, 16) <= len(records) for identity in member_ids)
        epoch_by_id = {record["id"]: record["epoch"] for record in records}
        assert all(epoch_by_id[identity] < cutoff for identity in member_ids)

        # 近期提交仍获得本次模型分数，只是没有进入任何训练分区。
        scored = [record for record in records if record["epoch"] >= cutoff]
        assert scored
        stored, total = service.sync.commits(done["syncId"], 1000)
        assert total == len(records) == len(stored)
        assert {item["commitId"] for item in stored} >= {record["id"] for record in scored}
        assert all(item["risk"] is not None for item in stored)
    finally:
        service.close()


def test_all_recent_records_fail_instead_of_widening_training_window(tmp_path):
    records = _records(30)
    store = CatalogStorage(tmp_path / "catalog.sqlite3")
    store.initialize()
    root = tmp_path / "artifacts"
    root.mkdir()
    service = SyncService(store, ModelCatalog(store, root), dataset_root=tmp_path / "datasets",
                          artifact_root=root, allow_local=True, timeout=120,
                          collect_fn=_collect(records))
    try:
        view, _ = service.create({
            "repositoryUrl": "https://github.com/example/recent", "branch": "main",
            "since": "2023-01-01", "until": "2024-12-31", "commitLimit": 500,
            "strategy": "force-train",
        }, request_id="recent-test")
        done = _wait(service, view["syncId"])
        assert done["status"] == "failed"
        assert done["error"]["code"] == "SPLIT_INVALID"
        assert not (Path(root) / f"repository-sync-{done['syncId'][:8]}").exists()
        # 数据集仍按完整采集范围登记，供查询与后续选择，不被训练失败删除。
        assert done["datasetVersion"]
    finally:
        service.close()
