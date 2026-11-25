"""Build and validate the four-scenario integration test matrix.

The matrix maps every business OpenAPI operation to normal, boundary, failure
and concurrency/failure evidence. Cells point to real test nodes or to a
human-reviewed not-applicable reason. High-risk operations may not use
not-applicable for any scenario.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCENARIOS = ("normal", "boundary", "error", "concurrency")
HIGH_RISK = {
    "auth-permissions", "sync-control", "training", "model-registry",
    "pr-analysis-report", "dataset-import", "explanation",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cell(mapping: dict, operation: dict, scenario: str) -> dict | None:
    default = mapping.get("domainDefaults", {}).get(operation["riskDomain"], {})
    override = mapping.get("overrides", {}).get(operation["key"], {})
    if scenario in override:
        return override[scenario]
    if scenario in default:
        return default[scenario]
    if scenario in mapping.get("contractDefaults", {}):
        return mapping["contractDefaults"][scenario]
    if scenario in mapping.get("notApplicable", {}):
        return mapping["notApplicable"][scenario]
    return None


def build_matrix(inventory: dict, mapping: dict) -> dict:
    operations = []
    for operation in inventory.get("operations", []):
        cells = {scenario: _cell(mapping, operation, scenario) for scenario in SCENARIOS}
        operations.append({**operation, "cells": cells})
    return {
        "kind": "integration-test-matrix",
        "change": mapping.get("change"),
        "generatedAt": _now(),
        "scenarios": list(SCENARIOS),
        "operations": operations,
    }


def _test_ref_problem(root: Path, reference: str) -> str | None:
    path_text, separator, node = reference.partition("::")
    path = root / path_text
    if not path.is_file():
        return f"缺少测试文件：{path_text}"
    if separator and node:
        text = path.read_text(encoding="utf-8", errors="replace")
        if not re.search(rf"\b{re.escape(node)}\b", text):
            return f"缺少测试节点：{reference}"
    return None


def validate(matrix: dict, inventory: dict, root: Path = ROOT, expected_count: int = 95) -> list[str]:
    problems: list[str] = []
    expected = {item["key"] for item in inventory.get("operations", [])}
    actual = {item.get("key") for item in matrix.get("operations", [])}
    for key in sorted(expected - actual):
        problems.append(f"矩阵缺少操作：{key}")
    for key in sorted(actual - expected):
        problems.append(f"矩阵多出操作：{key}")
    if len(actual) != expected_count:
        problems.append(f"矩阵应覆盖 {expected_count} 个业务操作，实际 {len(actual)}")
    for operation in matrix.get("operations", []):
        key = operation.get("key", "?")
        cells = operation.get("cells") or {}
        for scenario in SCENARIOS:
            cell = cells.get(scenario)
            if not isinstance(cell, dict):
                problems.append(f"{key} 缺少场景：{scenario}")
                continue
            kind = cell.get("kind")
            if kind == "test":
                tests = cell.get("tests")
                if not isinstance(tests, list) or not tests or not all(isinstance(item, str) and item for item in tests):
                    problems.append(f"{key} {scenario} 测试引用为空")
                    continue
                if cell.get("status", "passed") != "passed":
                    problems.append(f"{key} {scenario} 状态不是 passed：{cell.get('status')}")
                if not cell.get("level"):
                    problems.append(f"{key} {scenario} 缺少证据级别")
                for reference in tests:
                    problem = _test_ref_problem(root, reference)
                    if problem:
                        problems.append(f"{key} {scenario} {problem}")
            elif kind == "not-applicable":
                if operation.get("riskDomain") in HIGH_RISK:
                    problems.append(f"{key} {scenario} 高风险接口不得标记不适用")
                if scenario not in ("boundary", "concurrency"):
                    problems.append(f"{key} {scenario} 正常与异常场景不得标记不适用")
                for field in ("reason", "reviewedBy", "reviewedOn"):
                    if not isinstance(cell.get(field), str) or not cell.get(field).strip():
                        problems.append(f"{key} {scenario} 缺少 {field}")
                if cell.get("reviewedBy") == "待人工复核":
                    problems.append(f"{key} {scenario} 尚未完成人工复核")
            else:
                problems.append(f"{key} {scenario} 未知单元格类型：{kind}")
    return problems


def summary(matrix: dict) -> dict:
    counts = {scenario: {"test": 0, "not-applicable": 0} for scenario in SCENARIOS}
    high = 0
    for operation in matrix.get("operations", []):
        if operation.get("riskDomain") in HIGH_RISK:
            high += 1
        for scenario, cell in (operation.get("cells") or {}).items():
            if isinstance(cell, dict) and cell.get("kind") in counts.get(scenario, {}):
                counts[scenario][cell["kind"]] += 1
    return {
        "operations": len(matrix.get("operations", [])),
        "highRiskOperations": high,
        "cells": counts,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="生成或校验四类场景矩阵")
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--mapping", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    options = parser.parse_args()
    inventory = json.loads(options.inventory.read_text(encoding="utf-8"))
    mapping = json.loads(options.mapping.read_text(encoding="utf-8"))
    matrix = build_matrix(inventory, mapping)
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(matrix, ensure_ascii=False, indent=2), encoding="utf-8")
    problems = validate(matrix, inventory)
    result = {"summary": summary(matrix), "problems": problems, "passed": not problems}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if problems:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
