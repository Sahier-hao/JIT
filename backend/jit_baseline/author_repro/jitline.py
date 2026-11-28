"""JITLine commit classifier and LIME token-to-line localization."""
from __future__ import annotations

import math
import random
import re
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from imblearn.over_sampling import SMOTE
from scipy.sparse import csr_matrix, hstack
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import CountVectorizer

from ..errors import BaselineError
from .catalog import verify_material
from .common import finite_probability, seed_everything, write_json, write_jsonl
from .data import (jitsmart_line_labels, load_jit_defect4j_split,
                   load_jitline_baseline_split)
from .metrics import commit_metrics, line_metrics
from .runner import append_log, new_run

COMMON_TOKENS = {
    "abs", "delattr", "hash", "memoryview", "set", "all", "dict", "help", "min",
    "setattr", "any", "dir", "hex", "next", "slice", "ascii", "divmod", "id", "object",
    "sorted", "bin", "enumerate", "input", "oct", "staticmethod", "bool", "eval", "int",
    "open", "str", "breakpoint", "exec", "isinstance", "ord", "sum", "bytearray", "filter",
    "issubclass", "pow", "super", "bytes", "float", "iter", "print", "tuple", "callable",
    "format", "len", "property", "type", "chr", "frozenset", "list", "range", "vars",
    "classmethod", "getattr", "locals", "repr", "zip", "compile", "globals", "map",
    "reversed", "__import__", "complex", "hasattr", "max", "round", "False", "await",
    "else", "import", "passNone", "break", "except", "in", "raise", "True", "class",
    "finally", "is", "return", "and", "continue", "for", "lambda", "try", "as", "def",
    "from", "nonlocal", "while", "assert", "del", "global", "not", "with", "async",
    "elif", "if", "or", "yield", "self",
}
METRIC_FEATURES = ["ns", "nd", "nf", "entropy", "la", "ld", "lt", "fix", "ndev",
                   "age", "nuc", "exp", "rexp", "sexp"]
VARIANTS = {
    "jitfine-baseline": "JIT-Fine authors' fixed JIT-Defect4J JITLine baseline",
    "released-openstack": "JITLine released OpenStack tables with reconstructed split",
    "released-qt": "JITLine released Qt tables with reconstructed split",
}


def preprocess_code_line(code, *, remove_common=True):
    value = str(code)
    for char in "(){}[].,:;,":
        value = value.replace(char, " ")
    value = value.replace(" _ ", "_")
    value = re.sub(r"``.*``", "<STR>", value)
    value = re.sub(r"'.*'", "<STR>", value)
    value = re.sub(r'".*"', "<STR>", value)
    value = re.sub(r"\d+", "<NUM>", value)
    tokens = value.split()
    if remove_common:
        tokens = [token for token in tokens if token not in COMMON_TOKENS]
    return " ".join(tokens).strip()


def _code_texts(changes):
    ids, labels, _messages, codes = changes
    result = []
    for commit_code in codes:
        added, removed = set(), set()
        for item in (commit_code if isinstance(commit_code, (list, tuple)) else [commit_code]):
            if not isinstance(item, dict):
                continue
            added.update(preprocess_code_line(line) for line in item.get("added_code", ())
                         if not str(line).startswith("#"))
            removed.update(preprocess_code_line(line) for line in item.get("removed_code", ())
                           if not str(line).startswith("#"))
        result.append(" \n ".join(sorted(value for value in added if value)) + " " +
                      " \n ".join(sorted(value for value in removed if value)))
    return [str(value) for value in ids], [int(value) for value in labels], result


def _frame_map(frame):
    copied = frame.copy()
    copied["commit_hash"] = copied["commit_hash"].astype(str)
    if copied["commit_hash"].duplicated().any():
        raise BaselineError("AUTHOR_DATA_INVALID", "JITLine 特征表含重复提交")
    return copied.set_index("commit_hash", drop=False)


