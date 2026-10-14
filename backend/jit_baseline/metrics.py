"""Frozen classification and whole-commit effort evaluation."""
import math

from sklearn.metrics import average_precision_score, roc_auc_score

from .config import THRESHOLD
from .data import BaselineError

# 具名指标集：运行声明自己按哪一套指标评价，校验按该声明重算（PDB-12）。
# 新增指标时新增一个集合版本，既有运行仍按自身声明的集合重算，不因新增指标失效。
METRIC_SETS = {
    "metric-set-v1": ("precision", "recall", "f1", "confusion", "rocAuc", "averagePrecision",
                      "recall20Loc", "counts", "effort", "reference", "threshold"),
}
DEFAULT_METRIC_SET = "metric-set-v1"


def get_metric_set(name):
    """按名称取回指标集；未注册名称被拒绝，不退回默认集合。"""
    try:
        return METRIC_SETS[name]
    except (KeyError, TypeError):
        raise BaselineError("METRIC_SET_UNKNOWN", f"未注册的指标集：{name}") from None


def declared_metric_set(name):
    """旧运行没有指标集声明时回退到首轮冻结集合。"""
    return get_metric_set(name if name else DEFAULT_METRIC_SET)


def metric(value=None, reason=None):
    return {"value": value, "reason": reason}


def classification(labels, decisions):
    tp = sum(y == 1 and p for y, p in zip(labels, decisions, strict=True))
    fp = sum(y == 0 and p for y, p in zip(labels, decisions, strict=True))
    fn = sum(y == 1 and not p for y, p in zip(labels, decisions, strict=True))
    tn = len(labels) - tp - fp - fn
    return {
        "precision": metric(tp / (tp + fp)) if tp + fp else metric(reason="没有预测为正的提交"),
        "recall": metric(tp / (tp + fn)) if tp + fn else metric(reason="没有正标签提交"),
        "f1": metric(2 * tp / (2 * tp + fp + fn)) if 2 * tp + fp + fn else metric(reason="没有真实或预测正类"),
        "confusion": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
    }


def evaluate(records, risks, metric_set=None):
    if not records or len(records) != len(risks):
        raise BaselineError("EVALUATION_INVALID", "评价数量不一致或为空")
    if any(isinstance(p, bool) or not isinstance(p, (int, float)) or not math.isfinite(p) or not 0 <= p <= 1 for p in risks):
        raise BaselineError("EVALUATION_INVALID", "评价风险必须为有限概率")
    labels = [r["label"] for r in records]
    if any(y not in (0, 1) for y in labels):
        raise BaselineError("EVALUATION_INVALID", "评价标签无效")
    result = classification(labels, [p >= THRESHOLD for p in risks])
    two_classes = set(labels) == {0, 1}
    result["rocAuc"] = metric(float(roc_auc_score(labels, risks))) if two_classes else metric(reason="测试集不包含两类标签")
    result["averagePrecision"] = metric(float(average_precision_score(labels, risks))) if two_classes else metric(reason="测试集不包含两类标签")
    costs = [r["metrics"]["la"] + r["metrics"]["ld"] for r in records]
    if any(not math.isfinite(c) or c < 0 for c in costs):
        raise BaselineError("EVALUATION_INVALID", "工作量必须为非负有限值")
    total = sum(costs)
    budget = .2 * total
    order = sorted(range(len(records)), key=lambda i: (-risks[i], -records[i]["epoch"], records[i]["id"]))
    selected = []
    used = 0
    for i in order:
        if used + costs[i] > budget:
            break
        selected.append(i)
        used += costs[i]
    positives = sum(labels)
    result["recall20Loc"] = (metric(sum(labels[i] for i in selected) / positives) if total > 0 and positives
                              else metric(reason="总工作量为零" if total == 0 else "没有正标签提交"))
    result["counts"] = {"records": len(records), "positive": positives, "negative": len(records) - positives}
    result["effort"] = {"name": "Recall@20%LOC (risk-ranked)", "totalLoc": total, "budgetLoc": budget,
                        "usedLoc": used, "selectedCount": len(selected), "ordering": "risk-desc,time-desc,id-asc",
                        "policy": "whole-commit-prefix-stop"}
    result["reference"] = {"apNoInformation": positives / len(records),
                           "allNegative": classification(labels, [False] * len(labels))}
    result["threshold"] = THRESHOLD
    declared = declared_metric_set(metric_set)
    missing = [name for name in declared if name not in result]
    if missing:
        raise BaselineError("METRIC_SET_INVALID", f"指标集 {metric_set or DEFAULT_METRIC_SET} 声明了未定义的指标：{'、'.join(missing)}")
    return {name: result[name] for name in declared}
