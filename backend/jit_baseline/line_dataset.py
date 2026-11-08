"""从 SZZ 行号证据导出行级训练样本（line-szz-v1）。

正例来自数据集描述的 `labelEvidence`；负例来自 CSV 中 label=0 提交的新增行。
只读数据集、CSV 与仓库对象，不写回目录库或模型。
"""
from __future__ import annotations

import csv
import json
import random
import re
import subprocess
from pathlib import Path

from .config import BACKEND
from .errors import BaselineError
from .szz import _is_source_path

SCHEMA = "line-szz-v1"
MAX_POSITIVES = 20000
MAX_NEGATIVES_PER_COMMIT = 50
MAX_NEGATIVE_COMMITS = 300
LANGUAGE = {
    ".py": "python", ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript", ".jsx": "javascript", ".java": "java",
    ".go": "go", ".rs": "rust", ".rb": "ruby", ".php": "php", ".c": "c", ".h": "c",
    ".cc": "cpp", ".cpp": "cpp", ".hpp": "cpp", ".cs": "csharp", ".sh": "shell",
    ".bash": "shell", ".ps1": "powershell", ".sql": "sql", ".html": "html",
    ".css": "css", ".scss": "scss", ".yaml": "yaml", ".yml": "yaml", ".json": "json",
    ".toml": "toml", ".md": "markdown",
}


