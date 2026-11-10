"""固定协议下的多模型、仓库内时间外与留一仓库评价矩阵。

协议在运行前冻结：数据版本与文件哈希、切分预设、方法参数、种子、LOC 预算与阈值。
矩阵只读取已登记数据集，不改写数据、模型或默认模型；失败单元格保留原因。
"""
from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .algorithms import ALGORITHMS, get_algorithm
from .config import BACKEND
from .data import BaselineError, parse_source, sha256
from .datasets import load_manifest
from .metrics import evaluate, get_metric_set
from .model import fit_model, predict_risks
from .schemas import resolve
from .splits import resolve_preset, split_records

FORMAT = "evaluation-matrix-v1"
FROZEN_METHODS = ("logistic-regression-l2-v1", "decision-tree-v1",
                  "random-forest-v1", "mlp-v1")
FROZEN_SEEDS = (42, 43, 44)
SPLIT_PRESET = "temporal-70-15-15"
LOC_BUDGET = 0.20
THRESHOLD = 0.5
RANDOMIZED = {"random-forest-v1", "mlp-v1"}


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _digest(value):
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(payload.encode("utf-8"))


def load_dataset(path):
    """读取并核对一个已登记数据集：哈希、纳入规则与质量统计都必须一致。"""
    manifest_path = Path(path)
    manifest = load_manifest(manifest_path)
    schema = resolve(manifest["schemaName"])
    csv_path = Path(manifest["file"]["path"])
    csv_path = csv_path if csv_path.is_absolute() else BACKEND / csv_path
    try:
        blob = csv_path.read_bytes()
    except OSError as exc:
        raise BaselineError("DATASET_UNAVAILABLE", f"原始 CSV 不可用：{csv_path.name}") from exc
    if sha256(blob) != manifest["file"]["sha256"]:
        raise BaselineError("DATASET_INVALID", "原始 CSV 校验值与描述文件不一致")
    records, quality = parse_source(blob, schema, manifest["cohort"])
    if quality != manifest["quality"]:
        raise BaselineError("DATASET_INVALID", "按描述文件规则重算的质量统计与描述不一致")
    return {
        "manifest": manifest,
        "manifestSha256": sha256(manifest_path.read_bytes()),
        "csvSha256": manifest["file"]["sha256"],
        "schema": schema,
        "records": records,
        "quality": quality,
        "name": manifest["dataset"],
        "version": manifest["version"],
        "language": None,
    }


def mcc(metrics):
    """由混淆矩阵计算 MCC；任一格为空或分母为零时返回未定义与原因。"""
    confusion = metrics.get("confusion") if isinstance(metrics, dict) else None
    if not isinstance(confusion, dict):
        return {"value": None, "reason": "没有混淆矩阵"}
    tp, fp = confusion.get("tp", 0), confusion.get("fp", 0)
    tn, fn = confusion.get("tn", 0), confusion.get("fn", 0)
    denominator = math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
    if denominator == 0:
        return {"value": None, "reason": "混淆矩阵有一侧为空，MCC 未定义"}
    return {"value": (tp * tn - fp * fn) / denominator, "reason": None}


def _params_for(method, seed=None):
    """冻结参数；随机方法按种子覆盖其真实参数键。"""
    params = dict(ALGORITHMS[method]["params"])
    if seed is None:
        return params
    if method == "random-forest-v1":
        params["random_state"] = seed
    elif method == "mlp-v1":
        params["seed"] = seed
    return params


def _cell(records, risks, method, params, *, seed=None, seconds=None):
    metrics = evaluate([dict(record) for record in records], risks, "metric-set-v2")
    return {
        "method": method,
        "params": params,
        "seed": seed,
        "status": "succeeded",
        "members": {"records": len(records),
                    "positives": sum(record["label"] for record in records)},
        "metrics": {
            "rocAuc": metrics["rocAuc"], "averagePrecision": metrics["averagePrecision"],
            "precision": metrics["precision"], "recall": metrics["recall"],
            "f1": metrics["f1"], "mcc": mcc(metrics),
            "recall20Loc": metrics["recall20Loc"],
            "popt": metrics.get("popt"), "ifa": metrics.get("ifa"),
            "baseRate": metrics["reference"]["apNoInformation"],
            "effort": metrics.get("effort"), "poptEffort": metrics.get("poptEffort"),
            "confusion": metrics["confusion"],
        },
        "seconds": None if seconds is None else round(seconds, 3),
    }


