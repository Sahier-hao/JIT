"""Validate AI test sources, prompt archive and manual review evidence."""
from argparse import ArgumentParser
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = (
    ROOT
    / "docs/evidence/review-model-training-results-and-explanations"
    / "pr2-ai-test-provenance/manifest.json"
)


def _load_tests(manifest, source_overrides):
    tests = manifest.get("tests")
    if not isinstance(tests, list) or not tests:
        raise ValueError("测试来源清单为空")
    result = {}
    for item in tests:
        name = item.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError("测试名称缺失")
        if name in result:
            raise ValueError(f"测试重复登记：{name}")
        result[name] = item
    return result


def validate(manifest_path=DEFAULT_MANIFEST, *, source_overrides=None):
    manifest_path = Path(manifest_path)
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        tests = _load_tests(manifest, source_overrides or {})
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return {"passed": False, "errors": [str(exc)]}

    errors = []
    tools = manifest.get("tools")
    if not isinstance(tools, list) or not tools or not all(
        isinstance(value, str) and value for value in tools
    ):
        errors.append("AI 工具信息缺失")
    prompt = manifest.get("prompt")
    if not isinstance(prompt, str) or not prompt:
        errors.append("提示词归档路径缺失")
    elif not (ROOT / prompt).is_file() or not (ROOT / prompt).read_text(
        encoding="utf-8"
    ).strip():
        errors.append(f"提示词归档不存在或为空：{prompt}")

    for name, item in tests.items():
        relative = item.get("file")
        marker = item.get("marker")
        source = item.get("source")
        if source not in {"ai", "ai-modified"}:
            errors.append(f"{name} 不是 AI 来源：{source}")
        if not isinstance(relative, str) or not relative:
            errors.append(f"{name} 缺少测试文件")
            continue
        path = ROOT / relative
        if not path.is_file():
            errors.append(f"{name} 的测试文件不存在：{relative}")
            continue
        text = (source_overrides or {}).get(relative, path.read_text(encoding="utf-8"))
        language = item.get("language", "python")
        if language == "js":
            expected = f"{marker}\ntest('{name}'"
        else:
            expected = f"{marker}\ndef {name}("
        if not isinstance(marker, str) or expected not in text:
            errors.append(f"{name} 缺少来源标记：{marker}")
        if not isinstance(item.get("assertion"), str) or not item["assertion"].strip():
            errors.append(f"{name} 缺少断言说明")

    review = manifest.get("review") or {}
    if review.get("status") != "completed":
        errors.append("人工复核尚未完成")
    if not isinstance(review.get("reviewer"), str) or not review["reviewer"].strip():
        errors.append("人工复核缺少审核人")
    if not isinstance(review.get("reviewedAt"), str) or not review["reviewedAt"].strip():
        errors.append("人工复核缺少日期")
    decisions = manifest.get("manualReviewDecisions")
    if not isinstance(decisions, list):
        errors.append("人工复核 decisions 无效")
        decisions = []
    reviewed = {}
    for item in decisions:
        if not isinstance(item, dict):
            errors.append("人工复核 decision 结构无效")
            continue
        name = item.get("test")
        if not isinstance(name, str) or not name:
            errors.append("人工复核 decision 缺少具体测试名称")
            continue
        if name in reviewed:
            errors.append(f"人工复核 decision 重复：{name}")
            continue
        if item.get("verdict") == "reviewed":
            reviewed[name] = item
    for name, item in tests.items():
        decision = reviewed.get(name)
        if (
            decision is None
            or not isinstance(decision.get("comment"), str)
            or not decision["comment"].strip()
        ):
            errors.append(f"{name} 缺少有效人工复核结论")

    return {
        "passed": not errors,
        "manifest": str(manifest_path.resolve()),
        "tests": len(tests),
        "reviewed": len(reviewed),
        "errors": errors,
    }


def self_test(manifest_path=DEFAULT_MANIFEST):
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    first = manifest["tests"][0]
    text = (ROOT / first["file"]).read_text(encoding="utf-8")
    source_overrides = {
        first["file"]: text.replace(first["marker"] + "\ndef " + first["name"] + "(", "def " + first["name"] + "("),
    }
    cases = {"missing-source": validate(Path(manifest_path), source_overrides=source_overrides)}
    pending_review = copy.deepcopy(manifest)
    pending_review["review"] = {
        "status": "pending",
        "reviewer": None,
        "reviewedAt": None,
    }
    review_manifest = Path(manifest_path).with_name("self-test-missing-review.json")
    try:
        review_manifest.write_text(
            json.dumps(pending_review, ensure_ascii=False),
            encoding="utf-8",
        )
        cases["missing-review"] = validate(review_manifest)
    finally:
        review_manifest.unlink(missing_ok=True)
    missing_prompt = copy.deepcopy(manifest)
    missing_prompt["prompt"] = "docs/evidence/missing-prompt.md"
    prompt_manifest = Path(manifest_path).with_name("missing-prompt-manifest.json")
    try:
        prompt_manifest.write_text(
            json.dumps(missing_prompt, ensure_ascii=False),
            encoding="utf-8",
        )
        cases["missing-prompt"] = validate(prompt_manifest)
    finally:
        prompt_manifest.unlink(missing_ok=True)
    passed = all(
        not result["passed"]
        and any(keyword in " ".join(result["errors"]) for keyword in keywords)
        for keywords, result in (
            (("来源标记",), cases["missing-source"]),
            (("人工复核",), cases["missing-review"]),
            (("提示词归档",), cases["missing-prompt"]),
        )
    )
    return {"passed": passed, "cases": cases}


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    result = self_test(args.manifest) if args.self_test else validate(args.manifest)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
