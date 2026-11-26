"""固定行级研究模型的仓库留出影子评估。

评估只读取已导出的完整候选 JSONL 与冻结的研究预览模型，不训练、不写目录库，
也不改变项目分析或 PR 审查。未观测行不是人工确认的无缺陷行。
"""
from __future__ import annotations

import hashlib
import json
import math
import random
from pathlib import Path

from .line_candidates import _generated_path
from .line_preview import line_logit, load_model

FORMAT = "line-shadow-evaluation-v1"
RECALL_K = (1, 5, 10)
RANDOM_SEEDS = (42, 43, 44)
MIN_ELIGIBLE_CANDIDATES = 1000
MIN_ELIGIBLE_POSITIVE_COMMITS = 20


def _file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _repo_relationship(repo, model):
    lowered = str(repo or "").lower()
    split = model.get("split") or {}
    for name in split.get("trainRepos") or []:
        token = str(name or "").lower()
        if token and token in lowered:
            return "training"
    token = str(split.get("testRepo") or "").lower()
    if token and token in lowered:
        return "prior-holdout"
    return "unseen"


def _row_line(row):
    text = str(row.get("text") or "")
    stripped = text.strip()
    return {
        "text": text,
        "indent": len(text) - len(text.lstrip()),
        "blank": not stripped,
        "comment": stripped.startswith(("#", "//", "/*", "*", "--", ";", "<!--")),
    }


def _score(model, row):
    language = str(row.get("language") or "").lower()
    score, _ = line_logit(
        model, _row_line(row), language, position_features=False,
    )
    return score


def _ordered_groups(rows, score_key):
    grouped = {}
    for row in rows:
        grouped.setdefault(row["commitId"], []).append(row)
    for commit, items in grouped.items():
        items.sort(key=lambda item: (score_key(item), item.get("path") or "",
                                     int(item.get("line") or 0)))
    return grouped


