"""Static candidate locations for a fixed PR snapshot; never converts scores to line defects."""
import ast

ANALYZER_VERSION = "python-ast-v1"
RULE_VERSION = "1"
SUPPORTED_SUFFIXES = (".py",)


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
