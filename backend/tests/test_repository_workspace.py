"""仓库工作区：归仓、当前视图、分布口径与查询接口（RCL-10..RCL-13、D1/D2/D5/D6）。

端到端复用 `test_repository_sync` 的本地 Git 仓库夹具：样本不足时降级到现成的
`openstack-six-v1` 模型，因此离线也能跑完整链路。
"""

import shutil

import pytest
from fastapi.testclient import TestClient

from test_artifacts import real_run  # noqa: F401
from test_end_to_end import _commit, _make_repo  # noqa: F401
from test_repository_sync import (  # noqa: F401
    HEADERS, _create, _small_repo, _wait, harness)

from jit_baseline.sync import (DISTRIBUTION_RULE, distribution_of, normalize_repository_url,
                               repository_id_for)

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="系统缺少 git 命令")


def test_same_repository_written_three_ways_normalizes_to_one():
    base = "https://github.com/Sahier-hao/JIT"
    variants = [base, base + ".git", "https://GitHub.com/Sahier-hao/JIT/"]
    assert {normalize_repository_url(item) for item in variants} == {base}
    assert len({repository_id_for(item) for item in variants}) == 1


def test_distribution_boundaries_are_inclusive_on_the_lower_edge():
    counts = distribution_of([0.099, 0.10, 0.249, 0.25])
    assert counts == {"high": 1, "medium": 2, "low": 1, "unknown": 0}
    assert distribution_of([None, 0.0]) == {"high": 0, "medium": 0, "low": 1, "unknown": 1}


def test_repository_view_tracks_the_completed_job(harness):
    repo = _small_repo(harness["root"].parent)
    done = _wait(harness["service"], _create(harness, repo)["syncId"])
    assert done["status"] == "completed", done
    repository_id = done["repositoryId"]
    assert repository_id

    with TestClient(harness["app"]) as client:
        listed = client.get("/api/v1/repositories", headers=HEADERS).json()
        assert listed["total"] == 1
        assert listed["repositories"][0]["repositoryId"] == repository_id
        assert listed["repositories"][0]["displayName"] == "repo"

        detail = client.get(f"/api/v1/repositories/{repository_id}", headers=HEADERS).json()
        assert detail["viewSyncId"] == done["syncId"]
        assert detail["commitCount"] == 7
        assert detail["distributionRule"] == DISTRIBUTION_RULE
        assert detail["modelStrategy"] == "generic-model"
        assert detail["degradeReason"] == "fewRecords"
        assert detail["limitations"]
        assert detail['viewContext']['completedAt'] == done['completedAt']
        assert detail['viewContext']['headCommit'] == done['headCommit']
        assert done['completedAt'] and done['headCommit']
        assert detail['viewContext']['branch'] == 'main'
        pinned = client.get(f'/api/v1/repositories/{repository_id}', headers=HEADERS,
                            params={'viewSyncId': done['syncId']})
        assert pinned.status_code == 200
        import jsonschema
        from test_openapi import document
        doc = document()
        def validate(value, schema):
            jsonschema.Draft202012Validator({'$ref': f'#/components/schemas/{schema}',
                'components': doc['components']}).validate(value)
        validate(detail, 'Repository')
        page = client.get(f'/api/v1/repositories/{repository_id}/commits', headers=HEADERS,
                          params={'viewSyncId': done['syncId']}).json()
        validate(page, 'RepositoryCommitPage')
        assert all(row['authorName'] for row in page['commits'])
        sha = page['commits'][0]['commitId']
        validate(client.get(f'/api/v1/repositories/{repository_id}/commits/{sha}',
                 headers=HEADERS, params={'viewSyncId': done['syncId']}).json(), 'RepositoryCommit')
        validate(client.get(f'/api/v1/repositories/{repository_id}/summary',
                 headers=HEADERS, params={'viewSyncId': done['syncId']}).json(), 'RepositorySummary')
        assert client.get(f'/api/v1/repositories/{repository_id}', headers=HEADERS,
                          params={'viewSyncId': 'unknown'}).status_code == 404
        assert client.get(f'/api/v1/repositories/{repository_id}').status_code == 200

        summary = client.get(f"/api/v1/repositories/{repository_id}/summary",
                             headers=HEADERS).json()
        assert summary["total"] == 7
        assert summary["high"] + summary["medium"] + summary["low"] == 7
        assert summary["distributionRule"] == DISTRIBUTION_RULE


