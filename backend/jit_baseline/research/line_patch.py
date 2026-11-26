"""Parse fixed unified patches into line-level review candidates.

Only complete new-side added lines from source files covered by the frozen
JavaScript/TypeScript line model are eligible. The parser never reads the
working tree or invents missing lines.
"""
from __future__ import annotations

import re
from pathlib import Path

from .line_candidates import _generated_path
from .line_dataset import LANGUAGE, _is_source_path

HUNK = re.compile(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")
SUPPORTED_LANGUAGES = {"javascript", "typescript"}


def source_language(path: str) -> str | None:
    language = LANGUAGE.get(Path(path).suffix.lower())
    return language if language in SUPPORTED_LANGUAGES else None


def _unavailable(status: str) -> str | None:
    lowered = status.lower()
    if lowered in ("deleted", "removed"):
        return "deleted"
    return None


def patch_counts(patch: str | None) -> tuple[int, int]:
    if not isinstance(patch, str):
        return 0, 0
    added = sum(1 for line in patch.splitlines()
                if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in patch.splitlines()
                  if line.startswith("-") and not line.startswith("---"))
    return added, removed


def patch_candidates(
    patch: str | None,
    *,
    path: str,
    status: str,
    patch_complete: bool,
    expected_additions: int | None = None,
) -> dict:
    """Return candidates and a stable coverage status for one file patch."""
    language = source_language(path)
    if language is None:
        return {"status": "unsupported-language", "language": None, "candidates": []}
    if not _is_source_path(path) or _generated_path(path):
        return {"status": "generated-or-skipped-path", "language": language, "candidates": []}
    unavailable = _unavailable(status)
    if unavailable:
        return {"status": unavailable, "language": language, "candidates": []}
    if not patch_complete:
        return {"status": "patch-incomplete", "language": language, "candidates": []}
    if not isinstance(patch, str) or not patch:
        return {"status": "patch-incomplete", "language": language, "candidates": []}

    candidates = []
    next_line = None
    added = 0
    for raw in patch.splitlines():
        hunk = HUNK.match(raw)
        if hunk:
            next_line = int(hunk.group(1))
            continue
        if next_line is None:
            continue
        if raw.startswith("+"):
            text = raw[1:]
            candidates.append({"line": next_line, "text": text})
            next_line += 1
            added += 1
        elif raw.startswith("-") or raw.startswith("\\"):
            continue
        elif raw.startswith(" "):
            next_line += 1
        else:
            next_line = None

    if expected_additions is not None and added != expected_additions:
        return {"status": "patch-incomplete", "language": language, "candidates": []}
    substantive = [item for item in candidates if item["text"].strip()]
    if not substantive:
        return {"status": "no-candidates", "language": language, "candidates": []}
    return {
        "status": "supported",
        "language": language,
        "candidates": substantive,
        "addedLines": len(candidates),
        "skippedBlank": len(candidates) - len(substantive),
    }
