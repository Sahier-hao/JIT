"""行级模型研究预览：产物校验、按行打分与接口隔离。"""
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from jit_baseline.api_errors import RequestError, install_errors
from jit_baseline.line_artifact import preview_digest
from jit_baseline.line_preview import (MAX_LINES, install_research_routes,
                                       load_model, metadata, score_lines)

ARTIFACT = Path(__file__).resolve().parents[1] / "research" / "line-model-v1.json"


def _app(path=ARTIFACT):
    app = FastAPI()
    install_errors(app)
    install_research_routes(app, path)
    return app


def test_committed_artifact_reports_training_and_holdout_evidence():
    result = metadata()
    assert result["available"] is True
    assert result["languages"] == ["javascript", "typescript"]
    assert result["training"]["samples"] > 0 and result["holdout"]["samples"] > 0
    assert result["holdout"]["repo"] == "axios"
    assert result["metrics"]["prAuc"] > result["metrics"]["randomPrAuc"]
    assert len(result["artifactSha256"]) == 64
    assert result["caveats"] and result["limitations"]


def test_scores_non_blank_lines_and_ranks_them():
    result = score_lines("const a = 1\n\n\nfunction f() {\n  eval('x')\n}\n", "javascript")
    assert result["count"] == 4
    assert result["skippedBlank"] == 2
    scores = [row["score"] for row in result["lines"]]
    assert scores == sorted(scores, reverse=True)
    assert [row["rank"] for row in result["lines"]] == [1, 2, 3, 4]
    assert all(0.0 <= score <= 1.0 for score in scores)


def test_rejects_language_outside_training_coverage():
    with pytest.raises(RequestError) as caught:
        score_lines("def f():\n    return 1\n", "python")
    assert caught.value.code == "LINE_PREVIEW_LANGUAGE"


def test_rejects_empty_and_oversized_input():
    with pytest.raises(RequestError) as empty:
        score_lines(" \n\t\n", "typescript")
    assert empty.value.code == "LINE_PREVIEW_EMPTY"
    with pytest.raises(RequestError) as oversized:
        score_lines("\n".join(f"const v{index} = {index}" for index in range(MAX_LINES + 1)),
                    "typescript")
    assert oversized.value.code == "LINE_PREVIEW_TOO_LARGE"


def test_tampered_artifact_is_unavailable(tmp_path):
    model = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    model["coefficients"]["lineLength"] += 1
    tampered = tmp_path / "tampered.json"
    tampered.write_text(json.dumps(model, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(RequestError) as caught:
        load_model(tampered)
    assert caught.value.code == "LINE_PREVIEW_UNAVAILABLE"


def test_metadata_and_score_routes_use_shared_error_envelope():
    with TestClient(_app()) as client:
        meta = client.get("/api/v1/research/line-model")
        assert meta.status_code == 200
        assert meta.json()["holdout"]["repo"] == "axios"
        ok = client.post("/api/v1/research/line-model/score",
                         json={"language": "typescript", "code": "const a = 1\n"})
        assert ok.status_code == 200
        assert ok.json()["lines"][0]["line"] == 1
        rejected = client.post("/api/v1/research/line-model/score",
                               json={"language": "python", "code": "x = 1"})
        assert rejected.status_code == 422
        assert rejected.json()["error"]["code"] == "LINE_PREVIEW_LANGUAGE"
        assert rejected.json()["error"]["requestId"] == rejected.headers["X-Request-Id"]


def test_artifact_is_self_contained_and_hash_verified():
    model = load_model(ARTIFACT)
    assert model["schema"] == "line-preview-model-v1"
    assert preview_digest(model) == model["artifactSha256"]
