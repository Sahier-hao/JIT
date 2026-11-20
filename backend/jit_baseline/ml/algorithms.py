"""具名方法注册表：方法如何声明，以及运行身份如何由 (schema, 方法) 共同决定。

见 generalize-model-registry-and-run-contract 的 design D1/D4/D5/D6：
方法以具名条目声明类别、冻结超参、所需依赖、复现口径与解释口径；校验按运行声明的
方法比对超参，不再与模块级常量比较；方法标识由 schema 与方法共同决定。
"""
import importlib.util

from ..config import MODEL_CONFIG
from ..errors import BaselineError

CLASSIC = "classic"
DEEP = "deep"

ALGORITHMS = {
    "logistic-regression-l2-v1": {
        "label": "逻辑回归",
        "name": "逻辑回归 · L2",
        "category": CLASSIC,
        "detail": "L2/C=1/lbfgs/max_iter=1000/tol=1e-4/class_weight=None/seed=2026/单线程",
        # params 是运行声明与校验用的冻结声明；`logistic-regression-l2-v1` 沿用
        # config.MODEL_CONFIG，使既有运行按自身声明继续通过校验。
        "params": MODEL_CONFIG,
        "estimator": "logistic-regression",
        "kwargs": {"C": 1.0, "l1_ratio": 0.0, "solver": "lbfgs", "max_iter": 1000,
                   "tol": 1e-4, "class_weight": None, "random_state": 2026},
        "preprocess": ("scale",),
        "requires": (),
        "reproducibility": {"mode": "tolerance", "atol": 1e-8, "rtol": 0.0},
        "explanation": {"method": "occlusion-mean-v1", "reason": None},
    },
    "decision-tree-v1": {
        "label": "决策树",
        "name": "决策树 · CART",
        "category": CLASSIC,
        "detail": "gini/max_depth=8/min_samples_leaf=50/random_state=2026/单线程",
        "params": {"criterion": "gini", "max_depth": 8, "min_samples_leaf": 50, "seed": 2026, "threads": 1},
        "estimator": "decision-tree",
        "kwargs": {"criterion": "gini", "max_depth": 8, "min_samples_leaf": 50, "random_state": 2026},
        "preprocess": (),
        "requires": (),
        "reproducibility": {"mode": "tolerance", "atol": 1e-8, "rtol": 0.0},
        "explanation": {"method": "occlusion-mean-v1", "reason": None},
    },
    # 第一个 `requires` 非空的方法：用于实测"环境声明 → 子集校验 → 无 GPU 机器加载"这条路径
    # （此前两个方法的 requires 都是空的，该路径从未被走过）。它仍是表格型经典方法，
    # 不引入新框架；`scipy` 是其数值路径的真实依赖。
    "random-forest-v1": {
        "label": "随机森林",
        "name": "随机森林 · 200 棵 CART",
        "category": CLASSIC,
        "detail": "gini/n_estimators=200/max_depth=8/min_samples_leaf=50/random_state=2026/单线程",
        "params": {"n_estimators": 200, "criterion": "gini", "max_depth": 8,
                   "min_samples_leaf": 50, "seed": 2026, "threads": 1},
        "estimator": "random-forest",
        "kwargs": {"n_estimators": 200, "criterion": "gini", "max_depth": 8,
                   "min_samples_leaf": 50, "random_state": 2026, "n_jobs": 1},
        "preprocess": (),
        "requires": ("scipy",),
        "reproducibility": {"mode": "tolerance", "atol": 1e-8, "rtol": 0.0},
        "explanation": {"method": "occlusion-mean-v1", "reason": None},
    },
    "gaussian-naive-bayes-v1": {
        "label": "高斯朴素贝叶斯",
        "name": "高斯朴素贝叶斯 · 高斯假设",
        "category": CLASSIC,
        "detail": "var_smoothing=1e-9/单线程",
        # 高斯判定式逐特征建模，不需要标准化；仍沿用 schema 声明的 log1p（counts 步不由方法覆盖）。
        "params": {"var_smoothing": 1e-9, "threads": 1},
        "estimator": "gaussian-naive-bayes",
        "kwargs": {"var_smoothing": 1e-9},
        "preprocess": (),
        "requires": (),
        "reproducibility": {"mode": "tolerance", "atol": 1e-8, "rtol": 0.0},
        "explanation": {"method": "occlusion-mean-v1", "reason": None},
    },
    # 小树 + 叶下限的保守取值：控制训练时间，并与既有树方法的正则化取向一致。
    # 已冻结，不由验证或测试结果调整。
    "gradient-boosting-v1": {
        "label": "梯度提升树",
        "name": "梯度提升树 · 200 棵小树",
        "category": CLASSIC,
        "detail": "n_estimators=200/learning_rate=0.1/max_depth=3/min_samples_leaf=50/random_state=2026/单线程",
        "params": {"n_estimators": 200, "learning_rate": 0.1, "max_depth": 3,
                   "min_samples_leaf": 50, "seed": 2026, "threads": 1},
        "estimator": "gradient-boosting",
        "kwargs": {"n_estimators": 200, "learning_rate": 0.1, "max_depth": 3,
                   "min_samples_leaf": 50, "random_state": 2026},
        "preprocess": (),
        "requires": (),
        "reproducibility": {"mode": "tolerance", "atol": 1e-8, "rtol": 0.0},
        "explanation": {"method": "occlusion-mean-v1", "reason": None},
    },
    "mlp-v1": {
        "label": "深度 · MLP",
        "name": "多层感知机（2 隐层）",
        "category": DEEP,
        "detail": "hidden=(64,32)/dropout=0.2/lr=1e-3/batch=256/epochs=30/weight_decay=1e-4/seed=2026/单线程",
        "params": {"hidden": [64, 32], "dropout": 0.2, "lr": 1e-3, "batch_size": 256,
                   "epochs": 30, "weight_decay": 1e-4, "seed": 2026, "threads": 1},
        "estimator": "torch-mlp",
        "kwargs": {"hidden": [64, 32], "dropout": 0.2, "lr": 1e-3, "batch_size": 256,
                   "epochs": 30, "weight_decay": 1e-4, "seed": 2026, "threads": 1},
        "preprocess": ("scale",),
        "requires": ("torch",),
        "reproducibility": {"mode": "tolerance", "atol": 1e-6, "rtol": 0.0},
        "explanation": {"method": "occlusion-mean-v1", "reason": None},
    },
    "tabular-resnet-v1": {
        "label": "深度 · 表格 ResNet",
        "name": "表格残差网络（2 个残差块）",
        "category": DEEP,
        "detail": "blocks=2/hidden=64/dropout=0.2/lr=1e-3/batch=256/epochs=30/weight_decay=1e-4/seed=2026/单线程",
        "params": {"hidden": 64, "blocks": 2, "dropout": 0.2, "lr": 1e-3, "batch_size": 256,
                   "epochs": 30, "weight_decay": 1e-4, "seed": 2026, "threads": 1},
        "estimator": "torch-tabular-resnet",
        "kwargs": {"hidden": 64, "blocks": 2, "dropout": 0.2, "lr": 1e-3, "batch_size": 256,
                   "epochs": 30, "weight_decay": 1e-4, "seed": 2026, "threads": 1},
        "preprocess": ("scale",),
        "requires": ("torch",),
        "reproducibility": {"mode": "tolerance", "atol": 1e-6, "rtol": 0.0},
        "explanation": {"method": "occlusion-mean-v1", "reason": None},
    },
    "ft-transformer-v1": {
        "label": "深度 · FT-Transformer",
        "name": "特征 token 化 Transformer（每字段一个 token）",
        "category": DEEP,
        "detail": "d_token=32/heads=4/layers=1/dropout=0.1/lr=1e-3/batch=256/epochs=30/seed=2026/单线程",
        "params": {"d_token": 32, "heads": 4, "layers": 1, "dropout": 0.1, "lr": 1e-3,
                   "batch_size": 256, "epochs": 30, "seed": 2026, "threads": 1},
        "estimator": "torch-ft-transformer",
        "kwargs": {"d_token": 32, "heads": 4, "layers": 1, "dropout": 0.1, "lr": 1e-3,
                   "batch_size": 256, "epochs": 30, "seed": 2026, "threads": 1},
        "preprocess": ("scale",),
        "requires": ("torch",),
        "reproducibility": {"mode": "tolerance", "atol": 1e-6, "rtol": 0.0},
        "explanation": {"method": "occlusion-mean-v1", "reason": None},
    },
    "wide-deep-v1": {
        "label": "深度 · Wide&Deep",
        "name": "宽深双塔（线性分量 + MLP 分量并联）",
        "category": DEEP,
        "detail": "deep=(64,32)/dropout=0.2/lr=1e-3/batch=256/epochs=30/weight_decay=1e-4/seed=2026/单线程",
        "params": {"deep": [64, 32], "dropout": 0.2, "lr": 1e-3, "batch_size": 256,
                   "epochs": 30, "weight_decay": 1e-4, "seed": 2026, "threads": 1},
        "estimator": "torch-wide-deep",
        "kwargs": {"deep": [64, 32], "dropout": 0.2, "lr": 1e-3, "batch_size": 256,
                   "epochs": 30, "weight_decay": 1e-4, "seed": 2026, "threads": 1},
        "preprocess": ("scale",),
        "requires": ("torch",),
        "reproducibility": {"mode": "tolerance", "atol": 1e-6, "rtol": 0.0},
        "explanation": {"method": "occlusion-mean-v1", "reason": None},
    },
}