def _git(repo, args, timeout=120):
    try:
        completed = subprocess.run(["git", "-c", "core.quotePath=false", *args],
                                   cwd=str(repo), capture_output=True, text=True,
                                   encoding="utf-8", errors="replace", timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return completed.stdout if completed.returncode == 0 else None


def _repo_path(manifest, repo):
    if repo is not None:
        path = Path(repo)
    else:
        path = Path((manifest.get("collection") or {}).get("repository", {}).get("path") or "")
    if not path.is_dir():
        raise BaselineError("REPOSITORY_UNAVAILABLE", "行级导出需要可读的本地仓库或缓存裸克隆")
    return path


def _csv_path(manifest):
    file = manifest.get("file") or {}
    raw = file.get("path")
    if not raw:
        raise BaselineError("INPUT_INVALID", "数据集描述缺少 CSV 路径")
    path = Path(raw)
    return path if path.is_absolute() else BACKEND / path


def _features_by_commit(manifest):
    path = _csv_path(manifest)
    if not path.is_file():
        raise BaselineError("DATASET_INVALID", f"CSV 不存在：{path}")
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = [name for name in (reader.fieldnames or []) if name not in ("commit_id", "author_date", "bugcount")]
        features = {}
        for row in reader:
            commit_id = row.get("commit_id")
            if commit_id:
                features[commit_id] = {name: _number(row.get(name)) for name in fields}
    return features


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _content(repo, commit, path, cache):
    key = (commit, path)
    if key not in cache:
        text = _git(repo, ["show", f"{commit}:{path}"])
        cache[key] = text.splitlines() if text is not None else None
    return cache[key]


def _line_row(*, dataset_version, commit, path, line_no, text, before, after, features,
              label, source, fix_commit=None, evidence_ranges=None):
    stripped = text.strip()
    suffix = Path(path).suffix.lower()
    return {
        "schema": SCHEMA,
        "datasetVersion": dataset_version,
        "id": f"{commit[:12]}:{path}:{line_no}",
        "commitId": commit,
        "path": path,
        "line": line_no,
        "label": label,
        "text": text,
        "before": before,
        "after": after,
        "language": LANGUAGE.get(suffix, "other"),
        "lineLength": len(text),
        "indent": len(text) - len(text.lstrip()),
        "blank": not stripped,
        "comment": stripped.startswith(("#", "//", "/*", "*", "--", ";", "<!--")),
        "commitFeatures": features,
        "source": source,
        **({"fixCommit": fix_commit} if fix_commit else {}),
        **({"evidenceRanges": evidence_ranges} if evidence_ranges else {}),
    }


def _positive_rows(manifest, repo, features, context, content_cache, summary):
    version = manifest.get("version") or (manifest.get("dataset") or "")
    evidence = (manifest.get("collection") or {}).get("labelEvidence") or []
    rows, seen = [], set()
    for item in evidence:
        commit = item.get("introducedCommit")
        path = item.get("path") or item.get("oldPath")
        ranges = item.get("lineRanges") or []
        if not commit or not path or not ranges:
            continue
        content = _content(repo, commit, path, content_cache)
        if content is None and item.get("oldPath") and item["oldPath"] != path:
            path = item["oldPath"]
            content = _content(repo, commit, path, content_cache)
        if content is None:
            summary["missingLines"] += 1
            continue
        for start, end in ranges:
            for line_no in range(int(start), int(end) + 1):
                if not 1 <= line_no <= len(content):
                    summary["missingLines"] += 1
                    continue
                key = (commit, path, line_no)
                if key in seen:
                    continue
                seen.add(key)
                rows.append(_line_row(
                    dataset_version=version, commit=commit, path=path, line_no=line_no,
                    text=content[line_no - 1],
                    before=content[max(0, line_no - 1 - context):line_no - 1],
                    after=content[line_no:line_no + context],
                    features=features.get(commit, {}), label=1, source="szz-positive",
                    fix_commit=item.get("fixCommit"), evidence_ranges=ranges,
                ))
                if len(rows) >= MAX_POSITIVES:
                    summary["truncated"] = True
                    return rows
    return rows


def _added_ranges(diff_text):
    current = None
    result = []
    for line in diff_text.splitlines():
        if line.startswith("+++ "):
            path = line[4:].split("\t", 1)[0].strip()
            current = None if path == "/dev/null" else (path[2:] if path.startswith("b/") else path)
            continue
        if not line.startswith("@@ ") or not current:
            continue
        match = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", line)
        if not match:
            continue
        start, count = int(match.group(1)), int(match.group(2) or 1)
        if count > 0:
            result.append((current, start, start + count - 1))
    return result


def _negative_candidates(manifest, repo, features, content_cache, summary, *, limit=5000, seed=42):
    version = manifest.get("version") or (manifest.get("dataset") or "")
    csv_path = _csv_path(manifest)
    with csv_path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        zero = [row for row in reader if row.get("bugcount") in (None, "", "0", "0.0") and row.get("commit_id")]
    random.Random(seed).shuffle(zero)
    negatives = []
    for row in zero[:MAX_NEGATIVE_COMMITS]:
        if len(negatives) >= limit:
            break
        commit = row["commit_id"]
        diff = _git(repo, ["show", "--format=", "--unified=0", "--find-renames=50%", commit, "--"])
        if diff is None:
            summary["missingDiffs"] += 1
            continue
        taken = 0
        for path, start, end in _added_ranges(diff):
            if not _is_source_path(path):
                summary["skippedFiles"] += 1
                continue
            content = _content(repo, commit, path, content_cache)
            if content is None:
                summary["missingLines"] += 1
                continue
            for line_no in range(start, end + 1):
                if taken >= MAX_NEGATIVES_PER_COMMIT or len(negatives) >= limit or not 1 <= line_no <= len(content):
                    break
                negatives.append((commit, path, line_no, content[line_no - 1]))
                taken += 1
            if taken >= MAX_NEGATIVES_PER_COMMIT or len(negatives) >= limit:
                break
    return negatives


def build_line_dataset(manifest, output, *, repo=None, negatives_per_positive=3, context=3, seed=42):
    """导出 line-szz-v1 JSONL 与摘要；返回摘要。"""
    repo_path = _repo_path(manifest, repo)
    features = _features_by_commit(manifest)
    summary = {"schema": SCHEMA, "datasetVersion": manifest.get("version") or manifest.get("dataset"),
               "positives": 0, "negatives": 0, "positiveCommits": 0, "negativeCommits": 0,
               "files": 0, "contextLines": context, "seed": seed,
               "negativesPerPositive": negatives_per_positive,
               "missingLines": 0, "missingDiffs": 0, "skippedFiles": 0,
               "truncated": False, "negativeShortfall": 0}
    cache = {}
    positives = _positive_rows(manifest, repo_path, features, context, cache, summary)
    summary["positives"] = len(positives)
    summary["positiveCommits"] = len({row["commitId"] for row in positives})
    negatives = []
    if positives and negatives_per_positive > 0:
        target = len(positives) * negatives_per_positive
        candidates = _negative_candidates(manifest, repo_path, features, cache, summary,
                                          limit=max(target * 3, 200), seed=seed)
        positive_keys = {(row["commitId"], row["path"], row["line"]) for row in positives}
        candidates = [item for item in candidates if (item[0], item[1], item[2]) not in positive_keys]
        target = min(len(candidates), len(positives) * negatives_per_positive)
        rng = random.Random(seed)
        picked = rng.sample(candidates, target) if target else []
        version = summary["datasetVersion"]
        for commit, path, line_no, text in picked:
            offset = line_no - 1
            content = _content(repo_path, commit, path, cache) or []
            negatives.append(_line_row(
                dataset_version=version, commit=commit, path=path, line_no=line_no, text=text,
                before=content[max(0, offset - context):offset],
                after=content[line_no:line_no + context],
                features=features.get(commit, {}), label=0, source="added-line-negative",
            ))
        summary["negativeShortfall"] = max(0, len(positives) * negatives_per_positive - len(negatives))
    summary["negatives"] = len(negatives)
    summary["negativeCommits"] = len({row["commitId"] for row in negatives})
    rows = positives + negatives
    repo_name = manifest.get("dataset") or summary.get("datasetVersion")
    for row in rows:
        row["repo"] = repo_name
    rows.sort(key=lambda row: (-row["label"], row["commitId"], row["path"], row["line"]))
    summary["files"] = len({row["path"] for row in rows})
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    summary_path = target.with_suffix(target.suffix + ".summary.json")
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary
