"""行级模型研究预览：只读加载可移植系数模型，在请求内按行打分。

该模型不进入目录库、默认模型、项目分析或 PR 审查；分数未经概率校准。
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request

from .api_errors import RequestError
from .config import BACKEND
from .line_artifact import PREVIEW_SCHEMA, preview_digest
from .line_features import numeric_values

DEFAULT_MODEL = BACKEND / "research" / "line-model-v1.json"
MAX_LINES = 2000
MAX_CHARS = 200_000
MAX_BODY_BYTES = 1_000_000
CAVEATS = [
    "分数来自历史 SZZ 弱标签与正负 1:1 抽样，未做概率校准，不是缺陷概率。",
    "排序只使用行内文本与结构特征，不使用上下文、提交信息或完整候选集。",
    "研究预览不参与项目分析、PR 审查、模型目录或默认模型。",
]


def model_path(configured: str | Path | None = None) -> Path:
    return Path(configured or os.environ.get("JIT_LINE_PREVIEW_MODEL") or DEFAULT_MODEL)


def _invalid() -> RequestError:
    return RequestError("LINE_PREVIEW_UNAVAILABLE")


def load_model(path: str | Path | None = None) -> dict[str, Any]:
    try:
        raw = model_path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise _invalid() from exc
    try:
        model = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise _invalid() from exc
    if not isinstance(model, dict) or model.get("schema") != PREVIEW_SCHEMA:
        raise _invalid()
    features = model.get("features")
    coefficients = model.get("coefficients")
    if not isinstance(features, dict) or not isinstance(coefficients, dict):
        raise _invalid()
    covered = features.get("language")
    numeric = features.get("numeric")
    if not isinstance(covered, list) or not isinstance(numeric, list):
        raise _invalid()
    if not all(isinstance(value, str) and value for value in covered + numeric):
        raise _invalid()
    names = [f"language:{value}" for value in covered] + numeric
    if len(names) != len(set(names)) or set(names) != set(coefficients):
        raise _invalid()
    values = list(coefficients.values()) + [model.get("intercept")]
    if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in values):
        raise _invalid()
    if model.get("artifactSha256") != preview_digest(model):
        raise _invalid()
    return model


def _supported(model: dict[str, Any]) -> list[str]:
    features = model["features"]
    supported = features.get("supported") or features.get("language") or []
    return [value for value in supported if isinstance(value, str) and value]


def metadata(path: str | Path | None = None) -> dict[str, Any]:
    model = load_model(path)
    split = model.get("split") or {}
    samples = model.get("samples") or {}
    metrics = model.get("metrics") or {}
    localization = model.get("localization") or {}
    top_hits = localization.get("topKHit") or {}
    return {
        "schema": "line-preview-metadata-v1",
        "available": True,
        "languages": _supported(model),
        "training": {
            "repos": split.get("trainRepos") or [],
            "commits": split.get("trainCommits"),
            "samples": samples.get("train"),
            "positives": samples.get("trainPositives"),
        },
        "holdout": {
            "repo": split.get("testRepo"),
            "commits": split.get("testCommits"),
            "samples": samples.get("test"),
            "positives": samples.get("testPositives"),
        },
        "metrics": {
            "rocAuc": metrics.get("rocAuc"),
            "prAuc": metrics.get("prAuc"),
            "brier": metrics.get("brier"),
            "randomPrAuc": (model.get("referenceBaselines") or {}).get("randomPrAuc"),
        },
        "localization": {
            "proxy": localization.get("proxy") is True,
            "top5": top_hits.get("top5"),
            "recallAt20PercentLines": localization.get("recallAt20PercentLines"),
        },
        "model": model.get("model") or {},
        "features": {"language": model["features"].get("language"),
                     "numeric": model["features"].get("numeric")},
        "coefficientCount": len(model["coefficients"]),
        "artifactSha256": model.get("artifactSha256"),
        "generatedAt": model.get("generatedAt"),
        "limitations": model.get("limitations") or [],
        "caveats": CAVEATS,
        "limits": {"maxLines": MAX_LINES, "maxCharacters": MAX_CHARS},
    }


def score_lines(code: str, language: str, path: str | Path | None = None) -> dict[str, Any]:
    model = load_model(path)
    if language not in _supported(model):
        raise RequestError("LINE_PREVIEW_LANGUAGE")
    text = code.replace("\r\n", "\n").replace("\r", "\n")
    if len(text) > MAX_CHARS:
        raise RequestError("LINE_PREVIEW_TOO_LARGE")
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    if len(lines) > MAX_LINES:
        raise RequestError("LINE_PREVIEW_TOO_LARGE")
    if not any(line.strip() for line in lines):
        raise RequestError("LINE_PREVIEW_EMPTY")
    covered = model["features"]["language"]
    numeric_names = model["features"]["numeric"]
    coefficients = model["coefficients"]
    weights = [float(coefficients[name]) for name in numeric_names]
    position_features = (model.get("model") or {}).get("positionFeatures") is not False
    language_weights = [float(coefficients[f"language:{value}"]) for value in covered]
    intercept = float(model["intercept"])
    total = len(lines)
    results = []
    for number, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped:
            continue
        row = {
            "text": line,
            "indent": len(line) - len(line.lstrip()),
            "blank": False,
            "comment": stripped.startswith(("#", "//", "/*", "*", "--", ";", "<!--")),
            "fileLines": total,
            "lineRatio": number / total if total else 0.0,
        }
        values = numeric_values(row, include_commit=False,
                                position_features=position_features)
        if len(values) != len(weights):
            raise _invalid()
        score = intercept
        for value, weight in zip(values, weights):
            score += value * weight
        for language_name, weight in zip(covered, language_weights):
            if language_name == language:
                score += weight
        score = max(-60.0, min(60.0, score))
        probability = 1.0 / (1.0 + math.exp(-score))
        results.append({"line": number, "text": line, "score": round(probability, 4)})
    results.sort(key=lambda item: (-item["score"], item["line"]))
    for rank, item in enumerate(results, 1):
        item["rank"] = rank
    return {
        "schema": "line-preview-score-v1",
        "language": language,
        "lines": results,
        "count": len(results),
        "skippedBlank": total - len(results),
        "artifactSha256": model.get("artifactSha256"),
        "caveats": CAVEATS,
    }


def install_research_routes(app: FastAPI, path: str | Path | None = None) -> None:
    @app.get("/api/v1/research/line-model")
    def line_model_metadata():
        return metadata(path)

    @app.post("/api/v1/research/line-model/score")
    async def line_model_score(request: Request):
        length = request.headers.get("content-length")
        if length:
            try:
                too_large = int(length) > MAX_BODY_BYTES
            except ValueError as exc:
                raise RequestError("INPUT_INVALID", field="body") from exc
            if too_large:
                raise RequestError("LINE_PREVIEW_TOO_LARGE")
        body = await request.body()
        if len(body) > MAX_BODY_BYTES:
            raise RequestError("LINE_PREVIEW_TOO_LARGE")
        try:
            payload = json.loads(body.decode("utf-8")) if body else None
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RequestError("INPUT_INVALID", field="body") from exc
        if not isinstance(payload, dict):
            raise RequestError("INPUT_INVALID", field="body")
        code = payload.get("code")
        language = payload.get("language")
        if not isinstance(code, str) or not code.strip():
            raise RequestError("INPUT_INVALID", field="code")
        if not isinstance(language, str) or not language.strip():
            raise RequestError("INPUT_INVALID", field="language")
        return score_lines(code, language.strip().lower(), path)
