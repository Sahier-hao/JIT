"""Train-only fixed pipeline and chronological partitioning."""
import math
import warnings

import numpy as np
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler
from threadpoolctl import threadpool_limits

from .config import FEATURES, MODEL_CONFIG
from .data import BaselineError


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


def feature_matrix(records):
    try:
        matrix = np.asarray([r["features"] for r in records], dtype=np.float64)
    except (KeyError, TypeError, ValueError) as exc:
        raise BaselineError("FEATURES_INVALID", "输入特征矩阵无效") from exc
    if matrix.ndim != 2 or matrix.shape[1] != len(FEATURES) or not len(matrix):
        raise BaselineError("FEATURES_INVALID", "输入必须为非空六字段矩阵")
    if not np.isfinite(matrix).all() or (matrix < 0).any():
        raise BaselineError("FEATURES_INVALID", "输入特征含非法数值")
    return matrix


def log_counts(matrix):
    result = np.array(matrix, dtype=np.float64, copy=True)
    result[:, [0, 1, 2, 4, 5]] = np.log1p(result[:, [0, 1, 2, 4, 5]])
    return result


def fit_model(train_records, *, max_iter=MODEL_CONFIG["max_iter"]):
    matrix = feature_matrix(train_records)
    labels = np.asarray([r["label"] for r in train_records])
    if set(labels.tolist()) != {0, 1}:
        raise BaselineError("MODEL_INVALID", "训练需要两类发布标签")
    pipeline = Pipeline([
        ("counts", FunctionTransformer(log_counts)),
        ("scale", StandardScaler()),
        # sklearn 1.9 uses l1_ratio=0 for L2; penalty='l2' is deprecated.
        ("model", LogisticRegression(C=1.0, l1_ratio=0.0, solver="lbfgs", max_iter=max_iter,
                                     tol=1e-4, class_weight=None, random_state=2026)),
    ])
    try:
        with threadpool_limits(limits=1), warnings.catch_warnings():
            warnings.simplefilter("error", ConvergenceWarning)
            pipeline.fit(matrix, labels)
    except ConvergenceWarning as exc:
        raise BaselineError("MODEL_NOT_CONVERGED", "固定模型未收敛，不能发布有效产物") from exc
    return pipeline


def predict_risks(pipeline, records):
    matrix = feature_matrix(records)
    try:
        positive = pipeline.classes_.tolist().index(1)
        with threadpool_limits(limits=1):
            risks = np.asarray(pipeline.predict_proba(matrix)[:, positive], dtype=np.float64)
    except (AttributeError, ValueError, IndexError) as exc:
        raise BaselineError("INFERENCE_ERROR", "无法生成标签 1 的模型风险") from exc
    if len(risks) != len(records) or not np.isfinite(risks).all() or (risks < 0).any() or (risks > 1).any():
        raise BaselineError("INFERENCE_ERROR", "推理数量或风险数值无效")
    return risks.tolist()
