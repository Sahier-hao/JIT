"""完整候选集导出与行级定位评价。"""
import json
import subprocess
from pathlib import Path

from jit_baseline import line_candidates


def _git(repo, *args, env=None):
    completed = subprocess.run(["git", *args], cwd=str(repo), capture_output=True,
                               text=True, encoding="utf-8", errors="replace", env=env)
    assert completed.returncode == 0, completed.stderr
    return completed.stdout


def _commit(repo, message, files, date):
    for name, content in files.items():
        target = Path(repo) / name
        if content is None:
            target.unlink()
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            target.write_bytes(content)
        else:
            target.write_text(content, encoding="utf-8")
    _git(repo, "add", "-A")
    env = {"GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date,
           "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@e",
           "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@e"}
    _git(repo, "commit", "-q", "-m", message, env=env)
    return _git(repo, "rev-parse", "HEAD").strip()


def _repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "config", "user.email", "t@e")
    _git(repo, "config", "user.name", "t")
    add = _commit(repo, "add", {"pkg/a.py": "l1\nl2\nl3\nl4\nl5\n", "README.md": "docs\n"},
                  "2024-01-01T00:00:00+00:00")
    change = _commit(repo, "change", {"pkg/a.py": "l1\nl2\nL3 changed\nl4\nl5\n",
                                      "assets/logo.png": b"\x89PNG\r\n\x1a\n\x00\x00",
                                      "dist/app.js": "built();\n"},
                     "2024-01-02T00:00:00+00:00")
    _git(repo, "mv", "pkg/a.py", "pkg/b.py")
    renamed = _commit(repo, "rename", {"pkg/b.py": "l1\nl2\nL3 changed\nl4\nl5\nl6 renamed\n"},
                      "2024-01-03T00:00:00+00:00")
    deleted = _commit(repo, "delete", {"pkg/b.py": None}, "2024-01-04T00:00:00+00:00")
    return repo, add, change, renamed, deleted


def _manifest(tmp_path, commits, evidence):
    import hashlib
    csv_path = tmp_path / "demo.csv"
    csv_path.write_text("commit_id,author_date\n" + "".join(f"{c},2024-01-01\n" for c in commits),
                        encoding="utf-8")
    return {"dataset": "demo", "version": "demo-v1",
            "file": {"path": str(csv_path),
                     "sha256": hashlib.sha256(csv_path.read_bytes()).hexdigest()},
            "collection": {"repository": {"head": commits[-1]}, "labelEvidence": evidence}}


def test_export_uses_complete_diff_and_reports_uncoverable(tmp_path):
    repo, add, change, renamed, deleted = _repo(tmp_path)
    evidence = [
        {"introducedCommit": add, "path": "pkg/a.py", "lineRanges": [[2, 3]],
         "fixCommit": "f" * 40, "issueRefs": [7], "fixSource": "issueRef"},
        {"introducedCommit": change, "path": "pkg/a.py", "lineRanges": [[3, 3]],
         "fixCommit": "e" * 40, "issueRefs": [], "fixSource": "keyword"},
        # 引入行不在任何 diff 中：不可覆盖，不是负例。
        {"introducedCommit": add, "path": "pkg/a.py", "lineRanges": [[40, 40]],
         "fixCommit": "d" * 40, "issueRefs": []},
    ]
    manifest = _manifest(tmp_path, [add, change, renamed, deleted], evidence)
    output = tmp_path / "candidates.jsonl"
    summary = line_candidates.export_candidates(manifest, repo, output)
    rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
    assert summary["population"] == line_candidates.POPULATION
    assert summary["commits"] == 4
    assert summary["candidates"] == len(rows)
    assert summary["positives"] == 3
    assert summary["uncoverable"] == 1
    assert summary["uncoverableReasons"] == {"line-not-in-diff": 1}
    # 新增文件全部五行都在候选总体里，行号连续。
    added = [(row["path"], row["line"]) for row in rows if row["commitId"] == add]
    assert ("pkg/a.py", 1) in added and ("pkg/a.py", 5) in added
    # 修改提交只把改动行作为候选。
    changed = [(row["path"], row["line"], row["labelStatus"]) for row in rows
               if row["commitId"] == change and row["path"] == "pkg/a.py"]
    assert changed == [("pkg/a.py", 3, "positive")]
    # 重命名后的新路径进入候选，旧路径证据被映射。
    rename_rows = [row for row in rows if row["commitId"] == renamed]
    assert any(row["path"] == "pkg/b.py" for row in rename_rows)
    assert summary["exclusions"]["binary"] >= 1
    # 构建产物用 git pathspec 排除在候选总体之外。
    assert not [row for row in rows if row["path"] == "dist/app.js"]
    assert "pathspec" in summary["generatedPathScope"]
    # 删除提交没有新增行，不产生候选，但保留为已处理提交。
    assert not [row for row in rows if row["commitId"] == deleted]
    statuses = {row["labelStatus"] for row in rows}
    assert statuses == {"positive", "unobserved"}


