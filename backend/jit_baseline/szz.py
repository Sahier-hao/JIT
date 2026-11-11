"""SZZ 标签：simple（文件级）、line（行级）、full（issue/PR + 行级 + 噪声过滤）。

`szz-line-v1` 从修复提交的删除行回溯到引入提交；`szz-full-v1` 在此基础上：
- 优先用 issue/PR 关联确认修复，关键词兜底，并把 issue 元数据快照写入证据；
- 排除回滚、重构、格式化、纯空白改动与文档/测试路径；
- 支持删除文件的行级回溯；
- 记录修复信号、issue 查询与跳过原因，供人工抽样复核。

依赖系统 git；GitHub issue 查询需要 token，离线时如实降级。
"""
from __future__ import annotations

import csv
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .errors import BaselineError

SZZ_SIMPLE_RULE = "szz-simple-v1"
SZZ_LINE_RULE = "szz-line-v1"
SZZ_FULL_RULE = "szz-full-v1"
FIX_PATTERN = re.compile(r"(?i)\b(fix(?:es|ed)?|hotfix|bug(?:fix)?|defect|issue)\b")
STRONG_REF = re.compile(r"(?i)\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+(?:[\w.-]+/[\w.-]+)?#(\d+)")
BARE_REF = re.compile(r"(?<![\w#])#(\d+)")
URL_REF = re.compile(r"https?://github\.com/[\w.-]+/[\w.-]+/(?:issues|pull)/(\d+)")
REVERT_PATTERN = re.compile(r"(?i)^revert\b")
EXCLUDED_MESSAGE = re.compile(r"(?i)^(?:merge|chore|docs?|style|format(?:ting)?|refactor|test|build|ci|lint)\b")
FORMAT_WORDS = re.compile(r"(?i)\b(?:typo|whitespace|format(?:ting)?|lint|style)\b")
BUG_LABEL = re.compile(r"(?i)\b(bug|defect|regression|crash)\b")
METADATA_LINE = re.compile(r'''(?i)^\s*(?:"version"|'version'|version|__version__|versioncode|versionname)\s*[:=]''')
# 文档、测试与二进制不作为缺陷引入行；修复可以同时改源码和测试，只回溯源码路径。
SKIP_PATH = re.compile(
    r"(?i)(^|/)(docs?|documentation|examples?|samples?|fixtures?|testdata|test-data|tests?|specs?)(/|$)"
    r"|\.(md|markdown|rst|adoc|txt|po|pot|png|jpe?g|gif|svg|ico|pdf|lock)$"
)
MAX_FIX_COMMITS = int(os.environ.get("JIT_SZZ_MAX_FIX_COMMITS", "2000") or 2000)
MAX_RANGES_PER_FILE = 50
MAX_LINES_PER_COMMIT = 2000
# 单次采集的行的回溯时间预算；超出即停止并标记截断，避免拖垮分析作业。
MAX_SECONDS = int(os.environ.get("JIT_SZZ_MAX_SECONDS", "120") or 120)
ISSUE_LOOKUP_SECONDS = 5
SZZ_LINE_LIMITATIONS = (
    "标签由行级 SZZ 生成：按修复关键词与 issue 引用识别修复提交，删除/修改行用 git blame 回溯到引入提交。",
    "未关联 issue 的修复、纯新增式修复、强制推送改写历史与跨仓库搬运仍可能漏标；被过滤的文档/测试不作为引入行。",
    "证据保留引入提交中的原始行号，供后续行级缺陷预测使用；同一行被多个修复提交命中时保留多条证据。",
)
SZZ_FULL_LIMITATIONS = (
    "标签由完整 SZZ 流程生成：修复提交优先用 issue/PR 关联确认，关键词兜底；删除/修改行用 git blame 回溯到引入提交。",
    "issue 元数据是采集时的快照；离线或未配置 token 时退化为关键词识别，无法确认 issue 类型。",
    "未关联 issue、纯新增式修复、强制推送改写历史与跨仓库搬运仍可能漏标；文档/测试/纯空白/重构不参与。",
    "人工抽样复核不自动改变标签；可用 szz-sample 导出复核表，结论由人填写。",
)


