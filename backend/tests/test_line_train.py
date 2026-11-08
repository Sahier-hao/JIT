"""行级基线训练与切分测试。"""
import json

import pytest

from jit_baseline.line_train import train_line_baseline


def _row(commit, repo, label, text, language="python"):
    return {"schema": "line-szz-v1", "datasetVersion": f"measure-{repo}", "repo": repo,
            "commitId": commit, "path": f"pkg/{commit}.py", "line": 1, "label": label,
            "text": text, "before": ["def f():"], "after": ["    return 1"],
            "language": language, "lineLength": len(text), "indent": 4, "blank": False,
            "comment": False, "commitFeatures": {"nf": 1, "la": 2, "ld": 1}}


def _write(path, rows):
    path.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
    return path


def test_trains_with_repo_holdout_and_reports_metrics(tmp_path):
    rows = []
    for index in range(6):
        rows.append(_row(f"a{index}", "alpha", index % 2, f"value = {index}\n" + "x" * index))
        rows.append(_row(f"b{index}", "beta", index % 2, f"other = {index}\n" + "y" * index))
    source = _write(tmp_path / "rows.jsonl", rows)
    report = train_line_baseline([source], tmp_path / "report.json", test_repo="beta")
    assert report["split"]["kind"] == "repo"
    assert report["split"]["testRepos"] == ["beta"]
    assert report["split"]["trainRepos"] == ["alpha"]
    assert report["samples"]["test"] == 6
    assert report["metrics"]["rocAuc"] is not None
    assert report["features"]["dimension"] > 0


def test_commit_split_never_puts_one_commit_on_both_sides(tmp_path):
    rows = [_row(f"c{index // 3}", "alpha", index % 2, f"line {index}") for index in range(24)]
    source = _write(tmp_path / "rows.jsonl", rows)
    report = train_line_baseline([source], tmp_path / "report.json", seed=3)
    assert report["split"]["kind"] == "commit"
    assert report["split"]["trainCommits"] > 0 and report["split"]["testCommits"] > 0
    assert report["samples"]["train"] + report["samples"]["test"] == 24


def test_single_class_test_set_returns_null_metrics(tmp_path):
    rows = [_row("a1", "alpha", 0, "safe line"), _row("a2", "alpha", 1, "buggy line"),
            _row("b1", "beta", 1, "test bug one"), _row("b2", "beta", 1, "test bug two")]
    source = _write(tmp_path / "rows.jsonl", rows)
    report = train_line_baseline([source], tmp_path / "report.json", test_repo="beta")
    assert report["metrics"]["rocAuc"] is None
    assert "单一类别" in report["metrics"]["reason"]


def test_rows_without_repo_are_rejected_or_derived(tmp_path):
    rows = [_row("a1", "alpha", 0, "line"), _row("a2", "alpha", 1, "line2"),
            _row("b1", "beta", 0, "other"), _row("b2", "beta", 1, "other2")]
    for row in rows:
        row.pop("repo")
    source = _write(tmp_path / "rows.jsonl", rows)
    report = train_line_baseline([source], tmp_path / "report.json", test_repo="alpha")
    assert report["split"]["testRepos"] == ["alpha"]
    assert report["split"]["trainRepos"] == ["beta"]