def _failed(stage, exc, **extra):
    return {"status": "failed", "stage": stage,
            "code": getattr(exc, "code", "UNEXPECTED"),
            "message": str(exc), **extra}


def _fit_and_predict(train_records, eval_records, schema, method, params, extra=None):
    """训练一次，预测测试分区；提供 `extra` 时同时预测一个附加分区。"""
    started = time.perf_counter()
    model = fit_model(train_records, schema=schema, algorithm=method, params=params)
    risks = predict_risks(model, eval_records, schema)
    extra_risks = predict_risks(model, extra, schema) if extra else None
    return risks, extra_risks, time.perf_counter() - started


def _brier(probabilities, labels):
    return sum((p - y) ** 2 for p, y in zip(probabilities, labels, strict=True)) / len(labels)


def calibration_report(records, probabilities):
    """验证集概率校准对照：Brier 与固定五桶的观测比例。"""
    labels = [record["label"] for record in records]
    positives = sum(labels)
    if len(records) < 30 or positives == 0 or positives == len(records):
        return {"status": "undefined", "brier": None, "buckets": [],
                "reason": f"验证集 {len(records)} 条、正例 {positives} 条，不足以评估校准",
                "records": len(records), "positives": positives}
    buckets = []
    for index in range(5):
        low, high = index / 5, (index + 1) / 5
        selected = [(p, y) for p, y in zip(probabilities, labels, strict=True)
                    if low <= p < high or (index == 4 and p == 1.0)]
        buckets.append({
            "range": [low, high], "records": len(selected),
            "meanPredicted": (sum(p for p, _ in selected) / len(selected)) if selected else None,
            "observedRate": (sum(y for _, y in selected) / len(selected)) if selected else None,
        })
    return {"status": "computed", "brier": _brier(probabilities, labels),
            "buckets": buckets, "records": len(records), "positives": positives,
            "reason": None}


def _baseline_risks(test_records, kind, seed=None):
    """基线只产生检查顺序：用同序合成分数交给同一套整提交预算评价。"""
    count = len(test_records)
    if kind == "churn":
        keys = [-(record["metrics"]["la"] + record["metrics"]["ld"]) for record in test_records]
    elif kind == "time":
        keys = [-record["epoch"] for record in test_records]
    elif kind == "random":
        generator = np.random.default_rng(seed)
        keys = generator.permutation(count).tolist()
    else:
        raise BaselineError("INPUT_INVALID", f"未知基线：{kind}")
    order = sorted(range(count), key=lambda i: (keys[i], test_records[i]["id"]))
    scores = [0.0] * count
    for rank, index in enumerate(order):
        scores[index] = 1.0 - rank / max(count - 1, 1)
    return scores


def _baseline_cell(test_records, kind, seed=None):
    risks = _baseline_risks(test_records, kind, seed=seed)
    metrics = evaluate([dict(record) for record in test_records], risks, "metric-set-v2")
    return {
        "baseline": kind, "seed": seed, "status": "succeeded",
        "members": {"records": len(test_records),
                    "positives": sum(record["label"] for record in test_records)},
        "metrics": {
            "rocAuc": metrics["rocAuc"], "averagePrecision": metrics["averagePrecision"],
            "mcc": mcc(metrics), "recall20Loc": metrics["recall20Loc"],
            "popt": metrics.get("popt"), "ifa": metrics.get("ifa"),
            "effort": metrics.get("effort"),
        },
        "note": "排序基线；分类阈值指标不适用，未报告 Precision/Recall/F1。",
    }


