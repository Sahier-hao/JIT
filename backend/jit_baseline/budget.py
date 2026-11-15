"""review-benefit-v3: one whole-commit budget protocol for matrix and benefit reports.

Both the multi-repository matrix and the model benefit report call these pure
functions with the same records, fixed strategies and fixed randomness. Old
`metric-set-v2` values keep their own prefix-stop semantics and are not
recomputed through this module.
"""
from __future__ import annotations

import hashlib
import math
import random

from .data import BaselineError

PROTOCOL = "review-benefit-v3"
FORMAT = "review-benefit-v3"
BUDGET_FRACTION = 0.20
RANDOM_RUNS = 200
RANDOM_SEED = 2026
BOOTSTRAP_RUNS = 1000
BOOTSTRAP_SEED = 2026
BLOCK_SECONDS = 7 * 86400
MIN_BLOCKS = 5
MIN_POSITIVES = 5
CONFIDENCE = 0.95
BUDGET_RULE = "continue-whole-commit"
SENSITIVITY_RULE = "stop-at-first-overflow"
STRATEGIES = ("model", "density", "loc", "time", "random")
ORDERINGS = {
    "model": "score-desc,time-desc,id-asc",
    "density": "risk-per-loc-desc,time-desc,id-asc",
    "loc": "loc-asc,time-desc,id-asc",
    "time": "time-desc,id-asc",
}
LIMITATIONS = (
    "预算协议按整提交累计：放不下时跳过并继续，前缀停止只作为敏感性结果。",
    "这是固定测试分区上的回顾性评价，不是在线效果、缺陷概率或因果结论。",
    "配对区间来自 UTC 自然周时间块重采样，不能当作独立提交数量。",
    "零成本、无正例或时间块不足时，相关指标返回空值和原因，不以零或假区间代替。",
)


def protocol():
    """冻结协议声明；报告与矩阵写入同一个哈希。"""
    payload = {
        "name": PROTOCOL, "budgetFraction": BUDGET_FRACTION,
        "budgetRule": BUDGET_RULE, "sensitivityRule": SENSITIVITY_RULE,
        "strategies": list(STRATEGIES), "orderings": dict(ORDERINGS),
        "randomRuns": RANDOM_RUNS, "randomSeed": RANDOM_SEED,
        "bootstrapRuns": BOOTSTRAP_RUNS, "bootstrapSeed": BOOTSTRAP_SEED,
        "blockSeconds": BLOCK_SECONDS, "minBlocks": MIN_BLOCKS,
        "minPositives": MIN_POSITIVES, "confidence": CONFIDENCE,
        "unit": "whole-commit", "cost": "la+ld",
    }
    return payload


