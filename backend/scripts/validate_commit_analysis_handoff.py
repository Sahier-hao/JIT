"""Validate a jit-commit-analysis-v1 report and its CI handoff workflow.

The report is the cross-IDE handoff artifact. The workflow must remain
read-only and upload the report only; it must not comment, merge or change
branch protection.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHA = re.compile(r"^[a-f0-9]{40}(?:[a-f0-9]{24})?$")
FORBIDDEN = (
    "pull-requests: write",
    "issues: write",
    "gh pr comment",
    "pulls.createReview",
    "pulls.merge",
    "updateBranch",
)


def _nonempty(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_report(report: dict) -> list[str]:
    problems: list[str] = []
    if report.get("format") != "jit-commit-analysis-v1":
        problems.append("报告格式不是 jit-commit-analysis-v1")
    for field in ("analysisId", "contentSha256"):
        if not _nonempty(report.get(field)):
            problems.append(f"报告缺少 {field}")
    repository = report.get("repository")
    model = report.get("model")
    coverage = report.get("coverage")
    if not isinstance(repository, dict):
        problems.append("报告缺少 repository")
    else:
        for field in ("baseSha", "headSha"):
            value = repository.get(field)
            if not isinstance(value, str) or not SHA.match(value):
                problems.append(f"repository.{field} 不是合法 SHA")
        if not isinstance(repository.get("commitsInRange"), int) or repository["commitsInRange"] < 0:
            problems.append("repository.commitsInRange 不是非负整数")
    if not isinstance(model, dict):
        problems.append("报告缺少 model")
    else:
        for field in ("runId", "method", "featureSchema"):
            if not _nonempty(model.get(field)):
                problems.append(f"model.{field} 为空")
    if not isinstance(coverage, dict):
        problems.append("报告缺少 coverage")
    else:
        total, scored = coverage.get("commitsTotal"), coverage.get("commitsScored")
        if not isinstance(total, int) or total < 0:
            problems.append("coverage.commitsTotal 不是非负整数")
        if not isinstance(scored, int) or scored < 0:
            problems.append("coverage.commitsScored 不是非负整数")
        if isinstance(total, int) and isinstance(scored, int) and scored > total:
            problems.append("coverage.commitsScored 大于 commitsTotal")
    limitations = report.get("limitations")
    if not isinstance(limitations, list) or not limitations or not all(isinstance(item, str) and item.strip() for item in limitations):
        problems.append("报告 limitations 必须是非空字符串列表")
    if not isinstance(report.get("commits"), list):
        problems.append("报告 commits 必须是列表")
    if not isinstance(report.get("candidates"), list):
        problems.append("报告 candidates 必须是列表")
    return problems


def validate_workflow(workflow: dict) -> list[str]:
    problems: list[str] = []
    permissions = workflow.get("permissions")
    if not isinstance(permissions, dict) or permissions.get("contents") != "read":
        problems.append("工作流必须声明 contents: read")
    if isinstance(permissions, dict):
        for name, value in permissions.items():
            if name != "contents" and value not in (None, "read", "none"):
                problems.append(f"工作流包含写权限：{name}: {value}")
    serialized = json.dumps(workflow, ensure_ascii=False)
    for token in FORBIDDEN:
        if token in serialized:
            problems.append(f"工作流包含禁止操作：{token}")
    jobs = workflow.get("jobs")
    analyze = jobs.get("analyze") if isinstance(jobs, dict) else None
    steps = analyze.get("steps") if isinstance(analyze, dict) else None
    if not isinstance(steps, list):
        problems.append("工作流缺少 analyze.steps")
        return problems
    if not any("pr-check-analyze" in str(step.get("run") or "") for step in steps if isinstance(step, dict)):
        problems.append("工作流没有执行 pr-check-analyze")
    uploads = [
        step for step in steps
        if isinstance(step, dict) and "upload-artifact" in str(step.get("uses") or "")
    ]
    if not uploads:
        problems.append("工作流没有上传报告产物")
    else:
        with_block = uploads[0].get("with") or {}
        if not str(with_block.get("name") or "").startswith("commit-analysis-"):
            problems.append("报告产物名称不是 commit-analysis-*")
        if with_block.get("if-no-files-found") != "error":
            problems.append("报告缺失时 upload-artifact 必须失败")
    return problems


def validate_handoff(report: dict, workflow: dict) -> dict:
    problems = validate_report(report) + validate_workflow(workflow)
    return {"passed": not problems, "problems": problems}


def main() -> int:
    parser = argparse.ArgumentParser(description="校验提交分析报告交接与 CI 只读边界")
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--workflow", type=Path, default=ROOT / ".github" / "workflows" / "commit-analysis.yml")
    parser.add_argument("--output", type=Path, default=None)
    options = parser.parse_args()
    try:
        import yaml
    except ImportError as exc:
        raise SystemExit("需要 PyYAML：pip install -r backend/scripts/requirements-contract.txt") from exc
    report = json.loads(options.report.read_text(encoding="utf-8"))
    workflow = yaml.safe_load(options.workflow.read_text(encoding="utf-8"))
    result = validate_handoff(report, workflow)
    if options.output is not None:
        options.output.parent.mkdir(parents=True, exist_ok=True)
        options.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
