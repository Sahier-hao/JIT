import json
import sys

import numpy as np
import pytest

from jit_baseline import schemas
from jit_baseline.author_repro.catalog import verify_material
from jit_baseline.author_repro.deepjit import prepare_deepjit_data
from jit_baseline.author_repro.jitline import preprocess_code_line
from jit_baseline.author_repro.kamei import _under_sample
from jit_baseline.author_repro.metrics import line_metrics
from jit_baseline.author_repro.runner import new_run
from jit_baseline.errors import BaselineError
from jit_baseline.ml.collect import _History


def test_v3_rexp_is_non_integer_decay_schema_and_v2_is_unchanged():
    v3 = schemas.resolve("kamei14-git-v3")
    v2 = schemas.resolve("kamei14-git-v2")
    assert v3.by_name("rexp").integer is False
    assert "365.25" in v3.by_name("rexp").reason
    assert v2.by_name("rexp").integer is True
    assert v3.name != v2.name


def test_v3_rexp_uses_decaying_prior_commits_and_excludes_future():
    history = _History()
    history.author_epochs = {
        "author@example.com": [
            1_700_000_000,
            1_700_000_000 + int(365.25 * 86400),
            1_700_000_000 + int(730.5 * 86400),
        ]
    }
    commit = {
        "id": "a" * 40,
        "epoch": 1_700_000_000 + int(365.25 * 86400),
        "subject": "change",
        "author": "Author",
        "email": "author@example.com",
        "files": [{"path": "pkg/a.py", "added": 1, "deleted": 0}],
    }
    metrics = history.features(commit, schema="kamei14-git-v3")
    # One commit is one year old (0.5), one is current (1.0), and the future
    # commit is excluded rather than counted as experience.
    assert metrics["rexp"] == pytest.approx(1.5)
    assert metrics["_negativeAuthorAges"] == 1


def test_v3_rexp_reports_negative_author_age():
    history = _History()
    history.author_epochs = {"a@example.com": [2_000_000_000]}
    commit = {
        "id": "b" * 40, "epoch": 1_000_000_000, "subject": "change",
        "author": "A", "email": "a@example.com",
        "files": [{"path": "a.py", "added": 1, "deleted": 0}],
    }
    metrics = history.features(commit, schema="kamei14-git-v3")
    assert metrics["rexp"] == 0.0
    assert metrics["_negativeAuthorAges"] == 1


def test_material_hash_mismatch_is_explicit(tmp_path):
    material = tmp_path / ".cache" / "author-repro" / "deepjit-3965246" / "openstack_test.pkl"
    material.parent.mkdir(parents=True)
    material.write_bytes(b"not the author file")
    with pytest.raises(BaselineError) as raised:
        verify_material("deepjit-openstack-test", root=tmp_path)
    assert raised.value.code == "AUTHOR_MATERIAL_HASH_MISMATCH"


def test_deepjit_padding_truncates_lowercases_and_pads():
    dictionary = ({"<NULL>": 0, "hello": 1}, {"<NULL>": 0, "x": 2})
    prepared = prepare_deepjit_data(
        ["c1"], [1], ["HELLO " + "word " * 300], [["X " * 600]],
        dictionary, max_lines=2, max_length=4, max_msg_length=3,
    )
    assert prepared["message"].shape == (1, 3)
    assert prepared["code"].shape == (1, 2, 4)
    assert prepared["message"][0].tolist() == [1, 0, 0]
    assert prepared["code"][0][0].tolist() == [2, 2, 2, 2]
    assert prepared["code"][0][1].tolist() == [0, 0, 0, 0]


def test_under_sample_is_balanced_and_deterministic():
    labels = np.array([1, 1, 0, 0, 0, 0])
    first = _under_sample(np.arange(6), labels, 7)
    second = _under_sample(np.arange(6), labels, 7)
    assert first.tolist() == second.tolist()
    assert sorted(labels[first].tolist()) == [0, 0, 1, 1]


def test_jitline_preprocessing_matches_author_substitutions():
    value = preprocess_code_line('if (value["x"] == 42) { self.run(); }')
    assert "42" not in value
    assert "value" in value and "run" in value
    assert "self" not in value


def test_line_metrics_topk_and_budget_are_not_conflated():
    rows = [
        {"commitId": "c1", "path": "a.py", "idx": 0, "label": 0, "lineScore": 0.9},
        {"commitId": "c1", "path": "a.py", "idx": 1, "label": 1, "lineScore": 0.8},
        {"commitId": "c1", "path": "a.py", "idx": 2, "label": 1, "lineScore": 0.7},
        {"commitId": "c2", "path": "b.py", "idx": 0, "label": 1, "lineScore": 0.6},
        {"commitId": "c2", "path": "b.py", "idx": 1, "label": 0, "lineScore": 0.5},
    ]
    result = line_metrics(rows, random_runs=3, seed=11)
    assert result["model"]["topKHitRate"]["top1"] == 0.5
    assert result["model"]["topKHitRate"]["top5"] == 1.0
    assert result["model"]["recallAt20PercentLines"] == pytest.approx(1 / 3)
    assert result["model"]["mrr"] == pytest.approx((1 / 2 + 1) / 2)
    assert result["tieRule"].startswith("score desc")


def test_run_identity_is_stable_for_same_inputs(tmp_path):
    kwargs = dict(
        method="fixture", version="v1", fidelity="interface-only",
        material_hashes={"fixture": "abc"}, config={"x": 1},
        split={"kind": "fixture"}, seed=42, command=["run", "fixture"],
    )
    first = new_run(output=tmp_path / "a", **kwargs)
    second = new_run(output=tmp_path / "b", **kwargs)
    assert first.run_id == second.run_id
    changed = dict(kwargs, material_hashes={"fixture": "different"})
    third = new_run(output=tmp_path / "c", **changed)
    assert third.run_id != first.run_id
    assert json.loads((first.directory / "run.json").read_text(encoding="utf-8"))["schema"] == "author-repro-run-v1"


def test_author_cli_catalog_and_prepare_are_wired(monkeypatch, capsys):
    from jit_baseline import cli

    monkeypatch.setattr(sys, "argv", ["jit_baseline.cli", "author-catalog", "--method", "deepjit"])
    cli.main()
    output = json.loads(capsys.readouterr().out)
    assert output["method"] == "deepjit"
    assert output["entry"]["supportsLine"] is False

    monkeypatch.setattr(sys, "argv", ["jit_baseline.cli", "author-prepare", "--method", "jitline"])
    cli.main()
    output = json.loads(capsys.readouterr().out)
    assert output["schema"] == "author-material-check-v1"
    assert output["available"] is True


def test_author_cli_rejects_unknown_method():
    from jit_baseline import cli

    old = sys.argv
    try:
        sys.argv = ["jit_baseline.cli", "author-run", "--method", "not-a-method"]
        with pytest.raises(SystemExit):
            cli.main()
    finally:
        sys.argv = old
