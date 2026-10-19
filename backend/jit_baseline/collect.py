"""从 Git 仓库采集提交，计算 Kamei 14 维特征并生成简化 SZZ 标签（RCL-01..RCL-06）。

只读仓库：本地路径不修改，远程来源克隆到临时目录采集后删除。产物是与
`kamei14-git-v1` 对齐的 CSV 与数据集描述文件，复用 `store.register` / `store.import_dataset`
进入既有登记、入库与训练链路。特征为提交级聚合、标签为简化 SZZ，两项限制随产物记录。
"""
import csv
import io
import math
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
LIMITATIONS = (
    "特征为提交级聚合，与 Kamei 论文的文件级样本单位不同。",
    "标签由简化 SZZ 生成，未处理重命名、跨文件传播与 issue 关联，不是完整 SZZ。",
)
MAX_EPOCH = 2_147_483_647


def _run(cwd, args, check=True):
    command = ["git", "--no-pager", "-c", "core.quotepath=false", "-C", str(cwd)] + [str(arg) for arg in args]
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


def collect(repo, since=None, until=None, branch="HEAD", limit=None):
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
    return {"records": records, "csv": blob, "collection": collection, "excluded": excluded,
            "skipped": skipped, "fixCommits": fix_commits, "labeled": len(labels)}


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


def collect_repository(repo, since=None, until=None, branch="HEAD", output=None,
                       dataset=None, register=False, limit=None, root=None,
                       allow_local=True, return_blob=False):
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
            result = _run(Path(tempfile.gettempdir()),
                          ["clone", "--bare", "--quiet", "--no-tags", str(repo), str(clone)],
                          check=False)
            if result.returncode != 0:
                lines = [line for line in (result.stderr or "").splitlines() if line.strip()]
                raise BaselineError("REPOSITORY_UNAVAILABLE",
                                    f"仓库克隆失败，可重试：{lines[-1] if lines else result.returncode}")
            target = clone
        collected = collect(target, since, until, branch, limit)
        if not collected["records"]:
            raise BaselineError("DATASET_INVALID", "采集范围内没有可纳入的提交")
        blob = collected["csv"]
        path = Path(output) if output is not None else None
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary_csv = path.with_name(path.name + ".tmp")
            temporary_csv.write_bytes(blob)
            temporary_csv.replace(path)
        result = {"kind": "repository-collected", "repository": str(repo),
                  "records": len(collected["records"]), "fixCommits": collected["fixCommits"],
                  "labeled": collected["labeled"], "skipped": collected["skipped"],
                  "excluded": collected["excluded"], "collection": collected["collection"]}
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
                                               extra={"collection": collected["collection"]},
                                               provenance={"publisher": "collected",
                                                           "revision": collected["collection"]["repository"]["head"],
                                                           "url": str(repo),
                                                           "citation": "由本地 Git 仓库采集生成"})
        return result
    finally:
        if temporary is not None:
            shutil.rmtree(temporary, ignore_errors=True)