def _dataset_entry(dataset):
    return {
        "name": dataset["name"], "version": dataset["version"],
        "language": dataset["language"], "schema": dataset["schema"].name,
        "manifestSha256": dataset["manifestSha256"], "csvSha256": dataset["csvSha256"],
        "includedRows": dataset["quality"]["includedRows"],
        "positiveLabels": dataset["quality"]["positiveLabels"],
        "url": dataset["manifest"].get("url"),
        "revision": dataset["manifest"].get("revision"),
    }


def _split(dataset):
    split, boundaries, policy = split_records(dataset["records"], SPLIT_PRESET)
    return split, boundaries, policy


def run_matrix(specs, output, *, methods=FROZEN_METHODS, seeds=FROZEN_SEEDS):
    """`specs` 是 (language, manifest_path) 列表；返回写入的报告。"""
    if not isinstance(specs, list) or not specs:
        raise BaselineError("INPUT_INVALID", "评价矩阵需要至少一个数据集")
    languages = {}
    for language, path in specs:
        languages.setdefault(language, []).append(path)
    for language, paths in languages.items():
        if len(paths) < 2:
            raise BaselineError("INPUT_INVALID", f"{language} 至少需要两个数据集才能做留一仓库评价")
    for method in methods:
        get_algorithm(method)
    get_metric_set("metric-set-v2")
    preset = resolve_preset(SPLIT_PRESET)


    loaded, datasets, split_failures = {}, [], []
    for language in sorted(languages):
        for path in languages[language]:
            try:
                dataset = load_dataset(path)
            except BaselineError as exc:
                split_failures.append(_failed("dataset", exc, language=language, path=str(path)))
                continue
            dataset["language"] = language
            dataset["manifestPath"] = str(Path(path).resolve())
            try:
                split, boundaries, policy = _split(dataset)
            except BaselineError as exc:
                dataset.update(split=None, splitError=_failed("split", exc))
                datasets.append(_dataset_entry(dataset))
                split_failures.append({**dataset["splitError"], "name": dataset["name"],
                                       "language": language})
                loaded[(language, path)] = dataset
                continue
            dataset.update(split=split, boundaries=boundaries, policy=policy)
            loaded[(language, path)] = dataset
            datasets.append(_dataset_entry(dataset))

    schemas = {dataset["schema"].name for dataset in loaded.values()}
    if len(schemas) > 1:
        raise BaselineError("PROJECT_COHORT_INVALID",
                            f"评价矩阵要求同一特征 schema，实际：{sorted(schemas)}")
    protocol = {
        "format": FORMAT, "splitPreset": preset, "splitPolicy": "utc-distinct-times",
        "methods": list(methods), "seeds": list(seeds), "locBudget": LOC_BUDGET,
        "threshold": THRESHOLD, "metricSet": "metric-set-v2",
        "datasets": [{"name": entry["name"], "version": entry["version"],
                      "manifestSha256": entry["manifestSha256"], "csvSha256": entry["csvSha256"],
                      "language": entry["language"]} for entry in datasets],
        "parameters": {method: dict(ALGORITHMS[method]["params"]) for method in methods},
    }
    report = {
        "format": FORMAT, "generatedUtc": _now(),
        "protocol": protocol, "protocolSha256": _digest(protocol),
        "datasets": datasets, "splitFailures": split_failures,
        "withinRepo": [], "leaveOneRepoOut": [],
        "baselines": [], "calibration": [], "failures": [],
    }

    # ---- 仓库内时间外评价 ----
    for (language, path), dataset in sorted(loaded.items()):
        if not dataset.get("split"):
            continue
        split = dataset["split"]
        for method in methods:
            seed_values = seeds if method in RANDOMIZED else (None,)
            for seed in seed_values:
                params = _params_for(method, seed)
                try:
                    risks, validation, seconds = _fit_and_predict(
                        split["train"], split["test"], dataset["schema"], method, params,
                        extra=split["validation"])
                except BaselineError as exc:
                    report["failures"].append(_failed(
                        "within-repo", exc, dataset=dataset["name"], method=method, seed=seed))
                    report["withinRepo"].append({
                        "dataset": dataset["name"], "version": dataset["version"],
                        "language": language, "method": method, "seed": seed,
                        "status": "failed", "code": getattr(exc, "code", "UNEXPECTED"),
                        "message": str(exc)})
                    continue
                cell = _cell(split["test"], risks, method, params, seed=seed, seconds=seconds)
                cell.update(dataset=dataset["name"], version=dataset["version"], language=language)
                report["withinRepo"].append(cell)
                report["calibration"].append({
                    "dataset": dataset["name"], "method": method, "seed": seed,
                    **calibration_report(split["validation"], validation)})
        for kind, seed in [("churn", None), ("time", None)] + [("random", s) for s in seeds]:
            report["baselines"].append({
                "dataset": dataset["name"], "version": dataset["version"], "language": language,
                "partition": "test", **_baseline_cell(split["test"], kind, seed=seed)})

    # ---- 留一仓库评价 ----
    for language in sorted(languages):
        names = sorted(path for path in languages[language])
        entries = [loaded[(language, path)] for path in names if loaded.get((language, path))]
        for held in entries:
            if not held.get("split"):
                continue
            others = [entry for entry in entries if entry is not held and entry.get("split")]
            if len(others) < 2:
                report["failures"].append({
                    "status": "failed", "stage": "leave-one-repo-out", "language": language,
                    "dataset": held["name"], "code": "COHORT_TOO_SMALL",
                    "message": f"同语言可用仓库不足三个（{len(others) + (1 if held else 0)}），不生成留一评价"})
                continue
            train_records = [record for entry in others for record in entry["split"]["train"]]
            for method in methods:
                seed_values = seeds if method in RANDOMIZED else (None,)
                for seed in seed_values:
                    params = _params_for(method, seed)
                    try:
                        risks, _, seconds = _fit_and_predict(
                            train_records, held["split"]["test"], held["schema"], method, params)
                    except BaselineError as exc:
                        report["failures"].append(_failed(
                            "leave-one-repo-out", exc, dataset=held["name"], method=method,
                            seed=seed, language=language))
                        report["leaveOneRepoOut"].append({
                            "language": language, "heldOut": held["name"], "method": method,
                            "seed": seed, "status": "failed",
                            "code": getattr(exc, "code", "UNEXPECTED"), "message": str(exc)})
                        continue
                    cell = _cell(held["split"]["test"], risks, method, params,
                                 seed=seed, seconds=seconds)
                    cell.update(language=language, heldOut=held["name"],
                                trainDatasets=[entry["name"] for entry in others],
                                testVersion=held["version"])
                    cell["status"] = "succeeded"
                    report["leaveOneRepoOut"].append(cell)

    report["status"] = "complete" if not report["failures"] else "partial"
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                      encoding="utf-8")
    return report


