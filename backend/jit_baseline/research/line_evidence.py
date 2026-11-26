"""Compose line-level research evidence for immutable review resources."""
from __future__ import annotations

import math

from ..api_errors import RequestError
from .line_patch import patch_candidates
from .line_preview import CONTRIBUTION_CAVEAT, MAX_CHARS, MAX_LINES, load_model, score_lines

METHOD = "linear-logodds-line-v1"


def _result(
    *,
    status: str,
    reason: str | None,
    source_kind: str,
    resource_id: str,
    repository_id: str | None,
    commit_id: str,
    ref: str,
    path: str,
    side: str,
    language: str | None,
    coverage: dict,
    model: dict | None,
) -> dict:
    return {
        "schema": "line-review-evidence-v1",
        "status": status,
        "reason": reason,
        "sourceKind": source_kind,
        "resourceId": resource_id,
        "repositoryId": repository_id,
        "commitId": commit_id,
        "ref": ref,
        "path": path,
        "side": side,
        "language": language,
        "coverage": coverage,
        "explanationMethod": METHOD,
        "explanationUnit": "logit",
        "contributionCaveat": CONTRIBUTION_CAVEAT,
        "artifactSha256": (model or {}).get("artifactSha256"),
        "intercept": float(model["intercept"]) if model else None,
        "lines": [],
        "caveats": list((model or {}).get("limitations") or []),
    }


def unavailable_line_evidence(
    *,
    status: str,
    reason: str | None,
    source_kind: str,
    resource_id: str,
    repository_id: str | None,
    commit_id: str,
    ref: str,
    path: str,
    side: str,
) -> dict:
    return _result(
        status=status,
        reason=reason,
        source_kind=source_kind,
        resource_id=resource_id,
        repository_id=repository_id,
        commit_id=commit_id,
        ref=ref,
        path=path,
        side=side,
        language=None,
        coverage={
            "patchComplete": False,
            "status": status,
            "addedLines": None,
            "eligibleLines": 0,
            "skippedBlank": None,
        },
        model=None,
    )


def build_line_evidence(
    *,
    source_kind: str,
    resource_id: str,
    repository_id: str | None,
    commit_id: str,
    ref: str,
    path: str,
    side: str,
    patch: str | None,
    patch_status: str,
    patch_complete: bool,
    expected_additions: int | None,
    code: str | None,
    content_complete: bool,
    content_absent: bool = False,
    model_path=None,
) -> dict:
    parsed = patch_candidates(
        patch,
        path=path,
        status=patch_status,
        patch_complete=patch_complete,
        expected_additions=expected_additions,
    )
    coverage = {
        "patchComplete": patch_complete,
        "status": parsed["status"],
        "addedLines": parsed.get("addedLines"),
        "eligibleLines": len(parsed["candidates"]),
        "skippedBlank": parsed.get("skippedBlank"),
    }
    base = dict(
        source_kind=source_kind,
        resource_id=resource_id,
        repository_id=repository_id,
        commit_id=commit_id,
        ref=ref,
        path=path,
        side=side,
        language=parsed.get("language"),
        coverage=coverage,
    )
    if parsed["status"] != "supported":
        return _result(status=parsed["status"], reason=parsed["status"], model=None, **base)
    if content_absent or not content_complete or not isinstance(code, str):
        return _result(
            status="content-unavailable",
            reason="content-absent" if content_absent else "content-incomplete",
            model=None,
            **base,
        )
    if len(code) > MAX_CHARS or len(code.splitlines()) > MAX_LINES:
        return _result(
            status="content-unavailable",
            reason="content-too-large",
            model=None,
            **base,
        )
    try:
        model = load_model(model_path)
        scored = score_lines(code, parsed["language"], model_path)
    except RequestError as exc:
        status = "model-unavailable" if exc.code == "LINE_PREVIEW_UNAVAILABLE" else "content-unavailable"
        return _result(status=status, reason=exc.code, model=None, **base)
    wanted = {item["line"]: item for item in parsed["candidates"]}
    rows = []
    for item in scored["lines"]:
        if item["line"] not in wanted:
            continue
        contributions = item.get("contributions") or []
        values = [
            item["score"], item.get("logit"), item.get("languageContribution"),
            item.get("contributionTotal"), item.get("otherContribution"),
        ]
        if not all(isinstance(value, (int, float)) and math.isfinite(value)
                   for value in values):
            return _result(
                status="content-unavailable",
                reason="non-finite-contribution",
                model=model,
                **base,
            )
        if not all(math.isfinite(value["contribution"]) for value in contributions):
            return _result(
                status="content-unavailable",
                reason="non-finite-contribution",
                model=model,
                **base,
            )
        rows.append({
            "path": path,
            "side": side,
            "line": item["line"],
            "text": item["text"],
            "score": item["score"],
            "logit": item["logit"],
            "languageContribution": item["languageContribution"],
            "contributions": contributions,
            "contributionTotal": item["contributionTotal"],
            "otherContribution": item["otherContribution"],
        })
    if len(rows) != len(wanted):
        return _result(
            status="content-unavailable",
            reason="candidate-line-missing",
            model=model,
            **base,
        )
    rows.sort(key=lambda item: (-item["score"], item["line"]))
    for rank, row in enumerate(rows, 1):
        row["rank"] = rank
    result = _result(status="supported", reason=None, model=model, **base)
    result["lines"] = rows
    result["caveats"] = list(scored["caveats"])
    return result
