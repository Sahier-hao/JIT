"""行级缺陷预测基线：读取 line-szz-v1，按仓库或提交分组训练并报告指标。"""
from __future__ import annotations

import hashlib
import json
import math
import platform
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import sklearn
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


def _numeric(row, include_commit=True, position_features=True):
    text = str(row.get("text") or "")
    structure = _structure(text)
    values = [len(text), float(row.get("indent") or 0),
              1.0 if row.get("blank") else 0.0, 1.0 if row.get("comment") else 0.0]
    if position_features:
        values.extend([float(row.get("fileLines") or 0), float(row.get("lineRatio") or 0.0)])
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


def _localization(test_rows, y_test, probability):
    """按提交分组的定位代理指标；抽样负例不是完整候选集。"""
    groups = {}
    for row, label, score in zip(test_rows, y_test, probability):
        groups.setdefault(str(row["commitId"]), []).append((float(score), int(label)))
    top = {key: 0 for key in (1, 3, 5, 10)}
    commits = positives = budget_positives = 0
    ifas, recalls = [], []
    for items in groups.values():
        items.sort(key=lambda pair: pair[0], reverse=True)
        if not any(label for _, label in items):
            continue
        commits += 1
        positives += sum(label for _, label in items)
        for key in top:
            top[key] += 1 if any(label for _, label in items[:key]) else 0
        first = next(index for index, (_, label) in enumerate(items) if label)
        ifas.append(first)
        budget = max(1, math.ceil(len(items) * 0.2))
        captured = sum(label for _, label in items[:budget])
        budget_positives += captured
        recalls.append(captured / max(1, sum(label for _, label in items)))
    return {
        "proxy": True,
        "reason": ("评估集是正负抽样列表，不是完整文件或 PR 候选集合；"
                   "IFA 与预算召回只是上限代理，不能当作实际审查节省或线上收益。"),
        "commitsWithPositives": commits,
        "candidateLines": len(test_rows),
        "positives": positives,
        "topKHit": {f"top{key}": (top[key] / commits if commits else None) for key in top},
        "lineBudget": "每提交按预测分数取 ceil(20% 候选行)",
        "recallAt20PercentLines": (budget_positives / positives if positives else None),
        "recallAt20PercentPerCommitMean": float(np.mean(recalls)) if recalls else None,
        "ifaMean": float(np.mean(ifas)) if ifas else None,
        "ifaMedian": float(np.median(ifas)) if ifas else None,
    }


def _group_metrics(test_rows, y_test, probability, key):
    groups = {}
    for row, label, score in zip(test_rows, y_test, probability):
        groups.setdefault(str(row.get(key) or "unknown"), []).append((int(label), float(score)))
    result = {}
    for name, pairs in sorted(groups.items()):
        labels = [label for label, _ in pairs]
        if len(set(labels)) < 2:
            result[name] = {"samples": len(pairs), "positives": sum(labels),
                            "reason": "单一类别，无法计算排序指标"}
            continue
        metrics = _metrics(labels, [score for _, score in pairs])
        result[name] = {"samples": len(pairs), "positives": sum(labels), **metrics}
    return result


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def _input_record(path):
    path = Path(path)
    blob = path.read_bytes()
    sidecar = Path(str(path) + ".summary.json")
    sampling = json.loads(sidecar.read_text(encoding="utf-8")) if sidecar.exists() else None
    rows = [json.loads(line) for line in blob.decode("utf-8").splitlines() if line.strip()]
    return {
        "path": str(path),
        "sha256": hashlib.sha256(blob).hexdigest(),
        "bytes": len(blob),
        "rows": len(rows),
        "datasetVersions": sorted({str(row.get("datasetVersion")) for row in rows if row.get("datasetVersion")}),
        "repos": sorted({str(row.get("repo")) for row in rows if row.get("repo")}),
        "languages": sorted({str(row.get("language") or "other") for row in rows}),
        "sampling": sampling,
    }


def _manifest(inputs, report, *, seed, test_repo, include_commit_features,
              repo_balance, position_features, languages, train_commits, test_commits):
    split = report["split"]
    members = {
        "train": {"commits": len(train_commits), "memberSha256": _digest(sorted(train_commits))},
        "test": {"commits": len(test_commits), "memberSha256": _digest(sorted(test_commits))},
    }
    command = ["python", "-m", "jit_baseline.cli", "line-train"]
    for path in inputs:
        command.extend(["--input", str(path)])
    command.extend(["--output", "<report>.json", "--seed", str(seed)])
    if test_repo:
        command.extend(["--test-repo", test_repo])
    if include_commit_features:
        command.append("--include-commit-features")
    if not repo_balance:
        command.append("--no-repo-balance")
    if not position_features:
        command.append("--no-position-features")
    for language in languages or []:
        command.extend(["--language", language])
    sampling = [entry["sampling"] for entry in report["inputFiles"]
                if isinstance(entry.get("sampling"), dict)]
    negative_modes = sorted({str(item.get("negativeMode")) for item in sampling if item.get("negativeMode")})
    negative_seeds = sorted({int(item.get("seed")) for item in sampling if isinstance(item.get("seed"), int)})
    return {
        "schema": "line-experiment-manifest-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "inputs": report["inputFiles"],
        "split": {
            "kind": split["kind"], "seed": seed, "testRepo": test_repo,
            "trainCommits": split.get("trainCommits"), "testCommits": split.get("testCommits"),
            "trainRepos": split.get("trainRepos"), "testRepos": split.get("testRepos"),
            "memberSha256": {name: value["memberSha256"] for name, value in members.items()},
        },
        "sampling": {
            "negativeMode": negative_modes[0] if len(negative_modes) == 1 else negative_modes or None,
            "datasetSeed": negative_seeds[0] if len(negative_seeds) == 1 else negative_seeds or None,
            "source": [entry.get("path") for entry in report["inputFiles"]],
        },
        "features": report["features"],
        "model": report["model"],
        "environment": {"python": platform.python_version(), "sklearn": sklearn.__version__,
                        "numpy": np.__version__},
        "command": " ".join(command),
        "limitations": [
            "历史 SZZ 弱标签，正例不是人工确认的真值；未观测行不等于无缺陷。",
            "负例来自抽样列表，定位指标是代理值，不能代表完整候选集上的审查收益。",
            "大型原始 JSONL 不入版本库，复现需按 inputs 的 sha256 与获取说明准备同一份数据。",
        ],
    }