DEFAULT_ALGORITHM = "logistic-regression-l2-v1"

# 可配置训练的参数契约版本。显式提供参数时写入运行配置；没有该字段的既有运行
# 继续按注册表冻结参数严格校验。
PARAMETER_CONTRACT = "training-params-v1"

# 受控参数声明：只允许这里列出的键，键必须在方法冻结参数中已存在。
# 值声明类型（int/float）与闭区间 [min, max]；不支持任意 estimator 或表达式。
PARAM_SPECS = {
    "logistic-regression-l2-v1": {
        "C": {"type": "float", "min": 0.01, "max": 100.0,
              "label": "正则强度倒数 C", "description": "值越大限制越弱；先围绕 1 调整。"},
        "max_iter": {"type": "int", "min": 100, "max": 5000,
                     "label": "最大迭代次数", "description": "不足时训练可能不收敛；不要用它代替调参。"},
    },
    "decision-tree-v1": {
        "max_depth": {"type": "int", "min": 1, "max": 32,
                      "label": "最大深度", "description": "越大越容易记住训练集噪声。"},
        "min_samples_leaf": {"type": "int", "min": 1, "max": 5000,
                             "label": "叶节点最少样本", "description": "增大后树更保守、叶子更少。"},
    },
    "random-forest-v1": {
        "n_estimators": {"type": "int", "min": 10, "max": 1000,
                         "label": "树数量", "description": "更多树通常更稳定，但训练和加载更慢。"},
        "max_depth": {"type": "int", "min": 1, "max": 32,
                      "label": "最大深度", "description": "控制单棵树复杂度。"},
        "min_samples_leaf": {"type": "int", "min": 1, "max": 5000,
                             "label": "叶节点最少样本", "description": "增大后减少小样本叶子。"},
    },
    "gradient-boosting-v1": {
        "n_estimators": {"type": "int", "min": 10, "max": 1000,
                         "label": "提升轮数", "description": "轮数越多拟合越强，也更容易过拟合。"},
        "max_depth": {"type": "int", "min": 1, "max": 16,
                      "label": "单树深度", "description": "通常保持较小，再观察验证集变化。"},
        "min_samples_leaf": {"type": "int", "min": 1, "max": 5000,
                             "label": "叶节点最少样本", "description": "降低噪声叶子的影响。"},
    },
    "mlp-v1": {
        "epochs": {"type": "int", "min": 1, "max": 200,
                   "label": "训练轮数", "description": "结合验证损失判断是否继续。"},
        "lr": {"type": "float", "min": 1e-5, "max": 1e-1,
               "label": "学习率", "description": "过大可能震荡，过小则收敛慢。"},
        "batch_size": {"type": "int", "min": 16, "max": 2048,
                       "label": "批大小", "description": "受内存与训练稳定性约束。"},
    },
}

