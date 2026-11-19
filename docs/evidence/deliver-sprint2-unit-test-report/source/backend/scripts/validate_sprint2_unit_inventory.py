"""Validate the Sprint2 fast-unit inventory against its test files."""
from argparse import ArgumentParser
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "docs/test-delivery/sprint2-unit-test/core-tests.json"
BACKEND_ROOT = ROOT / "backend"
FRONTEND_ROOT = ROOT / "frontend"
SIDES = {"backend", "frontend"}
SCENARIOS = {"normal", "boundary", "error"}
SOURCES = {"ai", "ai-modified", "handwritten"}

BACKEND_TEST = re.compile(r"^def (test_[A-Za-z0-9_]+)\(", re.MULTILINE)
FRONTEND_TEST = re.compile(r"\b(?:it|test)\(\s*['\"]([^'\"]+)['\"]", re.MULTILINE)
FORBIDDEN_BACKEND = ("fastapi.testclient", "joblib", "sqlite3", "TestClient(")
FORBIDDEN_FRONTEND = ("@testing-library/react", "globalThis.fetch", "from 'playwright'")


def _resolve(side, relative):
    root = BACKEND_ROOT if side == "backend" else FRONTEND_ROOT
    return root / relative


def _tests(side, relative):
    path = _resolve(side, relative)
    if not path.is_file():
        raise ValueError(f"{side} 测试文件不存在：{relative}")
    text = path.read_text(encoding="utf-8")
    pattern = BACKEND_TEST if side == "backend" else FRONTEND_TEST
    names = pattern.findall(text)
    if not names:
        raise ValueError(f"{side} 测试文件没有可识别用例：{relative}")
    if len(names) != len(set(names)):
        raise ValueError(f"{side} 测试文件存在重名用例：{relative}")
    forbidden = FORBIDDEN_BACKEND if side == "backend" else FORBIDDEN_FRONTEND
    mixed = [token for token in forbidden if token in text]
    if mixed:
        raise ValueError(f"{side} 快速单元文件混入非单元依赖：{relative} -> {', '.join(mixed)}")
    return path, set(names)


def validate(manifest_path=MANIFEST, require_sources=False):
    errors = []
    try:
        manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"passed": False, "errors": [f"清单不可读：{exc}"]}

    suite = {}
    coverage_files = set()
    scope = manifest.get("scope", {})
    for side in SIDES:
        section = scope.get(side, {})
        for relative in section.get("suiteFiles", []):
            try:
                path, names = _tests(side, relative)
            except ValueError as exc:
                errors.append(str(exc))
                continue
            suite[(side, relative)] = names
            if side == "frontend" and ".test.tsx" in path.name:
                errors.append(f"前端快速单元套件不能包含组件测试：{relative}")
            if side == "backend" and any(name in path.name for name in ("e2e", "http", "sqlite")):
                errors.append(f"后端快速单元套件不能包含集成测试：{relative}")
        for relative in section.get("coverageFiles", []):
            if not _resolve(side, relative).is_file():
                errors.append(f"{side} 覆盖率模块不存在：{relative}")
            coverage_files.add((side, relative))

    owners = {}
    owner_sources = {}
    function_ids = set()
    covered_modules = set()
    prompt_files = {
        f"{side}/{relative}": relative_prompt
        for relative, relative_prompt in manifest.get("provenance", {}).get("promptFiles", {}).items()
        for side in SIDES
        if relative.startswith(("tests/", "src/")) and (side, relative) in suite
    }
    for item in manifest.get("functions", []):
        function_id = item.get("id")
        side = item.get("side")
        relative = item.get("testFile")
        cases = item.get("cases", {})
        source = item.get("source")
        if not function_id or function_id in function_ids:
            errors.append(f"函数标识为空或重复：{function_id}")
            continue
        function_ids.add(function_id)
        if side not in SIDES:
            errors.append(f"{function_id} 的 side 无效：{side}")
            continue
        if set(cases) != SCENARIOS or any(not cases[name] for name in SCENARIOS):
            errors.append(f"{function_id} 必须恰有非空的 normal、boundary、error 用例")
        if source not in SOURCES:
            errors.append(f"{function_id} 的来源无效：{source}")
        if require_sources and source == "ai":
            prompt = prompt_files.get(f"{side}/{relative}")
            if not prompt:
                errors.append(f"{function_id} 使用 AI 但没有提示词归档映射：{side}/{relative}")
            elif not (ROOT / prompt).is_file():
                errors.append(f"{function_id} 的提示词归档不存在：{prompt}")
        module = (side, item.get("module"))
        covered_modules.add(module)
        known_tests = suite.get((side, relative))
        if known_tests is None:
            errors.append(f"{function_id} 引用了未登记套件文件：{side}/{relative}")
            continue
        for scenario in SCENARIOS:
            for name in cases.get(scenario, []):
                key = (side, relative, name)
                if name not in known_tests:
                    errors.append(f"{function_id} 引用的测试节点不存在：{relative}::{name}")
                if key in owners:
                    errors.append(f"测试节点被重复分类：{relative}::{name} ({owners[key]} / {function_id})")
                else:
                    owners[key] = function_id
                    owner_sources[key] = source
                if require_sources and side == "frontend" and source == "ai" and "[AI生成]" not in name:
                    errors.append(f"AI 生成前端用例缺少来源标记：{relative}::{name}")

    for (side, relative), names in suite.items():
        for name in names:
            if (side, relative, name) not in owners:
                errors.append(f"快速单元套件存在未分类用例：{side}/{relative}::{name}")

    for side, relative in covered_modules:
        if (side, relative) not in coverage_files:
            errors.append(f"{side}/{relative} 声明为核心函数模块但不在覆盖率范围")

    if require_sources:
        for side, relative in suite:
            path = _resolve(side, relative)
            text = path.read_text(encoding="utf-8")
            if side == "backend":
                expected = len(suite[(side, relative)])
                actual = text.count("# [AI生成]") + text.count("# [AI生成-人工修改]") + text.count("# [手写]")
                if actual < expected:
                    errors.append(f"后端用例来源标记不足：{relative} 需要 {expected} 条，实际 {actual} 条")

    source_counts = {}
    source_by_file = {}
    for (side, relative, _name), source in owner_sources.items():
        source_counts[source] = source_counts.get(source, 0) + 1
        key = f"{side}/{relative}"
        summary = source_by_file.setdefault(key, {})
        summary[source] = summary.get(source, 0) + 1
    for summary in source_by_file.values():
        total = sum(summary.values())
        summary["total"] = total
        summary["percentages"] = {
            source: round(100.0 * count / total, 2)
            for source, count in summary.items()
            if source != "total"
        }

    return {
        "passed": not errors,
        "manifest": str(Path(manifest_path).resolve()),
        "suiteTests": {f"{side}/{relative}": len(names) for (side, relative), names in suite.items()},
        "functions": len(function_ids),
        "scenarioCounts": {
            scenario: sum(1 for item in manifest.get("functions", []) if item.get("cases", {}).get(scenario))
            for scenario in sorted(SCENARIOS)
        },
        "sourceCounts": source_counts,
        "sourceByFile": source_by_file,
        "promptFiles": prompt_files,
        "errors": errors,
    }


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--require-sources", action="store_true")
    args = parser.parse_args()
    result = validate(args.manifest, require_sources=args.require_sources)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
