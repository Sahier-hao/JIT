"""Run the test nodes referenced by the integration matrix and record results."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def _refs(matrix: dict) -> list[str]:
    found = set()
    for operation in matrix.get("operations", []):
        for cell in (operation.get("cells") or {}).values():
            if isinstance(cell, dict) and cell.get("kind") == "test":
                found.update(cell.get("tests") or [])
    return sorted(found)


def _to_pytest_ref(reference: str) -> str:
    if reference.startswith("backend/"):
        return reference[len("backend/"):]
    return reference


def _junit_results(path: Path) -> dict[str, str]:
    root = ET.parse(path).getroot()
    results: dict[str, str] = {}
    for case in root.iter("testcase"):
        classname = case.get("classname") or ""
        name = case.get("name") or ""
        status = "passed"
        if case.find("failure") is not None or case.find("error") is not None:
            status = "failed"
        elif case.find("skipped") is not None:
            status = "skipped"
        results[f"{classname}::{name}"] = status
    return results


def _ref_status(reference: str, results: dict[str, str]) -> str:
    path_text, separator, node = reference.partition("::")
    path = Path(path_text)
    module = "tests." + path.stem if path.parent.name == "tests" else path.stem
    if separator and node:
        matches = [
            status for key, status in results.items()
            if key.startswith(module + "::") and key.split("::", 1)[1].split("[", 1)[0] == node
        ]
    else:
        matches = [status for key, status in results.items() if key.startswith(module + "::")]
    if not matches:
        return "missing"
    if "failed" in matches:
        return "failed"
    if "skipped" in matches:
        return "skipped"
    return "passed"


def _summarize(matrix: dict) -> dict:
    counts = {"normal": {}, "boundary": {}, "error": {}, "concurrency": {}}
    for operation in matrix.get("operations", []):
        for scenario, cell in (operation.get("cells") or {}).items():
            if isinstance(cell, dict):
                kind = cell.get("kind", "?")
                counts.setdefault(scenario, {})[kind] = counts.setdefault(scenario, {}).get(kind, 0) + 1
    return {"operations": len(matrix.get("operations", [])), "cells": counts}


def main() -> int:
    parser = argparse.ArgumentParser(description="运行四类矩阵引用的测试")
    parser.add_argument("--matrix", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--junit", type=Path, default=None)
    options = parser.parse_args()
    matrix = json.loads(options.matrix.read_text(encoding="utf-8"))
    references = [_to_pytest_ref(item) for item in _refs(matrix)]
    junit = options.junit or (Path(tempfile.mkdtemp(prefix="jit-matrix-")) / "matrix.xml")
    junit.parent.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, "-m", "pytest", *references, "-q", f"--junitxml={junit}"]
    print(" ".join(command), flush=True)
    completed = subprocess.run(command, cwd=BACKEND)
    results = _junit_results(junit) if junit.is_file() else {}
    problems = []
    for operation in matrix.get("operations", []):
        for scenario, cell in (operation.get("cells") or {}).items():
            if not isinstance(cell, dict) or cell.get("kind") != "test":
                continue
            statuses = [_ref_status(_to_pytest_ref(reference), results) for reference in cell.get("tests") or []]
            if not statuses:
                status = "missing"
            elif "failed" in statuses or "missing" in statuses:
                status = "failed"
            elif "skipped" in statuses:
                status = "skipped"
            else:
                status = "passed"
            cell["status"] = status
            if status != "passed":
                problems.append(f"{operation.get('key')} {scenario}: {status}")
    report = {
        "kind": "integration-test-matrix-results",
        "command": command,
        "exitCode": completed.returncode,
        "junit": str(junit),
        "summary": _summarize(matrix),
        "problems": problems,
        "passed": completed.returncode == 0 and not problems,
        "matrix": matrix,
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "exitCode": completed.returncode,
                      "problems": problems[:20], "summary": report["summary"]},
                     ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