def protocol_sha256():
    import json
    return hashlib.sha256(json.dumps(protocol(), sort_keys=True,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()


def metric(value=None, reason=None):
    return {"value": value, "reason": reason}


def prepare(records):
    """校验并复制评价记录：成本必须是非负有限数。"""
    prepared = []
    for record in records:
        if "metrics" in record:
            metrics = record.get("metrics") or {}
            cost = metrics.get("la", 0) + metrics.get("ld", 0)
        else:
            cost = record.get("cost", 0)
        if isinstance(cost, bool) or not isinstance(cost, (int, float)) or not math.isfinite(cost) or cost < 0:
            raise BaselineError("EVALUATION_INVALID", "提交成本必须是非负有限数")
        prepared.append({"id": record["id"], "epoch": int(record["epoch"]),
                         "label": int(record["label"]), "cost": float(cost),
                         "risk": record.get("risk")})
    return prepared


def _tie(record):
    return (-record["epoch"], record["id"])


def model_order(records):
    if any(record.get("risk") is None for record in records):
        raise BaselineError("EVALUATION_INVALID", "模型排序需要每条提交的风险分数")
    return sorted(range(len(records)),
                  key=lambda i: (-records[i]["risk"], *_tie(records[i])))


def density_order(records):
    """风险/成本密度；零成本提交让密度无定义，不用 max(cost, 1) 制造数值。"""
    if any(record["cost"] <= 0 for record in records):
        return None, "存在零成本提交，风险/成本密度未定义"
    return sorted(range(len(records)),
                  key=lambda i: (-(records[i]["risk"] / records[i]["cost"]),
                                 *_tie(records[i]))), None


def loc_order(records):
    return sorted(range(len(records)),
                  key=lambda i: (records[i]["cost"], *_tie(records[i])))


def time_order(records):
    return sorted(range(len(records)), key=lambda i: _tie(records[i]))


def random_order(records, seed=RANDOM_SEED, run=0):
    return sorted(range(len(records)),
                  key=lambda i: hashlib.sha256(
                      f"{seed}:{run}:{records[i]['id']}".encode("utf-8")).digest())


def select(records, order, *, budget_fraction=BUDGET_FRACTION, skip_overflow=True):
    """按整提交累计预算；返回实际选中提交、使用成本与覆盖正例。"""
    total = sum(record["cost"] for record in records)
    positives = sum(record["label"] for record in records)
    if total <= 0:
        return metric(reason="总工作量为零"), {
            "selected": [], "selectedCount": 0, "usedLoc": 0.0,
            "issuesCovered": 0, "totalLoc": total, "budgetLoc": 0.0,
            "positives": positives, "reason": "总工作量为零",
            "precisionAtBudget": metric(reason="预算内没有可检查提交")}
    if positives <= 0:
        return metric(reason="没有正标签提交"), {
            "selected": [], "selectedCount": 0, "usedLoc": 0.0,
            "issuesCovered": 0, "totalLoc": total,
            "budgetLoc": budget_fraction * total, "positives": 0,
            "reason": "没有正标签提交",
            "precisionAtBudget": metric(reason="预算内没有可检查提交")}
    budget = budget_fraction * total
    selected, used, covered = [], 0.0, 0
    for index in order:
        cost = records[index]["cost"]
        if used + cost > budget:
            if skip_overflow:
                continue
            break
        selected.append(records[index]["id"])
        used += cost
        covered += records[index]["label"]
    precision = (metric(covered / len(selected)) if selected
                 else metric(reason="预算内没有可检查提交"))
    return metric(covered / positives), {
        "selected": selected, "selectedCount": len(selected), "usedLoc": used,
        "issuesCovered": covered, "totalLoc": total, "budgetLoc": budget,
        "positives": positives, "reason": None,
        "usedFraction": used / total, "precisionAtBudget": precision,
    }


def _curve_area(order, records, total_cost, positives):
    x = selected = 0.0
    points = [(0.0, 0.0)]
    for index in order:
        x += records[index]["cost"] / total_cost
        selected += records[index]["label"]
        points.append((x, selected / positives))
    return sum((y0 + y1) / 2.0 * (x1 - x0)
               for (x0, y0), (x1, y1) in zip(points, points[1:]))


def popt(records, order, *, ordering):
    """全预算成本-召回面积，按 oracle/worst 归一化；零成本时返回原因。"""
    detail = {"name": "Popt (normalized cost-recall area)", "ordering": ordering,
              "policy": "trapezoid-full-range", "totalLoc": None,
              "areaModel": None, "areaOracle": None, "areaWorst": None}
    total = sum(record["cost"] for record in records)
    positives = sum(record["label"] for record in records)
    detail["totalLoc"] = total
    if total <= 0:
        return metric(reason="总工作量为零"), detail
    if any(record["cost"] <= 0 for record in records):
        return metric(reason="存在零成本提交，Popt 未定义"), detail
    if positives <= 0:
        return metric(reason="没有正标签提交"), detail
    oracle = sorted(range(len(records)),
                    key=lambda i: (-records[i]["label"] / records[i]["cost"],
                                   *_tie(records[i])))
    worst = list(reversed(oracle))
    detail["areaModel"] = _curve_area(order, records, total, positives)
    detail["areaOracle"] = _curve_area(oracle, records, total, positives)
    detail["areaWorst"] = _curve_area(worst, records, total, positives)
    denominator = detail["areaOracle"] - detail["areaWorst"]
    if abs(denominator) <= 1e-12:
        return metric(reason="oracle 与 worst 面积相等，Popt 未定义"), detail
    return metric((detail["areaModel"] - detail["areaWorst"]) / denominator), detail


def ifa(records, order):
    positions = {index: position for position, index in enumerate(order)}
    first = None
    for index, record in enumerate(records):
        if record["label"] == 1:
            first = positions[index] if first is None else min(first, positions[index])
    if first is None:
        return metric(reason="没有正标签提交")
    return metric(first)


def strategy(records, order, *, ordering, skip_overflow=True, budget_fraction=BUDGET_FRACTION):
    """一条排序在给定预算规则下的完整结果。"""
    recall, coverage = select(records, order, budget_fraction=budget_fraction,
                              skip_overflow=skip_overflow)
    area, area_detail = popt(records, order, ordering=ordering)
    return {
        "ordering": ordering,
        "budgetRule": BUDGET_RULE if skip_overflow else SENSITIVITY_RULE,
        "recall20Loc": recall,
        "ifa": ifa(records, order),
        "popt": area,
        "coverage": coverage,
        "poptEffort": area_detail,
    }


def _aggregate(values, reason="没有可定义的随机结果"):
    numbers = [value for value in values if isinstance(value, (int, float))
               and not isinstance(value, bool)]
    if not numbers:
        return {"mean": None, "std": None, "min": None, "max": None,
                "validRuns": 0, "reason": reason}
    mean = sum(numbers) / len(numbers)
    variance = sum((value - mean) ** 2 for value in numbers) / len(numbers)
    return {"mean": mean, "std": math.sqrt(variance), "min": min(numbers),
            "max": max(numbers), "validRuns": len(numbers), "reason": None}


def random_summary(results, runs, seed):
    def values(path):
        collected = []
        for result in results:
            current = result
            for key in path:
                current = current.get(key) if isinstance(current, dict) else None
            collected.append(current if isinstance(current, (int, float))
                             and not isinstance(current, bool) else None)
        return collected
    return {
        "runs": runs, "seed": seed,
        "recall20Loc": _aggregate(values(("recall20Loc", "value"))),
        "ifa": _aggregate(values(("ifa", "value"))),
        "popt": _aggregate(values(("popt", "value"))),
        "coverage": {
            "issuesCovered": _aggregate(values(("coverage", "issuesCovered"))),
            "selectedCount": _aggregate(values(("coverage", "selectedCount"))),
            "usedLoc": _aggregate(values(("coverage", "usedLoc"))),
        },
        "precisionAtBudget": _aggregate(
            values(("coverage", "precisionAtBudget", "value"))),
    }


def evaluate(records, *, random_runs=RANDOM_RUNS, seed=RANDOM_SEED,
             budget_fraction=BUDGET_FRACTION):
    """五种策略的主结果、前缀停止敏感性与随机汇总，全部来自同一预算实现。"""
    prepared = prepare(records)
    orders = {
        "model": model_order(prepared),
        "loc": loc_order(prepared),
        "time": time_order(prepared),
        "random": random_order(prepared, seed, 0),
    }
    density, density_reason = density_order(prepared)
    if density is not None:
        orders["density"] = density
    primary = {}
    for key in ("model", "loc", "time"):
        primary[key] = strategy(prepared, orders[key], ordering=ORDERINGS[key],
                                budget_fraction=budget_fraction)
    primary["density"] = (strategy(prepared, density, ordering=ORDERINGS["density"],
                                   budget_fraction=budget_fraction)
                          if density is not None else
                          _undefined_strategy(ORDERINGS["density"], density_reason))
    sensitivity = {key: strategy(prepared, orders[key], ordering=ORDERINGS[key],
                                 skip_overflow=False, budget_fraction=budget_fraction)
                   for key in ("model", "loc", "time")}
    sensitivity["density"] = (
        strategy(prepared, density, ordering=ORDERINGS["density"], skip_overflow=False,
                 budget_fraction=budget_fraction)
        if density is not None else
        _undefined_strategy(ORDERINGS["density"], density_reason, sensitivity=True))
    random_results = [strategy(prepared, random_order(prepared, seed, run),
                               ordering=f"random(seed={seed},run={run})",
                               budget_fraction=budget_fraction)
                      for run in range(random_runs)]
    random_sensitivity = [strategy(prepared, random_order(prepared, seed, run),
                                   ordering=f"random(seed={seed},run={run})",
                                   skip_overflow=False, budget_fraction=budget_fraction)
                          for run in range(random_runs)]
    random = random_summary(random_results, random_runs, seed)
    strategies = {
        **primary, "random": random,
        "sensitivity": {**sensitivity,
                        "random": random_summary(random_sensitivity, random_runs, seed)},
    }
    comparisons = _comparisons(prepared, orders, primary, random, seed=seed,
                               budget_fraction=budget_fraction)
    return {"protocol": PROTOCOL, "protocolSha256": protocol_sha256(),
            "strategies": strategies, "comparisons": comparisons,
            "records": len(prepared),
            "costs": {"totalLoc": sum(record["cost"] for record in prepared),
                      "positiveLabels": sum(record["label"] for record in prepared)}}


def _undefined_strategy(ordering, reason, *, sensitivity=False):
    ignored = metric(reason=reason)
    return {
        "ordering": ordering,
        "budgetRule": SENSITIVITY_RULE if sensitivity else BUDGET_RULE,
        "recall20Loc": ignored,
        "ifa": ignored,
        "popt": ignored,
        "coverage": {"selected": [], "selectedCount": 0, "usedLoc": 0.0,
                     "issuesCovered": 0, "totalLoc": None, "budgetLoc": None,
                     "positives": None, "reason": reason,
                     "precisionAtBudget": metric(reason=reason)},
        "poptEffort": {"name": "Popt (normalized cost-recall area)",
                       "ordering": ordering, "policy": "trapezoid-full-range",
                       "totalLoc": None, "areaModel": None, "areaOracle": None,
                       "areaWorst": None},
    }


def _delta(a, b):
    return a - b if isinstance(a, (int, float)) and isinstance(b, (int, float)) else None


def _comparisons(records, orders, primary, random, *, seed, budget_fraction):
    result = {}
    for key, name in (("density", "modelVsDensity"), ("loc", "modelVsLoc"),
                      ("time", "modelVsTime")):
        result[name] = {
            "recall20Loc": _delta(primary["model"]["recall20Loc"]["value"],
                                  primary[key]["recall20Loc"]["value"]),
            "ifa": _delta(primary["model"]["ifa"]["value"], primary[key]["ifa"]["value"]),
            "popt": _delta(primary["model"]["popt"]["value"], primary[key]["popt"]["value"]),
            "recall20LocInterval": (bootstrap_delta(records, orders["model"], orders[key],
                                                   seed=seed, budget_fraction=budget_fraction)
                                    if orders.get(key) is not None else
                                    {"low": None, "high": None, "validRuns": 0,
                                     "reason": "该基线未定义"}),
        }
    result["modelVsRandomMean"] = {
        "recall20Loc": _delta(primary["model"]["recall20Loc"]["value"],
                              random["recall20Loc"]["mean"]),
        "ifa": _delta(primary["model"]["ifa"]["value"], random["ifa"]["mean"]),
        "popt": _delta(primary["model"]["popt"]["value"], random["popt"]["mean"]),
        "recall20LocInterval": bootstrap_delta(records, orders["model"], orders["random"],
                                               seed=seed, budget_fraction=budget_fraction),
    }
    return result


def _week_blocks(records):
    blocks = {}
    for index, record in enumerate(records):
        blocks.setdefault(record["epoch"] // BLOCK_SECONDS, []).append(index)
    return blocks


def bootstrap_delta(records, model_rank, baseline_rank, *, seed=BOOTSTRAP_SEED,
                    runs=BOOTSTRAP_RUNS, budget_fraction=BUDGET_FRACTION):
    """按 UTC 自然周有放回重采样，给出模型相对基线的配对 Recall 区间。

    重复抽中的时间块按出现编号展开，同一提交的副本不会因重复 ID 而合并或乱序。
    """
    blocks = _week_blocks(records)
    positives = sum(record["label"] for record in records)
    if len(blocks) < MIN_BLOCKS:
        return {"low": None, "high": None, "validRuns": 0, "requestedRuns": runs,
                "seed": seed, "unit": "recall20Loc-difference",
                "reason": f"非空时间块不足 {MIN_BLOCKS} 个"}
    if positives < MIN_POSITIVES:
        return {"low": None, "high": None, "validRuns": 0, "requestedRuns": runs,
                "seed": seed, "unit": "recall20Loc-difference",
                "reason": f"正例少于 {MIN_POSITIVES} 个"}
    block_ids = sorted(blocks)
    rng = random.Random(seed)
    deltas = []
    model_position = {index: position for position, index in enumerate(model_rank)}
    baseline_position = {index: position for position, index in enumerate(baseline_rank)}
    for _ in range(runs):
        drawn = [rng.choice(block_ids) for _ in block_ids]
        copies = []
        for occurrence, block_id in enumerate(drawn):
            for index in blocks[block_id]:
                copies.append((index, occurrence))
        subset = [{"id": f"{records[index]['id']}#{occurrence}",
                   "epoch": records[index]["epoch"], "label": records[index]["label"],
                   "cost": records[index]["cost"], "risk": records[index]["risk"]}
                  for index, occurrence in copies]
        total = sum(record["cost"] for record in subset)
        if total <= 0 or sum(record["label"] for record in subset) <= 0:
            continue
        slot = {(index, occurrence): position
                for position, (index, occurrence) in enumerate(copies)}
        model_subset = [slot[(index, occurrence)] for index, occurrence in sorted(
            copies, key=lambda pair: (model_position[pair[0]], pair[1]))]
        baseline_subset = [slot[(index, occurrence)] for index, occurrence in sorted(
            copies, key=lambda pair: (baseline_position[pair[0]], pair[1]))]
        model_recall = select(subset, model_subset,
                              budget_fraction=budget_fraction)[0]["value"]
        baseline_recall = select(subset, baseline_subset,
                                 budget_fraction=budget_fraction)[0]["value"]
        if model_recall is not None and baseline_recall is not None:
            deltas.append(model_recall - baseline_recall)
    if not deltas:
        return {"low": None, "high": None, "validRuns": 0, "requestedRuns": runs,
                "seed": seed, "unit": "recall20Loc-difference",
                "reason": "没有可用的重采样结果"}
    deltas.sort()
    low_index = max(0, int(0.025 * len(deltas)))
    high_index = min(len(deltas) - 1, int(0.975 * len(deltas)))
    return {"low": deltas[low_index], "high": deltas[high_index],
            "validRuns": len(deltas), "requestedRuns": runs, "seed": seed,
            "unit": "recall20Loc-difference", "reason": None}


def sentence(report, positives):
    values = {name: result["recall20Loc"]["value"]
              for name, result in report.items() if name != "sensitivity"}
    random_value = report.get("random", {}).get("recall20Loc", {}).get("mean") \
        if "random" in report else None
    if random_value is not None:
        values["随机平均"] = random_value
    if any(value is None for value in values.values()):
        return "测试分区缺少可用正例或工作量，无法比较五种检查顺序。"
    names = {"model": "模型排序", "density": "风险/成本密度", "loc": "改动量升序",
             "time": "时间顺序"}
    parts = [f"{label}覆盖 {values[key] * 100:.1f}%"
             f"（{values[key] * positives:.1f}/{positives} 个历史标记）"
             for key, label in names.items()]
    return "；".join(parts) + "。"