def summarize(report):
    """给人读的摘要：按仓库与语言给出成功率、指标与失败单元格数量。"""
    within = [cell for cell in report["withinRepo"] if cell.get("status") == "succeeded"]
    loo = [cell for cell in report["leaveOneRepoOut"] if cell.get("status") == "succeeded"]
    def average(cells, name):
        values = [cell["metrics"][name]["value"] for cell in cells
                  if isinstance(cell["metrics"].get(name), dict)
                  and cell["metrics"][name].get("value") is not None]
        return sum(values) / len(values) if values else None
    return {
        "withinRepo": {"cells": len(report["withinRepo"]), "succeeded": len(within),
                       "rocAuc": average(within, "rocAuc"),
                       "averagePrecision": average(within, "averagePrecision"),
                       "mcc": average(within, "mcc"),
                       "recall20Loc": average(within, "recall20Loc")},
        "leaveOneRepoOut": {"cells": len(report["leaveOneRepoOut"]), "succeeded": len(loo),
                            "rocAuc": average(loo, "rocAuc"),
                            "averagePrecision": average(loo, "averagePrecision"),
                            "mcc": average(loo, "mcc"),
                            "recall20Loc": average(loo, "recall20Loc")},
        "baselines": len(report["baselines"]), "failures": len(report["failures"]),
        "protocolSha256": report["protocolSha256"],
    }
