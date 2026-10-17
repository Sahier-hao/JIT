"""仓库采集（repository-collection）的行为测试。

用临时 git 仓库验证：提交遍历与排除、Kamei 指标口径、简化 SZZ 标签、二进制改动、
窗口上限，以及登记出的描述文件带上采集证据。
"""

import json
import os
import shutil
import subprocess

import pytest

from jit_baseline import datasets
from jit_baseline import errors
from jit_baseline.collect import collect, collect_repository

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="系统缺少 git 命令")

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
        if content is None:
            target.unlink(missing_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            target.write_bytes(content)
        else:
            target.write_text(content, encoding="utf-8")
    _git(repo, "add", "-A")
    env = dict(os.environ, GIT_AUTHOR_DATE=moment, GIT_COMMITTER_DATE=moment)
    _git(repo, "commit", "-q", "-m", subject, env=env)
    return _git(repo, "rev-parse", "HEAD")


def _merge(repo, branch, moment):
    env = dict(os.environ, GIT_AUTHOR_DATE=moment, GIT_COMMITTER_DATE=moment)
    _git(repo, "merge", "--no-ff", "-q", "-m", f"merge {branch}", branch, env=env)


def test_collect_computes_declared_metrics(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    first = _commit(repo, "add module", {"pkg/a.py": LINES}, "2024-01-01T00:00:00+00:00")
    second = _commit(repo, "fix: correct first line", {"pkg/a.py": "line 0 fixed\n" + LINES.split("\n", 1)[1]},
                     "2024-01-02T00:00:00+00:00")
    _commit(repo, "add docs", {"README.md": "docs\n"}, "2024-01-03T00:00:00+00:00")

    collected = collect(repo, since="2024-01-01", until="2024-01-05")
    by_id = {record["id"]: record for record in collected["records"]}

    introduced = by_id[first]["metrics"]
    assert introduced["nf"] == 1 and introduced["la"] == 100 and introduced["ld"] == 0
    assert introduced["lt"] == 0 and introduced["ns"] == 1 and introduced["nd"] == 1
    assert introduced["entropy"] == 0 and introduced["nuc"] == 0

    modified = by_id[second]["metrics"]
    assert modified["la"] == 1 and modified["ld"] == 1 and modified["lt"] == 100
    assert modified["nuc"] == 1 and modified["ndev"] == 1 and modified["exp"] == 1


def test_szz_labels_the_previous_modification(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    first = _commit(repo, "add module", {"pkg/a.py": LINES}, "2024-01-01T00:00:00+00:00")
    _commit(repo, "bugfix: adjust first line", {"pkg/a.py": "line 0 fixed\n" + LINES.split("\n", 1)[1]},
            "2024-01-02T00:00:00+00:00")

    collected = collect(repo, since="2024-01-01", until="2024-01-05")
    by_id = {record["id"]: record for record in collected["records"]}

    assert by_id[first]["label"] == 1
    assert by_id[first]["labelRule"]
    assert by_id[first]["labelNote"] is None
    assert collected["labeled"] == 1 and collected["fixCommits"] == 1


def test_merge_commit_is_excluded(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    _commit(repo, "add module", {"a.py": "a\n"}, "2024-01-01T00:00:00+00:00")
    _git(repo, "checkout", "-q", "-b", "feature")
    _commit(repo, "add feature", {"b.py": "b\n"}, "2024-01-02T00:00:00+00:00")
    _git(repo, "checkout", "-q", "main")
    _merge(repo, "feature", "2024-01-03T00:00:00+00:00")

    collected = collect(repo, since="2024-01-01", until="2024-01-05")

    assert [record["subject"] for record in collected["records"]] == ["add module", "add feature"]
    assert collected["excluded"]["merges"] == 1


def test_binary_change_counts_no_lines(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    _commit(repo, "add assets", {"logo.bin": b"\x00\x01\x02"}, "2024-01-01T00:00:00+00:00")

    collected = collect(repo, since="2024-01-01", until="2024-01-05")

    metrics = collected["records"][0]["metrics"]
    assert metrics["nf"] == 1 and metrics["la"] == 0 and metrics["ld"] == 0
    assert collected["collection"]["counts"]["binaryFiles"] == 1


def test_window_limit_is_rejected(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    _commit(repo, "one", {"a.py": "1\n"}, "2024-01-01T00:00:00+00:00")
    _commit(repo, "two", {"b.py": "2\n"}, "2024-01-02T00:00:00+00:00")

    with pytest.raises(errors.BaselineError) as raised:
        collect(repo, since="2024-01-01", until="2024-01-05", limit=1)
    assert raised.value.code == "DATASET_INVALID"


def test_collect_registers_manifest_with_evidence(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    _commit(repo, "add module", {"a.py": "a\n"}, "2024-01-01T00:00:00+00:00")
    second = _commit(repo, "fix: adjust", {"a.py": "b\n"}, "2024-01-02T00:00:00+00:00")
    registry = tmp_path / "datasets"

    result = collect_repository(repo, since="2024-01-01", until="2024-01-05",
                                output=tmp_path / "repo.csv", dataset="demo",
                                register=True, root=registry)

    manifest_path = result["dataset"]["path"]
    manifest = json.loads(open(manifest_path, encoding="utf-8").read())
    datasets.validate_manifest(manifest)
    assert manifest["schemaName"] == "kamei14-git-v1"
    assert manifest["dataset"] == "demo"
    assert manifest["collection"]["kind"] == "git-repository"
    assert manifest["collection"]["window"]["since"] == "2024-01-01"
    assert manifest["collection"]["counts"]["records"] == 2
    assert manifest["revision"] == second
    assert len(manifest["fields"]) == 14
    assert manifest["quality"]["includedRows"] == 2
    assert result["dataset"]["created"] is True