ALGORITHM_GUIDES = {
    "logistic-regression-l2-v1": {
        "summary": "线性基线，按特征加权后输出风险分。",
        "strengths": ["训练快、稳定", "系数和归因容易解释"],
        "tradeoffs": ["难以自动表达复杂交互", "需要标准化"],
        "whenToUse": "先建立可比基线，或数据量较小、需要稳定上线时。",
    },
    "decision-tree-v1": {
        "summary": "用一组阈值规则递归划分提交。",
        "strengths": ["规则直观", "不需要标准化"],
        "tradeoffs": ["单树方差大", "容易拟合训练集噪声"],
        "whenToUse": "需要快速理解规则形状，或作为树集成方法的对照。",
    },
    "random-forest-v1": {
        "summary": "多棵随机决策树投票，降低单树波动。",
        "strengths": ["对异常值较稳健", "通常比单树泛化好"],
        "tradeoffs": ["模型更大", "参数和训练时间随树数增加"],
        "whenToUse": "表格特征存在非线性关系、又不想引入深度依赖时。",
    },
    "gaussian-naive-bayes-v1": {
        "summary": "假设各特征条件独立的高斯概率模型。",
        "strengths": ["训练极快", "样本较少时可作简单对照"],
        "tradeoffs": ["独立性假设通常不成立", "风险分可能偏激进"],
        "whenToUse": "需要低成本基线，并明确披露独立假设时。",
    },
    "gradient-boosting-v1": {
        "summary": "逐轮拟合残差的小树集成。",
        "strengths": ["常能捕捉非线性与交互", "表格任务表现稳健"],
        "tradeoffs": ["训练更慢", "轮数和深度需要谨慎控制"],
        "whenToUse": "有足够样本和验证集，需要更强的表格模型时。",
    },
    "mlp-v1": {
        "summary": "两层全连接网络，学习特征的非线性组合。",
        "strengths": ["表达能力强", "可按 epoch 观察训练"],
        "tradeoffs": ["依赖 torch", "对学习率和轮数更敏感"],
        "whenToUse": "经典模型已建立基线，且环境具备深度依赖时。",
    },
    "tabular-resnet-v1": {
        "summary": "带残差连接的表格网络。",
        "strengths": ["较深网络更容易优化", "适合连续表格特征"],
        "tradeoffs": ["依赖 torch", "比线性模型更难复现和解释"],
        "whenToUse": "需要深度模型对照，并接受更长训练时间时。",
    },
    "ft-transformer-v1": {
        "summary": "把每个字段当作 token 的表格 Transformer。",
        "strengths": ["可学习字段间交互", "结构适合特征集合"],
        "tradeoffs": ["依赖 torch", "小数据上不一定优于树模型"],
        "whenToUse": "样本量较大，且希望研究字段交互建模时。",
    },
    "wide-deep-v1": {
        "summary": "线性宽塔与多层深塔并联。",
        "strengths": ["兼顾线性记忆与非线性表达", "结构清晰"],
        "tradeoffs": ["依赖 torch", "参数量与调参成本更高"],
        "whenToUse": "需要深度方法对照，同时保留线性分量时。",
    },
}


