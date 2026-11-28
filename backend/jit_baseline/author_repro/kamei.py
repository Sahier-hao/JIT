"""Kamei TSE 2013 tabular reproduction and 14-feature local control."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold
from sklearn.preprocessing import StandardScaler

from ..errors import BaselineError
from .catalog import verify_material
from .common import digest_json, finite_probability, write_json, write_jsonl
from .data import kamei_sources, read_kamei
from .metrics import commit_metrics
from .runner import append_log, new_run

AUTHOR_FEATURES = ("ns", "nf", "entropy", "la", "ld", "lt", "fix", "ndev",
                   "age", "nuc", "exp", "sexp")
FEATURES_14 = ("ns", "nd", "nf", "entropy", "la", "ld", "lt", "fix", "ndev",
               "age", "nuc", "exp", "rexp", "sexp")
SOURCE_COLUMNS = {"nd": "nm", "age": "pd", "nuc": "npt"}
MODE_FEATURES = {"author": AUTHOR_FEATURES, "unified14": FEATURES_14}
MODE_VERSIONS = {"author": "kamei-2013-author-v1", "unified14": "kamei-14-local-control-v1"}


def _epoch(value) -> int:
    text = str(value).strip()
    for fmt in ("%Y/%m/%d %H:%M", "%Y-%m-%d %H:%M", "%Y/%m/%d"):
        try:
            return int(datetime.strptime(text, fmt).replace(tzinfo=timezone.utc).timestamp())
        except ValueError:
            continue
    raise BaselineError("AUTHOR_DATA_INVALID", f"Kamei commitdate 无法解析：{value!r}")


def _matrix(frame, features):
    source = np.column_stack([
        frame[SOURCE_COLUMNS.get(name, name)].to_numpy(dtype=float)
        for name in features
    ])
    transformed = source.copy()
    for index, name in enumerate(features):
        if name != "fix":
            transformed[:, index] = np.log1p(np.maximum(0.0, source[:, index]))
    return transformed


def _raw_loc(row) -> float:
    """Published LA/LD are normalized ratios; LT restores approximate changed LOC."""
    return max(0.0, (float(row["la"]) + float(row["ld"])) * float(row["lt"] or 0.0))


def _under_sample(indices, labels, seed):
    positive = indices[labels[indices] == 1]
    negative = indices[labels[indices] == 0]
    if not len(positive) or not len(negative):
        raise BaselineError("AUTHOR_DATA_INVALID", "训练折只有单一类别，无法拟合")
    size = min(len(positive), len(negative))
    generator = np.random.RandomState(seed)
    chosen = np.concatenate([
        generator.choice(positive, size, replace=False),
        generator.choice(negative, size, replace=False),
    ])
    generator.shuffle(chosen)
    return chosen


def _fit_project(frame, features, seed):
    x = _matrix(frame, features)
    labels = frame["bug"].to_numpy(dtype=int)
    if len(frame) < 10 or len(set(labels)) < 2:
        raise BaselineError("AUTHOR_DATA_INVALID", "Kamei 项目样本不足或只有单一类别")
    splitter = StratifiedKFold(n_splits=10, shuffle=True, random_state=seed)
    scores = np.full(len(frame), np.nan, dtype=float)
    fold_ids = np.full(len(frame), -1, dtype=int)
    fold_rows = []
    coefficients = []
    fitted = []
    for fold, (train_index, test_index) in enumerate(splitter.split(x, labels)):
        scaler = StandardScaler()
        x_train_full = scaler.fit_transform(x[train_index])
        x_test = scaler.transform(x[test_index])
        sampled = _under_sample(train_index, labels, seed + fold)
        sampled_positions = np.searchsorted(train_index, sampled)
        if np.any(train_index[sampled_positions] != sampled):
            position = {value: index for index, value in enumerate(train_index)}
            sampled_positions = np.array([position[value] for value in sampled])
        # sklearn 1.9 deprecates penalty=None; C=inf is the documented
        # unpenalized equivalent and does not change the model family.
        model = LogisticRegression(C=np.inf, solver="lbfgs", max_iter=5000)
        model.fit(x_train_full[sampled_positions], labels[sampled])
        probability = model.predict_proba(x_test)[:, 1]
        scores[test_index] = probability
        fold_ids[test_index] = fold
        fold_rows.append({
            "fold": fold,
            "train": len(train_index),
            "underSampledTrain": len(sampled),
            "test": len(test_index),
            "testPositives": int(labels[test_index].sum()),
            "scoreSha256": digest_json([round(float(v), 12) for v in probability]),
        })
        coefficients.append({
            "fold": fold,
            "intercept": float(model.intercept_[0]),
            "coefficients": {name: float(value)
                             for name, value in zip(features, model.coef_[0], strict=True)},
        })
        fitted.append({"fold": fold, "scaler": scaler, "model": model,
                       "features": list(features)})
    if np.isnan(scores).any():
        raise BaselineError("AUTHOR_RUN_INVALID", "Kamei 十折预测未覆盖全部记录")
    return scores, fold_ids, fold_rows, coefficients, fitted


def run_kamei(*, mode="author", output=None, seed=42, argv=None) -> dict:
    if mode not in MODE_FEATURES:
        raise BaselineError("AUTHOR_MODE_UNKNOWN", f"Kamei 未知模式：{mode}")
    features = MODE_FEATURES[mode]
    sources = kamei_sources()
    material = verify_material("kamei-published-six")
    if not material["available"]:
        raise BaselineError("AUTHOR_MATERIAL_MISSING", "Kamei 发布数据缺失或哈希不符")
    material_hashes = {
        Path(item["path"]).name: item.get("sha256")
        for item in material["members"]
    }
    records, predictions, fold_report, coefficients, fitted_models = [], [], {}, {}, {}
    for source in sources:
        frame = read_kamei(source["path"])
        frame = frame.copy()
        frame["_epoch"] = frame["commitdate"].map(_epoch)
        scores, fold_ids, folds, coefs, fitted = _fit_project(frame, features, seed)
        project = source["project"]
        fold_report[project] = folds
        coefficients[project] = coefs
        fitted_models[project] = fitted
        for index, row in frame.iterrows():
            record = {
                "id": f"{project}:{row['transactionid']}",
                "commitId": str(row["transactionid"]),
                "project": project,
                "epoch": int(row["_epoch"]),
                "label": int(row["bug"]),
                "la": _raw_loc(row),
                "ld": 0.0,
            }
            records.append(record)
            predictions.append({
                **record,
                "score": finite_probability(scores[index]),
                "fold": int(fold_ids[index]),
            })
    config = {
        "features": list(features),
        "model": "LogisticRegression",
        "penalty": "none (C=inf)",
        "solver": "lbfgs",
        "threshold": 0.5,
        "validation": "per-project StratifiedKFold",
        "folds": 10,
        "underSampling": "majority down to minority inside each training fold",
        "transforms": "log1p non-fix features then train-fold StandardScaler",
        "effortCost": "(la + ld) * lt from published normalized ratios",
        "paperProtocol": mode == "author",
        "localControl": mode == "unified14",
        "limitations": [
            "Kamei lab replicates the paper's feature deletion and model family on published tables; it is not a rerun of the authors' original R script.",
            "Published LA/LD are ratios; effort cost reconstruction through LT is approximate.",
            "The 14-feature run is a local unified control, not an original-paper result.",
        ],
    }
    run = new_run(
        "kamei", version=MODE_VERSIONS[mode],
        fidelity="author-protocol" if mode == "author" else "local-control",
        material_hashes=material_hashes, config=config,
        split={"kind": "project-stratified-10-fold", "seed": seed},
        seed=seed, output=output, argv=argv,
    )
    try:
        by_project = {}
        for project in sorted({record["project"] for record in records}):
            members = [record for record in records if record["project"] == project]
            member_scores = [row["score"] for row in predictions
                             if row["project"] == project]
            by_project[project] = commit_metrics(members, member_scores)
        metrics = commit_metrics(records, [row["score"] for row in predictions])
        result = {
            "schema": "author-kamei-metrics-v1",
            "mode": mode,
            "features": list(features),
            "projects": by_project,
            "pooled": metrics,
            "paperComparison": {
                "status": "not-machine-readable",
                "reason": "The paper reports a project table; this run records actual local values and does not invent omitted paper cells.",
            },
        }
        write_jsonl(run.directory / "predictions.jsonl", predictions)
        write_json(run.directory / "folds.json", fold_report)
        write_json(run.directory / "coefficients.json", coefficients)
        joblib.dump(fitted_models, run.directory / "models.joblib")
        run.write_metrics(result)
        append_log(run, f"Kamei {mode} completed: {len(records)} records, {len(predictions)} predictions")
        return run.complete({
            "mode": mode,
            "records": len(records),
            "metrics": metrics,
            "featureCount": len(features),
        })
    except Exception as exc:
        run.fail(getattr(exc, "code", "AUTHOR_RUN_FAILED"), str(exc))
        raise
