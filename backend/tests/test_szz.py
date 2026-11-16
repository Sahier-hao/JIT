"""行级 SZZ（szz-line-v1）的合成仓库行为测试。"""
import os
import shutil
import subprocess

import pytest

from jit_baseline.collect import collect

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
        if content is None:
            target.unlink(missing_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    _git(repo, "add", "-A")
    env = dict(os.environ, GIT_AUTHOR_DATE=moment, GIT_COMMITTER_DATE=moment)
    _git(repo, "commit", "-q", "-m", subject, env=env)
    return _git(repo, "rev-parse", "HEAD")


def _collect(repo):
    return collect(repo, since="2024-01-01", until="2024-02-01", szz="line")


def test_line_szz_labels_the_introducing_commit_with_original_lines(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    first = _commit(repo, "add module", {"pkg/a.py": LINES}, "2024-01-01T00:00:00+00:00")
    _commit(repo, "fix: correct second line",
            {"pkg/a.py": LINES.replace("line 2", "line 2 fixed")}, "2024-01-02T00:00:00+00:00")

    collected = _collect(repo)
    by_id = {record["id"]: record for record in collected["records"]}

    assert by_id[first]["label"] == 1
    assert by_id[first]["labelRule"] == "szz-line-v1"
    evidence = [item for item in collected["labelEvidence"] if item["introducedCommit"] == first]
    assert evidence and evidence[0]["lineRanges"] == [[2, 2]]
    assert collected["collection"]["label"]["kind"] == "szz-line"
    assert collected["collection"]["szz"]["evidencePairs"] >= 1


def test_docs_and_test_only_fixes_do_not_label_source(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    first = _commit(repo, "add module", {"pkg/a.py": LINES, "README.md": "docs\n"},
                    "2024-01-01T00:00:00+00:00")
    _commit(repo, "fix typo in docs", {"README.md": "docs fixed\n"}, "2024-01-02T00:00:00+00:00")

    collected = _collect(repo)
    by_id = {record["id"]: record for record in collected["records"]}
    assert by_id[first]["label"] == 0
    assert collected["collection"]["szz"]["skippedFiles"] >= 1


def test_revert_is_not_treated_as_a_fix_commit(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    first = _commit(repo, "add module", {"pkg/a.py": LINES}, "2024-01-01T00:00:00+00:00")
    fix = _commit(repo, "fix: correct second line",
                  {"pkg/a.py": LINES.replace("line 2", "line 2 fixed")},
                  "2024-01-02T00:00:00+00:00")
    _commit(repo, f'Revert "fix: correct second line"\n\nThis reverts commit {fix}.',
            {"pkg/a.py": LINES}, "2024-01-03T00:00:00+00:00")

    collected = _collect(repo)
    by_id = {record["id"]: record for record in collected["records"]}
    assert by_id[first]["label"] == 1
    assert collected["collection"]["szz"]["fixCommits"] == 1


def test_pure_addition_fix_does_not_label_a_previous_commit(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    first = _commit(repo, "add module", {"pkg/a.py": LINES}, "2024-01-01T00:00:00+00:00")
    _commit(repo, "fix: add missing helper", {"pkg/helper.py": "def helper():\n    return 1\n"},
            "2024-01-02T00:00:00+00:00")

    collected = _collect(repo)
    by_id = {record["id"]: record for record in collected["records"]}
    assert by_id[first]["label"] == 0


def test_line_szz_follows_a_renamed_file(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    first = _commit(repo, "add module", {"pkg/a.py": LINES}, "2024-01-01T00:00:00+00:00")
    _git(repo, "mv", "pkg/a.py", "pkg/b.py")
    env = dict(os.environ, GIT_AUTHOR_DATE="2024-01-02T00:00:00+00:00",
               GIT_COMMITTER_DATE="2024-01-02T00:00:00+00:00")
    _git(repo, "commit", "-q", "-m", "rename module", env=env)
    _commit(repo, "fix: correct second line",
            {"pkg/b.py": LINES.replace("line 2", "line 2 fixed")}, "2024-01-03T00:00:00+00:00")

    collected = _collect(repo)
    by_id = {record["id"]: record for record in collected["records"]}
    assert by_id[first]["label"] == 1
    evidence = [item for item in collected["labelEvidence"] if item["fixCommit"] != first]
    assert evidence and evidence[0]["lineRanges"] == [[2, 2]]
