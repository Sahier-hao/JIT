"""Freeze and integrity checks for archived verification evidence."""
import json

import pytest


def workspace(tmp_path):
    """A run workspace shaped like the real one: evidence plus a fixtures subtree."""
    run = tmp_path / "run"
    (run / "screenshots").mkdir(parents=True)
    (run / "fixtures").mkdir()
    (run / "verification.json").write_text('{"success": true}', encoding="utf-8")
    (run / "screenshots" / "desktop-1280-list.png").write_bytes(b"png")
    (run / "fixtures" / "runtime-context-fixture-batch.json").write_text('{"records": []}', encoding="utf-8")
    return run


def test_freeze_copies_evidence_and_excludes_run_fixtures(tmp_path):
    from jit_baseline import evidence
    run = workspace(tmp_path)
    target = tmp_path / "archive"
    manifest = evidence.freeze(target, run)
    assert manifest["copiedFromWorkspace"] == ["screenshots/desktop-1280-list.png", "verification.json"]
    assert manifest["excluded"] == ["fixtures/"]
    assert not (target / "fixtures").exists()
    assert (target / "screenshots" / "desktop-1280-list.png").read_bytes() == b"png"
    assert {entry["path"] for entry in manifest["files"]} == {"screenshots/desktop-1280-list.png", "verification.json"}
    assert all(len(entry["sha256"]) == 64 for entry in manifest["files"])
    assert manifest["frozenUtc"] and manifest["sourceRunId"]


def test_check_passes_on_an_untouched_freeze(tmp_path):
    from jit_baseline import evidence
    target = tmp_path / "archive"
    evidence.freeze(target, workspace(tmp_path))
    result = evidence.check(target)
    assert result["passed"] is True and result["problems"] == [] and result["listedCount"] == 2


def test_check_reports_a_modified_file(tmp_path):
    from jit_baseline import evidence
    target = tmp_path / "archive"
    evidence.freeze(target, workspace(tmp_path))
    (target / "verification.json").write_text('{"success": false}', encoding="utf-8")
    result = evidence.check(target)
    assert result["passed"] is False
    assert {"path": "verification.json", "kind": "modified"} in result["problems"]


def test_check_reports_a_missing_file(tmp_path):
    from jit_baseline import evidence
    target = tmp_path / "archive"
    evidence.freeze(target, workspace(tmp_path))
    (target / "screenshots" / "desktop-1280-list.png").unlink()
    result = evidence.check(target)
    assert result["passed"] is False
    assert {"path": "screenshots/desktop-1280-list.png", "kind": "missing"} in result["problems"]


def test_check_reports_an_unlisted_addition(tmp_path):
    from jit_baseline import evidence
    target = tmp_path / "archive"
    evidence.freeze(target, workspace(tmp_path))
    (target / "smuggled.json").write_text("{}", encoding="utf-8")
    result = evidence.check(target)
    assert result["passed"] is False
    assert {"path": "smuggled.json", "kind": "unlisted"} in result["problems"]


@pytest.mark.parametrize("drop", ["frozenUtc", "sourceRunId"])
def test_check_rejects_a_manifest_without_source_information(tmp_path, drop):
    from jit_baseline import evidence
    target = tmp_path / "archive"
    evidence.freeze(target, workspace(tmp_path))
    manifest_path = target / evidence.MANIFEST_NAME
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.pop(drop)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    result = evidence.check(target)
    assert result["passed"] is False
    assert {"path": evidence.MANIFEST_NAME, "kind": "incomplete-manifest"} in result["problems"]


def test_check_reports_a_missing_manifest(tmp_path):
    from jit_baseline import evidence
    empty = tmp_path / "archive"
    empty.mkdir()
    with pytest.raises(OSError):
        evidence.check(empty)


def test_freeze_keeps_files_it_did_not_include_and_is_reproducible(tmp_path):
    from jit_baseline import evidence
    run = workspace(tmp_path)
    target = tmp_path / "archive"
    (target).mkdir()
    (target / "acceptance.md").write_text("hand-written record", encoding="utf-8")
    first = evidence.freeze(target, run)
    assert (target / "acceptance.md").read_text(encoding="utf-8") == "hand-written record"
    assert "acceptance.md" in {entry["path"] for entry in first["files"]}
    second = evidence.freeze(target, run)
    assert second["sourceRunId"] == first["sourceRunId"]
    assert second["files"] == first["files"]
    assert evidence.check(target)["passed"] is True