def param_specs(name):
    """返回方法的可配置参数声明；不支持配置时返回空字典。"""
    get_algorithm(name)
    return dict(PARAM_SPECS.get(name, {}))


def _check_value(method, key, declaration, value):
    if isinstance(value, bool):
        raise BaselineError("INPUT_INVALID", f"参数 {key} 的类型无效")
    kind = declaration["type"]
    if kind == "int":
        if not isinstance(value, int):
            raise BaselineError("INPUT_INVALID", f"参数 {key} 必须是整数")
    elif kind == "float":
        if not isinstance(value, (int, float)):
            raise BaselineError("INPUT_INVALID", f"参数 {key} 必须是数值")
        value = float(value)
    else:  # pragma: no cover - 声明表由本模块维护
        raise BaselineError("INPUT_INVALID", f"参数 {key} 的声明类型无效")
    if value < declaration["min"] or value > declaration["max"]:
        raise BaselineError(
            "INPUT_INVALID",
            f"参数 {key} 必须在 {declaration['min']} 到 {declaration['max']} 之间",
        )
    return value


def resolve_params(method, overrides=None):
    """解析一次训练的实际参数，返回 (参数, 是否显式覆盖)。

    没有覆盖时返回冻结声明本身，使默认运行的配置与旧运行完全一致。
    有覆盖时只接受声明过的键，并写入契约版本；未知或越界参数直接拒绝。
    """
    entry = get_algorithm(method)
    if not overrides:
        return dict(entry["params"]), False
    specs = PARAM_SPECS.get(method)
    if not specs:
        raise BaselineError("INPUT_INVALID", f"{entry['name']} 不支持自定义参数")
    if not isinstance(overrides, dict):
        raise BaselineError("INPUT_INVALID", "训练参数必须是对象")
    unknown = set(overrides) - set(specs)
    if unknown:
        raise BaselineError("INPUT_INVALID", f"未声明的训练参数：{sorted(unknown)}")
    resolved = dict(entry["params"])
    for key, value in overrides.items():
        resolved[key] = _check_value(method, key, specs[key], value)
    return resolved, True


