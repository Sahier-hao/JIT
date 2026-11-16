"""从本地 Git 提交范围执行真实特征采集、模型推理和检查报告生成。"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from . import candidate as candidate_rules
from . import collect
from .catalog import ModelCatalog
from .catalog_storage import utc_now
from .errors import BaselineError


class CommitAnalysisError(BaselineError):
    def __init__(self, code, message, exit_code=1):
        super().__init__(code, message)
        self.exit_code = exit_code


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _digest(value):
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _git(repo, args, code="REPOSITORY_UNAVAILABLE", message="Git 命令失败", exit_code=4):
    result = collect._run(repo, args, check=False)
    if result.returncode != 0:
        raise CommitAnalysisError(code, message, exit_code)
    return result.stdout


def resolve_range(repo_path, base, head_ref):
    repo = collect.repository(repo_path)
    head_result = collect._run(repo, ["rev-parse", "--verify", f"{head_ref}^{{commit}}"], check=False)
    if head_result.returncode != 0:
        raise CommitAnalysisError("IDENTITY_MISMATCH", f"目标提交不可用：{head_ref}", 3)
    head_sha = head_result.stdout.strip()
    base_result = collect._run(repo, ["rev-parse", "--verify", f"{base}^{{commit}}"], check=False)
    if base_result.returncode != 0:
        raise CommitAnalysisError("IDENTITY_MISMATCH", f"基准提交不可用：{base}", 3)
    base_sha = base_result.stdout.strip()
    ancestor = collect._run(repo, ["merge-base", "--is-ancestor", base_sha, head_sha], check=False)
    if ancestor.returncode != 0:
        raise CommitAnalysisError("IDENTITY_MISMATCH", "基准提交不是目标提交的祖先", 3)
    if base_sha == head_sha:
        raise CommitAnalysisError("NO_CHANGES", "基准与目标相同，没有可分析的提交", 2)
    ids = [line.strip() for line in _git(
        repo, ["rev-list", "--no-merges", "--reverse", f"{base_sha}..{head_sha}"]).splitlines()
        if line.strip()]
    if not ids:
        raise CommitAnalysisError("NO_CHANGES", "范围内没有可分析的提交", 2)
    return repo, base_sha, head_sha, ids


def collect_features(repo, head_sha, wanted):
    """沿第一父链重建历史状态，只为指定提交计算真实 Kamei 特征。"""
    entries, unparsed = collect._entries(repo, head_sha)
    remaining = {commit["id"]: 0 for commit in entries}
    for commit in entries:
        if commit["parents"] and commit["parents"][0] in remaining:
            remaining[commit["parents"][0]] += 1
    states = {}

    def take(parent):
        if parent not in states:
            return collect._History()
        if remaining[parent] > 1:
            remaining[parent] -= 1
            return states[parent].clone()
        remaining[parent] -= 1
        return states.pop(parent)

    records = []
    for commit in entries:
        parent = commit["parents"][0] if commit["parents"] else None
        state = take(parent) if parent is not None else collect._History()
        if len(commit["parents"]) > 1:
            states[commit["id"]] = state
            if remaining[commit["id"]] == 0:
                states.pop(commit["id"], None)
            continue
        if commit["id"] in wanted and commit["files"]:
            metrics = state.features(commit)
            metrics.pop("_negativeFileAges", None)
            records.append({
                "id": commit["id"], "epoch": commit["epoch"],
                "time": commit["time"].isoformat(timespec="seconds").replace("+00:00", "Z"),
                "subject": commit["subject"], "authorName": commit["author"],
                "filePaths": [item["path"] for item in commit["files"]],
                "metrics": metrics,
            })
        state.advance(commit)
        states[commit["id"]] = state
        if remaining[commit["id"]] == 0:
            states.pop(commit["id"], None)
    records.sort(key=lambda item: item["epoch"])
    return records, unparsed


def _candidate_coverage(repo, head_sha, paths, limit=50):
    analyzed, skipped, items = [], [], []
    for path in paths[:limit]:
        if not path.endswith(candidate_rules.SUPPORTED_SUFFIXES):
            skipped.append({"path": path, "reason": "unsupported-language"})
            continue
        result = collect._run(repo, ["show", f"{head_sha}:{path}"], check=False)
        if result.returncode != 0:
            skipped.append({"path": path, "reason": "content-unavailable"})
            continue
        found, error = candidate_rules.analyze(path, "head", result.stdout)
        if error:
            skipped.append({"path": path, "reason": error})
            continue
        analyzed.append(path)
        items.extend(dict(item, suggestion=candidate_rules.suggestion(item)) for item in found)
    if len(paths) > limit:
        skipped.append({"path": f"<{len(paths) - limit} more>", "reason": "limit-exceeded"})
    return {"analyzed": analyzed, "skipped": skipped, "candidates": items,
            "analyzerVersion": candidate_rules.ANALYZER_VERSION, "side": "head"}


def analyze(repo_path, base, head_ref, catalog, model_id, *, max_commits=200,
            max_candidate_files=50):
    repo, base_sha, head_sha, ids = resolve_range(repo_path, base, head_ref)
    if len(ids) > max_commits:
        raise CommitAnalysisError(
            "INPUT_INVALID", f"范围内提交数 {len(ids)} 超过上限 {max_commits}", 4)
    records, unparsed = collect_features(repo, head_sha, set(ids))
    if not records:
        raise CommitAnalysisError("NO_CHANGES", "范围内没有带文件改动的可分析提交", 2)
    try:
        snapshot, payload = catalog.load_model(model_id)
    except BaselineError as exc:
        raise CommitAnalysisError(getattr(exc, "code", "MODEL_UNAVAILABLE"),
                                  f"模型不可用：{exc}", 2) from exc
    names = list(snapshot.schema.in_model_names())
    missing = [name for name in names if name not in records[0]["metrics"]]
    if missing or snapshot.schema.semantic:
        raise CommitAnalysisError(
            "SCHEMA_UNSUPPORTED",
            f"模型特征 schema {snapshot.schema.name} 不能由提交采集直接生成", 5)
    for record in records:
        record["features"] = [record["metrics"][name] for name in names]
    from .model import predict_risks
    risks = predict_risks(snapshot.model, records, snapshot.schema)
    commits = [{
        "commitId": record["id"], "epoch": record["epoch"], "time": record["time"],
        "subject": record["subject"], "authorName": record["authorName"],
        "risk": float(risk), "addedLines": record["metrics"]["la"],
        "deletedLines": record["metrics"]["ld"], "files": record["metrics"]["nf"],
        "filePaths": record["filePaths"],
    } for record, risk in zip(records, risks, strict=True)]
    paths = sorted({path for record in records for path in record["filePaths"]})
    participants = _candidate_coverage(repo, head_sha, paths, max_candidate_files)
    fingerprint = _digest({"baseSha": base_sha, "headSha": head_sha,
                           "modelRunId": snapshot.manifest["runId"],
                           "commits": [item["commitId"] for item in commits]})
    body = {
        "format": "jit-commit-analysis-v1",
        "generatedAt": utc_now(),
        "analysisId": fingerprint[:16],
        "contentSha256": None,
        "repository": {"path": str(repo), "baseSha": base_sha, "headSha": head_sha,
                       "commitsInRange": len(ids)},
        "model": {
            "modelId": payload.get("modelId"),
            "name": payload.get("name"),
            "runId": snapshot.manifest["runId"],
            "method": snapshot.manifest["config"].get("algorithmVersion"),
            "featureSchema": snapshot.schema.name,
            "parameters": snapshot.manifest["config"].get("model"),
            "modelSha256": snapshot.summary.get("modelSha256"),
        },
        "coverage": {"commitsTotal": len(ids), "commitsScored": len(commits),
                     "commitsWithoutChanges": len(ids) - len(commits),
                     "unparsedHistory": unparsed,
                     "candidateFiles": len(paths), "candidates": participants["analyzed"],
                     "candidatesSkipped": participants["skipped"]},
        "commits": sorted(commits, key=lambda item: (-item["risk"], item["commitId"])),
        "candidates": participants["candidates"],
        "limitations": [
            "分数是提交级模型估计，不是缺陷概率，也不是行级定位。",
            "候选位置来自静态规则，与模型分数分属不同依据，不换算成行级概率。",
            "历史特征依赖第一父链；合并提交不进入评分。",
            "报告默认不评论 PR、不阻断合并、不修改远端配置。",
        ],
    }
    body["contentSha256"] = _digest({key: value for key, value in body.items()
                                     if key not in ("generatedAt", "contentSha256")})
    return body


def write_report(report, output, markdown=None):
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)
    if markdown is not None:
        target = Path(markdown)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(markdown_report(report), encoding="utf-8")


def markdown_report(report):
    lines = [
        "# 提交范围检查报告",
        "",
        f"- 基准：`{report['repository']['baseSha']}`",
        f"- 目标：`{report['repository']['headSha']}`",
        f"- 模型：{report['model']['name']} · 运行 `{report['model']['runId']}`",
        f"- 覆盖：{report['coverage']['commitsScored']}/{report['coverage']['commitsTotal']} 个提交",
        "",
        "## 提交分数",
        "",
        "| 提交 | 分数 | 新增行 | 删除行 | 文件数 | 标题 |",
        "| --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for item in report["commits"]:
        lines.append(f"| `{item['commitId'][:12]}` | {item['risk']:.4f} | {item['addedLines']} | "
                     f"{item['deletedLines']} | {item['files']} | {(item['subject'] or '')[:80]} |")
    if report["candidates"]:
        lines += ["", "## 静态候选", ""]
        for item in report["candidates"]:
            lines.append(f"- `{item['path']}:{item['line']}` {item['ruleId']} · {item['message']}")
    lines += ["", "## 限制", ""] + [f"- {item}" for item in report["limitations"]]
    return "\n".join(lines) + "\n"
