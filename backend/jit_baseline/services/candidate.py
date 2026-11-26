"""Static candidate locations for a fixed PR snapshot; never converts scores to line defects."""
import ast

ANALYZER_VERSION = "python-ast-v2"
RULE_VERSION = "2"
LEGACY_RULE_VERSIONS = {"python-ast-v1": "1"}
SUPPORTED_SUFFIXES = (".py",)

# 确定性修复建议模板：只覆盖语义明确的规则；不生成补丁、不自动应用。
SUGGESTIONS = {
    "py-mutable-default": {
        "title": "把可变默认参数改为 None 并在函数体内创建",
        "rationale": "列表、字典或集合作为默认参数只求值一次，会在调用之间共享状态。",
        "manualChecks": ["按原默认值的类型和内容初始化参数", "确认默认值不依赖跨调用共享", "确认调用方传入 None 时语义不变"],
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
    "py-subprocess-shell-true": {
        "title": "避免 shell=True，改用参数列表",
        "rationale": "shell=True 会把命令交给系统 shell 解释；如果命令中包含外部输入，可能改变实际执行的命令。",
        "manualChecks": ["确认命令是否包含外部输入", "确认能否改为参数列表", "确认 shell 特性是否确有必要"],
        "example": {
            "before": "subprocess.run(\"git status\", shell=True)",
            "after": "subprocess.run([\"git\", \"status\"], check=True)",
        },
    },
    "py-yaml-unsafe-load": {
        "title": "为 yaml.load 指定安全的 Loader",
        "rationale": "未指定 Loader 的 yaml.load 可能按文档构造任意对象；应显式选择与输入格式匹配的安全加载器。",
        "manualChecks": ["确认 YAML 只包含数据而不需要构造任意对象", "确认 SafeLoader 能解析现有文档", "确认自定义标签是否确实需要"],
        "example": {
            "before": "data = yaml.load(text)",
            "after": "data = yaml.load(text, Loader=yaml.SafeLoader)",
        },
    },
    "py-requests-verify-false": {
        "title": "确认是否需要关闭 TLS 校验",
        "rationale": "verify=False 会关闭证书校验，使客户端无法确认服务器身份；生产请求通常不应关闭。",
        "manualChecks": ["确认目标服务是否使用受信任证书", "确认是否只在隔离测试中使用", "确认关闭校验不会暴露敏感数据"],
        "example": {
            "before": "requests.get(url, verify=False)",
            "after": "requests.get(url, timeout=10)",
        },
    },
    "py-tempfile-mktemp": {
        "title": "改用不会产生竞态条件的临时文件接口",
        "rationale": "tempfile.mktemp 只返回未创建的路径，创建前可能被其他进程占用，应使用原子创建接口。",
        "manualChecks": ["确认临时文件的生命周期", "确认调用方需要路径还是文件对象", "确认清理时不会删除其他进程的文件"],
        "example": {
            "before": "path = tempfile.mktemp()",
            "after": "with tempfile.NamedTemporaryFile() as handle:\n    path = handle.name",
        },
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


def _root_name(node):
    while isinstance(node, (ast.Attribute, ast.Call)):
        node = node.value if isinstance(node, ast.Attribute) else node.func
    return node.id if isinstance(node, ast.Name) else None


def _keyword(call, name):
    return next((item for item in call.keywords if item.arg == name), None)


def _constant_false(value):
    return isinstance(value, ast.Constant) and value.value is False


def _constant_true(value):
    return isinstance(value, ast.Constant) and value.value is True


def _new_rule(node):
    if not isinstance(node, ast.Call):
        return None
    func = node.func
    root = _root_name(func)
    attr = func.attr if isinstance(func, ast.Attribute) else None
    if (root == "subprocess" and attr in {"Popen", "run", "call", "check_call", "check_output"}
            and any(item.arg == "shell" and _constant_true(item.value) for item in node.keywords)):
        return ("py-subprocess-shell-true", "shell=True 会把命令交给系统 shell 解释")
    if (root == "yaml" and attr == "load" and len(node.args) < 2
            and _keyword(node, "Loader") is None):
        return ("py-yaml-unsafe-load", "yaml.load 未指定 Loader")
    if (root == "requests" and attr in {"get", "post", "put", "patch", "delete", "head", "request", "options"}
            and any(item.arg == "verify" and _constant_false(item.value) for item in node.keywords)):
        return ("py-requests-verify-false", "requests 请求关闭了 TLS 证书校验")
    if root == "tempfile" and attr == "mktemp":
        return ("py-tempfile-mktemp", "tempfile.mktemp 存在路径竞态风险")
    return None


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
        else:
            rule = _new_rule(node)
            if rule:
                candidates.append(_candidate(side, path, node.lineno, rule[0],
                                             rule[1], evidence(node)))
    return candidates, None
