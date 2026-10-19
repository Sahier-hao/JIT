"""仓库同步作业：创建校验、状态流转、降级、复用与重启恢复（RCL-07..RCL-09）。

端到端用本地临时 Git 仓库；样本不足时降级到目录里现成的 `openstack-six-v1` 模型，
这样离线也能跑完整链路。
"""

import shutil
import time

import pytest
from fastapi.testclient import TestClient

from test_end_to_end import _commit, _make_repo
from test_artifacts import real_run  # noqa: F401

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="系统缺少 git 命令")

HEADERS = {"Authorization": "Bearer fixture-member"}
HEADERS = {"Authorization": "Bearer fixture-admin"}
SINCE, UNTIL = "2024-01-01", "2025-01-01"
LINES = "\n".join(f"line {index}" for index in range(100)) + "\n"


@pytest.fixture
def harness(tmp_path, real_run):  # noqa: F811
    from jit_baseline.api import create_app
    from jit_baseline.catalog import ModelCatalog
    from jit_baseline.catalog_storage import CatalogStorage
    from jit_baseline.sync import SyncService

    store = CatalogStorage(tmp_path / "catalog.sqlite3")
    store.initialize()
    root = tmp_path / "artifacts"
    shutil.copytree(real_run, root / "baseline")
    catalog = ModelCatalog(store, root)
    catalog.register_key("baseline")
    service = SyncService(store, catalog, dataset_root=tmp_path / "datasets",
                          artifact_root=root, allow_local=True, timeout=180)
    app = create_app(database=store.path, artifact_root=root, sync_service=service)
    return {"app": app, "service": service, "store": store, "catalog": catalog,
            "root": root, "datasets": tmp_path / "datasets"}


