"""Registered, deterministic explanation methods for repository scores."""
import math

import numpy as np
from sklearn.linear_model import LogisticRegression

from ..errors import BaselineError

DEFAULT_METHOD = "occlusion-mean-v1"
LINEAR_METHOD = "linear-logodds-v1"
TOP_K = 5
_ZERO = 1e-12
_REPOSITORY_SCHEMAS = frozenset(("openstack-six-v1", "kamei14-git-v1", "kamei14-git-v2"))

METHODS = {
    DEFAULT_METHOD: {
        "method": DEFAULT_METHOD,
        "name": "遮挡均值基线",
        "applicableModels": (
            "logistic-regression",
            "decision-tree",
            "random-forest",
            "gaussian-naive-bayes",
            "gradient-boosting",
            "torch-mlp",
            "torch-tabular-resnet",
            "torch-ft-transformer",
            "torch-wide-deep",
        ),
        "unit": "probability",
        "baseline": "training-partition-mean",
        "cost": "one replacement prediction per input feature",
        "deterministic": True,
        "limitations": (
            "衡量单个字段被训练分区均值替换后的风险变化，不是可相加的模型分解。",
            "字段之间可能存在交互，逐个遮挡不能解释交互贡献。",
        ),
    },
    LINEAR_METHOD: {
        "method": LINEAR_METHOD,
        "name": "逻辑回归 log-odds 分解",
        "applicableModels": ("logistic-regression",),
        "unit": "logit",
        "baseline": "training-partition-mean",
        "cost": "one pipeline transform and one coefficient product",
        "deterministic": True,
        "limitations": (
            "只适用于二元逻辑回归，贡献和等于当前输入相对基线的 log-odds 差。",
            "log-odds 与遮挡法的概率变化单位不同，不能相加或共同排名。",
        ),
    },
}


def method(method_id=DEFAULT_METHOD):
    """Return one registered method declaration; unknown ids never fall back."""
    try:
        return dict(METHODS[method_id])
    except (KeyError, TypeError):
        raise BaselineError("EXPLANATION_METHOD_UNKNOWN", f"未注册的解释方法：{method_id}") from None


def _linear_model(pipeline):
    estimator = getattr(pipeline, "named_steps", {}).get("model")
    return estimator if isinstance(estimator, LogisticRegression) else None


def applicable_methods(schema_name, pipeline):
    """Return only methods executable for this input schema and fitted pipeline."""
    if schema_name not in _REPOSITORY_SCHEMAS:
        return []
    result = [method(DEFAULT_METHOD)]
    if _linear_model(pipeline) is not None:
        result.append(method(LINEAR_METHOD))
    return result


def require_applicable(method_id, schema_name, pipeline):
    declaration = method(method_id)
    if schema_name not in _REPOSITORY_SCHEMAS:
        raise BaselineError(
            "EXPLANATION_METHOD_UNSUPPORTED",
            f"输入 schema {schema_name} 不支持仓库解释",
        )
    if method_id == LINEAR_METHOD and _linear_model(pipeline) is None:
        raise BaselineError(
            "EXPLANATION_METHOD_UNSUPPORTED",
            "linear-logodds-v1 只适用于二元逻辑回归模型",
        )
    return declaration


def _logit_scores(pipeline, matrix):
    estimator = _linear_model(pipeline)
    if estimator is None:
        raise ValueError("linear explanation requires logistic regression")
    classes = list(getattr(estimator, "classes_", ()))
    try:
        positive = classes.index(1)
    except ValueError:
        raise ValueError("logistic regression does not contain positive class 1") from None
    values = np.asarray(pipeline.decision_function(matrix), dtype=np.float64)
    if values.ndim == 2:
        values = values[:, positive]
    if values.shape != (2,) or not np.isfinite(values).all():
        raise ValueError("logistic decision function returned invalid scores")
    return values


def linear_logodds(pipeline, features, baseline, names, top_k=TOP_K):
    """Exact logistic-regression decomposition in log-odds units.

    Both the current vector and baseline vector pass through the fitted pipeline's
    preprocessing. Coefficients are therefore applied to the same transformed space
    used during training. Missing baseline fields use zero before that transform.
    """
    if len(features) != len(names):
        raise ValueError("feature vector and names have different lengths")
    if top_k < 1:
        raise ValueError("top_k must be positive")
    estimator = _linear_model(pipeline)
    if estimator is None:
        raise ValueError("linear explanation requires logistic regression")
    coefficients = np.asarray(estimator.coef_, dtype=np.float64)
    if coefficients.ndim == 2 and coefficients.shape[0] == 1:
        coefficients = coefficients[0]
    if coefficients.shape != (len(names),) or not np.isfinite(coefficients).all():
        raise ValueError("logistic coefficients do not match input features")

    vector = np.asarray([[float(value) for value in features]], dtype=np.float64)
    base_vector = np.asarray(
        [[float(baseline.get(name, 0.0)) for name in names]], dtype=np.float64
    )
    matrix = np.vstack((vector, base_vector))
    preprocess = pipeline[:-1]
    transformed = np.asarray(preprocess.transform(matrix), dtype=np.float64)
    if transformed.shape != (2, len(names)) or not np.isfinite(transformed).all():
        raise ValueError("preprocessed explanation inputs are invalid")

    contributions = coefficients * (transformed[0] - transformed[1])
    scores = _logit_scores(pipeline, matrix)
    explained = float(np.sum(contributions))
    actual = float(scores[0] - scores[1])
    if not math.isclose(explained, actual, rel_tol=1e-9, abs_tol=1e-9):
        raise ValueError("linear contributions do not equal the log-odds difference")

    items = []
    for index, name in enumerate(names):
        delta = float(contributions[index])
        if abs(delta) <= _ZERO:
            continue
        items.append({
            "feature": name,
            "value": features[index],
            "baseline": baseline.get(name, 0.0),
            "delta": round(delta, 6),
            "direction": "increases" if delta > 0 else "decreases",
        })
    items.sort(key=lambda item: abs(item["delta"]), reverse=True)
    items = items[:top_k]
    return {
        "method": LINEAR_METHOD,
        "unit": "logit",
        "items": items,
        "summary": _linear_summary(items, actual),
        "contributionTotal": explained,
        "currentLogit": float(scores[0]),
        "baselineLogit": float(scores[1]),
    }


def _linear_summary(items, total):
    if not items:
        return "当前输入与训练分区基线没有可测的 log-odds 差异；这不是缺陷结论。"
    lead = items[0]
    verb = "推高" if lead["direction"] == "increases" else "拉低"
    return (
        f"相对训练分区基线，log-odds 总变化为 {total:.6f}； "
        f"影响最大的字段为 {lead['feature']}，{verb} {abs(lead['delta']):.6f}。"
        "该结果来自逻辑回归分解，不是缺陷结论。"
    )


def linear_stability(pipeline, features, baseline, names, rounds=3):
    """Apply the same legal small perturbation used by occlusion stability."""
    base = linear_logodds(pipeline, features, baseline, names)["items"]
    base_order = [item["feature"] for item in base[:3]]
    orders = []
    for index in range(rounds):
        factor = 0.9 if index % 2 == 0 else 1.1
        perturbed = [max(0.0, float(value) * factor) for value in features]
        items = linear_logodds(pipeline, perturbed, baseline, names)["items"]
        orders.append([item["feature"] for item in items[:3]])
    stable = all(order == base_order for order in orders)
    return {
        "status": "stable" if stable else "unstable",
        "rounds": rounds,
        "topFeatures": orders,
        "baseOrder": base_order,
    }