def validate_declared_params(method, values):
    """校验运行配置里声明的实际参数（加载阶段使用）。

    配置必须包含该方法冻结参数的全部键；声明过的键按契约校验，未声明的键
    必须与冻结值一致。这样既有参数化产物可加载，被篡改的配置会被拒绝。
    """
    entry = get_algorithm(method)
    if not isinstance(values, dict) or set(values) != set(entry["params"]):
        raise BaselineError("ARTIFACT_INVALID", "运行参数声明不完整")
    specs = PARAM_SPECS.get(method, {})
    for key, value in values.items():
        if key in specs:
            _check_value(method, key, specs[key], value)
        elif value != entry["params"][key]:
            raise BaselineError("ARTIFACT_INVALID", f"未声明参数 {key} 与冻结声明不一致")
    return True


def params_display(params, method):
    """相对于方法冻结声明的差异摘要，用于模型显示名。"""
    entry = get_algorithm(method)
    changed = {key: value for key, value in (params or {}).items()
               if entry["params"].get(key) != value}
    return ",".join(f"{key}={value}" for key, value in changed.items())

# (schema, 方法) → 模型标识。既有两项保持既有标识不变，使既有运行的来源信息可继续追溯。
METHOD_LABELS = {
    ("openstack-six-v1", "logistic-regression-l2-v1"): {"id": "logistic-regression-six-v1", "name": "逻辑回归 · 六字段"},
    ("kamei14-v1", "logistic-regression-l2-v1"): {"id": "logistic-regression-kamei14-v1", "name": "逻辑回归 · Kamei14（12 字段入模）"},
}


def get_algorithm(name):
    """按名称取回方法声明；未注册版本必须被拒绝。"""
    try:
        return ALGORITHMS[name]
    except (KeyError, TypeError):
        raise BaselineError("ALGORITHM_UNKNOWN", f"未注册的算法版本：{name}") from None


def resolve_algorithm(name):
    """接受名称或 None，缺省回退到首个冻结方法（旧运行无该方法声明时的解析口径）。"""
    return get_algorithm(name if name else DEFAULT_ALGORITHM)


def model_descriptor(schema_name, algorithm_version=None):
    """运行声明的模型标识：由 (schema, 方法) 共同决定，不再由 schema 单独决定。"""
    resolved = algorithm_version if algorithm_version else DEFAULT_ALGORITHM
    known = METHOD_LABELS.get((schema_name, resolved))
    if known is not None:
        return dict(known)
    entry = get_algorithm(resolved)
    return {"id": f"{entry['estimator']}@{schema_name}", "name": f"{entry['label']} · {schema_name}"}


def method_missing_dependencies(name):
    entry = get_algorithm(name)
    return [dependency for dependency in entry['requires']
            if importlib.util.find_spec(dependency) is None]


def method_catalog(schema):
    """项目分析可选方法：真实依赖是否可用，以及能否读取当前 schema。"""
    from ..schemas import resolve
    resolved = resolve(schema)
    supported = not resolved.semantic_only and resolved.input_width() > 0
    result = []
    for name, entry in ALGORITHMS.items():
        missing = method_missing_dependencies(name)
        result.append({
            'method': name, 'name': entry['name'], 'label': entry['label'],
            'category': entry['category'], 'requires': list(entry['requires']),
            'detail': entry['detail'], 'preprocess': list(entry['preprocess']),
            'explanation': dict(entry['explanation']),
            'guide': dict(ALGORITHM_GUIDES[name]),
            'available': not missing and supported,
            'supportedSchema': supported,
            'reason': ('缺少依赖：' + '、'.join(missing)) if missing
                      else (None if supported else '当前特征 schema 不支持该方法'),
        })
    return result


def check_method(name, schema):
    """创建分析前校验方法；未注册、依赖缺失或 schema 不支持时拒绝。"""
    entry = get_algorithm(name)
    missing = method_missing_dependencies(name)
    if missing:
        raise BaselineError('METHOD_DEPENDENCY_UNAVAILABLE',
                            f'{entry["name"]} 缺少运行依赖：{"、".join(missing)}')
    from ..schemas import resolve
    resolved = resolve(schema)
    if resolved.semantic_only or resolved.input_width() <= 0:
        raise BaselineError('METHOD_SCHEMA_MISMATCH', '当前特征 schema 不支持所选训练方法')
    return entry
