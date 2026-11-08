"""行级 SZZ 标签（szz-line-v1）：从修复提交的删除行回溯到引入提交与原始行号。

与 `szz-simple-v1` 的区别：
- 修复提交按关键词与 issue 引用识别，排除回滚提交与合并提交；
- 对修复提交的父提交做 `git diff -M -C`，只取被删除/修改的行区间；
- 用 `git blame --line-porcelain -M -C` 把这些行回溯到引入提交，保留引入提交中的原始行号；
- 跳过文档、测试与二进制路径，限制单次修复的回溯范围，无法回溯时如实记入统计。

依赖系统 git；仓库已由 collect 校验，本模块只读。
"""
from __future__ import annotations

import re
import subprocess
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .errors import BaselineError

SZZ_LINE_RULE = "szz-line-v1"
FIX_PATTERN = re.compile(r"(?i)\b(fix(?:es|ed)?|hotfix|bug(?:fix)?|defect|issue)\b")
ISSUE_PATTERN = re.compile(r"(?i)\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#\d+")
REVERT_PATTERN = re.compile(r"(?i)^revert\b")
# 文档、测试与二进制不作为缺陷引入行；修复可以同时改源码和测试，只回溯源码路径。
SKIP_PATH = re.compile(
    r"(?i)(^|/)(docs?|documentation|examples?|samples?|fixtures?|testdata|test-data|tests?|specs?)(/|$)"
    r"|\.(md|markdown|rst|adoc|txt|po|pot|png|jpe?g|gif|svg|ico|pdf|lock)$"
)
MAX_FIX_COMMITS = 2000
MAX_RANGES_PER_FILE = 50
MAX_LINES_PER_COMMIT = 2000
# 单次采集的行级回溯时间预算；超出即停止并标记截断，避免拖垮分析作业。
MAX_SECONDS = 120
SZZ_LINE_LIMITATIONS = (
    "标签由行级 SZZ 生成：按修复关键词与 issue 引用识别修复提交，删除/修改行用 git blame 回溯到引入提交。",
    "未关联 issue 的修复、纯新增式修复、强制推送改写历史与跨仓库搬运仍可能漏标；被过滤的文档/测试不作为引入行。",
    "证据保留引入提交中的原始行号，供后续行级缺陷预测使用；同一行被多个修复提交命中时保留多条证据。",
)


@dataclass
class LineSzzResult:
    rule: str = SZZ_LINE_RULE
    labels: set[str] = field(default_factory=set)
    evidence: list[dict] = field(default_factory=list)
    fix_commits: int = 0
    unresolved_ranges: int = 0
    skipped_files: int = 0
    outside_window: int = 0
    truncated: bool = False

    def stats(self) -> dict:
        return {
            "rule": self.rule,
            "fixCommits": self.fix_commits,
            "labeledCommits": len(self.labels),
            "evidencePairs": len(self.evidence),
            "unresolvedRanges": self.unresolved_ranges,
            "skippedFiles": self.skipped_files,
            "outsideWindow": self.outside_window,
            "truncated": self.truncated,
        }


def _git(repo, args, timeout=120):
    command = ["git", "-c", "core.quotePath=false", *args]
    try:
        completed = subprocess.run(command, cwd=str(repo), capture_output=True, text=True,
                                   encoding="utf-8", errors="replace", timeout=timeout, check=False)
    except OSError as exc:
        raise BaselineError("REPOSITORY_UNAVAILABLE", "找不到 git 可执行文件") from exc
    except subprocess.TimeoutExpired:
        return None
    if completed.returncode != 0:
        return None
    return completed.stdout


def is_fix_subject(subject):
    return bool(FIX_PATTERN.search(subject or "") or ISSUE_PATTERN.search(subject or ""))


def is_revert_subject(subject):
    return bool(REVERT_PATTERN.search(subject or ""))


def _is_source_path(path):
    return bool(path) and not SKIP_PATH.search(path)


def _parse_hunks(diff_text):
    """返回 [{old,new,ranges,binary}]；ranges 是父提交中被删除/修改的行区间。"""
    files, current = [], None
    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            if current is not None:
                files.append(current)
            current = {"old": None, "new": None, "ranges": [], "binary": False}
            continue
        if current is None:
            continue
        if line.startswith("Binary files ") or line == "GIT binary patch":
            current["binary"] = True
            continue
        if line.startswith("rename from "):
            current["old"] = line[len("rename from "):].strip()
            continue
        if line.startswith("rename to "):
            current["new"] = line[len("rename to "):].strip()
            continue
        if line.startswith("--- "):
            path = line[4:].split("\t", 1)[0].strip()
            current["old"] = None if path == "/dev/null" else (path[2:] if path.startswith("a/") else path)
            continue
        if line.startswith("+++ "):
            path = line[4:].split("\t", 1)[0].strip()
            current["new"] = None if path == "/dev/null" else (path[2:] if path.startswith("b/") else path)
            continue
        if line.startswith("@@ "):
            match = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", line)
            if match and current.get("old") and current["new"]:
                start, count = int(match.group(1)), int(match.group(2) or 1)
                if count > 0:
                    current["ranges"].append([start, start + count - 1])
    if current is not None:
        files.append(current)
    return files