def _small_repo(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    _commit(repo, "add module", {"pkg/a.py": LINES}, "2024-01-01T00:00:00+00:00")
    _commit(repo, "add helper", {"pkg/b.py": "helper\n" * 30}, "2024-01-02T00:00:00+00:00")
    _commit(repo, "fix: adjust module", {"pkg/a.py": "line 0 fixed\n" + LINES.split("\n", 1)[1]},
            "2024-01-03T00:00:00+00:00")
    _commit(repo, "add docs", {"README.md": "docs\n"}, "2024-01-04T00:00:00+00:00")
    _commit(repo, "fix: repair helper", {"pkg/b.py": "helper\n" * 39 + "fixed\n"},
            "2024-01-06T00:00:00+00:00")
    _commit(repo, "add util", {"pkg/c.py": "util\n" * 20}, "2024-01-07T10:00:00+00:00")
    _commit(repo, "fix: repair util", {"pkg/c.py": "util\n" * 19 + "fixed\n"},
            "2024-01-07T11:00:00+00:00")
    return repo


def _wait(service, sync_id, timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        view = service.get(sync_id)
        if view["status"] in ("completed", "failed", "interrupted"):
            return view
        time.sleep(0.05)
    raise AssertionError(f"作业未在 {timeout} 秒内结束：{service.get(sync_id)}")


def _create(harness, repo, **overrides):
    payload = {"repositoryUrl": str(repo), "branch": "HEAD", "since": SINCE, "until": UNTIL,
               "commitLimit": 500, "strategy": "auto"}
    payload.update(overrides)
    view, created = harness["service"].create(payload, request_id="test-request")
    assert created is True
    return view


def test_sync_degrades_to_generic_model_and_scores_commits(harness):
    repo = _small_repo(harness["root"].parent)
    view = _create(harness, repo)
    assert view["status"] in ("queued", "collecting")
    done = _wait(harness["service"], view["syncId"])

    assert done["status"] == "completed", done
    assert done["requestedStrategy"] == "auto"
    assert done["modelStrategy"] == "generic-model"
    assert done["degradeReason"] == "fewRecords"
    assert done["trainRecords"] < 200
    assert done["modelId"] and done["runId"] and done["datasetVersion"]
    assert done["datasetVersion"].startswith("kamei14-git-v1-")
    assert done["error"] is None

    with TestClient(harness["app"]) as client:
        listed = client.get("/api/v1/repository-syncs", headers=HEADERS).json()
        assert listed["total"] == 1 and listed["syncs"][0]["syncId"] == done["syncId"]
        commits = client.get(f"/api/v1/repository-syncs/{done['syncId']}/commits",
                             headers=HEADERS, params={"limit": 200}).json()
        assert commits["total"] == 7
        assert len(commits["commits"]) == 7
        risks = [item["risk"] for item in commits["commits"]]
        assert risks == sorted(risks, reverse=True)
        first = commits["commits"][0]
        assert set(first) == {"commitId", "epoch", "risk", "addedLines", "deletedLines",
                                  "files", "features", "label", "labelNote", "subject", "authorName"}
        assert len(first["features"]) == 14
        assert first["subject"]
        detail = client.get(f"/api/v1/repository-syncs/{done['syncId']}/commits/"
                            f"{first['commitId']}", headers=HEADERS).json()
        assert set(detail["features"]) >= {"ns", "nd", "nf", "entropy", "la", "ld"}
        assert detail["label"] in (0, 1)
        assert (detail["labelNote"] is None) == (detail["label"] == 1)
        assert client.get(f"/api/v1/repository-syncs/{done['syncId']}/commits/"
                          f"{'0' * 40}", headers=HEADERS).status_code == 404

        # 服务端过滤：搜索词、日期区间与排序都在列表接口里生效（任务 6.4）。
        base = f"/api/v1/repository-syncs/{done['syncId']}/commits"
        prefix = first["commitId"][:6]
        filtered = client.get(base, headers=HEADERS, params={"search": prefix}).json()
        assert filtered["total"] >= 1
        assert all(item["commitId"].startswith(prefix) for item in filtered["commits"])
        # 标识搜索与历史回放一致：中间片段也命中，不要求从开头匹配。
        middle = first["commitId"][8:14]
        fragment = client.get(base, headers=HEADERS, params={"search": middle}).json()
        assert fragment["total"] >= 1
        assert all(middle in item["commitId"] for item in fragment["commits"])
        by_time = client.get(base, headers=HEADERS,
                             params={"sort": "time", "limit": 200}).json()
        epochs = [item["epoch"] for item in by_time["commits"]]
        assert epochs == sorted(epochs, reverse=True)
        dated = client.get(base, headers=HEADERS,
                           params={"start": "2024-01-02", "end": "2024-01-03",
                                   "limit": 200}).json()
        assert 1 <= dated["total"] <= 2
        bad_sort = client.get(base, headers=HEADERS, params={"sort": "bogus"}).json()
        assert bad_sort["error"]["code"] == "INPUT_INVALID"
        bad_range = client.get(base, headers=HEADERS,
                               params={"start": "2024-01-03", "end": "2024-01-02"}).json()
        assert bad_range["error"]["code"] == "INPUT_INVALID"


@pytest.mark.parametrize("override,code", [
    ({"repositoryUrl": ""}, "INPUT_INVALID"),
    ({"repositoryUrl": "ssh://git@example.com/x.git"}, "REPOSITORY_UNAVAILABLE"),
    ({"repositoryUrl": "http://127.0.0.1/x.git"}, "REPOSITORY_UNAVAILABLE"),
    ({"commitLimit": 0}, "INPUT_INVALID"),
    ({"commitLimit": 5001}, "INPUT_INVALID"),
    ({"strategy": "train-maybe"}, "INPUT_INVALID"),
    ({"since": "2025-02-01", "until": "2025-01-01"}, "INPUT_INVALID"),
])
def test_invalid_input_never_creates_a_job(harness, override, code):
    payload = {"repositoryUrl": "https://example.com/x.git", "branch": "HEAD",
               "since": SINCE, "until": UNTIL, "commitLimit": 500, "strategy": "auto"}
    payload.update(override)
    with TestClient(harness["app"]) as client:
        response = client.post("/api/v1/repository-syncs", headers=HEADERS, json=payload)
        assert response.status_code in (422, 502), response.text
        assert response.json()["error"]["code"] == code
        assert client.get("/api/v1/repository-syncs", headers=HEADERS).json()["total"] == 0


def test_same_parameters_reuse_an_active_job(harness):
    from jit_baseline.sync import _window

    since, until = _window({"since": SINCE, "until": UNTIL})
    rows = [{"id": "sync-in-flight", "repository_url": "https://example.com/x.git",
             "branch": "HEAD", "since": since, "until": until, "commit_limit": 500,
             "requested_strategy": "auto", "status": "collecting", "stage": "collecting",
             "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00"}]
    harness["service"].sync.create(rows[0])
    again, created = harness["service"].create(
        {"repositoryUrl": "https://example.com/x.git", "branch": "HEAD", "since": SINCE,
         "until": UNTIL, "commitLimit": 500, "strategy": "auto"})
    assert created is False
    assert again["syncId"] == "sync-in-flight"


def test_restart_marks_unfinished_jobs_interrupted(harness):
    harness["service"].sync.create({
        "id": "sync-stale", "repository_url": "https://example.com/y.git", "branch": "HEAD",
        "since": SINCE, "until": UNTIL, "commit_limit": 500, "requested_strategy": "auto",
        "status": "training", "stage": "training",
        "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00"})
    assert harness["service"].recover() == 1
    view = harness["service"].get("sync-stale")
    assert view["status"] == "interrupted"
    assert view["error"]["code"] == "SYNC_INTERRUPTED"


def test_missing_generic_model_fails_with_reason(tmp_path, real_run):  # noqa: F811
    """目录里没有现成模型且样本不足时，作业失败并记录 noGenericModel。"""
    from jit_baseline.api import create_app
    from jit_baseline.catalog import ModelCatalog
    from jit_baseline.catalog_storage import CatalogStorage
    from jit_baseline.sync import SyncService

    store = CatalogStorage(tmp_path / "catalog.sqlite3")
    store.initialize()
    root = tmp_path / "artifacts"
    root.mkdir()
    service = SyncService(store, ModelCatalog(store, root), dataset_root=tmp_path / "datasets",
                          artifact_root=root, allow_local=True, timeout=180)
    app = create_app(database=store.path, artifact_root=root, sync_service=service)
    repo = _small_repo(tmp_path)
    view, _ = service.create({"repositoryUrl": str(repo), "branch": "HEAD", "since": SINCE,
                              "until": UNTIL, "commitLimit": 500, "strategy": "auto"})
    done = _wait(service, view["syncId"])
    assert done["status"] == "failed"
    assert done["error"]["code"] == "MODEL_NOT_READY"
    assert done["degradeReason"] == "noGenericModel"
    with TestClient(app) as client:
        assert client.get("/api/v1/repository-syncs", headers=HEADERS).json()["total"] == 1
        assert client.get("/api/v1/repository-syncs/" + done["syncId"],
                          headers=HEADERS).json()["status"] == "failed"


def test_default_window_is_stable_within_one_day():
    """同一天内两次同步必须得到同一个窗口，否则会撞同名数据集版本。"""
    from datetime import datetime, timezone

    from jit_baseline.sync import _window

    morning = datetime(2026, 10, 18, 1, 5, 3, tzinfo=timezone.utc)
    evening = datetime(2026, 10, 18, 23, 59, 59, tzinfo=timezone.utc)
    assert _window({}, now=morning) == _window({}, now=evening)
    since, until = _window({}, now=evening)
    assert since.endswith("T00:00:00+00:00") and until.endswith("T00:00:00+00:00")


def test_explicit_dates_cover_whole_days():
    """只给日期时，起点是当天零点、终点是次日零点，结束日当天的提交也在范围内。"""
    from jit_baseline.sync import _window

    since, until = _window({"since": "2026-07-20", "until": "2026-10-18"})
    assert since == "2026-07-20T00:00:00+00:00"
    assert until == "2026-10-19T00:00:00+00:00"


def test_same_day_range_is_one_day():
    from jit_baseline.sync import _window

    since, until = _window({"since": "2026-10-18", "until": "2026-10-18"})
    assert (since, until) == ("2026-10-18T00:00:00+00:00", "2026-10-19T00:00:00+00:00")

def test_register_unique_keeps_both_versions_when_metadata_changes(tmp_path):
    """同一天窗口下采集元信息变了要成为新版本，不能覆盖已有版本或让整次同步失败。"""
    from jit_baseline import collect as collector
    from jit_baseline.sync import _register_unique

    repo = _small_repo(tmp_path)
    collected = collector.collect(str(repo), since=SINCE, until=UNTIL)
    records = collected["records"]
    dataset = "kamei14-git-v1-x"
    version = f"{dataset}-{records[0]['time'][:10]}_{records[-1]['time'][:10]}"
    room = tmp_path / "datasets" / dataset
    kwargs = dict(schema=collector.SCHEMA_NAME, cohort=collector.cohort(SINCE, UNTIL),
                  root=tmp_path / "datasets",
                  provenance={"publisher": "collected", "revision": "head", "url": str(repo)})
    first = _register_unique(room, dataset, version, collected["csv"],
                             extra={"collection": {"window": {"since": SINCE}}}, **kwargs)
    second = _register_unique(room, dataset, version, collected["csv"],
                              extra={"collection": {"window": {"since": UNTIL}}}, **kwargs)
    assert first["version"] == version
    assert second["version"].startswith(version + "-")
    assert (room / f"{first['version']}.json").exists()
    assert (room / f"{second['version']}.json").exists()


def test_dataset_version_accepts_hash_suffix():
    from jit_baseline.datasets import VERSION_PATTERN

    match = VERSION_PATTERN.fullmatch("kamei14-git-v1-x-2026-10-12_2026-10-18-1a2b3c4d")
    assert match is not None
    assert (match["start"], match["end"]) == ("2026-10-12", "2026-10-18")
    assert VERSION_PATTERN.fullmatch("openstack-six-v1-2011-01-01_2014-12-31") is not None


def test_import_conflict_retries_with_hash_suffix(harness):
    """目录库里同一版本已导入不同内容时，换带哈希的版本名重试，不让整次同步失败。

    旧数据里可能出现"描述文件内容一致、但目录库记录的 manifest 哈希不同"的版本
    （早期实现先写描述文件再导入，中途失败）。导入层的 `DATASET_EXISTS` 也必须
    触发换名，否则这一类历史数据会让每次同步都失败。
    """
    import sqlite3

    repo = _small_repo(harness["root"].parent / "repo-conflict")
    payload = {"repositoryUrl": str(repo), "branch": "HEAD", "since": SINCE, "until": UNTIL,
               "commitLimit": 500, "strategy": "auto"}
    first, _ = harness["service"].create(payload)
    version = _wait(harness["service"], first["syncId"])["datasetVersion"]
    assert version

    with sqlite3.connect(harness["store"].path) as db:
        db.execute("UPDATE dataset_record SET manifest_sha256='deadbeef' WHERE dataset_version=?",
                   (version,))
        db.commit()

    second, _ = harness["service"].create(payload)
    again = _wait(harness["service"], second["syncId"])
    assert again["status"] == "completed", again.get("error")
    assert again["datasetVersion"] != version
    assert again["datasetVersion"].startswith(version + "-")
