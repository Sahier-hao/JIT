"""CI report handoff tests. [AI生成]"""
from pathlib import Path

import yaml

from scripts import validate_commit_analysis_handoff as handoff

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "vscode-extension" / "scripts" / "fixtures" / "sample-report.json"
WORKFLOW = ROOT / ".github" / "workflows" / "commit-analysis.yml"


def _workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _report() -> dict:
    import json
    return json.loads(REPORT.read_text(encoding="utf-8"))


# [AI生成]
def test_real_sample_report_and_read_only_workflow_pass():
    result = handoff.validate_handoff(_report(), _workflow())
    assert result == {"passed": True, "problems": []}


# [AI生成]
def test_report_without_limitations_or_identity_fails():
    report = _report()
    report["limitations"] = []
    report["contentSha256"] = ""
    problems = handoff.validate_report(report)
    assert any("limitations" in problem for problem in problems)
    assert any("contentSha256" in problem for problem in problems)


# [AI生成]
def test_workflow_with_write_permission_or_comment_fails():
    workflow = _workflow()
    workflow["permissions"] = {"contents": "read", "pull-requests": "write"}
    workflow["jobs"]["analyze"]["steps"].append({"run": "gh pr comment 1 --body merge"})
    problems = handoff.validate_workflow(workflow)
    assert any("写权限" in problem for problem in problems)
    assert any("gh pr comment" in problem for problem in problems)


# [AI生成]
def test_upload_must_fail_when_report_missing():
    workflow = _workflow()
    upload = next(step for step in workflow["jobs"]["analyze"]["steps"]
                  if "upload-artifact" in str(step.get("uses") or ""))
    upload["with"]["if-no-files-found"] = "warn"
    assert any("必须失败" in problem for problem in handoff.validate_workflow(workflow))
