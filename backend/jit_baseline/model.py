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
from .schemas import DEFAULT_SCHEMA, resolve


def _deep_estimator(name):
    """深度方法的估计器工厂：torch 只在真正训练时导入。

    `torch` 是可选依赖；缺失时其余方法与服务仍可用，选到深度方法才以可定位的
    错误拒绝（PROTOCOL.md「深度方法的随机性与复现」）。
    """
    def factory(**kwargs):
        try:
            from . import deep
        except ImportError as exc:
            raise BaselineError("ALGORITHM_UNAVAILABLE", "深度方法需要可用的 torch 环境") from exc
        return getattr(deep, name)(**kwargs)
    return factory


# 估计器实现表：注册条目声明用哪一个，这里提供可 joblib 序列化的实现。
ESTIMATORS = {
    "logistic-regression": LogisticRegression,
    "decision-tree": DecisionTreeClassifier,
    "random-forest": RandomForestClassifier,
    "gaussian-naive-bayes": GaussianNB,
    "gradient-boosting": GradientBoostingClassifier,
    "torch-mlp": _deep_estimator("torch_mlp"),
    "torch-tabular-resnet": _deep_estimator("torch_tabular_resnet"),
    "torch-ft-transformer": _deep_estimator("torch_ft_transformer"),
    "torch-wide-deep": _deep_estimator("torch_wide_deep"),
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


class ExpertStandardScaler:
    """只标准化前 N 个专家列；语义向量保持原值。模块级类以便 joblib 序列化。"""

    def __init__(self, expert_columns):
        self.expert_columns = int(expert_columns)
        self.scaler_ = StandardScaler()

    def fit(self, X, y=None):
        X = np.asarray(X)
        if X.ndim != 2 or self.expert_columns < 0 or self.expert_columns > X.shape[1]:
            raise ValueError("专家列数与输入矩阵不一致")
        self.n_features_in_ = X.shape[1]
        if self.expert_columns:
            self.scaler_.fit(X[:, :self.expert_columns])
        return self

    def transform(self, X):
        result = np.array(X, dtype=np.float64, copy=True)
        if self.expert_columns:
            result[:, :self.expert_columns] = self.scaler_.transform(X[:, :self.expert_columns])
        return result

    def fit_transform(self, X, y=None):
        return self.fit(X, y).transform(X)

    def get_params(self, deep=True):
        return {"expert_columns": self.expert_columns}

    def set_params(self, **params):
        for key, value in params.items():
            setattr(self, key, value)
        return self


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
    schema = resolve(schema if schema is not None else DEFAULT_SCHEMA)
    if not records:
        raise BaselineError("FEATURES_INVALID", "输入特征矩阵为空")
    experts = None
    if not schema.semantic_only:
        width = len(schema.in_model_names())
        try:
            experts = np.asarray([r["features"] for r in records], dtype=np.float64)
        except (KeyError, TypeError, ValueError) as exc:
            raise BaselineError("FEATURES_INVALID", "输入特征矩阵无效") from exc
        if experts.ndim != 2 or experts.shape[1] != width:
            raise BaselineError("FEATURES_INVALID", f"输入必须为非空 {width} 字段矩阵")
        if not np.isfinite(experts).all() or (experts < 0).any():
            raise BaselineError("FEATURES_INVALID", "输入特征含非法数值")
    if schema.semantic:
        dim = schema.semantic_dim()
        vectors = []
        for record in records:
            vector = record.get("semantic")
            if not isinstance(vector, (list, tuple, np.ndarray)) or len(vector) != dim:
                raise BaselineError("FEATURES_INVALID", "语义向量缺失或维度与 schema 声明不一致")
            vectors.append(vector)
        try:
            semantic = np.asarray(vectors, dtype=np.float64)
        except (TypeError, ValueError) as exc:
            raise BaselineError("FEATURES_INVALID", "语义向量无效") from exc
        if semantic.ndim != 2 or semantic.shape[1] != dim or not np.isfinite(semantic).all():
            raise BaselineError("FEATURES_INVALID", "语义向量无效")
        matrix = semantic if schema.semantic_only else np.hstack([experts, semantic])
    else:
        matrix = experts
    if matrix is None or matrix.ndim != 2 or matrix.shape[1] != schema.input_width() or not len(matrix):
        raise BaselineError("FEATURES_INVALID", "输入特征形状与 schema 声明不一致")
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
    steps = []
    if not schema.semantic_only:
        steps.append(("counts", FunctionTransformer(Log1pColumns(schema.log1p_indices()))))
    if "scale" in entry["preprocess"]:
        steps.append(("scale", ExpertStandardScaler(
            0 if schema.semantic_only else len(schema.in_model_names()))
            if schema.semantic else StandardScaler()))
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