@dataclass
class FixInfo:
    is_fix: bool
    source: str | None = None
    refs: list[int] = field(default_factory=list)
    snapshots: list[dict] = field(default_factory=list)
    reason: str | None = None


@dataclass
class LineSzzResult:
    rule: str = SZZ_LINE_RULE
    mode: str = "line"
    labels: set[str] = field(default_factory=set)
    evidence: list[dict] = field(default_factory=list)
    fix_commits: int = 0
    unresolved_ranges: int = 0
    skipped_files: int = 0
    skipped_excluded: int = 0
    skipped_whitespace: int = 0
    skipped_noise_lines: int = 0
    skipped_docs_only: int = 0
    outside_window: int = 0
    truncated: bool = False
    fix_signals: dict = field(default_factory=lambda: {"issue": 0, "issueRef": 0, "keyword": 0})
    issue_lookup: dict = field(default_factory=lambda: {"attempted": 0, "succeeded": 0, "failed": 0, "unavailable": 0})
    fix_signal_evidence: list[dict] = field(default_factory=list)

    def stats(self) -> dict:
        return {
            "rule": self.rule,
            "mode": self.mode,
            "fixCommits": self.fix_commits,
            "labeledCommits": len(self.labels),
            "evidencePairs": len(self.evidence),
            "unresolvedRanges": self.unresolved_ranges,
            "skippedFiles": self.skipped_files,
            "skippedExcluded": self.skipped_excluded,
            "skippedWhitespace": self.skipped_whitespace,
            "skippedNoiseLines": self.skipped_noise_lines,
            "skippedDocsOnly": self.skipped_docs_only,
            "outsideWindow": self.outside_window,
            "truncated": self.truncated,
            "fixSignals": dict(self.fix_signals),
            "issueLookup": dict(self.issue_lookup),
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


def _git_status(repo, args, timeout=120):
    command = ["git", "-c", "core.quotePath=false", *args]
    try:
        completed = subprocess.run(command, cwd=str(repo), capture_output=True, text=True,
                                   encoding="utf-8", errors="replace", timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return completed.returncode


def is_fix_subject(subject):
    return bool(FIX_PATTERN.search(subject or "") or STRONG_REF.search(subject or ""))


def is_revert_subject(subject):
    return bool(REVERT_PATTERN.search(subject or ""))


def commit_message(repo, commit_id):
    return _git(repo, ["show", "-s", "--format=%B", commit_id]) or ""


def commit_bodies(repo, ids):
    """一次取回多条提交的完整说明，避免逐条 git show。"""
    if not ids:
        return {}
    command = ["git", "-c", "core.quotePath=false", "log", "--no-walk=unsorted",
               "--format=%x01%H%x02%B%x02", "--stdin"]
    try:
        completed = subprocess.run(command, cwd=str(repo), input="\n".join(ids),
                                   capture_output=True, text=True, encoding="utf-8",
                                   errors="replace", timeout=120, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if completed.returncode != 0:
        return {}
    bodies = {}
    for chunk in completed.stdout.split("\x01"):
        if not chunk.strip():
            continue
        identity, _, body = chunk.partition("\x02")
        bodies[identity.strip()] = body.rstrip("\x02")
    return bodies


def issue_refs(text):
    refs = [int(value) for value in STRONG_REF.findall(text or "")]
    refs.extend(int(value) for value in URL_REF.findall(text or ""))
    refs.extend(int(value) for value in BARE_REF.findall(text or ""))
    return sorted(set(refs))


def _is_source_path(path):
    return bool(path) and not SKIP_PATH.search(path)


def _snapshot_is_bug(snapshot):
    labels = " ".join(snapshot.get("labels") or [])
    return bool(BUG_LABEL.search(labels) or BUG_LABEL.search(snapshot.get("title") or ""))


def classify_message(subject, body="", snapshots=None):
    """返回修复信号；完整模式使用 issue 快照，缺失时降级为关键词。"""
    text = f"{subject or ''}\n{body or ''}"
    if REVERT_PATTERN.search(subject or ""):
        return FixInfo(False, reason="revert")
    snapshots = snapshots or []
    refs = issue_refs(text)
    strong = bool(STRONG_REF.search(text) or URL_REF.search(text))
    if strong:
        source = "issue" if any(_snapshot_is_bug(item) for item in snapshots) else "issueRef"
        return FixInfo(True, source=source, refs=refs, snapshots=snapshots)
    if EXCLUDED_MESSAGE.search(subject or ""):
        return FixInfo(False, refs=refs, reason="excluded")
    if FORMAT_WORDS.search(subject or ""):
        return FixInfo(False, refs=refs, reason="format")
    if FIX_PATTERN.search(subject or ""):
        return FixInfo(True, source="keyword", refs=refs, snapshots=snapshots)
    return FixInfo(False, refs=refs, reason="notFix")


class GitHubResolver:
    """只读查询 issue/PR 元数据；失败按不可用处理，不阻断采集。"""

    def __init__(self, slug, token, timeout=ISSUE_LOOKUP_SECONDS):
        self.slug = slug
        self.token = token
        self.timeout = timeout
        self.cache = {}
        self.failed = False

    def lookup(self, number):
        if number in self.cache:
            return self.cache[number]
        if self.failed or not self.token:
            return None
        request = urllib.request.Request(
            f"https://api.github.com/repos/{self.slug}/issues/{number}",
            headers={"Accept": "application/vnd.github+json", "User-Agent": "jit-szz",
                     "Authorization": f"Bearer {self.token}"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code in (403, 429):
                self.failed = True
            self.cache[number] = None
            return None
        except (urllib.error.URLError, TimeoutError, ValueError):
            self.failed = True
            self.cache[number] = None
            return None
        snapshot = {
            "number": number,
            "title": payload.get("title"),
            "state": payload.get("state"),
            "labels": [label.get("name") for label in payload.get("labels") or [] if label.get("name")],
            "kind": "pr" if payload.get("pull_request") else "issue",
            "url": payload.get("html_url"),
            "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        }
        self.cache[number] = snapshot
        return snapshot


def _github_slug(repo):
    remote = _git(repo, ["remote", "get-url", "origin"]) or ""
    match = re.search(r"github\.com[:/]([\w.-]+)/([\w.-]+?)(?:\.git)?$", remote.strip())
    return f"{match.group(1)}/{match.group(2)}" if match else None


def build_resolver(repo, token=None):
    token = token or os.environ.get("JIT_GITHUB_TOKEN") or os.environ.get("GITHUB_TOKEN")
    slug = _github_slug(repo)
    if not token or not slug:
        return None
    return GitHubResolver(slug, token)


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
            if match and current.get("old"):
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
    """返回 [(commit, orig_line, parent_line)]；失败返回 None。"""
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


def _file_lines(repo, commit, path, cache):
    key = (commit, path)
    if key not in cache:
        text = _git(repo, ["show", f"{commit}:{path}"])
        cache[key] = text.splitlines() if text is not None else None
    return cache[key]


def _noise_line(text):
    stripped = (text or "").strip()
    return not stripped or bool(METADATA_LINE.match(stripped))


def _substantive_ranges(lines, start, end):
    ranges, current = [], None
    for line_no in range(start, end + 1):
        text = lines[line_no - 1] if 1 <= line_no <= len(lines) else ""
        if _noise_line(text):
            if current:
                ranges.append(current)
                current = None
            continue
        if current and line_no == current[1] + 1:
            current[1] = line_no
        else:
            if current:
                ranges.append(current)
            current = [line_no, line_no]
    if current:
        ranges.append(current)
    return ranges


def commit_evidence(repo, commit, *, result: LineSzzResult, mode="line", info=None):
    """计算一个修复提交的引入提交与原始行号证据。"""
    parents = commit.get("parents") or []
    if len(parents) != 1:
        return []
    parent = parents[0]
    if mode == "full":
        # 只改空白/格式的提交不作为修复提交。
        status = _git_status(repo, ["diff", "--quiet", "--ignore-all-space", "--ignore-blank-lines",
                                    parent, commit["id"], "--"])
        if status == 0:
            result.skipped_whitespace += 1
            return []
    diff_args = ["diff", "--unified=0", "--no-color", "--find-renames=50%", "--find-copies=50%",
                 "--diff-filter=AMRD" if mode == "full" else "--diff-filter=AMR",
                 parent, commit["id"], "--"]
    diff_text = _git(repo, diff_args)
    if diff_text is None:
        result.unresolved_ranges += 1
        return []
    pairs, ranges_done = {}, 0
    filtered_files = 0
    capped = False
    content_cache = {}
    for item in _parse_hunks(diff_text):
        if item["binary"]:
            result.skipped_files += 1
            filtered_files += 1
            continue
        path = item["new"] or item["old"]
        if not item["old"] or not path:
            continue
        if not _is_source_path(path):
            result.skipped_files += 1
            filtered_files += 1
            continue
        merged_ranges = _merge_ranges(item["ranges"])
        if len(merged_ranges) > MAX_RANGES_PER_FILE:
            result.truncated = True
        for start, end in merged_ranges[:MAX_RANGES_PER_FILE]:
            parent_lines = _file_lines(repo, parent, item["old"], content_cache)
            parts = _substantive_ranges(parent_lines, start, end) if parent_lines is not None else [[start, end]]
            if parent_lines is not None and not parts:
                result.skipped_noise_lines += 1
                continue
            for sub_start, sub_end in parts:
                if ranges_done >= MAX_LINES_PER_COMMIT:
                    result.truncated = True
                    capped = True
                    break
                remaining = MAX_LINES_PER_COMMIT - ranges_done
                if sub_end - sub_start + 1 > remaining:
                    sub_end = sub_start + remaining - 1
                    result.truncated = True
                blamed = _blame(repo, parent, item["old"], sub_start, sub_end)
                if blamed is None:
                    result.unresolved_ranges += 1
                    continue
                ranges_done += sub_end - sub_start + 1
                old_path = item["old"] if item["old"] != item["new"] else None
                for identity, orig, final in blamed:
                    if identity == commit["id"]:
                        continue
                    pairs.setdefault((identity, path, old_path), []).append((orig, final))
            if capped:
                break
        if capped:
            break
    evidence = []
    for (identity, path, old_path), lines in sorted(pairs.items()):
        line_ranges = _merge_ranges([[line, line] for line, _final in sorted(set(lines))])
        parent_ranges = _merge_ranges([[final, final] for _line, final in sorted(set(lines))])
        if len(line_ranges) > MAX_RANGES_PER_FILE:
            line_ranges = line_ranges[:MAX_RANGES_PER_FILE]
            parent_ranges = parent_ranges[:MAX_RANGES_PER_FILE]
            result.truncated = True
        entry = {
            "introducedCommit": identity,
            "fixCommit": commit["id"],
            "path": path,
            "oldPath": old_path,
            "lineRanges": line_ranges,
            "parentRanges": parent_ranges,
            "fixTime": _iso(commit.get("time")),
        }
        if info is not None:
            entry["fixSource"] = info.source
            entry["issueRefs"] = info.refs
        evidence.append(entry)
    if not evidence and filtered_files and ranges_done == 0:
        result.skipped_docs_only += 1
    return evidence


def _iso(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return str(value)


def label_repository(repo, entries, window_ids, start=None, end=None, mode="line", resolver=None):
    """对窗口内的修复提交做回溯；只把窗口内提交标为正例。"""
    result = LineSzzResult(mode=mode, rule=SZZ_FULL_RULE if mode == "full" else SZZ_LINE_RULE)
    candidates = []
    for commit in entries:
        if start is not None and commit["epoch"] < start:
            continue
        if end is not None and commit["epoch"] >= end:
            continue
        if len(commit.get("parents") or []) > 1:
            if mode == "full":
                result.skipped_excluded += 1
            continue
        if not commit.get("files"):
            continue
        candidates.append(commit)
    if mode == "full" and resolver is None:
        result.issue_lookup["unavailable"] = 1
    bodies = commit_bodies(repo, [commit["id"] for commit in candidates]) if mode == "full" else {}
    fix_commits = []
    for commit in candidates:
        if mode == "line":
            if not is_fix_subject(commit.get("subject")) or is_revert_subject(commit.get("subject")):
                if is_revert_subject(commit.get("subject")):
                    result.skipped_excluded += 1
                continue
            info = FixInfo(True, source="keyword")
        else:
            body = bodies.get(commit["id"]) or commit_message(repo, commit["id"])
            text = f"{commit.get('subject') or ''}\n{body}"
            refs = issue_refs(text)
            strong = ([int(value) for value in STRONG_REF.findall(text)] +
                      [int(value) for value in URL_REF.findall(text)])
            if not is_fix_subject(commit.get("subject")) and not refs:
                continue
            snapshots = []
            if resolver is not None:
                for number in sorted(set(strong)):
                    result.issue_lookup["attempted"] += 1
                    snapshot = resolver.lookup(number)
                    if snapshot is None:
                        result.issue_lookup["failed"] += 1
                    else:
                        result.issue_lookup["succeeded"] += 1
                        snapshots.append(snapshot)
            info = classify_message(commit.get("subject"), body, snapshots)
            if not info.is_fix:
                if info.reason in ("excluded", "format"):
                    result.skipped_excluded += 1
                continue
        result.fix_signals[info.source or "keyword"] = result.fix_signals.get(info.source or "keyword", 0) + 1
        if mode == "full":
            result.fix_signal_evidence.append({
                "fixCommit": commit["id"],
                "source": info.source,
                "issueRefs": info.refs,
                "issues": info.snapshots,
                "fixTime": _iso(commit.get("time")),
            })
        fix_commits.append((commit, info))
    if len(fix_commits) > MAX_FIX_COMMITS:
        result.truncated = True
        fix_commits = fix_commits[:MAX_FIX_COMMITS]
    result.fix_commits = len(fix_commits)
    deadline = time.monotonic() + MAX_SECONDS
    for commit, info in fix_commits:
        if time.monotonic() > deadline:
            result.truncated = True
            break
        for item in commit_evidence(repo, commit, result=result, mode=mode, info=info):
            if item["introducedCommit"] not in window_ids:
                result.outside_window += 1
                continue
            result.labels.add(item["introducedCommit"])
            result.evidence.append(item)
    return result


def sample_evidence(manifest, repo=None, limit=100):
    """导出一份人工复核表；不改变标签。"""
    collection = manifest.get("collection") or {}
    evidence = collection.get("labelEvidence") or []
    signals = {item.get("fixCommit"): item for item in collection.get("fixSignals") or []}
    rows = []
    for item in evidence[:limit]:
        fix = item.get("fixCommit") or ""
        introduced = item.get("introducedCommit") or ""
        signal = signals.get(fix) or {}
        row = {
            "fixCommit": fix,
            "introducedCommit": introduced,
            "path": item.get("path") or "",
            "lineRanges": item.get("lineRanges") or "",
            "parentRanges": item.get("parentRanges") or "",
            "fixTime": item.get("fixTime") or "",
            "fixSource": item.get("fixSource") or signal.get("source") or "",
            "issueRefs": item.get("issueRefs") or signal.get("issueRefs") or "",
            "introducedSubject": "",
            "fixSubject": "",
            "verdict": "",
            "note": "",
        }
        if repo is not None:
            row["introducedSubject"] = (_git(repo, ["show", "-s", "--format=%s", introduced]) or "").strip()
            row["fixSubject"] = (_git(repo, ["show", "-s", "--format=%s", fix]) or "").strip()
        rows.append(row)
    return rows


def write_sample_csv(rows, path):
    fields = ["fixCommit", "introducedCommit", "path", "lineRanges", "parentRanges", "fixTime",
              "fixSource", "issueRefs", "introducedSubject", "fixSubject", "verdict", "note"]
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return target
