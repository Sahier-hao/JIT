"""Build the machine-readable and Markdown integration delivery report."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HIGH_RISK = {
    "auth-permissions", "sync-control", "training", "model-registry",
    "pr-analysis-report", "dataset-import", "explanation",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _git(args: list[str]) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout.strip()


def _junit(path: Path) -> dict:
    root = ET.parse(path).getroot()
    suite = root[0] if root.tag == "testsuites" else root
    return {key: int(suite.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")}


def _extension(log: Path) -> dict:
    text = log.read_text(encoding="utf-8", errors="replace")
    passed = re.findall(r"# pass (\d+)", text)
    failed = re.findall(r"# fail (\d+)", text)
    return {"passed": int(passed[-1]) if passed else 0, "failed": int(failed[-1]) if failed else 0}


def _na_cells(matrix: dict) -> list[dict]:
    result = []
    for operation in matrix.get("operations", []):
        cells = operation.get("cells") or {}
        na = [(name, cell) for name, cell in cells.items()
              if isinstance(cell, dict) and cell.get("kind") == "not-applicable"]
        if na:
            result.append({
                "operation": operation.get("key"),
                "riskDomain": operation.get("riskDomain"),
                "scenarios": [name for name, _ in na],
                "reasons": sorted({cell.get("reason") for _, cell in na}),
                "reviewedBy": sorted({cell.get("reviewedBy") for _, cell in na}),
                "reviewedOn": sorted({cell.get("reviewedOn") for _, cell in na}),
            })
    return result


def build(args) -> dict:
    inventory = json.loads(args.inventory.read_text(encoding="utf-8"))
    matrix_result = json.loads(args.matrix.read_text(encoding="utf-8"))
    matrix = matrix_result.get("matrix", matrix_result)
    provenance = json.loads(args.provenance.read_text(encoding="utf-8"))
    backend = _junit(args.backend_junit)
    frontend = json.loads(args.frontend_results.read_text(encoding="utf-8"))
    browser = json.loads(args.browser_results.read_text(encoding="utf-8")).get("stats", {})
    extension = _extension(args.extension_log)
    handoff = json.loads(args.handoff.read_text(encoding="utf-8"))
    matrix_tests = _junit(args.matrix_junit)
    matrix_passed = int(matrix_tests["tests"]) - int(matrix_tests["failures"]) - int(matrix_tests["errors"]) - int(matrix_tests["skipped"])
    na = _na_cells(matrix)
    high = [item for item in matrix.get("operations", []) if item.get("riskDomain") in HIGH_RISK]
    high_complete = all(
        all(isinstance(cell, dict) and cell.get("kind") == "test" and cell.get("status") == "passed"
            for cell in (item.get("cells") or {}).values())
        for item in high
    )
    human_review = provenance.get("review", {}).get("status") == "completed"
    na_reviewed = all(
        all(name not in ("待人工复核", None, "") for name in item.get("reviewedBy", []))
        for item in na
    )
    machine_passed = (
        backend["failures"] == 0 and backend["errors"] == 0
        and frontend.get("numFailedTests") == 0
        and browser.get("unexpected", 0) == 0
        and extension.get("failed", 0) == 0
        and bool(handoff.get("passed"))
        and bool(matrix_result.get("passed"))
        and high_complete
    )
    report = {
        "kind": "integration-test-delivery-report",
        "change": "deliver-ide-handoff-and-integration-tests",
        "generatedAt": _now(),
        "gitHead": _git(["rev-parse", "HEAD"]),
        "branch": _git(["rev-parse", "--abbrev-ref", "HEAD"]),
        "inventory": {
            "totalOperations": inventory.get("totalOperations"),
            "businessOperations": inventory.get("businessOperations"),
            "adminAuthOperations": len(inventory.get("adminAuthOperations", [])),
            "highRiskOperations": len(high),
        },
        "matrix": {
            "operations": len(matrix.get("operations", [])),
            "highRiskOperations": len(high),
            "highRiskAllFourScenariosPassed": high_complete,
            "notApplicableOperations": len(na),
            "notApplicable": na,
            "scenarios": matrix_result.get("summary", {}).get("cells", {}),
        },
        "tests": {
            "matrix": {"tests": matrix_tests["tests"], "passed": matrix_passed, "failures": matrix_tests["failures"], "skipped": matrix_tests["skipped"]},
            "backendFull": backend,
            "frontendUnit": {"tests": frontend.get("numTotalTests"), "passed": frontend.get("numPassedTests"), "failed": frontend.get("numFailedTests"), "pending": frontend.get("numPendingTests")},
            "vscodeExtension": extension,
            "browserE2E": {"expected": browser.get("expected"), "unexpected": browser.get("unexpected"), "skipped": browser.get("skipped"), "flaky": browser.get("flaky")},
            "handoffValidation": handoff,
        },
        "provenance": {
            "tests": len(provenance.get("tests", [])),
            "prompt": provenance.get("prompt"),
            "review": provenance.get("review"),
        },
        "machineChecksPassed": machine_passed,
        "humanReviewComplete": human_review,
        "notApplicableReviewComplete": na_reviewed,
        "passed": machine_passed and human_review and na_reviewed,
        "knownLimitations": [
            "VS Code 宿主冒烟已通过并截取 Extension Development Host 窗口；截图展示工作区与本机 VS Code 1.147.0，JIT 报告树未在截图中展开（报告导入、身份、命令由宿主冒烟断言验证）。",
            "Eclipse 与 Visual Studio 只交付可行性结论，未交付插件。",
            "只读 GET 的边界与并发场景使用人工复核的不适用理由，详见 notApplicable。",
        ],
        "evidence": {
            "inventory": "api-inventory.json",
            "matrix": "scenario-matrix.json",
            "matrixResults": "matrix-results.json",
            "backendJunit": "backend-full-junit.xml",
            "frontendUnit": "frontend-unit-results.json",
            "browser": "browser-results.json",
            "handoffValidation": "handoff-validation.json",
            "vscodeHostSmoke": "smoke-host.log",
            "vscodeScreenshotSmoke": "smoke-screenshot.log",
            "vscodeHostScreenshot": "screenshots/vscode-extension-host.png",
        },
    }
    return report


def _md(report: dict) -> str:
    inv = report["inventory"]
    tests = report["tests"]
    lines = [
        "# 集成测试交付报告",
        "",
        f"- change：`{report['change']}`",
        f"- 提交：`{report['gitHead']}`（`{report['branch']}`）",
        f"- 生成时间：{report['generatedAt']}",
        f"- 机器检查：{'通过' if report['machineChecksPassed'] else '未通过'}",
        f"- 人工复核：{'完成' if report['humanReviewComplete'] else '待完成'}",
        f"- 不适用格复核：{'完成' if report['notApplicableReviewComplete'] else '待完成'}",
        "",
        "## 汇总",
        "",
        "| 项目 | 结果 |",
        "| --- | --- |",
        f"| OpenAPI 操作总数 | {inv['totalOperations']} |",
        f"| 业务 API 清单 | {inv['businessOperations']} |",
        f"| admin 认证单独排除 | {inv['adminAuthOperations']} |",
        f"| 高风险业务操作 | {inv['highRiskOperations']} |",
        f"| 矩阵操作数 | {report['matrix']['operations']} |",
        f"| 高风险四类全部实际通过 | {'是' if report['matrix']['highRiskAllFourScenariosPassed'] else '否'} |",
        f"| 矩阵测试 | {tests['matrix']['passed']} passed / {tests['matrix']['failures']} failed / {tests['matrix']['skipped']} skipped |",
        f"| 后端完整回归 | {tests['backendFull']['tests'] - tests['backendFull']['failures'] - tests['backendFull']['errors'] - tests['backendFull']['skipped']} passed / {tests['backendFull']['failures']} failed / {tests['backendFull']['skipped']} skipped |",
        f"| 前端单测 | {tests['frontendUnit']['passed']}/{tests['frontendUnit']['tests']} passed / {tests['frontendUnit']['failed']} failed |",
        f"| VS Code 扩展 | {tests['vscodeExtension']['passed']} passed / {tests['vscodeExtension']['failed']} failed |",
        f"| 真实 E2E | {tests['browserE2E']['expected']} passed / {tests['browserE2E']['unexpected']} unexpected |",
        f"| 报告交接校验 | {'通过' if tests['handoffValidation'].get('passed') else '未通过'} |",
        f"| AI 来源测试 | {report['provenance']['tests']} 项；复核 {report['provenance']['review'].get('status')} |",
        "",
        "## 不适用格",
        "",
    ]
    if report["matrix"]["notApplicable"]:
        for item in report["matrix"]["notApplicable"]:
            lines.append(f"- `{item['operation']}`：{'、'.join(item['scenarios'])}；{ '；'.join(item['reasons']) }；复核：{ '、'.join(item['reviewedBy']) }（{ '、'.join(item['reviewedOn']) }）")
    else:
        lines.append("- 无")
    lines += ["", "## 已知限制", ""]
    lines += [f"- {item}" for item in report["knownLimitations"]]
    lines += ["", "## 证据索引", ""]
    for name, path in report.get("evidence", {}).items():
        lines.append(f"- {name}: `{path}`")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="生成集成测试交付报告")
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--matrix", type=Path, required=True)
    parser.add_argument("--matrix-junit", type=Path, required=True)
    parser.add_argument("--backend-junit", type=Path, required=True)
    parser.add_argument("--frontend-results", type=Path, required=True)
    parser.add_argument("--browser-results", type=Path, required=True)
    parser.add_argument("--extension-log", type=Path, required=True)
    parser.add_argument("--handoff", type=Path, required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    parser.add_argument("--output-md", type=Path, required=True)
    args = parser.parse_args()
    report = build(args)
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    args.output_md.write_text(_md(report), encoding="utf-8")
    print(json.dumps({key: report[key] for key in (
        "machineChecksPassed", "humanReviewComplete",
        "notApplicableReviewComplete", "passed")}, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
