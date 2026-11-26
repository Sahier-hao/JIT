from jit_baseline.research.line_patch import patch_candidates, source_language


def test_parses_added_and_modified_new_side_lines():
    patch = "@@ -2,2 +2,3 @@\n context\n-old\n+new\n+extra\n"
    result = patch_candidates(
        patch, path="src/tool.ts", status="modified",
        patch_complete=True, expected_additions=2,
    )
    assert result["status"] == "supported"
    assert result["language"] == "typescript"
    assert result["candidates"] == [
        {"line": 3, "text": "new"},
        {"line": 4, "text": "extra"},
    ]


def test_added_file_and_rename_use_new_path():
    added = patch_candidates(
        "@@ -0,0 +1,2 @@\n+const a = 1\n+\n",
        path="src/new.js", status="added", patch_complete=True,
    )
    renamed = patch_candidates(
        "@@ -1 +1 @@\n-old\n+new\n",
        path="src/renamed.tsx", status="renamed", patch_complete=True,
    )
    assert added["status"] == renamed["status"] == "supported"
    assert added["skippedBlank"] == 1
    assert renamed["language"] == "typescript"


def test_rejects_deleted_binary_incomplete_and_generated_paths():
    deleted = patch_candidates(
        None, path="src/a.ts", status="deleted", patch_complete=False,
    )
    binary = patch_candidates(
        None, path="src/a.ts", status="modified", patch_complete=False,
    )
    incomplete = patch_candidates(
        "@@ -1 +1 @@\n-old\n+new\n",
        path="src/a.ts", status="modified", patch_complete=False,
    )
    generated = patch_candidates(
        "@@ -1 +1 @@\n-old\n+new\n",
        path="dist/bundle.js", status="modified", patch_complete=True,
    )
    assert deleted["status"] == "deleted"
    assert binary["status"] == incomplete["status"] == "patch-incomplete"
    assert generated["status"] == "generated-or-skipped-path"


def test_counts_mismatch_is_incomplete_and_missing_hunk_has_no_candidates():
    mismatch = patch_candidates(
        "@@ -1 +1 @@\n-old\n+new\n",
        path="src/a.ts", status="modified", patch_complete=True, expected_additions=2,
    )
    no_hunk = patch_candidates(
        "Binary files a/a.ts and b/a.ts differ\n",
        path="src/a.ts", status="modified", patch_complete=True,
    )
    assert mismatch["status"] == "patch-incomplete"
    assert no_hunk["status"] == "no-candidates"


def test_language_and_path_coverage_is_explicit():
    assert source_language("src/a.tsx") == "typescript"
    assert source_language("src/a.mjs") == "javascript"
    assert source_language("src/a.py") is None
    unsupported = patch_candidates(
        "@@ -1 +1 @@\n-old\n+new\n",
        path="src/a.py", status="modified", patch_complete=True,
    )
    skipped = patch_candidates(
        "@@ -1 +1 @@\n-old\n+new\n",
        path="tests/a.ts", status="modified", patch_complete=True,
    )
    assert unsupported["status"] == "unsupported-language"
    assert skipped["status"] == "generated-or-skipped-path"
