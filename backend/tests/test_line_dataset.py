"""行级样本导出（line-szz-v1）测试。"""
import json
import os
import shutil
import subprocess

import pytest

from jit_baseline.collect import collect
from jit_baseline.line_dataset import build_line_dataset

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="系统缺少 git 命令")

LINES = "\n".join(f"line {index}" for index in range(1, 11)) + "\n"


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


def _manifest(tmp_path, repo):
    collected = collect(repo, since="2024-01-01", until="2024-02-01", szz="full")
    csv_path = tmp_path / "dataset.csv"
    csv_path.write_bytes(collected["csv"])
    return {
        "version": "demo-line-v1",
        "dataset": "demo",
        "file": {"path": str(csv_path)},
        "collection": collected["collection"],
    }


def test_line_dataset_exports_positive_lines_and_negative_added_lines(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    first = _commit(repo, "add module", {"pkg/a.py": LINES}, "2024-01-01T00:00:00+00:00")
    _commit(repo, "fix: correct second line",
            {"pkg/a.py": LINES.replace("line 2", "line 2 fixed")}, "2024-01-02T00:00:00+00:00")

    manifest = _manifest(tmp_path, repo)
    output = tmp_path / "lines.jsonl"
    summary = build_line_dataset(manifest, output, repo=repo, negatives_per_positive=2, context=1)

    rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
    positives = [row for row in rows if row["label"] == 1]
    negatives = [row for row in rows if row["label"] == 0]
    assert summary["positives"] == len(positives) and summary["negatives"] == len(negatives)
    assert any(row["commitId"] == first and row["path"] == "pkg/a.py" and row["line"] == 2
               and row["text"] == "line 2" for row in positives)
    assert all(row["source"] == "added-line-negative" and row["commitId"] != first for row in negatives)
    assert positives[0]["before"] == ["line 1"] and positives[0]["language"] == "python"
    assert positives[0]["commitFeatures"]["nf"] == 1
    assert not ({(row["commitId"], row["path"], row["line"]) for row in positives} &
                {(row["commitId"], row["path"], row["line"]) for row in negatives})


def test_line_dataset_is_reproducible_with_the_same_seed(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    first = _commit(repo, "add module", {"pkg/a.py": LINES}, "2024-01-01T00:00:00+00:00")
    _commit(repo, "fix: correct line", {"pkg/a.py": LINES.replace("line 2", "line 2 fixed")},
            "2024-01-02T00:00:00+00:00")
    _commit(repo, "add docs", {"README.md": "docs\n"}, "2024-01-03T00:00:00+00:00")
    manifest = _manifest(tmp_path, repo)
    one, two = tmp_path / "one.jsonl", tmp_path / "two.jsonl"
    build_line_dataset(manifest, one, repo=repo, negatives_per_positive=3, seed=7)
    build_line_dataset(manifest, two, repo=repo, negatives_per_positive=3, seed=7)
    assert one.read_bytes() == two.read_bytes()


def test_line_dataset_rejects_missing_csv(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    _commit(repo, "add module", {"pkg/a.py": LINES}, "2024-01-01T00:00:00+00:00")
    manifest = {"version": "demo", "file": {"path": str(tmp_path / "missing.csv")}, "collection": {"labelEvidence": []}}
    with pytest.raises(Exception):
        build_line_dataset(manifest, tmp_path / "out.jsonl", repo=repo)
