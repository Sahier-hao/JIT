"""从 Git 仓库采集提交，计算 Kamei 14 维特征并生成简化 SZZ 标签（RCL-01..RCL-06）。

只读仓库：本地路径不修改，远程来源克隆到临时目录采集后删除。产物是与
`kamei14-git-v1` 对齐的 CSV 与数据集描述文件，复用 `store.register` / `store.import_dataset`
进入既有登记、入库与训练链路。特征为提交级聚合、标签为简化 SZZ，两项限制随产物记录。
"""
import csv
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from ipaddress import ip_address
from pathlib import Path
from urllib.parse import urlparse

from .errors import BaselineError
from .schemas import resolve

SCHEMA_NAME = "kamei14-git-v1"
SZZ_RULE = "szz-simple-v1"
SZZ_PATTERN = r"(?i)\b(fix(?:es|ed)?|hotfix|bug(?:fix)?|defect|issue)\b"
RECENT_DAYS = 90
MAX_COMMITS = 50000
TEXT_RULE = "diff-bound-v1"
TEXT_MAX_LINES_PER_FILE = 80
TEXT_MAX_BYTES_PER_COMMIT = 8192
LIMITATIONS = (
    "特征为提交级聚合，与 Kamei 论文的文件级样本单位不同。",
    "标签由简化 SZZ 生成，未处理重命名、跨文件传播与 issue 关联，不是完整 SZZ。",
)
MAX_EPOCH = 2_147_483_647
# git 自身不读 Windows 系统代理：浏览器能打开 GitHub 时克隆仍会直连并长时间卡住。
# 显式环境变量优先，其次系统代理设置；两者都没有时保持直连。
PROXY_ENV = ("JIT_GIT_PROXY", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy")
# 传输速度持续低于该阈值即判定网络停滞，避免干等到 900 秒命令超时。
STALL_LIMIT = 1024
STALL_SECONDS = 60
# 秒数可覆盖：慢速但存活的链路把阈值放宽，设 0 关闭停滞判定。
STALL_ENV = "JIT_GIT_STALL_SECONDS"


def normalize_proxy(value):
    """把代理设置规范成 git 可用的 URL；空值返回 None。"""
    text = str(value or "").strip()
    if not text:
        return None
    if "://" not in text:
        text = "http://" + text
    return text


def _proxy_from_server(server):
    """解析 WinINET 的 ProxyServer：可能是 host:port，也可能是 http=h:p;https=h:p。"""
    text = str(server or "").strip()
    if "=" in text:
        entries = {}
        for item in text.split(";"):
            name, _, value = item.partition("=")
            if value.strip():
                entries[name.strip().lower()] = value.strip()
        text = entries.get("https") or entries.get("http") or ""
    return normalize_proxy(text)


def windows_proxy():
    """读取当前用户 Windows 系统代理；未启用或非 Windows 返回 None。"""
    if os.name != "nt":
        return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\CurrentVersion\Internet Settings") as key:
            enabled = winreg.QueryValueEx(key, "ProxyEnable")[0]
            server = winreg.QueryValueEx(key, "ProxyServer")[0]
    except (OSError, TypeError):
        return None
    return _proxy_from_server(server) if enabled else None


def proxy_url():
    """采集使用的代理地址：环境变量优先，其次 Windows 系统代理。"""
    for name in PROXY_ENV:
        value = normalize_proxy(os.environ.get(name))
        if value:
            return value
    return windows_proxy()


def stall_seconds():
    """停滞判定秒数：默认 `STALL_SECONDS`，可由环境变量覆盖，`0` 表示关闭判定。

    慢速但存活的链路（大仓库、限速出口）需要放宽或关掉，否则 60 秒就会被判停滞；
    取值非法时退回默认，不因为一个坏配置把采集变成无保护。
    """
    raw = os.environ.get(STALL_ENV)
    if raw is None or not str(raw).strip():
        return STALL_SECONDS
    try:
        value = int(str(raw).strip())
    except ValueError:
        return STALL_SECONDS
    return value if value >= 0 else STALL_SECONDS


def _command(cwd, args, use_proxy=True):
    """git 命令：附带代理与停滞阈值，确保克隆既走代理也不会无限等待。

    `use_proxy=False` 生成显式直连命令（不带 `http.proxy`），供代理失败后回退使用。
    """
    command = ["git", "--no-pager", "-c", "core.quotepath=false"]
    seconds = stall_seconds()
    if seconds:
        command += ["-c", f"http.lowSpeedLimit={STALL_LIMIT}",
                    "-c", f"http.lowSpeedTime={seconds}"]
    proxy = proxy_url() if use_proxy else None
    if proxy:
        command += ["-c", f"http.proxy={proxy}"]
    return command + ["-C", str(cwd)] + [str(arg) for arg in args]


def _run(cwd, args, check=True, use_proxy=True):
    command = _command(cwd, args, use_proxy=use_proxy)
    try:
        completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8",
                                   errors="replace", timeout=900, check=False)
    except OSError as exc:
        raise BaselineError("REPOSITORY_UNAVAILABLE", "找不到 git 可执行文件") from exc
    except subprocess.TimeoutExpired as exc:
        raise BaselineError("REPOSITORY_UNAVAILABLE", "git 命令超时，请缩小范围") from exc
    if check and completed.returncode != 0:
        lines = [line for line in (completed.stderr or "").splitlines() if line.strip()]
        raise BaselineError("REPOSITORY_UNAVAILABLE",
                            f"git 命令失败：{lines[-1] if lines else completed.returncode}")
    return completed


