"""端到端链路：真实 Git 仓库 → 采集 → 登记 → 导入 → 训练 → 预测与解释。

用临时 git 仓库造数据，全程离线；系统没有 git 时跳过。预测入口按 FIP-01 只接受
`openstack-six-v1`，所以六字段数据集由采集产物派生：`ent` 与采集的 `entropy`
是同一个 Kamei 熵特征的不同列名，其余字段同名同义。
"""

import csv
import os
import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient

from test_artifacts import real_run  # noqa: F401
from test_catalog_api import HEADERS, settings  # noqa: F401

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="系统缺少 git 命令")

SINCE, UNTIL = "2024-01-01", "2025-01-01"
SIX_COLUMNS = ("commit_id", "author_date", "bugcount", "ns", "nd", "nf", "ent", "la", "ld")
LINES = "\n".join(f"line {index}" for index in range(100)) + "\n"


def _git(repo, *args, env=None):
    completed = subprocess.run(["git", "-C", str(repo), *args], check=True,
                               capture_output=True, text=True, env=env)
    return completed.stdout.strip()


def _make_repo(path):
    path.mkdir(parents=True, exist_ok=True)
    _git(path, "init", "-q", "-b", "main")
    _git(path, "config", "user.email", "author@example.com")
    _git(path, "config", "user.name", "Author")
    return path


def _commit(repo, subject, files, moment):
    for name, content in files.items():
        target = repo / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    _git(repo, "add", "-A")
    env = dict(os.environ, GIT_AUTHOR_DATE=moment, GIT_COMMITTER_DATE=moment)
    _git(repo, "commit", "-q", "-m", subject, env=env)
    return _git(repo, "rev-parse", "HEAD")


def _six_field_rows(source):
    """从采集 CSV 派生六字段 CSV：ent 取采集的 entropy 列。"""
    text = source.read_text(encoding="utf-8")
    rows = list(csv.DictReader(text.splitlines()))
    stream = []
    for row in rows:
        stream.append([row["commit_id"], row["author_date"], row["bugcount"], row["ns"],
                       row["nd"], row["nf"], row["entropy"], row["la"], row["ld"]])
    return stream


@pytest.fixture
def chain(tmp_path, settings):  # noqa: F811
    from jit_baseline import collect, datasets, store
    from jit_baseline.api import create_app
    from jit_baseline.artifacts import build_run

    repo = _make_repo(tmp_path / "repo")
    _commit(repo, "add module", {"pkg/a.py": LINES}, "2024-01-01T00:00:00+00:00")
    _commit(repo, "add helper", {"pkg/b.py": "helper\n" * 30}, "2024-01-02T00:00:00+00:00")
    _commit(repo, "fix: adjust module", {"pkg/a.py": "line 0 fixed\n" + LINES.split("\n", 1)[1]},
            "2024-01-03T00:00:00+00:00")
    _commit(repo, "add docs", {"README.md": "docs\n"}, "2024-01-04T00:00:00+00:00")
    _commit(repo, "extend helper", {"pkg/b.py": "helper\n" * 40}, "2024-01-05T00:00:00+00:00")
    _commit(repo, "fix: repair helper", {"pkg/b.py": "helper\n" * 39 + "fixed\n"},
            "2024-01-06T00:00:00+00:00")
    _commit(repo, "add util", {"pkg/c.py": "util\n" * 20}, "2024-01-07T10:00:00+00:00")
    _commit(repo, "fix: repair util", {"pkg/c.py": "util\n" * 19 + "fixed\n"},
            "2024-01-07T11:00:00+00:00")

    datasets_root = tmp_path / "datasets"
    collected = collect.collect_repository(
        repo, since=SINCE, until=UNTIL, output=tmp_path / "kamei14.csv",
        dataset="e2e-sample", register=True, root=datasets_root)
    assert collected["records"] == 8, collected
    assert collected["collection"]["szz"]["labeledCommits"] == 3, collected["collection"]

    rows = _six_field_rows(tmp_path / "kamei14.csv")
    six = tmp_path / "six.csv"
    with six.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(SIX_COLUMNS)
        writer.writerows(rows)

    registered = datasets.register(
        six, schema="openstack-six-v1", dataset="e2e", root=datasets_root,
        cohort=collect.cohort(SINCE, UNTIL))
    manifest_path = datasets_root / "e2e" / (registered["version"] + ".json")
    run = build_run(tmp_path / "source", settings["artifact_root"] / "e2e",
                    dataset_manifest=manifest_path)

    app = create_app(**settings)
    store.import_dataset(None, manifest_path, app.state.catalog.store)
    with TestClient(app) as client:
        candidates = client.get("/api/v1/model-candidates", headers=HEADERS).json()["candidates"]
        candidate = next(item for item in candidates if item["displayName"] == "e2e")
        model = client.post("/api/v1/models/register", headers=HEADERS, json={
            "candidateId": candidate["candidateId"],
            "expectedManifestSha256": candidate["manifestSha256"]}).json()["model"]

    # 用一条真实采集记录的特征发起预测（最后一条采集记录）。
    last = rows[-1]
    features = {"ns": int(last[3]), "nd": int(last[4]), "nf": int(last[5]),
                "ent": max(0.0, float(last[6])), "la": int(last[7]), "ld": int(last[8])}
    return {"app": app, "model": model, "features": features,
            "version": registered["version"], "manifest": run,
            "collection": collected["collection"]}


def test_repository_collection_reaches_prediction_with_explanation(chain):
    """5.1：采集产物一路训练成可服务模型，预测给出风险、解释与来源。"""
    from jit_baseline import attribution

    app, model, features = chain["app"], chain["model"], chain["features"]
    version, run = chain["version"], chain["manifest"]
    assert chain["collection"]["repository"]["head"]
    body = {"modelId": model["modelId"], "featureSchemaVersion": "openstack-six-v1",
            "project": "e2e-project", "record": {"recordId": "e2e-input", "features": features}}
    with TestClient(app) as client:
        response = client.post("/api/v1/predictions", headers=HEADERS, json=body)
        assert response.status_code == 201, response.text
        saved = response.json()
        record = saved["records"][0]

        assert saved["mode"] == "feature-input" and saved["sourceKind"] == "client-features"
        assert 0 <= record["risk"] <= 1
        assert record["features"] == features
        assert record["explanationStatus"] == "supported"
        assert record["explanationMethod"] == attribution.METHOD
        assert record["explanationSummary"]
        items = record["explanation"]
        assert 1 <= len(items) <= attribution.TOP_K
        for item in items:
            assert set(item) == {"feature", "value", "baseline", "delta", "direction"}
            assert item["feature"] in features
            assert item["value"] == features[item["feature"]]
            assert item["direction"] == ("increases" if item["delta"] > 0 else "decreases")
        deltas = [abs(item["delta"]) for item in items]
        assert deltas == sorted(deltas, reverse=True)

        assert saved["model"]["modelId"] == model["modelId"]
        assert saved["model"]["artifactDatasetVersion"] == version
        assert saved["model"]["artifactRunId"] == run["runId"]
        assert saved["runId"] == model["runId"]
        assert len(saved["inputSha256"]) == 64
        assert client.get("/api/v1/prediction-batches/" + saved["batchId"], headers=HEADERS).json() == saved


def test_unknown_dataset_version_is_404_without_fallback(chain):
    """5.2：未登记的数据集版本直接 404，不回退到其它版本、不落库。"""
    app, model = chain["app"], chain["model"]
    version = chain["version"]
    probes = [("e2e-1999-01-01_1999-01-02", "a" * 40), (version, "b" * 40)]
    with TestClient(app) as client:
        for dataset_version, commit_id in probes:
            body = {"modelId": model["modelId"], "featureSchemaVersion": "openstack-six-v1",
                    "project": "e2e-project", "datasetVersion": dataset_version,
                    "record": {"recordId": "probe", "commitId": commit_id}}
            response = client.post("/api/v1/predictions", headers=HEADERS, json=body)
            assert response.status_code == 404, (dataset_version, response.text)
            assert response.json()["error"]["code"] == "NOT_FOUND"
            assert "risk" not in response.text
    with app.state.catalog.store.connection() as db:
        assert db.execute("SELECT count(*) FROM prediction_batch").fetchone()[0] == 0
