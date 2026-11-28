"""Commit and line metrics shared by author reproduction runs."""
from __future__ import annotations

import math
import random
from collections import defaultdict

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score

from ..ml.metrics import evaluate as evaluate_commit_metrics


def _finite(value, reason):
    return {"value": value, "reason": reason}


def commit_metrics(records, scores, *, threshold=0.5) -> dict:
    """Evaluate commit predictions on one frozen member set.

    Popt/IFA and whole-commit Recall@20%LOC reuse the registered metric code.
    Records must contain id, label, epoch, la and ld; callers that lack a real
    epoch use the fixed evaluation epoch 0 and disclose that limitation.
    """
    if len(records) != len(scores) or not records:
        raise ValueError("提交评价的样本与预测数量不一致")
    prepared = []
    for record, score in zip(records, scores, strict=True):
        value = float(score)
        if not math.isfinite(value) or not 0 <= value <= 1:
            raise ValueError(f"提交预测不是 [0,1] 内有限值：{score!r}")
        la = float(record.get("la") or record.get("laAdded") or 0)
        ld = float(record.get("ld") or record.get("ldDeleted") or 0)
        prepared.append({
            "id": str(record.get("id") or record.get("commitId")),
            "label": int(record["label"]),
            "epoch": int(record.get("epoch") or 0),
            "metrics": {"la": la, "ld": ld},
        })
    result = evaluate_commit_metrics(prepared, [float(v) for v in scores],
                                     metric_set="metric-set-v2")
    labels = [row["label"] for row in prepared]
    decisions = [score >= threshold for score in scores]
    tp = sum(label == 1 and pred for label, pred in zip(labels, decisions, strict=True))
    fp = sum(label == 0 and pred for label, pred in zip(labels, decisions, strict=True))
    fn = sum(label == 1 and not pred for label, pred in zip(labels, decisions, strict=True))
    tn = len(labels) - tp - fp - fn
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None
    return {
        "threshold": threshold,
        "samples": len(prepared),
        "positives": sum(labels),
        "averagePrecision": result["averagePrecision"],
        "rocAuc": result["rocAuc"],
        "precision": _finite(precision, None if precision is not None else "没有预测为正的提交"),
        "recall": _finite(recall, None if recall is not None else "没有正标签提交"),
        "f1": _finite(f1, None if f1 is not None else "没有真实或预测正类"),
        "confusion": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
        "recall20Loc": result["recall20Loc"],
        "effort": result["effort"],
        "popt": result["popt"],
        "ifa": result["ifa"],
        "reference": result["reference"],
    }


def _tie_key(row):
    try:
        idx = int(row.get("idx"))
    except (TypeError, ValueError):
        idx = 0
    return (str(row.get("path") or ""), idx)


def _ranked(rows, score_key):
    return sorted(rows, key=lambda row: (-float(row[score_key]), *_tie_key(row)))


def _commit_line_metrics(rows, score_key="lineScore") -> dict:
    groups = defaultdict(list)
    for row in rows:
        groups[str(row["commitId"])].append(row)
    top_hits = {1: 0, 5: 0, 10: 0}
    reciprocal, ifas, budget_recalls = [], [], []
    commits = positives = budget_positives = 0
    for commit in sorted(groups):
        members = _ranked(groups[commit], score_key)
        labels = [int(row["label"]) for row in members]
        positive_count = sum(labels)
        if not positive_count:
            continue
        commits += 1
        positives += positive_count
        for k in top_hits:
            top_hits[k] += int(any(labels[:k]))
        first = next(index for index, label in enumerate(labels) if label)
        reciprocal.append(1.0 / (first + 1))
        ifas.append(first)
        budget = max(1, math.ceil(0.2 * len(labels)))
        captured = sum(labels[:budget])
        budget_positives += captured
        budget_recalls.append(captured / positive_count)
    return {
        "commitsWithPositives": commits,
        "positives": positives,
        "topKHitRate": {f"top{k}": (hits / commits if commits else None)
                        for k, hits in top_hits.items()},
        "mrr": float(np.mean(reciprocal)) if reciprocal else None,
        "firstPositiveInspectionMean": float(np.mean(ifas)) if ifas else None,
        "firstPositiveInspectionMedian": float(np.median(ifas)) if ifas else None,
        "lineBudget": "ceil(20% of each commit's eligible lines)",
        "recallAt20PercentLines": (budget_positives / positives if positives else None),
        "recallAt20PercentPerCommitMean": (float(np.mean(budget_recalls))
                                           if budget_recalls else None),
    }


def _baseline_scores(rows, strategy, seed=42):
    if strategy == "file-order":
        ordered = sorted(rows, key=_tie_key)
        total = max(len(ordered) - 1, 1)
        rank = {id(row): index for index, row in enumerate(ordered)}
        return [1.0 - rank[id(row)] / total for row in rows]
    if strategy == "random":
        generator = random.Random(seed)
        order = list(range(len(rows)))
        generator.shuffle(order)
        total = max(len(rows) - 1, 1)
        scores = [0.0] * len(rows)
        for position, index in enumerate(order):
            scores[index] = 1.0 - position / total
        return scores
    raise ValueError(f"未知行级基线：{strategy}")


def line_metrics(rows, *, score_key="lineScore", random_runs=50, seed=42) -> dict:
    """Evaluate line ordering on all supplied rows.

    Rows must contain commitId, label, score_key, and an ordering identity
    (path/idx). Positive rows without a score are counted as uncovered when
    they come through the coverage argument supplied by callers.
    """
    if not rows:
        return {"samples": 0, "reason": "没有可评价的行"}
    model = _commit_line_metrics(_ranked(rows, score_key), score_key)
    file_rows = [dict(row) for row in rows]
    file_scores = _baseline_scores(file_rows, "file-order")
    for row, score in zip(file_rows, file_scores, strict=True):
        row["baselineScore"] = score
    file_order = _commit_line_metrics(_ranked(file_rows, "baselineScore"), "baselineScore")
    random_results = []
    for offset in range(random_runs):
        sample = [dict(row) for row in rows]
        scores = _baseline_scores(sample, "random", seed + offset)
        for row, score in zip(sample, scores, strict=True):
            row["baselineScore"] = score
        random_results.append(_commit_line_metrics(
            _ranked(sample, "baselineScore"), "baselineScore"))
    random_summary = {}
    for key in ("topKHitRate", "mrr", "firstPositiveInspectionMean",
                "recallAt20PercentLines"):
        if key == "topKHitRate":
            random_summary[key] = {
                name: (float(np.mean([item[key][name] for item in random_results
                                      if item[key][name] is not None]))
                       if any(item[key][name] is not None for item in random_results) else None)
                for name in ("top1", "top5", "top10")
            }
        else:
            values = [item[key] for item in random_results if item[key] is not None]
            random_summary[key] = float(np.mean(values)) if values else None
    return {
        "samples": len(rows),
        "positives": sum(int(row["label"]) for row in rows),
        "model": model,
        "baselines": {
            "fileOrder": file_order,
            "random": {"runs": random_runs, "seed": seed, **random_summary},
        },
        "tieRule": "score desc, path asc, idx asc",
        "metricDefinitions": {
            "topKHitRate": "fraction of positive commits with at least one positive in the first K lines",
            "recallAt20PercentLines": "share of positives captured by the first ceil(20% lines) per commit",
            "mrr": "mean reciprocal rank of the first positive line",
            "firstPositiveInspection": "number of lines ranked before the first positive line",
        },
    }
