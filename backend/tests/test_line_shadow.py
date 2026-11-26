"""冻结行级研究模型的完整候选集影子评估。"""
import hashlib
import json

import pytest

from jit_baseline.research.line_shadow import _metrics, evaluate_line_shadow


def _row(commit, path, line, label, language="javascript", repo="unseen-repo"):
    return {
        "schema": "line-candidates-v1",
        "repo": repo,
        "commitId": commit,
        "path": path,
        "line": line,
        "text": f"const value{line} = call({line})",
        "language": language,
        "labelStatus": "positive" if label else "unobserved",
        "id": f"{commit}:{path}:{line}",
    }


def _write(path, rows):
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    return path


def test_metrics_use_per_commit_recall_and_first_positive_rank():
    groups = {
        "a": [
            {"labelStatus": "unobserved"},
            {"labelStatus": "positive"},
            {"labelStatus": "unobserved"},
            {"labelStatus": "positive"},
        ],
        "b": [
            {"labelStatus": "positive"},
            {"labelStatus": "unobserved"},
        ],
    }
    result = _metrics(groups)
    assert result["commitsWithPositive"] == 2
    assert result["positives"] == 3
    assert result["recallAtK"]["recallAt1"] == 0.5
    assert result["recallAtK"]["recallAt5"] == 1.0
    assert result["microRecallAtK"]["recallAt1"] == pytest.approx(1 / 3)
    assert result["mrr"] == pytest.approx((1 / 2 + 1) / 2)
    assert result["meanLinesToFirstPositive"] == 1.5
    assert result["medianLinesToFirstPositive"] == 2

def test_shadow_evaluation_uses_complete_supported_rows_and_fixed_baselines(tmp_path):
    source = _write(tmp_path / "unseen.jsonl", [
        _row("a", "a.js", 1, False),
        _row("a", "a.js", 2, True),
        _row("a", "a.js", 3, False),
        _row("b", "b.js", 1, True),
        _row("b", "b.js", 2, False),
        _row("c", "c.py", 1, True, language="python"),
    ])
    output = tmp_path / "report.json"
    report = evaluate_line_shadow([source], output)
    entry = report["inputs"][0]
    assert entry["status"] == "evaluated"
    assert entry["supportedRows"] == 5
    assert entry["unsupportedRows"] == 1
    assert entry["positiveRate"] == 0.4
    assert entry["thresholdEligible"] is False
    assert "样本不足" in entry["thresholdReason"]
    assert entry["sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert set(entry["scorers"]) == {
        "model", "file-order", "random-42", "random-43", "random-44",
    }
    assert entry["comparison"]["byMetric"]["recallAt1"]["model"] is not None
    assert report["summary"]["thresholdPassed"] is False
    assert report["summary"]["unseenEligibleRepos"] == 0
    assert "不接入 A3" in report["summary"]["conclusion"]
    assert json.loads(output.read_text(encoding="utf-8"))["schema"] == report["schema"]

    second = evaluate_line_shadow([source], tmp_path / "second.json")
    assert second["inputs"][0]["scorers"] == entry["scorers"]


def test_non_applicable_language_is_reported_without_fabricating_metrics(tmp_path):
    source = _write(tmp_path / "python.jsonl", [
        _row("a", "a.py", 1, True, language="python"),
    ])
    report = evaluate_line_shadow([source], tmp_path / "report.json")
    entry = report["inputs"][0]
    assert entry["status"] == "not-applicable"
    assert entry["supportedRows"] == 0
    assert entry["scorers"] == {}
    assert entry["positiveRate"] is None
    assert report["summary"]["applicableRepos"] == 0
