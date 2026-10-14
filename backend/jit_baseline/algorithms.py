"""具名方法注册表：方法如何声明，以及运行身份如何由 (schema, 方法) 共同决定。

见 generalize-model-registry-and-run-contract 的 design D1/D4/D5/D6：
方法以具名条目声明类别、冻结超参、所需依赖、复现口径与解释口径；校验按运行声明的
方法比对超参，不再与模块级常量比较；方法标识由 schema 与方法共同决定。
"""
from .config import MODEL_CONFIG
from .errors import BaselineError

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
        "explanation": {"method": None, "reason": "本 change 未实现预测解释；线性模型的候选口径留待解释 change 登记"},
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
        "explanation": {"method": None, "reason": "本 change 未实现预测解释；树模型的候选口径留待解释 change 登记"},
    },
}

DEFAULT_ALGORITHM = "logistic-regression-l2-v1"

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