def repository(path):
    """校验并返回仓库路径；不是 Git 仓库即失败，不退回其它来源。"""
    path = Path(path).resolve()
    if not path.is_dir():
        raise BaselineError("REPOSITORY_UNAVAILABLE", f"仓库路径不可用：{path}")
    result = _run(path, ["rev-parse", "--git-dir"], check=False)
    if result.returncode != 0:
        raise BaselineError("REPOSITORY_UNAVAILABLE", f"不是 Git 仓库：{path.name}")
    return path


def head(repo, branch="HEAD"):
    result = _run(repo, ["rev-parse", branch], check=False)
    if result.returncode != 0:
        raise BaselineError("REPOSITORY_UNAVAILABLE", f"分支或提交不可用：{branch}")
    return result.stdout.strip()


def git_version():
    result = _run(Path.cwd(), ["version"], check=False)
    return result.stdout.strip() if result.returncode == 0 else "unknown"


def parse_time(text):
    """把 `YYYY-MM-DD` 或 ISO 时间解析成 UTC epoch；无时区按 UTC。"""
    if text is None:
        return None
    try:
        parsed = datetime.fromisoformat(str(text))
    except ValueError as exc:
        raise BaselineError("INPUT_INVALID", f"时间格式无效：{text}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def _inside(epoch, start, end):
    return (start is None or epoch >= start) and (end is None or epoch < end)


def _entries(repo, branch):
    """一次 `git log` 取回提交、作者、作者时间与 numstat；返回提交与无法解析行数。"""
    text = _run(repo, ["log", branch, "--reverse", "--no-merges", "--no-renames", "--numstat",
                       "--format=%x01%H%x02%P%x02%an%x02%ae%x02%aI%x02%s"]).stdout
    commits, unparsed = [], 0
    current = None
    for line in text.splitlines():
        if not line.strip():
            continue
        if line.startswith("\x01"):
            parts = line[1:].split("\x02")
            if len(parts) != 6:
                unparsed += 1
                current = None
                continue
            identity, parents, author, email, moment, subject = parts
            try:
                parsed = datetime.fromisoformat(moment)
            except ValueError:
                unparsed += 1
                current = None
                continue
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            current = {"id": identity, "parents": parents.split(), "author": author, "email": email,
                       "time": parsed.astimezone(timezone.utc), "epoch": int(parsed.timestamp()),
                       "subject": subject, "files": []}
            commits.append(current)
            continue
        if current is None:
            continue
        parts = line.split("\t")
        if len(parts) != 3:
            unparsed += 1
            continue
        added, deleted, path = parts
        binary = added == "-" or deleted == "-"
        if binary:
            current["files"].append({"path": path, "added": 0, "deleted": 0, "binary": True})
            continue
        try:
            current["files"].append({"path": path, "added": int(added), "deleted": int(deleted), "binary": False})
        except ValueError:
            unparsed += 1
    return commits, unparsed


def _merge_epochs(repo, branch):
    result = _run(repo, ["log", branch, "--merges", "--format=%aI"], check=False)
    if result.returncode != 0:
        return []
    epochs = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            parsed = datetime.fromisoformat(line)
        except ValueError:
            continue
        epochs.append(int(parsed.timestamp()))
    return epochs


def _subsystem(path):
    return path.split("/", 1)[0] if "/" in path else ""


def _directory(path):
    return path.rsplit("/", 1)[0] if "/" in path else ""


def _patch_by_commit(repo, branch):
    """一次 `git log -p` 取回每个提交的补丁文本。"""
    text = _run(repo, ["log", branch, "--reverse", "--no-merges", "--no-renames",
                       "--patch", "--unified=0", "--format=%x01%H"]).stdout
    patches, current = {}, None
    for line in text.splitlines():
        if line.startswith("\x01"):
            current = line[1:].strip()
            patches[current] = []
        elif current is not None:
            patches[current].append(line)
    return patches


def _bound_patch(lines):
    """按固定规则截断一个提交的补丁：每文件 80 行、每提交 8KB、跳过二进制。"""
    files, current = [], None
    for line in lines:
        if line.startswith("diff --git "):
            path = line.split(" b/", 1)[-1] if " b/" in line else line
            current = {"path": path, "lines": []}
            files.append(current)
        elif current is not None:
            current["lines"].append(line)
    kept, skipped, truncated, used = [], [], False, 0
    for index, item in enumerate(files):
        if any("Binary files" in line for line in item["lines"]):
            skipped.append(item["path"])
            continue
        clipped = item["lines"][:TEXT_MAX_LINES_PER_FILE]
        if len(clipped) < len(item["lines"]):
            truncated = True
        chunk = f"diff --git a/{item['path']} b/{item['path']}\n" + "\n".join(clipped)
        size = len(chunk.encode("utf-8"))
        if used + size > TEXT_MAX_BYTES_PER_COMMIT:
            truncated = True
            skipped.extend(item["path"] for item in files[index:]
                           if not any("Binary files" in line for line in item["lines"]))
            break
        kept.append(chunk)
        used += size
    return "\n".join(kept), truncated, skipped


def text_entries(repo, branch, records):
    """为每个纳入提交生成有界文本记录，顺序与 records 一致。"""
    patches = _patch_by_commit(repo, branch)
    entries = []
    for record in records:
        diff, truncated, skipped = _bound_patch(patches.get(record["id"], []))
        entries.append({"commit_id": record["id"], "subject": record["subject"],
                        "diff": diff, "truncated": truncated, "skippedFiles": skipped})
    return entries


def _jsonl_bytes(entries):
    if not entries:
        return b""
    return b"\n".join(json.dumps(entry, ensure_ascii=False, sort_keys=True).encode("utf-8")
                      for entry in entries) + b"\n"


class _History:
    """单遍历史索引：文件与作者的既往状态，随遍历推进。"""

    def __init__(self):
        self.file_lines = {}
        self.file_last = {}
        self.file_authors = {}
        self.file_count = {}
        self.author_epochs = {}
        self.author_dirs = {}

    def advance(self, commit):
        paths = [item["path"] for item in commit["files"]]
        for item in commit["files"]:
            path = item["path"]
            self.file_last[path] = (commit["id"], commit["epoch"])
            self.file_authors.setdefault(path, set()).add(commit["email"])
            self.file_count[path] = self.file_count.get(path, 0) + 1
            before = self.file_lines.get(path, 0)
            self.file_lines[path] = max(0, before + item["added"] - item["deleted"])
        self.author_epochs.setdefault(commit["email"], []).append(commit["epoch"])
        for subsystem in {_subsystem(path) for path in paths}:
            key = (commit["email"], subsystem)
            self.author_dirs[key] = self.author_dirs.get(key, 0) + 1

    def features(self, commit):
        files = commit["files"]
        paths = [item["path"] for item in files]
        subsystems = {_subsystem(path) for path in paths}
        directories = {_directory(path) for path in paths}
        added = sum(item["added"] for item in files)
        deleted = sum(item["deleted"] for item in files)
        churn = [item["added"] + item["deleted"] for item in files]
        total = sum(churn)
        entropy = 0.0
        if total > 0:
            entropy = -sum((value / total) * math.log(value / total) for value in churn if value > 0)
        ages = [(commit["epoch"] - self.file_last[path][1]) / 86400 for path in paths if path in self.file_last]
        author_epochs = self.author_epochs.get(commit["email"], [])
        recent = commit["epoch"] - RECENT_DAYS * 86400
        return {
            "ns": len(subsystems),
            "nd": len(directories),
            "nf": len(files),
            "entropy": entropy,
            "la": added,
            "ld": deleted,
            "lt": sum(self.file_lines.get(path, 0) for path in paths),
            "fix": 1 if re.search(SZZ_PATTERN, commit["subject"] or "") else 0,
            "ndev": sum(len(self.file_authors.get(path, ())) for path in paths),
            "age": (sum(ages) / len(ages)) if ages else 0.0,
            "nuc": sum(self.file_count.get(path, 0) for path in paths),
            "exp": len(author_epochs),
            "rexp": sum(1 for epoch in author_epochs if epoch >= recent),
            "sexp": sum(self.author_dirs.get((commit["email"], subsystem), 0) for subsystem in subsystems),
        }


def collect(repo, since=None, until=None, branch="HEAD", limit=None, with_text=False):
    """采集一个仓库的提交窗口；返回记录、标签统计、采集证据与 CSV 字节。"""
    repo = repository(repo)
    start, end = parse_time(since), parse_time(until)
    if start is not None and end is not None and start >= end:
        raise BaselineError("INPUT_INVALID", "起始时间必须早于结束时间")
    entries, unparsed = _entries(repo, branch)
    entries.sort(key=lambda commit: (commit["epoch"], commit["id"]))
    merges = _merge_epochs(repo, branch)
    excluded = {"merges": sum(1 for epoch in merges if _inside(epoch, start, end)),
                "empty": 0, "outsideWindow": 0, "unparsed": unparsed}
    window = [commit for commit in entries if _inside(commit["epoch"], start, end)]
    excluded["outsideWindow"] = len(entries) - len(window)
    if not window:
        raise BaselineError("DATASET_INVALID",
                            "采集范围内没有提交，请调整起始日期、结束日期或分支")
    if limit is not None and len(window) > limit:
        raise BaselineError("DATASET_INVALID",
                            f"范围内提交数 {len(window)} 超过上限 {limit}，请缩小范围")

    history = _History()
    pending, records = [], []
    skipped = {"noEarlierChange": 0, "outsideWindow": 0}
    for commit in entries:
        if _inside(commit["epoch"], start, end):
            break
        history.advance(commit)

    labels = set()
    fix_commits = 0
    for commit in window:
        if not commit["files"]:
            excluded["empty"] += 1
            continue
        metrics = history.features(commit)
        if metrics["fix"]:
            fix_commits += 1
            for item in commit["files"]:
                previous = history.file_last.get(item["path"])
                if previous is None:
                    skipped["noEarlierChange"] += 1
                    continue
                identity, epoch = previous
                if start is not None and epoch < start:
                    skipped["outsideWindow"] += 1
                    continue
                labels.add(identity)
        records.append({"id": commit["id"], "epoch": commit["epoch"],
                        "time": commit["time"].isoformat(timespec="seconds").replace("+00:00", "Z"),
                        "subject": commit["subject"], "authorName": commit["author"], "metrics": metrics})
        history.advance(commit)

    names = resolve(SCHEMA_NAME).in_model_names()
    for record in records:
        record["label"] = 1 if record["id"] in labels else 0
        record["labelRule"] = SZZ_RULE if record["label"] else None
        record["labelNote"] = (None if record["label"]
                               else "未观测到缺陷引入（简化 SZZ），不等于已证实无缺陷")
        record["features"] = [record["metrics"][name] for name in names]

    blob = _csv_bytes(records, names)
    collection = {
        "kind": "git-repository",
        "repository": {"path": str(repo), "head": head(repo, branch), "branch": branch,
                       "resolvedBranch": _run(repo, ['rev-parse', '--abbrev-ref', branch]).stdout.strip()},
        "window": {"since": since, "until": until, "startEpoch": start, "endEpoch": end},
        "gitVersion": git_version(),
        "szz": {"rule": SZZ_RULE, "pattern": SZZ_PATTERN, "fixCommits": fix_commits,
                "labeledCommits": len(labels), "unresolved": dict(skipped)},
        "counts": {"commitsInWindow": len(window), "records": len(records),
                   "excluded": excluded,
                   "binaryFiles": sum(1 for commit in window for item in commit["files"]
                                      if item["binary"])},
        "limitations": list(LIMITATIONS),
    }
    text = None
    if with_text:
        entries = text_entries(repo, branch, records)
        text = {"records": entries, "bytes": _jsonl_bytes(entries), "rule": TEXT_RULE,
                "truncated": sum(1 for entry in entries if entry["truncated"]),
                "skippedFiles": sum(len(entry["skippedFiles"]) for entry in entries)}
    return {"records": records, "csv": blob, "collection": collection, "excluded": excluded,
            "skipped": skipped, "fixCommits": fix_commits, "labeled": len(labels), "text": text}


def _csv_bytes(records, names):
    stream = io.StringIO()
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(["commit_id", "author_date", "bugcount"] + list(names))
    for record in records:
        cells = [record["id"], record["epoch"], record["label"]]
        for name in names:
            value = record["metrics"][name]
            cells.append(repr(value) if isinstance(value, float) else value)
        writer.writerow(cells)
    return stream.getvalue().encode("utf-8")


def cohort(since=None, until=None):
    """采集数据集采用的纳入规则：时间窗来自采集参数，阈值沿用固定口径。"""
    return {"startEpochInclusive": parse_time(since) or 0,
            "endEpochExclusive": parse_time(until) or MAX_EPOCH,
            "addedLinesGreaterThan": 0, "maxChurnInclusive": 10000, "maxFilesInclusive": 100}


def dataset_name(repo):
    """仓库名派生数据集名：小写，非字母数字转连字符。"""
    stem = Path(str(repo).rstrip("/\\")).stem or "repository"
    name = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")
    return name or "repository"


def _is_remote(repo):
    text = str(repo)
    return text.startswith(("http://", "https://", "git@", "ssh://", "git://"))


def _private_host(host):
    """判断主机名是否指向本机或内网，避免把非公开地址当作仓库来源。"""
    try:
        address = ip_address(host)
    except ValueError:
        name = host.lower().rstrip(".")
        return name == "localhost" or name.endswith((".localhost", ".local", ".internal"))
    return (address.is_private or address.is_loopback or address.is_link_local
            or address.is_reserved or address.is_multicast or address.is_unspecified)


def validate_source(repo, allow_local=True):
    """校验同步来源；返回可用于采集的地址或路径（RCL-07、D6）。

    只接受公开的 HTTP(S) 地址；`file://`、`ssh://`、`git@host:path` 等协议一律拒绝。
    允许本地路径时供 CLI 与测试使用，同步接口调用方应传 `allow_local=False`。
    """
    text = str(repo).strip()
    if not text:
        raise BaselineError("INPUT_INVALID", "仓库地址不能为空")
    lowered = text.lower()
    if lowered.startswith(("http://", "https://")):
        parsed = urlparse(text)
        host = parsed.hostname or ""
        if not host:
            raise BaselineError("INPUT_INVALID", f"仓库地址缺少主机名：{text}")
        if _private_host(host):
            raise BaselineError("REPOSITORY_UNAVAILABLE",
                                "仓库地址必须是公开地址，不能指向本机或内网")
        if not parsed.path.strip("/"):
            raise BaselineError("INPUT_INVALID", f"仓库地址缺少仓库路径：{text}")
        return text
    if "://" in text or re.match(r"^[^/\\@]+@[^/\\@]+:", text):
        raise BaselineError("REPOSITORY_UNAVAILABLE",
                            "只支持公开的 HTTP(S) 仓库地址；不支持 file、ssh、git 等协议")
    if not allow_local:
        raise BaselineError("INPUT_INVALID", "请填写公开的 HTTP(S) 仓库地址")
    return text


def _clone_detail(result):
    """克隆失败时取 git 的最后一行输出，没有输出就用返回码。"""
    lines = [line for line in (result.stderr or "").splitlines() if line.strip()]
    return lines[-1] if lines else result.returncode


NO_RETRY_MARKERS = ("not found", "404", "authentication failed", "could not read username")


def _retryable(result):
    """代理失败是否值得回退直连：仓库不存在、地址写错或需要凭证时换通道也没用。

    直连被墙的机器上，这类失败再试一次要等上几分钟的连接超时，只会把「地址不对」
    拖成「等了半天才报错」。
    """
    text = (result.stderr or "").lower()
    return not any(marker in text for marker in NO_RETRY_MARKERS)


def _clone_bare(repo, clone):
    """克隆裸仓库，返回实际走通的通道（`"proxy"` 或 `"direct"`）。

    当前没有配置代理时只尝试直连；配了代理则先走代理，失败后回退直连再试一次——
    系统代理可能残留失效（`ProxyEnable=1` 但端口已无人监听），此时直连往往仍然可用。
    仓库不存在或需要凭证时不回退（换通道不会成功，只会多等一次连接超时）。两次都
    失败才抛错，并分别带上每条通道的最后一行输出，便于区分「代理不通」与「仓库不可
    达」。每次尝试前清掉上一次的半成品目录，否则 git 会拒绝写非空目录。
    """
    attempts = [("proxy", True)] if proxy_url() else []
    attempts.append(("direct", False))
    failures = []
    for name, use_proxy in attempts:
        shutil.rmtree(clone, ignore_errors=True)
        args = ["clone", "--bare", "--quiet", "--no-tags", str(repo), str(clone)]
        result = _run(Path(tempfile.gettempdir()), args, check=False, use_proxy=use_proxy)
        if result.returncode == 0:
            return name
        failures.append((name, _clone_detail(result)))
        if not _retryable(result):
            break
    detail = "；".join(f"{'代理' if name == 'proxy' else '直连'}：{last}"
                      for name, last in failures)
    hint = "" if proxy_url() else "；如网络需要代理请设置 JIT_GIT_PROXY"
    raise BaselineError("REPOSITORY_UNAVAILABLE", f"仓库克隆失败，可重试（{detail}）{hint}")


def collect_repository(repo, since=None, until=None, branch="HEAD", output=None,
                       dataset=None, register=False, limit=None, root=None,
                       allow_local=True, return_blob=False, with_text=False):
    """采集 → 写 CSV → 可选登记；远程来源克隆到临时目录并在结束时清理。

    `allow_local=False` 时只接受公开 HTTP(S) 地址（同步接口使用）；
    `return_blob=True` 时把 CSV 字节与逐条记录一并返回，供同步编排直接落库。
    """
    repo = validate_source(repo, allow_local=allow_local)
    temporary = None
    try:
        target = repo
        if _is_remote(repo):
            temporary = tempfile.mkdtemp(prefix="jit-collect-")
            clone = Path(temporary) / "repository.git"
            _clone_bare(repo, clone)
            target = clone
        collected = collect(target, since, until, branch, limit, with_text=with_text)
        if not collected["records"]:
            raise BaselineError("DATASET_INVALID", "采集范围内没有可纳入的提交")
        blob = collected["csv"]
        path = Path(output) if output is not None else None
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary_csv = path.with_name(path.name + ".tmp")
            temporary_csv.write_bytes(blob)
            temporary_csv.replace(path)
        text_meta = None
        if with_text:
            if path is None:
                raise BaselineError("INPUT_INVALID", "文本采集需要 --output 指定 CSV 路径")
            text_path = path.with_name(path.stem + ".text.jsonl")
            text_bytes = collected["text"]["bytes"]
            temporary_text = text_path.with_name(text_path.name + ".tmp")
            temporary_text.write_bytes(text_bytes)
            temporary_text.replace(text_path)
            from .config import BACKEND
            resolved = text_path.resolve()
            relative = (resolved.relative_to(BACKEND.resolve()).as_posix()
                        if resolved.is_relative_to(BACKEND.resolve()) else resolved.as_posix())
            text_meta = {"path": relative, "sha256": hashlib.sha256(text_bytes).hexdigest(),
                         "bytes": len(text_bytes), "rule": TEXT_RULE,
                         "records": len(collected["text"]["records"]),
                         "truncated": collected["text"]["truncated"],
                         "skippedFiles": collected["text"]["skippedFiles"]}
        result = {"kind": "repository-collected", "repository": str(repo),
                  "records": len(collected["records"]), "fixCommits": collected["fixCommits"],
                  "labeled": collected["labeled"], "skipped": collected["skipped"],
                  "excluded": collected["excluded"], "collection": collected["collection"],
                  "text": text_meta}
        if return_blob:
            result["blob"] = blob
            result["rawRecords"] = collected["records"]
        if path is not None:
            result["csv"] = {"path": str(path.resolve()), "bytes": len(blob)}
        if register:
            from . import store
            if path is None:
                raise BaselineError("INPUT_INVALID", "登记需要 --output 指定 CSV 路径")
            result["dataset"] = store.register(path, schema=SCHEMA_NAME,
                                               dataset=dataset or dataset_name(repo),
                                               cohort=cohort(since, until), root=root,
                                               extra={"collection": collected["collection"],
                                                      **({"text": text_meta} if text_meta else {})},
                                               provenance={"publisher": "collected",
                                                           "revision": collected["collection"]["repository"]["head"],
                                                           "url": str(repo),
                                                           "citation": "由本地 Git 仓库采集生成"})
        return result
    finally:
        if temporary is not None:
            shutil.rmtree(temporary, ignore_errors=True)
