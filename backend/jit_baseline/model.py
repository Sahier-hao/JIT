"""Train-only fixed pipeline and chronological partitioning."""
import math
import warnings

import numpy as np
from sklearn.exceptions import ConvergenceWarning
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.naive_bayes import GaussianNB
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler
from sklearn.tree import DecisionTreeClassifier
from threadpoolctl import threadpool_limits

from .algorithms import DEFAULT_ALGORITHM, get_algorithm
from .data import BaselineError
from .deep import torch_ft_transformer, torch_mlp, torch_tabular_resnet, torch_wide_deep
from .schemas import DEFAULT_SCHEMA, resolve

# 估计器实现表：注册条目声明用哪一个，这里提供可 joblib 序列化的实现。
ESTIMATORS = {
    "logistic-regression": LogisticRegression,
    "decision-tree": DecisionTreeClassifier,
    "random-forest": RandomForestClassifier,
    "gaussian-naive-bayes": GaussianNB,
    "gradient-boosting": GradientBoostingClassifier,
    "torch-mlp": torch_mlp,
    "torch-tabular-resnet": torch_tabular_resnet,
    "torch-ft-transformer": torch_ft_transformer,
    "torch-wide-deep": torch_wide_deep,
}


class Log1pColumns:
    """按 schema 声明的列做 log1p；模块级类以便 joblib 序列化。"""

    def __init__(self, columns):
        self.columns = tuple(columns)

    def __call__(self, matrix):
        result = np.array(matrix, dtype=np.float64, copy=True)
        if self.columns:
            result[:, list(self.columns)] = np.log1p(result[:, list(self.columns)])
        return result


def log_counts(matrix):
    """旧六字段冻结产物的 joblib 兼容入口。

    具名 schema 重构（generalize-model-registry-and-run-contract）之前的冻结产物
    （backend/artifacts/baseline 与 reproduction）在序列化时引用本模块的 `log_counts`；
    保留同行为入口使旧产物按其训练时代码加载。列 [0,1,2,4,5] 对应 openstack-six-v1
    的 ns、nd、nf、la、ld，ent（列 3）不变——与 Log1pColumns 对该 schema 的行为一致。
    """
    result = np.array(matrix, dtype=np.float64, copy=True)
    result[:, [0, 1, 2, 4, 5]] = np.log1p(result[:, [0, 1, 2, 4, 5]])
    return result


def temporal_split(records):
    if not records or len({r["id"] for r in records}) != len(records):
        raise BaselineError("SPLIT_INVALID", "分区为空或提交身份重复")
    if any(not isinstance(r["epoch"], int) or isinstance(r["epoch"], bool) for r in records):
        raise BaselineError("SPLIT_INVALID", "分区时间无效")
    ordered = sorted(records, key=lambda r: (r["epoch"], r["id"]))
    times = sorted({r["epoch"] for r in ordered})
    if len(times) < 3:
        raise BaselineError("SPLIT_INVALID", "时间组不足，不能形成三个非空分区")
    boundaries = [times[math.floor(.70 * len(times))], times[math.floor(.85 * len(times))]]
    split = {"train": [], "validation": [], "test": []}
    for r in ordered:
        partition = "train" if r["epoch"] < boundaries[0] else "validation" if r["epoch"] < boundaries[1] else "test"
        split[partition].append(r)
    if any(not part for part in split.values()):
        raise BaselineError("SPLIT_INVALID", "时间分区包含空集合")
    if any({r["label"] for r in split[k]} != {0, 1} for k in ["train", "test"]):
        raise BaselineError("SPLIT_INVALID", "训练与测试必须包含两类发布标签")
    return split, boundaries


def feature_matrix(records, schema=None):
    width = len(resolve(schema if schema is not None else DEFAULT_SCHEMA).in_model_names())
    try:
        matrix = np.asarray([r["features"] for r in records], dtype=np.float64)
    except (KeyError, TypeError, ValueError) as exc:
        raise BaselineError("FEATURES_INVALID", "输入特征矩阵无效") from exc
    if matrix.ndim != 2 or matrix.shape[1] != width or not len(matrix):
        raise BaselineError("FEATURES_INVALID", f"输入必须为非空 {width} 字段矩阵")
    if not np.isfinite(matrix).all() or (matrix < 0).any():
        raise BaselineError("FEATURES_INVALID", "输入特征含非法数值")
    return matrix


def build_estimator(entry):
    """由方法声明构造估计器；未实现的估计器必须被拒绝。"""
    factory = ESTIMATORS.get(entry.get("estimator"))
    if factory is None:
        raise BaselineError("ALGORITHM_UNKNOWN", f"方法声明的估计器未实现：{entry.get('estimator')}")
    return factory(**entry["kwargs"])


def fit_model(train_records, *, schema=None, algorithm=None):
    """按 schema 的变换与方法的声明构造流水线。

    `counts` 由 schema 决定、方法不得覆盖；是否标准化与估计器由方法声明。
    """
    schema = resolve(schema if schema is not None else DEFAULT_SCHEMA)
    entry = get_algorithm(algorithm if algorithm else DEFAULT_ALGORITHM)
    matrix = feature_matrix(train_records, schema)
    labels = np.asarray([r["label"] for r in train_records])
    if set(labels.tolist()) != {0, 1}:
        raise BaselineError("MODEL_INVALID", "训练需要两类发布标签")
    steps = [("counts", FunctionTransformer(Log1pColumns(schema.log1p_indices())))]
    if "scale" in entry["preprocess"]:
        steps.append(("scale", StandardScaler()))
    steps.append(("model", build_estimator(entry)))
    pipeline = Pipeline(steps)
    try:
        with threadpool_limits(limits=1), warnings.catch_warnings():
            warnings.simplefilter("error", ConvergenceWarning)
            pipeline.fit(matrix, labels)
    except ConvergenceWarning as exc:
        raise BaselineError("MODEL_NOT_CONVERGED", "方法按自身声明未收敛，不能发布有效产物") from exc
    return pipeline


def predict_risks(pipeline, records, schema=None):
    matrix = feature_matrix(records, schema)
    try:
        positive = pipeline.classes_.tolist().index(1)
        with threadpool_limits(limits=1):
            risks = np.asarray(pipeline.predict_proba(matrix)[:, positive], dtype=np.float64)
    except (AttributeError, ValueError, IndexError) as exc:
        raise BaselineError("INFERENCE_ERROR", "无法生成标签 1 的模型风险") from exc
    if len(risks) != len(records) or not np.isfinite(risks).all() or (risks < 0).any() or (risks > 1).any():
        raise BaselineError("INFERENCE_ERROR", "推理数量或风险数值无效")
    return risks.tolist()