def _metrics(groups):
    commits = 0
    positives = 0
    hits_by_k = {k: 0 for k in RECALL_K}
    micro_positives = {k: 0 for k in RECALL_K}
    recall_by_k = {k: [] for k in RECALL_K}
    reciprocal_ranks = []
    first_positive_ranks = []
    any_hit_by_k = {k: 0 for k in RECALL_K}
    for items in groups.values():
        labels = [item["labelStatus"] == "positive" for item in items]
        positive_count = sum(labels)
        if not positive_count:
            continue
        first = next(index for index, label in enumerate(labels) if label)
        commits += 1
        positives += positive_count
        first_positive_ranks.append(first + 1)
        reciprocal_ranks.append(1.0 / (first + 1))
        for k in RECALL_K:
            captured = sum(labels[:k])
            hits_by_k[k] += captured
            micro_positives[k] += captured
            recall_by_k[k].append(captured / positive_count)
            if captured:
                any_hit_by_k[k] += 1

    def mean(values):
        return sum(values) / len(values) if values else None

    return {
        "commitsWithPositive": commits,
        "positives": positives,
        "recallAtK": {
            f"recallAt{k}": mean(recall_by_k[k]) for k in RECALL_K
        },
        "microRecallAtK": {
            f"recallAt{k}": (hits_by_k[k] / positives if positives else None)
            for k in RECALL_K
        },
        "hitAtK": {
            f"hitAt{k}": (any_hit_by_k[k] / commits if commits else None)
            for k in RECALL_K
        },
        "mrr": mean(reciprocal_ranks),
        "meanLinesToFirstPositive": mean(first_positive_ranks),
        "medianLinesToFirstPositive": (
            sorted(first_positive_ranks)[len(first_positive_ranks) // 2]
            if first_positive_ranks else None
        ),
    }


def _metric_value(metrics, name):
    if name.startswith("recallAt"):
        return metrics["recallAtK"][name]
    return metrics[name]


def _better(name, candidate, baseline):
    if candidate is None or baseline is None:
        return False
    if name == "meanLinesToFirstPositive":
        return candidate < baseline
    return candidate > baseline


def _edge_summary(model_metrics, baseline_metrics, baseline_names):
    names = [f"recallAt{k}" for k in RECALL_K] + ["mrr", "meanLinesToFirstPositive"]
    by_metric = {}
    for name in names:
        candidate = _metric_value(model_metrics, name)
        comparisons = {baseline: _metric_value(baseline_metrics[baseline], name)
                       for baseline in baseline_names}
        by_metric[name] = {
            "model": candidate,
            "baselines": comparisons,
            "betterThanAll": all(
                _better(name, candidate, value) for value in comparisons.values()
            ),
        }
    return {
        "byMetric": by_metric,
        "betterOnEveryMetric": all(item["betterThanAll"] for item in by_metric.values()),
    }


def _read_input(path, supported, model):
    rows = []
    total = 0
    unsupported = 0
    invalid = 0
    repos = set()
    languages = {}
    with Path(path).open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            total += 1
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                invalid += 1
                continue
            language = str(row.get("language") or "other").lower()
            languages[language] = languages.get(language, 0) + 1
            if row.get("labelStatus") not in ("positive", "unobserved"):
                invalid += 1
                continue
            if not row.get("commitId") or not row.get("path") or not row.get("line"):
                invalid += 1
                continue
            if language not in supported:
                unsupported += 1
                continue
            if _generated_path(str(row.get("path") or "")):
                unsupported += 1
                continue
            row["language"] = language
            row["_shadowModelScore"] = _score(model, row)
            rows.append(row)
            if row.get("repo"):
                repos.add(str(row["repo"]))
    repo = next(iter(repos), Path(path).stem.replace("-mature", ""))
    return {
        "path": str(path),
        "sha256": _file_sha256(path),
        "totalRows": total,
        "supportedRows": len(rows),
        "unsupportedRows": unsupported,
        "invalidRows": invalid,
        "languages": dict(sorted(languages.items())),
        "repo": repo,
        "relationshipToModel": _repo_relationship(repo, model),
        "rows": rows,
    }


def evaluate_line_shadow(inputs, output, *, model_path=None):
    """在完整候选集上评估冻结研究模型，并写出可核查的 JSON 报告。"""
    model = load_model(model_path)
    supported = set(model["features"].get("supported") or model["features"]["language"])
    entries = []
    for path in inputs:
        source = _read_input(path, supported, model)
        rows = source.pop("rows")
        model_metrics = None
        scorer_metrics = {}
        comparison = None
        if rows:
            model_groups = _ordered_groups(
                rows, lambda item: (-item["_shadowModelScore"], item["path"], item["line"]),
            )
            model_metrics = _metrics(model_groups)
            file_groups = _ordered_groups(
                rows, lambda item: (item["path"], item["line"]),
            )
            scorer_metrics = {"model": model_metrics, "file-order": _metrics(file_groups)}
            random_names = []
            for seed in RANDOM_SEEDS:
                shuffled = list(rows)
                random.Random(seed).shuffle(shuffled)
                positions = {row["id"]: index for index, row in enumerate(shuffled)}
                groups = _ordered_groups(rows, lambda item: positions[item["id"]])
                name = f"random-{seed}"
                random_names.append(name)
                scorer_metrics[name] = _metrics(groups)
            comparison = _edge_summary(
                model_metrics, scorer_metrics, ["file-order", *random_names],
            )
        eligible = bool(
            rows
            and len(rows) >= MIN_ELIGIBLE_CANDIDATES
            and model_metrics["commitsWithPositive"] >= MIN_ELIGIBLE_POSITIVE_COMMITS
        )
        entry = {
            **source,
            "status": "evaluated" if rows else "not-applicable",
            "reason": None if rows else "冻结模型未覆盖该输入的语言或没有有效候选行",
            "positiveRate": (
                sum(row["labelStatus"] == "positive" for row in rows) / len(rows)
                if rows else None
            ),
            "thresholdEligible": eligible,
            "thresholdReason": (
                "样本量满足门槛"
                if eligible
                else "样本不足：至少需要 1000 个适用候选行与 20 个含正例提交"
            ),
            "scorers": scorer_metrics if rows else {},
            "comparison": comparison,
        }
        entries.append(entry)

    applicable = [entry for entry in entries if entry["status"] == "evaluated"]
    eligible = [entry for entry in applicable if entry["thresholdEligible"]]
    unseen = [entry for entry in eligible if entry["relationshipToModel"] == "unseen"]
    passed = [entry for entry in unseen if entry["comparison"]["betterOnEveryMetric"]]
    report = {
        "schema": FORMAT,
        "generatedAt": "2026-11-26",
        "protocol": {
            "population": "introduced-added-lines-v1 complete candidate rows",
            "model": "frozen line-preview-model-v1; no retraining or tuning",
            "labels": "historical SZZ positives; unobserved is not confirmed clean",
            "recall": "macro mean across commits with at least one positive; top-k rows per commit",
            "microRecall": "all positives captured in each commit's top-k divided by all positives",
            "mrr": "mean reciprocal rank of the first positive line per commit",
            "linesToFirstPositive": "1-based rank of the first positive line; mean is lower-is-better",
            "random": list(RANDOM_SEEDS),
            "fileOrder": "sort candidates by path then line, equivalent to reading diff files in order",
            "minimumSamples": {
                "candidates": MIN_ELIGIBLE_CANDIDATES,
                "commitsWithPositive": MIN_ELIGIBLE_POSITIVE_COMMITS,
            },
            "threshold": (
                "at least two eligible, previously-unseen repositories must beat every "
                "baseline on all five localization metrics"
            ),
        },
        "model": {
            "artifactSha256": model.get("artifactSha256"),
            "trainRepos": (model.get("split") or {}).get("trainRepos") or [],
            "priorHoldout": (model.get("split") or {}).get("testRepo"),
            "supportedLanguages": sorted(supported),
        },
        "inputs": entries,
        "summary": {
            "applicableRepos": len(applicable),
            "thresholdEligibleRepos": len(eligible),
            "unseenEligibleRepos": len(unseen),
            "unseenEligible": [entry["repo"] for entry in unseen],
            "repositoriesBeatingAllBaselines": len(passed),
            "passingRepos": [entry["repo"] for entry in passed],
            "thresholdPassed": len(passed) >= 2,
            "conclusion": (
                "通过门槛，可评估产品接入"
                if len(passed) >= 2
                else "未通过门槛：不足两个适用仓库在全部指标上稳定优于随机与文件顺序基线，保留研究预览，不接入 A3"
            ),
        },
        "limitations": [
            "标签是历史 SZZ 弱标签；未被标记的候选行仍是未观测，不是已证实无缺陷。",
            "冻结模型只覆盖 JavaScript/TypeScript；Python 候选仓库不适用，不能通过换语言绕过模型边界。",
            "axios 是冻结模型原实验的留出仓库，但未参与系数训练；express 相对该模型未参与训练或留出。两者都没有人工复核的新盲测标签。",
            "完整候选集是提交 diff 的新增/修改行，不是整个文件或 PR 的全部行；指标不能直接换算成审查节省。",
        ],
    }
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                      encoding="utf-8")
    return report
