"""review-benefit-v3 dataset-level time-out evaluation.

Runs the frozen methods on a registered dataset's temporal test partition and
reports the same whole-commit budget comparison used by the matrix and model
benefit report. It does not select a default model or tune on the test split.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

from . import evaluation_matrix

from .. import admission, budget, metrics

from ..algorithms import ALGORITHMS
from ..data import BaselineError, sha256
from ..model import fit_model, predict_risks
from ..splits import split_records

FORMAT = "review-benefit-report-v1"
KIND = "review-benefit-evaluation"
METHODS = evaluation_matrix.FROZEN_METHODS
SEEDS = evaluation_matrix.FROZEN_SEEDS
SPLIT_PRESET = evaluation_matrix.SPLIT_PRESET
RANDOM_RUNS = budget.RANDOM_RUNS
CASE_COUNT = 5
LIMITATIONS = (
    *budget.LIMITATIONS,
    "历史正例来自完整 SZZ 观测；未观测到缺陷引入不等于已证实无缺陷。",
    "这是冻结测试分区上的离线评价，不代表真实审查耗时、采纳率或在线效果。",
    "同一仓库的多个方法共用同一测试成员；不据测试结果选择默认模型或自动替换。",
)


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _digest(value):
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(payload.encode("utf-8"))


def _params(method, seed):
    return evaluation_matrix._params_for(method, seed)


def _cases(dataset, test_records, risks, status_by_id):
    """固定规则抽取排序分歧案例：模型排序与时间/随机排序位置差最大的提交。"""
    prepared = budget.prepare([{**dict(record), "risk": float(risk)}
                               for record, risk in zip(test_records, risks, strict=True)])
    model_rank = {prepared[index]["id"]: position
                  for position, index in enumerate(budget.model_order(prepared))}
    time_rank = {prepared[index]["id"]: position
                 for position, index in enumerate(budget.time_order(prepared))}
    random_rank = {prepared[index]["id"]: position
                   for position, index in
                   enumerate(budget.random_order(prepared, budget.RANDOM_SEED, 0))}
    model_ids = set(model_selected_selection(budget, prepared, budget.model_order(prepared)))
    time_ids = set(model_selected_selection(budget, prepared, budget.time_order(prepared)))
    divergence = []
    for record in prepared:
        identity = record["id"]
        score = abs(model_rank[identity] - min(time_rank[identity], random_rank[identity]))
        divergence.append((-score, identity))
    chosen = [identity for _, identity in sorted(divergence)[:CASE_COUNT]]
    by_id = {record["id"]: record for record in prepared}
    raw_by_id = {record["id"]: record for record in test_records}
    cases = []
    for identity in chosen:
        record = by_id[identity]
        status = status_by_id.get(identity) or {}
        raw = raw_by_id[identity]
        cases.append({
            "dataset": dataset["name"], "version": dataset["version"],
            "commitId": identity, "epoch": record["epoch"],
            "cost": record["cost"], "label": record["label"],
            "modelRisk": record["risk"],
            "modelRank": model_rank[identity], "timeRank": time_rank[identity],
            "randomRank": random_rank[identity],
            "selectedByModelBudget": identity in model_ids,
            "selectedByTimeBudget": identity in time_ids,
            "evidenceStatus": status.get("evidenceStatus"),
            "labelEvidence": [item for item in
                              (dataset["manifest"].get("collection") or {}).get("labelEvidence") or []
                              if item.get("introducedCommit") == identity][:5],
            "subject": raw.get("subject"),
            "automaticCheck": {
                "statusMatchesCsv": status.get("label") == record["label"],
                "costPositive": record["cost"] > 0,
                "rankOrderValid": (model_rank[identity] >= 0
                                   and time_rank[identity] >= 0
                                   and random_rank[identity] >= 0),
            },
            "humanReview": {"status": "pending", "humanVerdict": "",
                            "note": "自动核验提交、成本、标签状态与排序位置；人工判断未执行。"},
        })
    return cases


def model_selected_selection(module, records, order):
    """Return the selected ids for one order under the main budget rule."""
    _, coverage = module.select(records, order)
    return coverage["selected"]


def _conclusion(cell):
    strategies = cell["reviewBenefit"]["strategies"]
    comparisons = cell["reviewBenefit"]["comparisons"]
    model = strategies["model"]["recall20Loc"]
    beats, loses = [], []
    for key, label in (("density", "风险/成本密度"), ("loc", "改动量升序"),
                       ("time", "时间顺序"), ("random", "随机平均")):
        baseline = (strategies["random"]["recall20Loc"]["mean"] if key == "random"
                    else strategies[key]["recall20Loc"]["value"])
        if model["value"] is None or baseline is None:
            continue
        (beats if model["value"] > baseline else loses).append(label)
    return {
        "sentence": ("模型召回高于" + "、".join(beats) if beats else "模型召回不高于任何基线")
                    + ("；低于" + "、".join(loses) if loses else ""),
        "higherThan": beats, "lowerThan": loses,
        "intervals": {name: value.get("recall20LocInterval")
                      for name, value in comparisons.items()},
    }


def evaluate_datasets(specs, output, *, methods=METHODS, seeds=SEEDS,
                      random_runs=RANDOM_RUNS):
    """`specs` 是 (language, manifest_path) 列表；逐仓库执行时间外评价。"""
    if not isinstance(specs, list) or not specs:
        raise BaselineError("INPUT_INVALID", "收益评价需要至少一个数据集")
    for method in methods:
        evaluation_matrix.get_algorithm(method)
    loaded, data_entries = [], []
    for language, path in specs:
        dataset = evaluation_matrix.load_dataset(path)
        dataset["language"] = language
        dataset["manifestPath"] = str(Path(path).resolve())
        loaded.append(dataset)
        data_entries.append(evaluation_matrix._dataset_entry(dataset))

    report = {
        "format": FORMAT, "kind": KIND, "generatedUtc": _now(),
        "protocol": budget.protocol(), "protocolSha256": budget.protocol_sha256(),
        "splitPreset": SPLIT_PRESET, "methods": list(methods), "seeds": list(seeds),
        "randomRuns": random_runs,
        "data": data_entries, "cells": [], "failures": [], "cases": [],
        "conclusion": {}, "limitations": list(LIMITATIONS),
        "boundary": {"retrospective": True, "defectProbability": False,
                     "crossModelRanking": False, "defaultModelChanged": False,
                     "trainedOnTest": False},
    }
    if len({dataset["schema"].name for dataset in loaded}) > 1:
        raise BaselineError("PROJECT_COHORT_INVALID", "收益评价要求同一特征 schema")
    for dataset in loaded:
        try:
            split, boundaries, policy = split_records(dataset["records"], SPLIT_PRESET)
        except BaselineError as exc:
            report["failures"].append({"dataset": dataset["name"], "stage": "split",
                                       "code": exc.code, "message": str(exc)})
            continue
        status_by_id = admission.read_entries(dataset["manifest"])
        for method in methods:
            seed_values = seeds if method in evaluation_matrix.RANDOMIZED else (None,)
            for seed in seed_values:
                params = _params(method, seed)
                started = time.perf_counter()
                try:
                    model = fit_model(split["train"], schema=dataset["schema"],
                                      algorithm=method, params=params)
                    risks = predict_risks(model, split["test"], dataset["schema"])
                except Exception as exc:  # 单元格失败不终止其他方法
                    report["failures"].append({
                        "dataset": dataset["name"], "method": method, "seed": seed,
                        "stage": "fit", "code": getattr(exc, "code", "UNEXPECTED"),
                        "message": str(exc) if isinstance(exc, BaselineError)
                        else f"{type(exc).__name__}: {exc}"})
                    continue
                seconds = time.perf_counter() - started
                try:
                    evaluated = budget.evaluate(
                        [{**dict(record), "risk": float(risk)}
                         for record, risk in zip(split["test"], risks, strict=True)],
                        random_runs=random_runs)
                    legacy = metrics.evaluate([dict(record) for record in split["test"]],
                                              risks, "metric-set-v2")
                except BaselineError as exc:
                    report["failures"].append({
                        "dataset": dataset["name"], "method": method, "seed": seed,
                        "stage": "evaluate", "code": exc.code, "message": str(exc)})
                    continue
                cell = {
                    "dataset": dataset["name"], "version": dataset["version"],
                    "language": dataset["language"], "method": method,
                    "params": params, "seed": seed, "status": "succeeded",
                    "members": {"records": len(split["test"]),
                                "positives": sum(record["label"] for record in split["test"])},
                    "seconds": round(seconds, 3),
                    "reviewBenefit": evaluated,
                    "existingMetrics": {
                        "rocAuc": legacy["rocAuc"],
                        "averagePrecision": legacy["averagePrecision"],
                        "recall20Loc": legacy["recall20Loc"],
                    },
                }
                report["cells"].append(cell)
                report["conclusion"].setdefault(dataset["name"], {})[
                    f"{method}:{seed}"] = _conclusion(cell)
                if method == "logistic-regression-l2-v1" and seed is None:
                    report["cases"].extend(
                        _cases(dataset, split["test"], risks, status_by_id))

    report["status"] = ("complete" if report["cells"] and not report["failures"] else
                        "partial" if report["cells"] else "failed")
    languages = {}
    for entry in data_entries:
        languages[entry["language"]] = languages.get(entry["language"], 0) + 1
    insufficient = {name: count for name, count in languages.items() if count < 3}
    report["crossRepo"] = {
        "status": "not-run-insufficient-cohort" if insufficient else "eligible-not-run",
        "languages": languages,
        "reason": ("同语言合格仓库不足三个，未执行留一仓库评价：" +
                   "、".join(f"{name}={count}" for name, count in sorted(insufficient.items()))
                   if insufficient else "同语言仓库已达三个；本轮未执行留一仓库评价"),
        "mixedLanguages": False,
    }
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                      encoding="utf-8")
    return report


def summarize(report):
    cells = [cell for cell in report["cells"] if cell["status"] == "succeeded"]
    return {
        "status": report["status"], "cells": len(report["cells"]),
        "succeeded": len(cells), "failures": len(report["failures"]),
        "datasets": [entry["version"] for entry in report["data"]],
        "protocolSha256": report["protocolSha256"],
        "methods": sorted({cell["method"] for cell in cells}),
    }