def _merge_metrics(ids, labels, code, features):
    indexes = _frame_map(features)
    missing = [commit for commit in ids if commit not in indexes.index]
    if missing:
        raise BaselineError("AUTHOR_DATA_INVALID",
                            f"JITLine 特征表缺少 {len(missing)} 个提交")
    rows = []
    for commit, label, text in zip(ids, labels, code, strict=True):
        row = indexes.loc[commit]
        def number(name):
            if name == "fix":
                return 1.0 if str(row[name]).strip().lower() in ("true", "1", "1.0") else 0.0
            return float(row[name])
        rows.append({
            "id": commit,
            "label": int(label),
            "code": text,
            "features": {name: number(name) for name in METRIC_FEATURES},
            "la": number("la"),
            "ld": number("ld"),
            "epoch": int(row.get("author_date_unix_timestamp") or 0),
            "project": str(row.get("project") or ""),
        })
    return rows


def _load_jitfine_baseline():
    train_changes, train_features = load_jit_defect4j_split("train")
    test_changes, test_features = load_jit_defect4j_split("test")
    train_ids, train_labels, train_code = _code_texts(train_changes)
    test_ids, test_labels, test_code = _code_texts(test_changes)
    return (
        _merge_metrics(train_ids, train_labels, train_code, train_features),
        _merge_metrics(test_ids, test_labels, test_code, test_features),
        {
            "kind": "jitfine-baseline",
            "description": VARIANTS["jitfine-baseline"],
            "authorOriginalSplit": False,
            "missingAuthorPickles": True,
        },
    )


def _parse_released_metrics(metrics_path: Path):
    frame = pd.read_csv(metrics_path)
    if "commit_id" not in frame or "bugcount" not in frame:
        raise BaselineError("AUTHOR_DATA_INVALID", "JITLine 发布指标缺少提交或标签列")
    frame = frame.drop_duplicates("commit_id").copy()
    frame["label"] = frame["bugcount"].fillna(0).astype(int).clip(0, 1)
    frame["epoch"] = pd.to_numeric(frame["author_date"], errors="coerce").fillna(0).astype(int)
    frame = frame.sort_values(["epoch", "commit_id"]).reset_index(drop=True)
    cutoff = max(1, int(len(frame) * 0.8))
    return frame.iloc[:cutoff].copy(), frame.iloc[cutoff:].copy()


def _released_code(lines: pd.DataFrame):
    groups = {}
    if "code_change_remove_common_tokens" not in lines.columns:
        raise BaselineError("AUTHOR_DATA_INVALID", "JITLine 行级表缺少规范化代码列")
    for commit, group in lines.groupby("commit_hash", sort=False):
        values = [str(value) for value in group["code_change_remove_common_tokens"]
                  if isinstance(value, str) and value.strip()]
        groups[str(commit)] = " \n ".join(sorted(set(values)))
    return groups


def _load_released(project):
    base = Path(__file__).resolve().parents[2] / ".cache" / "author-repos" / "JITLine" / "JITLine" / "data"
    metrics_path = base / f"{project}_metrics.csv"
    lines_path = base / f"{project}_complete_buggy_line_level.csv"
    if not metrics_path.is_file() or not lines_path.is_file():
        raise BaselineError("AUTHOR_MATERIAL_MISSING", f"缺少 JITLine {project} 发布表")
    train, test = _parse_released_metrics(metrics_path)
    lines = pd.read_csv(lines_path, sep="\t")
    code = _released_code(lines)
    rows = []
    for frame in (train, test):
        for _, row in frame.iterrows():
            def numeric(name, default=0.0):
                value = row.get(name)
                return default if pd.isna(value) else float(value)
            feature = {name: 0.0 for name in METRIC_FEATURES}
            feature.update({
                "ns": numeric("ns"), "nd": numeric("nd"),
                "nf": numeric("nf"), "entropy": numeric("ent"),
                "la": numeric("la"), "ld": numeric("ld"),
                "ndev": numeric("ndev"), "age": numeric("age"),
                "nuc": numeric("nuc"), "exp": numeric("aexp"),
                "rexp": numeric("rexp"), "sexp": numeric("asexp"),
                "fix": 1.0 if numeric("fixcount") > 0 else 0.0,
            })
            commit = str(row["commit_id"])
            rows.append({
                "id": commit, "label": int(row["label"]), "code": code.get(commit, ""),
                "features": feature, "la": feature["la"], "ld": feature["ld"],
                "epoch": int(row["epoch"]), "project": project,
            })
    split = len(train)
    return rows[:split], rows[split:], {
        "kind": f"released-{project}",
        "description": VARIANTS[f"released-{project}"],
        "authorOriginalSplit": False,
        "splitRule": "chronological 80/20 reconstruction; original pickle split unavailable",
        "missingAuthorPickles": True,
    }


