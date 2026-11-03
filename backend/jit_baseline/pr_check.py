"""Offline PR check bundle and report; reads saved scores without loading models."""
import hashlib
import json
from pathlib import Path

from .catalog_storage import utc_now
from .errors import BaselineError

BUNDLE_FORMAT = "jit-pr-check-bundle-v1"
REPORT_FORMAT = "jit-pr-check-v1"


class PrCheckError(BaselineError):
    def __init__(self, code, message, exit_code=1):
        super().__init__(code, message)
        self.exit_code = exit_code


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _digest(value):
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def export_bundle(storage, snapshot_id, sync_id):
    """从固定快照与分析导出可移植包；不读取个人草稿，不加载模型。"""
    with storage.connection() as db:
        snapshot_row = db.execute("SELECT payload_json FROM pr_snapshot WHERE id=?", (snapshot_id,)).fetchone()
        sync = db.execute("SELECT * FROM repository_sync WHERE id=?", (sync_id,)).fetchone()
        if snapshot_row is None or sync is None:
            raise PrCheckError("NOT_FOUND", "快照或分析不存在", 2)
        if sync["source_kind"] != "pr" or sync["source_snapshot_id"] != snapshot_id:
            raise PrCheckError("IDENTITY_MISMATCH", "分析不属于该快照", 3)
        if sync["status"] != "completed":
            raise PrCheckError("ANALYSIS_INCOMPLETE", "分析未成功完成", 2)
        rows = db.execute(
            "SELECT commit_id, epoch, risk, added_lines, deleted_lines, files, subject, author_name "
            "FROM repository_commit WHERE sync_id=? ORDER BY risk DESC, epoch DESC, commit_id ASC",
            (sync_id,)).fetchall()
    snapshot = json.loads(snapshot_row["payload_json"])
    commits = [{"commitId": row["commit_id"], "epoch": row["epoch"], "risk": row["risk"],
                "addedLines": row["added_lines"], "deletedLines": row["deleted_lines"],
                "files": row["files"], "subject": row["subject"], "authorName": row["author_name"]}
               for row in rows]
    body = {
        "format": BUNDLE_FORMAT,
        "exportedAt": utc_now(),
        "snapshot": snapshot,
        "analysis": {"syncId": sync_id, "status": sync["status"], "datasetVersion": sync["dataset_version"],
                     "modelId": sync["model_id"], "runId": sync["run_id"]},
        "model": {"modelId": sync["model_id"], "runId": sync["run_id"]},
        "commits": commits,
        "coverage": {"commitsTotal": snapshot.get("totalCommits", len(commits)),
                     "commitsScored": len(commits)},
        "candidates": [],
        "personalDataIncluded": False,
    }
    body["contentSha256"] = _digest(body)
    return body


def _validate_bundle(bundle):
    if not isinstance(bundle, dict) or bundle.get("format") != BUNDLE_FORMAT:
        raise PrCheckError("INPUT_INVALID", "不是受支持的 PR 检查分析包", 4)
    saved = bundle.get("contentSha256")
    body = {key: value for key, value in bundle.items() if key != "contentSha256"}
    if saved != _digest(body):
        raise PrCheckError("INPUT_INVALID", "分析包内容哈希不匹配", 4)
    snapshot = bundle.get("snapshot") or {}
    analysis = bundle.get("analysis") or {}
    model = bundle.get("model") or {}
    if not snapshot.get("baseSha") or not snapshot.get("headSha"):
        raise PrCheckError("IDENTITY_MISMATCH", "分析包缺少基准或目标 SHA", 3)
    if analysis.get("modelId") != model.get("modelId") or analysis.get("runId") != model.get("runId"):
        raise PrCheckError("IDENTITY_MISMATCH", "分析包中的模型身份不一致", 3)
    return snapshot, analysis


def build_report(bundle):
    snapshot, analysis = _validate_bundle(bundle)
    commits = bundle.get("commits") or []
    coverage = bundle.get("coverage") or {}
    total = coverage.get("commitsTotal", len(commits))
    scored = coverage.get("commitsScored", len(commits))
    limitations = [
        "模型分数是提交级估计，不是缺陷概率，也不是行级定位。",
        "报告只读取已保存分数，不重新推理、不训练、不选择模型。",
        "默认不包含个人草稿、笔记或反馈；报告不修改远端 PR，也不构成合并门禁。",
    ]
    if scored < total:
        limitations.append(f"只覆盖 {scored}/{total} 个提交，未覆盖提交不能视为低风险。")
    if not bundle.get("candidates"):
        limitations.append("该分析没有静态代码候选位置，候选未生成或不可用。")
    return {
        "format": REPORT_FORMAT,
        "generatedAt": utc_now(),
        "repository": {"owner": snapshot.get("owner"), "name": snapshot.get("name")},
        "pullRequest": {"number": snapshot.get("number"), "title": snapshot.get("title"),
                        "url": snapshot.get("url")},
        "baseSha": snapshot.get("baseSha"),
        "headSha": snapshot.get("headSha"),
        "analysis": analysis,
        "model": bundle.get("model"),
        "coverage": {"commitsTotal": total, "commitsScored": scored,
                     "filesTotal": snapshot.get("totalFiles"),
                     "filesComplete": snapshot.get("filesComplete")},
        "commits": commits,
        "candidates": bundle.get("candidates") or [],
        "personalDataIncluded": False,
        "limitations": limitations,
    }


def markdown_report(report):
    lines = [
        "# PR 检查报告",
        "",
        f"- 仓库：{report['repository'].get('owner')}/{report['repository'].get('name')}",
        f"- PR：#{report['pullRequest'].get('number')} {report['pullRequest'].get('title') or ''}".rstrip(),
        f"- 基准：{report['baseSha']}",
        f"- 目标：{report['headSha']}",
        f"- 模型：{report['model'].get('modelId')} · 运行 {report['model'].get('runId')}",
        f"- 覆盖：{report['coverage']['commitsScored']}/{report['coverage']['commitsTotal']} 个提交",
        "",
        "## 提交分数",
        "",
        "| 提交 | 分数 | 新增行 | 删除行 | 文件数 | 标题 |",
        "| --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for item in report["commits"]:
        lines.append(f"| `{item['commitId'][:12]}` | {item['risk']:.4f} | {item['addedLines']} | "
                     f"{item['deletedLines']} | {item['files']} | {(item['subject'] or '').splitlines()[0][:80]} |")
    lines += ["", "## 限制", ""]
    lines += [f"- {item}" for item in report["limitations"]]
    return "\n".join(lines) + "\n"


def write_report(bundle, output, fmt="json"):
    report = build_report(bundle)
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    if fmt == "markdown":
        path.write_text(markdown_report(report), encoding="utf-8")
    elif fmt == "json":
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        raise PrCheckError("INPUT_INVALID", "报告格式必须是 json 或 markdown", 4)
    return report, path
