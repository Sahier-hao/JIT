"""具名算法版本注册表。

见 align-feature-and-model-definitions 的 design D6：运行声明算法版本，源码指纹转为溯源记录，
校验的是"声明的版本已被注册"，而不是"当前文件与旧运行逐字节相同"。
"""
from .errors import BaselineError

ALGORITHMS = {
    "logistic-regression-l2-v1": {
        "name": "逻辑回归 · L2",
        "detail": "L2/C=1/lbfgs/max_iter=1000/tol=1e-4/class_weight=None/seed=2026/单线程",
    },
}

DEFAULT_ALGORITHM = "logistic-regression-l2-v1"


def get_algorithm(name):
    """按名称取回算法版本；未注册版本必须被拒绝。"""
    try:
        return ALGORITHMS[name]
    except (KeyError, TypeError):
        raise BaselineError("ALGORITHM_UNKNOWN", f"未注册的算法版本：{name}") from None


MODEL_LABELS = {
    "openstack-six-v1": {"id": "logistic-regression-six-v1", "name": "逻辑回归 · 六字段"},
    "kamei14-v1": {"id": "logistic-regression-kamei14-v1", "name": "逻辑回归 · Kamei14（12 字段入模）"},
}


def model_descriptor(schema_name):
    """运行声明的模型标识：由 schema 决定，不再写死在代码常量里。"""
    return MODEL_LABELS.get(schema_name, {"id": f"logistic-regression-{schema_name}", "name": f"逻辑回归 · {schema_name}"})