def train_line_baseline(inputs, output, *, test_repo=None, seed=42, model_output=None,
                        include_commit_features=False, repo_balance=True, position_features=True,
                        languages=None, manifest_output=None, text_features=True):
    rows = load_rows(inputs)
    if languages:
        selected = {value.lower() for value in languages}
        rows = [row for row in rows if str(row.get("language") or "").lower() in selected]
        if not rows:
            raise ValueError(f"没有匹配语言的行级样本：{sorted(selected)}")
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
    if text_features:
        x_text_train = vectorizer.fit_transform([_text(row) for row in train_rows])
        x_text_test = vectorizer.transform([_text(row) for row in test_rows])
    else:
        from scipy.sparse import csr_matrix as _empty
        x_text_train = _empty((len(train_rows), 0))
        x_text_test = _empty((len(test_rows), 0))
    encoder = OneHotEncoder(handle_unknown="ignore", sparse_output=True)
    x_lang_train = encoder.fit_transform(np.array([[row.get("language") or "other"] for row in train_rows]))
    x_lang_test = encoder.transform(np.array([[row.get("language") or "other"] for row in test_rows]))
    x_num_train = csr_matrix(np.array([_numeric(row, include_commit_features, position_features) for row in train_rows], dtype=float))
    x_num_test = csr_matrix(np.array([_numeric(row, include_commit_features, position_features) for row in test_rows], dtype=float))
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
    localization = _localization(test_rows, y_test.tolist(), probability.tolist())
    input_files = [_input_record(path) for path in inputs]
    report = {
        "schema": "line-model-report-v2",
        "inputs": [str(path) for path in inputs],
        "inputFiles": input_files,
        "split": {**split, "seed": seed,
                  "trainCommits": int(len(set(commits[train_index]))),
                  "testCommits": int(len(set(commits[test_index]))),
                  "trainRepos": sorted(set(repos[train_index].tolist())),
                  "testRepos": sorted(set(repos[test_index].tolist()))},
        "languages": sorted({str(row.get("language") or "other") for row in rows}),
        "samples": {"total": len(rows), "train": len(train_rows), "test": len(test_rows),
                    "positives": int(labels.sum()), "negatives": int(len(labels) - labels.sum()),
                    "trainPositives": int(y_train.sum()), "testPositives": int(y_test.sum())},
        "features": {"dimension": int(x_train.shape[1]), "text": TEXT_PARAMS,
                     "numeric": (["lineLength", "indent", "blank", "comment"] + (["fileLines", "lineRatio"] if position_features else []) + STRUCT_KEYS +
                                 (FEATURE_NAMES if include_commit_features else [])),
                     "languages": [str(value) for value in encoder.categories_[0]]},
        "model": {"type": "logistic-regression", "classWeight": "balanced",
                  "solver": "liblinear", "maxIter": 2000, "threshold": 0.5,
                  "includeCommitFeatures": include_commit_features, "repoBalance": repo_balance,
                  "positionFeatures": position_features, "textFeatures": text_features},
        "metrics": metrics,
        "referenceBaselines": {
            "randomPrAuc": (y_test.sum() / len(y_test)) if len(y_test) else None,
            "note": "PR-AUC 的随机基线等于测试集正例率；排序模型必须明显高于它才有意义。",
        },
        "localization": localization,
        "byRepo": _group_metrics(test_rows, y_test, probability, "repo"),
        "byLanguage": _group_metrics(test_rows, y_test, probability, "language"),
    }
    manifest = _manifest(
        inputs, report, seed=seed, test_repo=test_repo,
        include_commit_features=include_commit_features, repo_balance=repo_balance,
        position_features=position_features, languages=languages,
        train_commits=sorted(set(commits[train_index].tolist())),
        test_commits=sorted(set(commits[test_index].tolist())))
    report["manifest"] = manifest
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    sidecar = (Path(manifest_output) if manifest_output
               else target.with_suffix(".manifest.json"))
    sidecar.parent.mkdir(parents=True, exist_ok=True)
    sidecar.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    if model_output:
        import joblib
        joblib.dump({"vectorizer": vectorizer, "encoder": encoder, "model": model,
                     "features": FEATURE_NAMES}, model_output)
    return report
