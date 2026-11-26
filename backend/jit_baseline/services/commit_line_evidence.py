"""Fixed-commit line evidence backed by immutable GitHub commit content."""
from __future__ import annotations

import base64
import re
from pathlib import Path
from urllib.parse import quote

from ..errors import BaselineError
from ..research.line_evidence import build_line_evidence, unavailable_line_evidence
from ..research.line_dataset import _git
from ..research.line_patch import patch_counts
from .pr_review import github_request, github_source

SHA = re.compile(r"^[a-f0-9]{40,64}$")


def _file_from_commit(commit, path):
    for item in commit.get("files") or []:
        if item.get("filename") == path:
            return item
    return None


def _content(request, repository, path, ref):
    data = request(
        f'/repos/{repository}/contents/{quote(path, safe="/")}?ref={quote(ref, safe="")}'
    )
    if data.get("type") != "file" or data.get("encoding") != "base64":
        return None
    if not isinstance(data.get("size"), int) or data["size"] < 0 or data["size"] > 1_048_576:
        return None
    try:
        content = base64.b64decode(data["content"]).decode("utf-8")
    except (KeyError, TypeError, ValueError, UnicodeError):
        return None
    return None if "\0" in content else content


def commit_line_evidence(
    repository,
    commit_id,
    path,
    *,
    request=github_request,
    model_path=None,
    allow_local=False,
):
    repository_id = repository.get("repositoryId")
    repository_url = repository.get("url")
    if not isinstance(commit_id, str) or not SHA.fullmatch(commit_id):
        raise BaselineError("INPUT_INVALID", "提交标识必须是完整 Git SHA")
    if allow_local and not str(repository_url or "").startswith("https://github.com/"):
        root = Path(repository_url or "")
        if root.is_dir():
            if _git(root, ["cat-file", "-e", f"{commit_id}^{{commit}}"]) is None:
                return unavailable_line_evidence(
                    status="source-unavailable",
                    reason="commit-not-found",
                    source_kind="repository-commit",
                    resource_id=repository_id or repository_url or "",
                    repository_id=repository_id,
                    commit_id=commit_id,
                    ref=commit_id,
                    path=path,
                    side="head",
                )
            patch = _git(
                root,
                [
                    "show", "--format=", "--no-color", "--unified=0",
                    "--find-renames=50%", "--find-copies=50%", commit_id, "--", path,
                ],
                timeout=120,
            )
            content = _git(root, ["show", f"{commit_id}:{path}"], timeout=120)
            lowered = patch or ""
            status = (
                "added" if "new file mode" in lowered
                else "deleted" if "deleted file mode" in lowered
                else "renamed" if "rename from " in lowered
                else "modified"
            )
            added, _ = patch_counts(patch)
            return build_line_evidence(
                source_kind="repository-commit",
                resource_id=repository_id or repository_url or "",
                repository_id=repository_id,
                commit_id=commit_id,
                ref=commit_id,
                path=path,
                side="head",
                patch=patch,
                patch_status=status,
                patch_complete=patch is not None,
                expected_additions=added if patch is not None else None,
                code=content,
                content_complete=content is not None,
                content_absent=False,
                model_path=model_path,
            )
    try:
        owner, name, number = github_source(repository_url)
    except BaselineError:
        owner = name = ""
        number = 1
    if number or not owner or not name:
        return unavailable_line_evidence(
            status="source-unavailable",
            reason="unsupported-repository-source",
            source_kind="repository-commit",
            resource_id=repository_id or repository_url or "",
            repository_id=repository_id,
            commit_id=commit_id,
            ref=commit_id,
            path=path,
            side="head",
        )
    slug = f"{owner}/{name}"
    try:
        commit = request(f'/repos/{slug}/commits/{quote(commit_id, safe="")}')
    except BaselineError as exc:
        return unavailable_line_evidence(
            status="source-unavailable",
            reason=exc.code,
            source_kind="repository-commit",
            resource_id=repository_id or repository_url or "",
            repository_id=repository_id,
            commit_id=commit_id,
            ref=commit_id,
            path=path,
            side="head",
        )
    if not isinstance(commit, dict) or commit.get("sha") != commit_id:
        return unavailable_line_evidence(
            status="source-unavailable",
            reason="commit-identity-mismatch",
            source_kind="repository-commit",
            resource_id=repository_id or repository_url or "",
            repository_id=repository_id,
            commit_id=commit_id,
            ref=commit_id,
            path=path,
            side="head",
        )
    file = _file_from_commit(commit, path)
    if file is None:
        return unavailable_line_evidence(
            status="patch-incomplete",
            reason="file-not-in-fixed-commit",
            source_kind="repository-commit",
            resource_id=repository_id or repository_url or "",
            repository_id=repository_id,
            commit_id=commit_id,
            ref=commit_id,
            path=path,
            side="head",
        )
    patch = file.get("patch")
    added, removed = patch_counts(patch)
    complete = (
        isinstance(patch, str)
        and added == file.get("additions")
        and removed == file.get("deletions")
    )
    content = None
    if complete:
        try:
            content = _content(request, slug, path, commit_id)
        except BaselineError:
            content = None
    return build_line_evidence(
        source_kind="repository-commit",
        resource_id=repository_id or repository_url or "",
        repository_id=repository_id,
        commit_id=commit_id,
        ref=commit_id,
        path=path,
        side="head",
        patch=patch,
        patch_status=file.get("status") or "modified",
        patch_complete=complete,
        expected_additions=file.get("additions"),
        code=content,
        content_complete=content is not None,
        content_absent=False,
        model_path=model_path,
    )
