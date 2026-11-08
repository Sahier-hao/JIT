"""Static candidate locations for a fixed PR snapshot; never converts scores to line defects."""
import ast

ANALYZER_VERSION = "python-ast-v1"
RULE_VERSION = "1"
SUPPORTED_SUFFIXES = (".py",)

# 确定性修复建议模板：只覆盖语义明确的规则；不生成补丁、不自动应用。
SUGGESTIONS = {
    "py-mutable-default": {
        "title": "把可变默认参数改为 None 并在函数体内创建",
        "rationale": "列表、字典或集合作为默认参数只求值一次，会在调用之间共享状态。",
        "manualChecks": ["确认默认值不依赖跨调用共享", "确认调用方传入 None 时语义不变"],
        "example": {"before": "def handle(items=[]):", "after": "def handle(items=None):\n    items = [] if items is None else items"},
    },
    "py-bare-except": {
        "title": "指明需要捕获的异常类型",
        "rationale": "裸 except 会吞掉 KeyboardInterrupt、SystemExit 和编程错误，使失败难以发现。",
        "manualChecks": ["确认哪些异常可以安全处理", "确认无法处理时继续向上抛出"],
        "example": {"before": "try:\n    run()\nexcept:\n    pass", "after": "try:\n    run()\nexcept ValueError as error:\n    logger.warning('输入无效: %s', error)"},
    },
    "py-eval-exec": {
        "title": "核对动态执行的输入来源并改为显式解析",
        "rationale": "eval/exec 会执行任意字符串；替代方案取决于输入格式，不能统一替换成另一个动态执行函数。",
        "manualChecks": ["确认输入是否来自不可信来源", "确认是否只需解析字面量（可用 ast.literal_eval）", "确认是否需要完整的表达式求值"],
        "example": None,
    },
}


def suggestion(item):
    """按规则返回建议；没有语义明确模板时返回 None，不编造修复。"""
    template = SUGGESTIONS.get(item.get("ruleId"))
    if template is None:
        return None
    return {
        "ruleId": item["ruleId"],
        "ruleVersion": item.get("ruleVersion"),
        "title": template["title"],
        "rationale": template["rationale"],
        "location": {"path": item.get("path"), "line": item.get("line"), "side": item.get("side")},
        "manualChecks": list(template["manualChecks"]),
        "example": template["example"],
    }


def _candidate(side, path, line, rule_id, message, evidence):
    return {"side": side, "path": path, "line": line, "ruleId": rule_id,
            "ruleVersion": RULE_VERSION, "message": message, "evidence": evidence}


def analyze(path, side, content):
    """分析一个文件；返回候选与未分析原因。只支持 Python 源码。"""
    if not path.endswith(SUPPORTED_SUFFIXES):
        return [], "unsupported-language"
    try:
        tree = ast.parse(content)
    except (SyntaxError, ValueError):
        return [], "parse-failed"
    lines = content.splitlines()
    candidates = []

    def evidence(node):
        line = getattr(node, "lineno", None)
        return lines[line - 1].strip() if line and 0 < line <= len(lines) else ""

    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler) and node.type is None:
            candidates.append(_candidate(side, path, node.lineno, "py-bare-except",
                                         "裸 except 会吞掉所有异常", evidence(node)))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for default in node.args.defaults + node.args.kw_defaults:
                if isinstance(default, (ast.List, ast.Dict, ast.Set)):
                    candidates.append(_candidate(side, path, default.lineno, "py-mutable-default",
                                                 "可变默认参数会在调用之间共享状态", evidence(default)))
        elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
              and node.func.id in ("eval", "exec")):
            candidates.append(_candidate(side, path, node.lineno, "py-eval-exec",
                                         "动态执行字符串，需确认输入来源", evidence(node)))
    return candidates, None
