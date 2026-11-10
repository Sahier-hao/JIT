"""完整候选集导出与行级定位评价。

候选总体事先确定为每个提交的真实 diff 中全部合格新增/修改代码行（side=new），
不从标签挑选或补齐；未在 SZZ 证据中的行是“未观测”，不是已证实无缺陷。
评价只使用固定启发式与固定种子随机排序，不训练模型、不接入产品分析。
"""
from __future__ import annotations

import csv
import json
import random
import re
from pathlib import Path

from .config import BACKEND
from .errors import BaselineError
from .line_dataset import LANGUAGE, _git, _is_source_path, _noise_line

FORMAT = "line-candidates-v1"
POPULATION = "introduced-added-lines-v1"
HUNK = re.compile(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")
RENAME_FROM = re.compile(r"^rename from (.+)$")
RENAME_TO = re.compile(r"^rename to (.+)$")
BUDGETS = (0.10, 0.20)
SEEDS = (42, 43, 44)
KEYWORDS = ("except", "eval(", "exec(", "catch", "panic", "unwrap(", "todo", "fixme",
            "assert", "null", "undefined", "==", "!=")


def _csv_features(manifest):
    """CSV 中全部提交身份，保持文件顺序；不读取特征值。"""
    raw = (manifest.get("file") or {}).get("path")
    if not raw:
        raise BaselineError("INPUT_INVALID", "数据集描述缺少 CSV 路径")
    path = Path(raw) if Path(raw).is_absolute() else BACKEND / raw
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return [row["commit_id"] for row in reader if row.get("commit_id")]


def _evidence(manifest):
    """SZZ 行级证据：{(commit, path): {line: {fixCommit, issueRefs}}}。"""
    collected = {}
    for item in (manifest.get("collection") or {}).get("labelEvidence") or []:
        commit = item.get("introducedCommit")
        if not commit:
            continue
        for path in {item.get("path"), item.get("oldPath")}:
            if not path:
                continue
            for start, end in item.get("lineRanges") or []:
                for line in range(int(start), int(end) + 1):
                    collected.setdefault((commit, path), {})[line] = {
                        "fixCommit": item.get("fixCommit"),
                        "issueRefs": list(item.get("issueRefs") or []),
                        "fixSource": item.get("fixSource"),
                    }
    return collected


def commit_diff(repo, commit):
    """返回 (candidates, renames, exclusions)；candidates 为 (path, line, text)。

    只解析新增/修改侧；删除行、二进制与空 diff 分别计数，不补齐。
    """
    diff = _git(repo, ["show", "--format=", "--unified=0", "--find-renames=50%",
                       "--no-color", commit, "--"], timeout=300)
    exclusions = {"missingDiff": 0, "skippedPath": 0, "noise": 0, "binary": 0, "empty": 0}
    if diff is None:
        exclusions["missingDiff"] += 1
        return [], {}, exclusions
    candidates, renames = [], {}
    current = None
    next_line = None
    pending_from = None
    for line in diff.splitlines():
        match = RENAME_FROM.match(line)
        if match:
            pending_from = match.group(1)
            continue
        match = RENAME_TO.match(line)
        if match and pending_from:
            renames[pending_from] = match.group(1)
            pending_from = None
            continue
        if line.startswith("+++ "):
            raw = line[4:].split("	", 1)[0].strip()
            current = None if raw == "/dev/null" else raw[2:] if raw.startswith("b/") else raw
            next_line = None
            if current is not None and not _is_source_path(current):
                exclusions["skippedPath"] += 1
                current = None
            continue
        if line.startswith("Binary files") or line.startswith("GIT binary patch"):
            exclusions["binary"] += 1
            continue
        if line.startswith("@@"):
            match = HUNK.match(line)
            next_line = int(match.group(1)) if (match and current) else None
            continue
        if current is None or next_line is None or not line.startswith("+"):
            continue
        candidates.append((current, next_line, line[1:]))
        next_line += 1
    if not candidates:
        exclusions["empty"] += 1
    return candidates, renames, exclusions


def export_candidates(manifest, repo, output):
    """导出一个数据集的完整候选集与摘要；正例不可覆盖时单独计数。"""
    repo_path = Path(repo)
    if not repo_path.is_dir():
        raise BaselineError("REPOSITORY_UNAVAILABLE", "完整候选导出需要可读的本地仓库或缓存裸克隆")
    commits = _csv_features(manifest)
    evidence = _evidence(manifest)
    version = manifest.get("version") or manifest.get("dataset")
    repo_name = manifest.get("dataset") or version
    revision = ((manifest.get("collection") or {}).get("repository") or {}).get("head")
    summary = {
        "format": FORMAT, "population": POPULATION, "datasetVersion": version,
        "repo": repo_name, "revision": revision, "commits": len(commits),
        "commitsWithCandidates": 0, "candidates": 0, "positives": 0,
        "uncoverable": 0, "uncoverableReasons": {}, "exclusions": {
            "missingDiff": 0, "skippedPath": 0, "noise": 0, "binary": 0, "empty": 0},
        "byLanguage": {},
    }
    covered = set()
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        for commit in commits:
            lines, renames, exclusions = commit_diff(repo_path, commit)
            for key, value in exclusions.items():
                summary["exclusions"][key] += value
            if lines:
                summary["commitsWithCandidates"] += 1
            for path, line, text in lines:
                stripped = text.strip()
                if not stripped or _noise_line(text):
                    summary["exclusions"]["noise"] += 1
                    continue
                marks = evidence.get((commit, path)) or {}
                for old, new in renames.items():
                    if new == path and old != path:
                        marks = evidence.get((commit, old)) or marks
                evidence_entry = marks.get(line)
                if evidence_entry:
                    covered.add((commit, path, line))
                language = LANGUAGE.get(Path(path).suffix.lower(), "other")
                row = {
                    "schema": FORMAT, "population": POPULATION,
                    "datasetId": manifest.get("dataset"), "datasetVersion": version,
                    "repo": repo_name, "revision": revision, "commitId": commit,
                    "path": path, "side": "new", "line": line, "text": text,
                    "labelStatus": "positive" if evidence_entry else "unobserved",
                    "evidence": evidence_entry,
                    "language": language,
                    "id": f"{commit[:12]}:{path}:{line}",
                }
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
                summary["candidates"] += 1
                summary["byLanguage"][language] = summary["byLanguage"].get(language, 0) + 1
                if evidence_entry:
                    summary["positives"] += 1
    # 证据中不在候选总体里的行：不可覆盖，不是负例。
    for (commit, path), lines in evidence.items():
        for line in lines:
            if (commit, path, line) in covered:
                continue
            if not _is_source_path(path):
                reason = "path-excluded"
            elif any((commit, other, line) in covered for other in renames.values()):
                reason = "line-not-introduced"
            else:
                reason = "line-not-in-diff"
            summary["uncoverable"] += 1
            summary["uncoverableReasons"][reason] = summary["uncoverableReasons"].get(reason, 0) + 1
    summary_path = target.with_suffix(target.suffix + ".summary.json")
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def _keyword_score(text):
    lowered = text.lower()
    hits = sum(1 for token in KEYWORDS if token in lowered)
    return min(hits / 3.0, 1.0)


def _structure_score(text):
    return min(len(text) / 120.0, 1.0)


SCORERS = {
    "structure-v1": _structure_score,
    "keyword-v1": _keyword_score,
}


def _rows(path):
    with Path(path).open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def _score_rows(rows, scorer, seed=None):
    """返回 {id: score}；随机基线按固定种子产生候选规模相同的排列。"""
    if scorer == "random":
        generator = random.Random(seed)
        order = list(range(len(rows)))
        generator.shuffle(order)
        return {rows[index]["id"]: 1.0 - rank / max(len(rows) - 1, 1)
                for rank, index in enumerate(order)}
    return {row["id"]: SCORERS[scorer](row["text"]) for row in rows}


def _commit_metrics(rows, scores, budgets=BUDGETS):
    """按提交分组计算 IFA、Top-K 命中与行预算召回。

    同分时按 (commit, path, line) 固定顺序，预算按整行累计、不拆分。
    """
    groups = {}
    for row in rows:
        groups.setdefault(row["commitId"], []).append(row)
    ifa_values, top = [], {1: 0, 5: 0, 10: 0}
    commits_with_positive = 0
    for commit, items in groups.items():
        ordered = sorted(items, key=lambda item: (-scores[item["id"]], item["path"], item["line"]))
        first = next((index for index, item in enumerate(ordered)
                      if item["labelStatus"] == "positive"), None)
        if first is None:
            continue
        commits_with_positive += 1
        ifa_values.append(first)
        for k in top:
            if first < k:
                top[k] += 1
    total_positive = sum(1 for row in rows if row["labelStatus"] == "positive")
    result = {"candidates": len(rows), "positives": total_positive,
              "commitsWithPositive": commits_with_positive,
              "ifaMean": (sum(ifa_values) / len(ifa_values)) if ifa_values else None,
              "ifaMedian": (sorted(ifa_values)[len(ifa_values) // 2] if ifa_values else None),
              "top": {f"top{k}": (top[k] / commits_with_positive if commits_with_positive else None)
                      for k in top}}
    ordered_all = sorted(rows, key=lambda item: (-scores[item["id"]], item["path"], item["line"]))
    for budget in budgets:
        limit = int(len(ordered_all) * budget)
        selected = ordered_all[:limit]
        hits = sum(1 for item in selected if item["labelStatus"] == "positive")
        result[f"recall@{int(budget * 100)}%"] = hits / total_positive if total_positive else None
        result[f"budget@{int(budget * 100)}%"] = {"lines": limit, "positives": hits}
    return result


def evaluate_candidates(inputs, output):
    """在完整候选总体上评价固定启发式与随机基线；按仓库与语言报告。"""
    per_repo = {}
    rows_by_repo = {}
    for path in inputs:
        for row in _rows(path):
            rows_by_repo.setdefault((row.get("repo"), row.get("datasetVersion")), []).append(row)
    if not rows_by_repo:
        raise BaselineError("INPUT_INVALID", "没有候选行")
    report = {"format": "line-candidate-evaluation-v1", "population": POPULATION,
              "budgets": list(BUDGETS), "scorers": {}, "repos": []}
    for (repo, version), rows in sorted(rows_by_repo.items()):
        language = rows[0].get("language")
        entry = {"repo": repo, "version": version, "language": language,
                 "candidates": len(rows),
                 "positives": sum(1 for row in rows if row["labelStatus"] == "positive"),
                 "scorers": {}}
        for scorer in ("structure-v1", "keyword-v1"):
            entry["scorers"][scorer] = _commit_metrics(rows, _score_rows(rows, scorer))
        for seed in SEEDS:
            entry["scorers"][f"random-{seed}"] = _commit_metrics(
                rows, _score_rows(rows, "random", seed=seed))
        report["repos"].append(entry)
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                      encoding="utf-8")
    return report


def case_pack(inputs, output, *, limit=30, seed=42):
    """跨仓库正例案例包，供人工复核；未复核前不改写任何标签或结论。"""
    rows = []
    for path in inputs:
        for row in _rows(path):
            if row.get("labelStatus") == "positive":
                rows.append(row)
    random.Random(seed).shuffle(rows)
    picked = rows[:limit]
    pack = {"format": "line-candidate-cases-v1", "population": POPULATION,
            "note": "弱标签案例包；未经人工复核前不代表真实缺陷检出率。",
            "cases": picked}
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"cases": len(picked), "output": str(target)}