def test_search_finds_a_commit_beyond_the_first_page(harness):
    repo = _small_repo(harness["root"].parent)
    done = _wait(harness["service"], _create(harness, repo)["syncId"])
    repository_id = done["repositoryId"]

    with TestClient(harness["app"]) as client:
        first_page = client.get(f"/api/v1/repositories/{repository_id}/commits", headers=HEADERS,
                                params={"limit": 2, "sort": "time"}).json()
        assert first_page["total"] == 7 and len(first_page["commits"]) == 2

        everything = client.get(f"/api/v1/repositories/{repository_id}/commits", headers=HEADERS,
                                params={"limit": 200, "sort": "time"}).json()
        target = everything["commits"][-1]
        assert target["subject"]

        by_id = client.get(f"/api/v1/repositories/{repository_id}/commits", headers=HEADERS,
                           params={"search": target["commitId"][:8]}).json()
        assert by_id["total"] == 1 and by_id["commits"][0]["commitId"] == target["commitId"]

        by_title = client.get(f"/api/v1/repositories/{repository_id}/commits", headers=HEADERS,
                              params={"search": target["subject"][:6]}).json()
        assert any(item["commitId"] == target["commitId"] for item in by_title["commits"])


def test_repository_without_completed_job_returns_empty_page(harness):
    repo = _small_repo(harness["root"].parent)
    failed = _wait(harness["service"], _create(harness, repo, since="2023-01-01",
                                               until="2023-12-31")["syncId"])
    assert failed["status"] == "failed"
    repository_id = failed["repositoryId"]
    assert repository_id

    with TestClient(harness["app"]) as client:
        detail = client.get(f"/api/v1/repositories/{repository_id}", headers=HEADERS).json()
        assert detail["viewSyncId"] is None and detail["commitCount"] == 0
        page = client.get(f"/api/v1/repositories/{repository_id}/commits", headers=HEADERS).json()
        assert page["total"] == 0 and page["commits"] == []
        summary = client.get(f"/api/v1/repositories/{repository_id}/summary",
                             headers=HEADERS).json()
        assert summary["total"] == 0 and summary["unknown"] == 0


def test_failed_job_keeps_the_previous_view(harness):
    repo = _small_repo(harness["root"].parent)
    first = _wait(harness["service"], _create(harness, repo)["syncId"])
    assert first["status"] == "completed", first
    repository_id = first["repositoryId"]

    failed = _wait(harness["service"], _create(harness, repo, since="2023-01-01",
                                               until="2023-12-31")["syncId"])
    assert failed["status"] == "failed"

    detail = harness["service"].repository(repository_id)
    assert detail["viewSyncId"] == first["syncId"]
    assert detail["commitCount"] == 7
    assert detail["latestSyncId"] == failed["syncId"]


def test_second_successful_sync_replaces_the_view(harness):
    repo = _small_repo(harness["root"].parent)
    first = _wait(harness["service"], _create(harness, repo)["syncId"])
    second = _wait(harness["service"], _create(harness, repo, commitLimit=300)["syncId"])
    assert first["status"] == "completed" and second["status"] == "completed"
    assert first["repositoryId"] == second["repositoryId"]

    detail = harness["service"].repository(first["repositoryId"])
    assert detail["viewSyncId"] == second["syncId"]
    assert detail["commitCount"] == 7


def test_backfill_relinks_legacy_jobs_once(harness):
    repo = _small_repo(harness["root"].parent)
    done = _wait(harness["service"], _create(harness, repo)["syncId"])
    repository_id = done["repositoryId"]
    with harness["store"].connection(write=True) as db:
        db.execute("UPDATE repository_sync SET repository_id=NULL")

    assert harness["service"].sync.backfill_repositories() == 1
    assert harness["service"].sync.backfill_repositories() == 0
    assert harness["service"].repository(repository_id)["viewSyncId"] == done["syncId"]
