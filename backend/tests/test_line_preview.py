"""行级模型研究预览：产物校验、按行打分与接口隔离。"""
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from jit_baseline.api_errors import RequestError, install_errors
from jit_baseline.line_artifact import preview_digest
from jit_baseline.line_preview import (MAX_LINES, install_research_routes,
                                       line_logit, load_model, metadata, score_lines,
                                       score_patch_candidates)

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
    assert result["contributionCaveat"] == "行级特征贡献，不是缺陷原因。"
    assert result["contributionUnit"] == "logit"
    assert all(0 < len(row["contributions"]) <= 3 for row in result["lines"])
    assert all(item["contribution"] != 0
               for row in result["lines"] for item in row["contributions"])
    assert all(item["label"] and item["direction"] in ("increases", "decreases")
               for row in result["lines"] for item in row["contributions"])


def test_contributions_plus_intercept_equal_raw_logit():
    result = score_lines("function f(value: number) {\n  return value + 1\n}\n",
                         "typescript")
    for row in result["lines"]:
        total = result["intercept"] + row["contributionTotal"]
        assert total == pytest.approx(row["logit"], rel=1e-12, abs=1e-12)
        assert row["languageContribution"] == pytest.approx(
            next((item["contribution"] for item in row["contributions"]
                  if item["feature"] == "language:typescript"),
                 row["languageContribution"]),
            rel=1e-12, abs=1e-12,
        )
        displayed = sum(item["contribution"] for item in row["contributions"])
        assert displayed + row["otherContribution"] == pytest.approx(
            row["contributionTotal"], rel=1e-12, abs=1e-12,
        )
        assert row["contributions"] == sorted(
            row["contributions"],
            key=lambda item: (-abs(item["contribution"]), item["feature"]),
        )
        for item in row["contributions"]:
            assert item["contribution"] == pytest.approx(
                item["value"] * item["weight"], rel=1e-12, abs=1e-12,
            )


def test_patch_candidate_scores_match_full_file_for_current_model():
    code = "const a = 1\n\nfunction f(value: number) {\n  return value + 1\n}\n"
    full = {row["line"]: row for row in score_lines(code, "typescript")["lines"]}
    model = load_model(ARTIFACT)
    patch = score_patch_candidates([
        {"line": 1, "text": "const a = 1"},
        {"line": 3, "text": "function f(value: number) {"},
        {"line": 4, "text": "  return value + 1"},
        {"line": 5, "text": "}"},
    ], "typescript", model)
    assert patch["count"] == 4
    for row in patch["lines"]:
        expected = full[row["line"]]
        assert row["score"] == expected["score"]
        assert row["logit"] == pytest.approx(expected["logit"], rel=1e-12, abs=1e-12)
        assert [item["feature"] for item in row["contributions"]] == [
            item["feature"] for item in expected["contributions"]
        ]


def test_language_feature_is_only_added_for_the_active_covered_language():
    typescript = score_lines("const value = 1\n", "typescript")["lines"][0]
    javascript = score_lines("const value = 1\n", "javascript")["lines"][0]
    assert any(item["feature"] == "language:typescript"
               for item in typescript["contributions"])
    assert not any(item["feature"].startswith("language:")
                   for item in javascript["contributions"])
    assert typescript["logit"] != javascript["logit"]


def test_large_finite_logit_contribution_is_valid():
    model = load_model(ARTIFACT)
    model["coefficients"]["lineLength"] = 1_000.0
    row = {
        "text": "const value = 1",
        "indent": 0,
        "blank": False,
        "comment": False,
        "fileLines": 1,
        "lineRatio": 1.0,
    }
    logit, contributions = line_logit(model, row, "typescript")
    line_length = next(item for item in contributions if item["feature"] == "lineLength")
    assert abs(line_length["contribution"]) > 1
    assert pytest.approx(sum(item["contribution"] for item in contributions)
                         + model["intercept"]) == logit


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


def test_blank_lines_are_skipped_without_contributions():
    result = score_lines("const a = 1\n\n\n// note\n", "javascript")
    assert {row["line"] for row in result["lines"]} == {1, 4}
    assert all(row["text"].strip() for row in result["lines"])
    assert result["skippedBlank"] == 2


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
