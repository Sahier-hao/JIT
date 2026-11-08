"""行级缺陷预测基线：读取 line-szz-v1，按仓库或提交分组训练并报告指标。"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix,
                             precision_recall_fscore_support, roc_auc_score)
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import OneHotEncoder

FEATURE_NAMES = ["ns", "nd", "nf", "entropy", "la", "ld", "lt", "fix", "ndev",
                 "age", "nuc", "exp", "rexp", "sexp"]
TEXT_PARAMS = dict(analyzer="char_wb", ngram_range=(3, 5), min_df=2, max_features=30000,
                   sublinear_tf=True)


def _repo(row):
    value = row.get("repo")
    if isinstance(value, str) and value.strip():
        return value.strip()
    version = str(row.get("datasetVersion") or "")
    if version.startswith("measure-"):
        return version[len("measure-"):]
    return version or "unknown"


def load_rows(paths):
    rows = []
    for path in paths:
        with Path(path).open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = json.loads(line)
                label = row.get("label")
                if label not in (0, 1) or not row.get("commitId"):
                    continue
                row["repo"] = _repo(row)
                rows.append(row)
    if not rows:
        raise ValueError("没有可用的行级样本")
    return rows


def _text(row):
    parts = [str(value) for value in (row.get("before") or [])]
    parts.append(str(row.get("text") or ""))
    parts.extend(str(value) for value in (row.get("after") or []))
    return "\n".join(parts)


STRUCT_KEYS = ["if", "for", "while", "return", "try", "catch", "assign", "compare",
               "call", "member", "index", "identifier", "digit"]


def _structure(text):
    return {
        "if": text.count("if "), "for": text.count("for "), "while": text.count("while "),
        "return": text.count("return "), "try": text.count("try"), "catch": text.count("catch"),
        "assign": text.count("=") - text.count("==") - text.count("!=") - text.count(">=") - text.count("<="),
        "compare": text.count("==") + text.count("!=") + text.count(">=") + text.count("<="),
        "call": text.count("("), "member": text.count("."), "index": text.count("["),
        "identifier": sum(1 for token in text.replace("(", " ").replace(")", " ").split()
                          if token and (token[0].isalpha() or token[0] == "_")),
        "digit": sum(1 for ch in text if ch.isdigit()),
    }


def _numeric(row, include_commit=True):
    text = str(row.get("text") or "")
    structure = _structure(text)
    values = [len(text), float(row.get("indent") or 0),
              1.0 if row.get("blank") else 0.0, 1.0 if row.get("comment") else 0.0]
    values.extend(float(structure[key]) for key in STRUCT_KEYS)
    if include_commit:
        features = row.get("commitFeatures") or {}
        for name in FEATURE_NAMES:
            try:
                values.append(float(features.get(name) or 0.0))
            except (TypeError, ValueError):
                values.append(0.0)
    return values


def _metrics(y_true, probability):
    if len(set(y_true)) < 2:
        return {"rocAuc": None, "prAuc": None, "brier": None,
                "reason": "测试集只有单一类别，无法计算排序指标"}
    pred = [1 if value >= 0.5 else 0 for value in probability]
    precision, recall, f1, _ = precision_recall_fscore_support(y_true, pred, average="binary", zero_division=0)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    return {"rocAuc": float(roc_auc_score(y_true, probability)),
            "prAuc": float(average_precision_score(y_true, probability)),
            "brier": float(brier_score_loss(y_true, probability)),
            "threshold": 0.5, "precision": float(precision), "recall": float(recall),
            "f1": float(f1), "trueNegative": int(tn), "falsePositive": int(fp),
            "falseNegative": int(fn), "truePositive": int(tp)}


def train_line_baseline(inputs, output, *, test_repo=None, seed=42, model_output=None,
                        include_commit_features=False, repo_balance=True):
    rows = load_rows(inputs)
    labels = np.array([int(row["label"]) for row in rows], dtype=int)
    commits = np.array([str(row["commitId"]) for row in rows])
    repos = np.array([row["repo"] for row in rows])
    if test_repo:
        test_mask = repos == test_repo
        train_mask = ~test_mask
        if not test_mask.any() or not train_mask.any():
            raise ValueError(f"测试仓库没有样本或没有训练样本：{test_repo}")
        train_index, test_index = np.where(train_mask)[0], np.where(test_mask)[0]
        split = {"kind": "repo", "testRepo": test_repo}
    else:
        if len(set(commits)) < 2:
            raise ValueError("按提交分组切分至少需要两个提交")
        splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=seed)
        train_index, test_index = next(splitter.split(np.zeros(len(rows)), labels, groups=commits))
        split = {"kind": "commit", "testRepo": None}
    train_rows = [rows[index] for index in train_index]
    test_rows = [rows[index] for index in test_index]
    y_train, y_test = labels[train_index], labels[test_index]
    vectorizer = TfidfVectorizer(**TEXT_PARAMS)
    x_text_train = vectorizer.fit_transform([_text(row) for row in train_rows])
    x_text_test = vectorizer.transform([_text(row) for row in test_rows])
    encoder = OneHotEncoder(handle_unknown="ignore", sparse_output=True)
    x_lang_train = encoder.fit_transform(np.array([[row.get("language") or "other"] for row in train_rows]))
    x_lang_test = encoder.transform(np.array([[row.get("language") or "other"] for row in test_rows]))
    x_num_train = csr_matrix(np.array([_numeric(row, include_commit_features) for row in train_rows], dtype=float))
    x_num_test = csr_matrix(np.array([_numeric(row, include_commit_features) for row in test_rows], dtype=float))
    x_train = hstack([x_text_train, x_lang_train, x_num_train]).tocsr()
    x_test = hstack([x_text_test, x_lang_test, x_num_test]).tocsr()
    model = LogisticRegression(class_weight="balanced", solver="liblinear",
                               max_iter=2000, random_state=seed)
    if repo_balance:
        counts = {repo: repos[train_index].tolist().count(repo) for repo in set(repos[train_index])}
        weights = np.array([len(train_index) / (len(counts) * counts[repo]) for repo in repos[train_index]], dtype=float)
    else:
        weights = None
    model.fit(x_train, y_train, sample_weight=weights)
    probability = model.predict_proba(x_test)[:, 1]
    metrics = _metrics(y_test.tolist(), probability.tolist())
    report = {
        "schema": "line-model-report-v1",
        "inputs": [str(path) for path in inputs],
        "split": {**split, "seed": seed,
                  "trainCommits": int(len(set(commits[train_index]))),
                  "testCommits": int(len(set(commits[test_index]))),
                  "trainRepos": sorted(set(repos[train_index].tolist())),
                  "testRepos": sorted(set(repos[test_index].tolist()))},
        "samples": {"total": len(rows), "train": len(train_rows), "test": len(test_rows),
                    "positives": int(labels.sum()), "negatives": int(len(labels) - labels.sum()),
                    "trainPositives": int(y_train.sum()), "testPositives": int(y_test.sum())},
        "features": {"dimension": int(x_train.shape[1]), "text": TEXT_PARAMS,
                     "numeric": (["lineLength", "indent", "blank", "comment"] + STRUCT_KEYS +
                                 (FEATURE_NAMES if include_commit_features else [])),
                     "languages": [str(value) for value in encoder.categories_[0]]},
        "model": {"type": "logistic-regression", "classWeight": "balanced",
                  "solver": "liblinear", "maxIter": 2000, "threshold": 0.5,
                  "includeCommitFeatures": include_commit_features, "repoBalance": repo_balance},
        "metrics": metrics,
    }
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if model_output:
        import joblib
        joblib.dump({"vectorizer": vectorizer, "encoder": encoder, "model": model,
                     "features": FEATURE_NAMES}, model_output)
    return report