def _row(commit, path, line, text, status):
    return {"id": f"{commit}:{path}:{line}", "commitId": commit, "path": path, "line": line,
            "text": text, "labelStatus": status, "repo": "demo", "datasetVersion": "v1",
            "language": "python", "population": line_candidates.POPULATION}


def test_evaluation_reports_commit_grouped_metrics(tmp_path):
    rows = [
        # 正例在该提交的最后一行：IFA=4；结构基线按长度把它排到最后。
        _row("c1", "a.py", 1, "x", "unobserved"),
        _row("c1", "a.py", 2, "xx", "unobserved"),
        _row("c1", "a.py", 3, "xxx", "unobserved"),
        _row("c1", "a.py", 4, "xxxx", "unobserved"),
        _row("c1", "a.py", 5, "except: " + "y" * 200, "positive"),
        _row("c2", "b.py", 1, "eval(x)", "positive"),
        _row("c2", "b.py", 2, "plain", "unobserved"),
    ]
    source = tmp_path / "rows.jsonl"
    source.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    report = line_candidates.evaluate_candidates([source], tmp_path / "evaluation.json")
    entry = report["repos"][0]
    assert entry["candidates"] == 7 and entry["positives"] == 2
    keyword = entry["scorers"]["keyword-v1"]
    assert keyword["commitsWithPositive"] == 2
    assert keyword["ifaMean"] == 0.0  # 两个提交的首个正例都被关键字基线排在第 1
    assert keyword["top"]["top1"] == 1.0
    structure = entry["scorers"]["structure-v1"]
    assert structure["ifaMean"] == 0.0  # 正例文本最长，结构基线也排第 1
    random_cells = [key for key in entry["scorers"] if key.startswith("random-")]
    assert len(random_cells) == 3
    assert all(entry["scorers"][key]["ifaMean"] is not None for key in random_cells)
    assert entry["scorers"]["structure-v1"]["budget@10%"]["lines"] == 0


def test_case_pack_marks_weak_labels(tmp_path):
    rows = [_row("c1", "a.py", index, "text", "positive" if index % 2 else "unobserved")
            for index in range(1, 21)]
    source = tmp_path / "rows.jsonl"
    source.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    result = line_candidates.case_pack([source], tmp_path / "cases.json", limit=5)
    pack = json.loads((tmp_path / "cases.json").read_text(encoding="utf-8"))
    assert result["cases"] == 5
    assert len(pack["cases"]) == 5
    assert all(case["labelStatus"] == "positive" for case in pack["cases"])
    assert "未经人工复核" in pack["note"]


def test_renamed_evidence_is_counted_once(tmp_path):
    """SZZ 同时记录新路径与 oldPath 时，同一证据行只算一次。"""
    repo, add, change, renamed, deleted = _repo(tmp_path)
    evidence = [{"introducedCommit": add, "path": "pkg/a.py", "oldPath": "pkg/old-a.py",
                 "lineRanges": [[2, 2]], "fixCommit": "f" * 40, "issueRefs": []}]
    manifest = _manifest(tmp_path, [add], evidence)
    summary = line_candidates.export_candidates(manifest, repo, tmp_path / "c.jsonl")
    assert summary["positives"] == 1
    assert summary["uncoverable"] == 0


def test_missing_repo_is_a_located_error(tmp_path):
    from jit_baseline.errors import BaselineError
    repo, add, _, _, _ = _repo(tmp_path)
    manifest = _manifest(tmp_path, [add], [])
    manifest["collection"]["repository"].pop("path", None)
    import pytest
    with pytest.raises(BaselineError):
        line_candidates.export_candidates(manifest, None, tmp_path / "c.jsonl")
