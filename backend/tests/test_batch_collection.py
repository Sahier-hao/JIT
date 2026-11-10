"""多仓库批处理：内容身份幂等、阶段持久化、失败隔离与恢复。"""
import json

import pytest

from jit_baseline import batch_collection
from jit_baseline.batch_collection import BatchCollection
from jit_baseline.data import BaselineError


def _task(repo, **extra):
    return {"repo": repo, **extra}


def _collector(calls, *, failing=(), manifest_quality=None):
    def collect(repo, **kwargs):
        calls.append((repo, kwargs))
        if repo in failing:
            raise BaselineError("COLLECT_FAILED", f"注入的采集失败：{repo}")
        return {"records": 12, "csv": {"path": f"/tmp/{repo}.csv"},
                "dataset": {"version": f"dataset-{repo}", "path": f"datasets/{repo}.json"}}
    return collect


@pytest.fixture
def manifest_quality(monkeypatch):
    quality = {"includedRows": 10, "positiveLabels": 3, "rawRows": 12}
    monkeypatch.setattr(batch_collection, "load_manifest",
                        lambda path: {"version": path.stem, "quality": quality})
    return quality


def test_same_manifest_returns_same_batch(tmp_path, manifest_quality):
    calls = []
    service = BatchCollection(tmp_path / "state", dataset_root=tmp_path / "datasets",
                              collector=_collector(calls))
    tasks = [_task("https://example.com/a"), _task("https://example.com/b", szz="line")]
    first, created = service.create(tasks)
    second, again = service.create(list(tasks))
    assert created is True and again is False
    assert first["batchId"] == second["batchId"]
    assert first["contentKey"] == second["contentKey"]
    assert service.create([_task("https://example.com/a")], register=False)[0]["batchId"] != first["batchId"]


def test_run_persists_stage_and_records_dataset_identity(tmp_path, manifest_quality):
    calls = []
    service = BatchCollection(tmp_path / "state", dataset_root=tmp_path / "datasets",
                              collector=_collector(calls))
    state, _ = service.create([_task("https://example.com/a")])
    done = service.run(state["batchId"])
    assert done["repos"][0]["stage"] == "completed"
    assert done["repos"][0]["datasetVersion"] == "a"  # 以登记描述文件的版本为准
    assert done["repos"][0]["includedRows"] == 10
    assert done["repos"][0]["positiveLabels"] == 3
    # 状态落盘后可重新读取，再跑不会重复采集。
    reloaded = service.load(state["batchId"])
    assert reloaded["repos"][0]["stage"] == "completed"
    service.run(state["batchId"])
    assert len(calls) == 1


def test_failure_is_isolated_and_retry_only_reruns_failed(tmp_path, manifest_quality):
    calls = []
    failing = {"https://example.com/b"}
    service = BatchCollection(tmp_path / "state", dataset_root=tmp_path / "datasets",
                              collector=_collector(calls, failing=failing))
    state, _ = service.create([_task("https://example.com/a"), _task("https://example.com/b"),
                               _task("https://example.com/c")])
    first = service.run(state["batchId"])
    assert [entry["stage"] for entry in first["repos"]] == ["completed", "failed", "completed"]
    assert first["repos"][1]["errorCode"] == "COLLECT_FAILED"
    assert BatchCollection.summary(first)["status"] == "partial"
    assert len(calls) == 3

    failing.clear()
    second = service.run(state["batchId"], retry_failed=True)
    assert [entry["stage"] for entry in second["repos"]] == ["completed"] * 3
    assert second["repos"][1]["attempts"] == 2
    assert [repo for repo, _ in calls] == [
        "https://example.com/a", "https://example.com/b", "https://example.com/c",
        "https://example.com/b",
    ]
    assert BatchCollection.summary(second)["status"] == "completed"


def test_interrupted_run_resumes_without_repeating_finished_repos(tmp_path, manifest_quality):
    calls = []
    service = BatchCollection(tmp_path / "state", dataset_root=tmp_path / "datasets",
                              collector=_collector(calls))
    state, _ = service.create([_task("https://example.com/a"), _task("https://example.com/b")])
    interrupted = service.run(state["batchId"], max_repos=1)
    assert [entry["stage"] for entry in interrupted["repos"]] == ["completed", "pending"]
    resumed = service.run(state["batchId"])
    assert [entry["stage"] for entry in resumed["repos"]] == ["completed", "completed"]
    assert [repo for repo, _ in calls] == ["https://example.com/a", "https://example.com/b"]
    assert resumed["repos"][0]["attempts"] == 1


def test_cancel_stops_later_repos_and_is_idempotent(tmp_path, manifest_quality):
    calls = []
    service = BatchCollection(tmp_path / "state", dataset_root=tmp_path / "datasets",
                              collector=_collector(calls))
    state, _ = service.create([_task("https://example.com/a"), _task("https://example.com/b")])
    service.cancel(state["batchId"])
    after = service.run(state["batchId"])
    assert [entry["stage"] for entry in after["repos"]] == ["cancelled", "cancelled"]
    assert calls == []
    again = service.cancel(state["batchId"])
    assert again["cancelledAt"] == after["cancelledAt"]


def test_cancel_check_between_repos(tmp_path, manifest_quality):
    calls, flags = [], []

    def collector(repo, **kwargs):
        calls.append(repo)
        flags.append(True)
        return {"records": 1, "dataset": {"version": f"dataset-{repo}"}}

    service = BatchCollection(tmp_path / "state", dataset_root=tmp_path / "datasets",
                              collector=collector)
    state, _ = service.create([_task("https://example.com/a"), _task("https://example.com/b")])
    stopped = service.run(state["batchId"], cancel_check=lambda: len(calls) >= 1)
    assert calls == ["https://example.com/a"]
    assert [entry["stage"] for entry in stopped["repos"]] == ["completed", "cancelled"]
    assert stopped["cancelledAt"] is not None


def test_duplicate_tasks_and_unknown_batch_are_rejected(tmp_path):
    service = BatchCollection(tmp_path / "state", dataset_root=tmp_path / "datasets",
                              collector=_collector([]))
    with pytest.raises(BaselineError) as duplicate:
        service.create([_task("https://example.com/a"), _task("https://example.com/a")])
    assert duplicate.value.code == "INPUT_INVALID"
    with pytest.raises(BaselineError) as unknown:
        service.load("no-such-batch")
    assert unknown.value.code == "BATCH_UNKNOWN"
    with pytest.raises(BaselineError):
        service.create([{"repo": "", "branch": "main"}])
    with pytest.raises(BaselineError):
        service.create([{"repo": "x", "unexpected": 1}])


def test_state_file_is_reloadable_json(tmp_path, manifest_quality):
    service = BatchCollection(tmp_path / "state", dataset_root=tmp_path / "datasets",
                              collector=_collector([]))
    state, _ = service.create([_task("https://example.com/a")])
    path = tmp_path / "state" / f"{state['batchId']}.json"
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["format"] == batch_collection.FORMAT
    assert saved["repos"][0]["stage"] == "pending"