def load_jitline(variant="jitfine-baseline"):
    if variant == "jitfine-baseline":
        return (*_load_jitfine_baseline(),)
    if variant == "released-openstack":
        return _load_released("openstack")
    if variant == "released-qt":
        return _load_released("qt")
    raise BaselineError("AUTHOR_DATA_VARIANT_UNKNOWN", f"未知 JITLine 数据版本：{variant}")


def _build_matrix(train, test, max_train=None, seed=42):
    if max_train and max_train < len(train):
        positives = [row for row in train if row["label"] == 1]
        negatives = [row for row in train if row["label"] == 0]
        generator = random.Random(seed)
        take_pos = min(len(positives), max_train // 2)
        take_neg = min(len(negatives), max_train - take_pos)
        train = generator.sample(positives, take_pos) + generator.sample(negatives, take_neg)
        generator.shuffle(train)
    vectorizer = CountVectorizer(min_df=3, ngram_range=(1, 1))
    vectorizer.fit([row["code"] for row in train])
    token_names = list(vectorizer.get_feature_names_out())
    metric_names = list(METRIC_FEATURES)
    x_train = hstack([
        vectorizer.transform([row["code"] for row in train]),
        csr_matrix(np.asarray([[row["features"][name] for name in METRIC_FEATURES]
                               for row in train], dtype=float)),
    ]).tocsr()
    x_test = hstack([
        vectorizer.transform([row["code"] for row in test]),
        csr_matrix(np.asarray([[row["features"][name] for name in METRIC_FEATURES]
                               for row in test], dtype=float)),
    ]).tocsr()
    return train, test, vectorizer, token_names + metric_names, x_train, x_test


def _explain_lines(model, explainer, row, *, num_samples):
    explanation = explainer.explain_instance(
        row,
        model.predict_proba,
        num_features=len(explainer.feature_names),
        num_samples=num_samples,
    )
    weights = {}
    for expression, value in explanation.as_list(label=1):
        token = re.sub(r"\s.*", "", expression)
        if token in COMMON_TOKENS or token in METRIC_FEATURES:
            continue
        weights[token] = float(value)
    return weights


def _line_rows_for_commit(commit, variant, project=None):
    if variant == "jitfine-baseline":
        frame = jitsmart_line_labels("test")
        subset = frame[frame["commit hash"].astype(str) == commit]
        subset = subset[subset["change type"] == "added"]
        return [{
            "path": str(row["file"]), "idx": int(row["idx"]),
            "text": str(row["code line"]), "label": int(row["label"]),
        } for _, row in subset.sort_values("idx").iterrows()]
    base = Path(__file__).resolve().parents[2] / ".cache" / "author-repos" / "JITLine" / "JITLine" / "data"
    frame = pd.read_csv(base / f"{project}_complete_buggy_line_level.csv", sep="\t")
    subset = frame[frame["commit_hash"].astype(str) == commit]
    subset = subset[subset["change_type"] == "added"]
    rows = []
    for idx, (_, row) in enumerate(subset.iterrows()):
        text = row.get("code_change")
        rows.append({
            "path": None, "idx": idx, "text": "" if pd.isna(text) else str(text),
            "label": int(row.get("is_buggy_line") or 0),
        })
    return rows


def _line_outputs(model, x_train, x_test, token_names, test_rows, predictions, variant,
                  *, seed, line_commits, lime_samples):
    from lime.lime_tabular import LimeTabularExplainer
    background_size = min(256, x_train.shape[0])
    generator = np.random.RandomState(seed)
    indices = generator.choice(x_train.shape[0], background_size, replace=False)
    background = x_train[indices].toarray()
    explainer = LimeTabularExplainer(
        background,
        feature_names=token_names,
        class_names=["not defective", "defective"],
        discretize_continuous=False,
        random_state=seed,
    )
    positive = [(index, row, score)
                for index, (row, score) in enumerate(zip(test_rows, predictions, strict=True))
                if row["label"] == 1 and score >= 0.5]
    if not positive:
        positive = [(index, row, score)
                    for index, (row, score) in enumerate(zip(test_rows, predictions, strict=True))
                    if row["label"] == 1]
    selected = []
    skipped = {"noCommitLines": 0, "noPositiveTokens": 0}
    for index, row, score in positive:
        candidates = _line_rows_for_commit(row["id"], variant, row.get("project"))
        if candidates:
            selected.append((index, row, score, candidates))
        else:
            skipped["noCommitLines"] += 1
        if len(selected) >= line_commits:
            break
    line_rows, token_rows = [], []
    for commit_index, record, _score, candidate_rows in selected:
        weights = _explain_lines(model, explainer, x_test[commit_index].toarray()[0],
                                 num_samples=lime_samples)
        if not any(value > 0 for value in weights.values()):
            skipped["noPositiveTokens"] += 1
        project = record.get("project") or None
        for line in candidate_rows:
            tokens = preprocess_code_line(line["text"]).split()
            token_scores = [weights.get(token, 0.0) for token in tokens]
            positive_scores = [value for value in token_scores if value > 0]
            score = float(sum(positive_scores))
            line_rows.append({
                "commitId": record["id"], "path": line["path"], "idx": line["idx"],
                "gitLine": None,
                "lineNumberReason": "author-table-has-line-index-but-no-git-line-number",
                "text": line["text"], "label": line["label"], "lineScore": score,
                "meanTokenScore": float(np.mean(positive_scores)) if positive_scores else 0.0,
                "positiveTokenCount": len(positive_scores),
                "project": project,
            })
            for position, (token, value) in enumerate(zip(tokens, token_scores, strict=True)):
                if value:
                    token_rows.append({
                        "commitId": record["id"], "path": line["path"], "idx": line["idx"],
                        "tokenPosition": position, "token": token, "weight": float(value),
                    })
    return line_rows, token_rows, {
        "selectedCommits": len(selected),
        "lineExplainedCommits": len({row["commitId"] for row in line_rows}),
        "limeSamples": lime_samples,
        "limeBackgroundRows": background_size,
        "skipped": skipped,
    }


def run_jitline(*, variant="jitfine-baseline", output=None, seed=42, max_train=None,
                line_commits=10, lime_samples=512, smote_k=9, argv=None) -> dict:
    if variant not in VARIANTS:
        raise BaselineError("AUTHOR_DATA_VARIANT_UNKNOWN", f"未知 JITLine 数据版本：{variant}")
    seed_everything(seed)
    train_rows, test_rows, data_meta = load_jitline(variant)
    train_rows, test_rows, vectorizer, feature_names, x_train, x_test = _build_matrix(
        train_rows, test_rows, max_train=max_train, seed=seed)
    y_train = np.asarray([row["label"] for row in train_rows], dtype=int)
    y_test = np.asarray([row["label"] for row in test_rows], dtype=int)
    minority = int(min(np.bincount(y_train, minlength=2)))
    if minority <= smote_k:
        raise BaselineError(
            "AUTHOR_SAMPLE_INSUFFICIENT",
            f"JITLine SMOTE 需要少数类至少 {smote_k + 1} 条，实际 {minority}",
        )
    try:
        # imbalanced-learn 0.14 removed the historical SMOTE(n_jobs=...)
        # argument; this is a compatibility port, not an algorithm change.
        sampler = SMOTE(k_neighbors=smote_k, random_state=seed)
        x_resampled, y_resampled = sampler.fit_resample(x_train, y_train)
    except Exception as exc:
        raise BaselineError("AUTHOR_TRAIN_FAILED", f"JITLine SMOTE 失败：{exc}") from exc
    model = RandomForestClassifier(n_estimators=300, random_state=seed, n_jobs=-1)
    model.fit(x_resampled, y_resampled)
    scores = [finite_probability(value) for value in model.predict_proba(x_test)[:, 1]]
    material_hashes = {"jit-fine-jit-defect4j": verify_material(
        "jit-fine-jit-defect4j")["hashes"]}
    if variant == "jitfine-baseline":
        material_hashes["jit-smart-line-labels"] = {
            item["path"]: item.get("sha256")
            for item in verify_material("jit-smart-line-labels")["members"]
        }
    config = {
        "variant": variant,
        "preprocessing": "author JITLine punctuation/string/number normalization with Python-common-token removal",
        "deduplication": "sorted set per commit (author set order made deterministic)",
        "vectorizer": {"minDf": 3, "ngramRange": [1, 1]},
        "features": ["token-counts", *METRIC_FEATURES],
        "sampling": {"method": "SMOTE", "kNeighbors": smote_k, "randomState": 42},
        "classifier": {"method": "RandomForestClassifier", "nEstimators": 300,
                       "randomState": 42, "nJobs": -1},
        "threshold": 0.5,
        "lineAttribution": {
            "method": "LIME lime_tabular",
            "aggregation": "sum positive token weights per line",
            "samples": lime_samples,
            "explainedCommits": line_commits,
        },
        "data": data_meta,
        "limitations": [
            "JIT-Fine baseline variant uses the JIT-Fine authors' fixed input, not JITLine's original OpenStack/Qt pickle split.",
            "Released-table variants reconstruct a chronological split because the author-split pickles are absent.",
            "LIME explains only a declared sample of correctly predicted positive commits.",
            "Git line numbers are unavailable in the author tables; only file/index identity is emitted.",
        ],
    }
    run = new_run(
        "jitline", version="jitline-author-code-v1", fidelity="real-smoke",
        material_hashes=material_hashes, config=config,
        split={"kind": "test", "variant": variant, "seed": seed},
        seed=seed, output=output, argv=argv,
    )
    try:
        records = [{"id": row["id"], "label": row["label"], "epoch": row["epoch"],
                    "la": row["la"], "ld": row["ld"]} for row in test_rows]
        metrics = commit_metrics(records, scores)
        line_rows, token_rows, line_meta = _line_outputs(
            model, x_train, x_test, feature_names, test_rows, scores, variant,
            seed=seed, line_commits=line_commits, lime_samples=lime_samples)
        localization = line_metrics(line_rows) if line_rows else {"samples": 0,
                                                                   "reason": "没有已解释行"}
        localization["coverage"] = {
            **line_meta,
            "explainedLines": len(line_rows),
            "positiveLinesInExplainedCommits": sum(int(row["label"]) for row in line_rows),
            "testCommits": len(test_rows),
            "testPositiveCommits": int(sum(1 for row in test_rows if row["label"] == 1)),
        }
        predictions = [{
            "commitId": row["id"], "score": score, "label": row["label"],
            "project": row.get("project"), "variant": variant,
        } for row, score in zip(test_rows, scores, strict=True)]
        write_jsonl(run.directory / "predictions.jsonl", predictions)
        write_jsonl(run.directory / "line-predictions.jsonl", line_rows)
        write_jsonl(run.directory / "token-line-map.jsonl", token_rows)
        joblib.dump({"vectorizer": vectorizer, "model": model,
                     "featureNames": feature_names, "metrics": METRIC_FEATURES},
                    run.directory / "model.joblib")
        write_json(run.directory / "metrics.json", {
            "schema": "author-jitline-metrics-v1",
            "commit": metrics,
            "line": localization,
            "data": data_meta,
            "training": {
                "trainRows": len(train_rows),
                "testRows": len(test_rows),
                "features": len(feature_names),
                "afterSmote": int(len(y_resampled)),
                "smoteK": smote_k,
            },
            "limitations": config["limitations"],
        })
        append_log(run, f"JITLine {variant} completed: {len(predictions)} commits, "
                        f"{len(line_rows)} lines, {len(token_rows)} token links")
        return run.complete({
            "variant": variant,
            "commitMetrics": metrics,
            "lineMetrics": localization,
            "predictions": len(predictions),
            "lineRows": len(line_rows),
        })
    except Exception as exc:
        run.fail(getattr(exc, "code", "AUTHOR_RUN_FAILED"), str(exc))
        raise