def _merge_ranges(ranges):
    merged = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def _blame(repo, parent, path, start, end):
    """返回 [(commit, orig_line)]；失败返回 None。"""
    output = _git(repo, ["blame", "--line-porcelain", "-M", "-C",
                         "-L", f"{start},{end}", parent, "--", path])
    if output is None:
        return None
    blamed = []
    for line in output.splitlines():
        match = re.match(r"^\^?([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$", line)
        if not match:
            continue
        identity, orig, final = match.group(1), int(match.group(2)), int(match.group(3))
        count = int(match.group(4) or 1)
        if set(identity) == {"0"}:
            continue
        blamed.extend((identity, orig + offset, final + offset) for offset in range(count))
    return blamed


def commit_evidence(repo, commit, *, result: LineSzzResult):
    """计算一个修复提交的引入提交与原始行号证据。"""
    parents = commit.get("parents") or []
    if len(parents) != 1:
        return []
    parent = parents[0]
    diff_text = _git(repo, ["diff", "--unified=0", "--no-color", "--find-renames=50%",
                            "--find-copies=50%", "--diff-filter=AMR", parent, commit["id"], "--"])
    if diff_text is None:
        result.unresolved_ranges += 1
        return []
    evidence, ranges_done = [], 0
    for item in _parse_hunks(diff_text):
        if item["binary"] or not item["old"] or not item["new"]:
            if item["binary"]:
                result.skipped_files += 1
            continue
        if not _is_source_path(item["old"]):
            result.skipped_files += 1
            continue
        merged_ranges = _merge_ranges(item["ranges"])
        if len(merged_ranges) > MAX_RANGES_PER_FILE:
            result.truncated = True
        for start, end in merged_ranges[:MAX_RANGES_PER_FILE]:
            if ranges_done >= MAX_LINES_PER_COMMIT:
                result.truncated = True
                return evidence
            remaining = MAX_LINES_PER_COMMIT - ranges_done
            if end - start + 1 > remaining:
                end = start + remaining - 1
                result.truncated = True
            blamed = _blame(repo, parent, item["old"], start, end)
            if blamed is None:
                result.unresolved_ranges += 1
                continue
            ranges_done += end - start + 1
            by_commit = {}
            for identity, orig, final in blamed:
                if identity == commit["id"]:
                    continue
                by_commit.setdefault(identity, []).append((orig, final))
            for identity, lines in by_commit.items():
                line_ranges = _merge_ranges([[line, line] for line, _final in sorted(set(lines))])
                parent_ranges = _merge_ranges([[final, final] for _line, final in sorted(set(lines))])
                evidence.append({
                    "introducedCommit": identity,
                    "fixCommit": commit["id"],
                    "path": item["new"] or item["old"],
                    "oldPath": item["old"] if item["old"] != item["new"] else None,
                    "lineRanges": line_ranges,
                    "parentRanges": parent_ranges,
                    "fixTime": _iso(commit.get("time")),
                })
    return evidence


def _iso(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return str(value)


def label_repository(repo, entries, window_ids, start=None, end=None):
    """对窗口内的修复提交做行级回溯；只把窗口内提交标为正例。"""
    result = LineSzzResult()
    fix_commits = []
    for commit in entries:
        if len(commit.get("parents") or []) > 1:
            continue
        if not commit.get("files"):
            continue
        if start is not None and commit["epoch"] < start:
            continue
        if end is not None and commit["epoch"] >= end:
            continue
        if not is_fix_subject(commit.get("subject")) or is_revert_subject(commit.get("subject")):
            continue
        fix_commits.append(commit)
    if len(fix_commits) > MAX_FIX_COMMITS:
        result.truncated = True
        fix_commits = fix_commits[:MAX_FIX_COMMITS]
    result.fix_commits = len(fix_commits)
    deadline = time.monotonic() + MAX_SECONDS
    for commit in fix_commits:
        if time.monotonic() > deadline:
            result.truncated = True
            break
        for item in commit_evidence(repo, commit, result=result):
            if item["introducedCommit"] not in window_ids:
                result.outside_window += 1
                continue
            result.labels.add(item["introducedCommit"])
            result.evidence.append(item)
    return result
