"""完整 SZZ（szz-full-v1）的信号、噪声过滤与抽样测试。"""
import csv
import os
import shutil
import subprocess

import pytest

from jit_baseline.collect import _entries
from jit_baseline.szz import classify_message, label_repository, sample_evidence, write_sample_csv

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


def _commit(repo, subject, files, moment, body=None):
    for name, content in files.items():
        target = repo / name
        if content is None:
            target.unlink(missing_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    _git(repo, "add", "-A")
    env = dict(os.environ, GIT_AUTHOR_DATE=moment, GIT_COMMITTER_DATE=moment)
    message = subject if not body else f"{subject}\n\n{body}"
    _git(repo, "commit", "-q", "-m", message, env=env)
    return _git(repo, "rev-parse", "HEAD")


class FakeResolver:
    def __init__(self, labels=("bug",)):
        self.labels = list(labels)
        self.calls = []

    def lookup(self, number):
        self.calls.append(number)
        return {"number": number, "title": "Crash on empty input", "state": "closed",
                "labels": self.labels, "kind": "issue",
                "url": f"https://github.com/example/project/issues/{number}",
                "fetchedAt": "2026-11-08T00:00:00Z"}


def _full(repo, resolver=None):
    entries, _unparsed = _entries(repo, "HEAD")
    return label_repository(repo, entries, {entry["id"] for entry in entries},
                            mode="full", resolver=resolver)


def test_full_szz_uses_issue_link_for_non_keyword_fix(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    first = _commit(repo, "add module", {"pkg/a.py": LINES}, "2024-01-01T00:00:00+00:00")
    _commit(repo, "update handler", {"pkg/a.py": LINES.replace("line 2", "line 2 changed")},
            "2024-01-02T00:00:00+00:00", body="This closes #12.")

    result = _full(repo, FakeResolver())
    assert first in result.labels
    assert result.fix_signals["issue"] == 1
    assert result.issue_lookup["succeeded"] == 1
    assert result.evidence[0]["fixSource"] == "issue"
    assert result.fix_signal_evidence[0]["issues"][0]["labels"] == ["bug"]


def test_full_szz_ignores_refactor_and_format_commits(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    first = _commit(repo, "add module", {"pkg/a.py": LINES}, "2024-01-01T00:00:00+00:00")
    _commit(repo, "refactor: rename helper", {"pkg/a.py": LINES.replace("line 2", "helper")},
            "2024-01-02T00:00:00+00:00")
    _commit(repo, "fix formatting", {"pkg/b.py": "a\n"}, "2024-01-03T00:00:00+00:00")

    result = _full(repo)
    assert first not in result.labels
    assert result.skipped_excluded >= 1


def test_full_szz_ignores_whitespace_only_fix(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    first = _commit(repo, "add module", {"pkg/a.py": "one\n  two\nthree\n"}, "2024-01-01T00:00:00+00:00")
    _commit(repo, "fix: spacing", {"pkg/a.py": "one\ntwo\nthree\n"}, "2024-01-02T00:00:00+00:00")

    result = _full(repo)
    assert first not in result.labels
    assert result.skipped_whitespace == 1


def test_full_szz_labels_a_deleted_file(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    first = _commit(repo, "add broken module", {"pkg/a.py": LINES}, "2024-01-01T00:00:00+00:00")
    _commit(repo, "fix: remove broken module", {"pkg/a.py": None}, "2024-01-02T00:00:00+00:00")

    result = _full(repo)
    assert first in result.labels
    assert result.evidence[0]["path"] == "pkg/a.py"


def test_classification_prefers_issue_and_excludes_refactor():
    bug = {"number": 1, "title": "Crash", "labels": ["bug"], "state": "closed",
           "kind": "issue", "url": "https://github.com/o/r/issues/1", "fetchedAt": "now"}
    assert classify_message("update handler", "fixes #1", [bug]).source == "issue"
    assert classify_message("update handler", "fixes #1", []).source == "issueRef"
    assert classify_message("refactor: split module", "", []).is_fix is False
    assert classify_message("fix: typo in docs", "", []).is_fix is False
    assert classify_message("fix: correct null check", "", []).source == "keyword"


def test_sample_export_keeps_verdict_for_human_review(tmp_path):
    manifest = {"collection": {
        "labelEvidence": [{"fixCommit": "b" * 40, "introducedCommit": "a" * 40,
                           "path": "pkg/a.py", "lineRanges": [[3, 4]],
                           "parentRanges": [[9, 10]], "fixTime": "2024-01-05T00:00:00Z",
                           "fixSource": "issue", "issueRefs": [12]}],
        "fixSignals": [{"fixCommit": "b" * 40, "source": "issue", "issueRefs": [12], "issues": []}],
    }}
    rows = sample_evidence(manifest, limit=10)
    assert rows[0]["fixSource"] == "issue"
    assert rows[0]["verdict"] == ""
    target = write_sample_csv(rows, tmp_path / "review.csv")
    with target.open(encoding="utf-8") as handle:
        reader = list(csv.DictReader(handle))
    assert reader[0]["path"] == "pkg/a.py" and reader[0]["verdict"] == ""


def test_full_szz_ignores_version_metadata_lines(tmp_path):
    repo = _make_repo(tmp_path / "repo")
    first = _commit(repo, "release 2.0.0", {"package.json": '{\n  "version": "2.0.0"\n}\n'},
                    "2024-01-01T00:00:00+00:00")
    _commit(repo, "fix: align app icon", {"package.json": '{\n  "version": "2.0.1"\n}\n'},
            "2024-01-02T00:00:00+00:00")

    result = _full(repo)
    assert first not in result.labels
    assert result.skipped_noise_lines >= 1
