"""Real publisher integration; fixtures are never formal experiment outputs."""
import json
import shutil
from pathlib import Path

import numpy as np
import pytest

from jit_baseline.config import BACKEND


@pytest.fixture(scope="session")
def real_run(tmp_path_factory):
    from jit_baseline.artifacts import build_run
    target = tmp_path_factory.mktemp("real-test-fixture") / "run"
    build_run(BACKEND / "data/openstack", target)
    return target


@pytest.fixture
def copied_run(real_run, tmp_path):
    target = tmp_path / "run"
    shutil.copytree(real_run, target)
    return target


def test_real_manifest_snapshot_and_reference_are_one_context(real_run):
    from jit_baseline.artifacts import Snapshot, verify_run
    manifest = verify_run(real_run)
    snapshot = Snapshot.load(real_run)
    batch = snapshot.batch()
    reference = json.loads((real_run / "reference-predictions.json").read_text(encoding="utf-8"))
    assert len(batch["records"]) == 1853
    assert batch["runId"] == batch["summary"]["runId"] == manifest["runId"]
    assert batch["datasetVersion"] == batch["summary"]["datasetVersion"]
    assert {r["id"] for r in batch["records"]} == {r["id"] for r in reference}
    assert np.max(np.abs([a["risk"] - b["risk"] for a, b in zip(batch["records"], reference, strict=True)])) <= 1e-8
    assert all("label" not in r and "title" not in r and "explanation" not in r for r in batch["records"])
    assert manifest["config"]["features"] == ["ns", "nd", "nf", "ent", "la", "ld"]


def test_service_invokes_loaded_model_and_does_not_read_labels_or_reference(copied_run, monkeypatch):
    from jit_baseline.artifacts import Snapshot
    snapshot = Snapshot.load(copied_run)
    (copied_run / "test-labels.json").unlink()
    (copied_run / "reference-predictions.json").unlink()
    calls = []
    original = snapshot.model.predict_proba
    def tracked(matrix):
        calls.append(matrix.shape)
        return original(matrix)
    monkeypatch.setattr(snapshot.model, "predict_proba", tracked)
    before = {p.name: p.read_bytes() for p in copied_run.iterdir()}
    assert len(snapshot.batch()["records"]) == 1853
    assert calls == [(1853, 6)]
    assert before == {p.name: p.read_bytes() for p in copied_run.iterdir()}
    # Even startup needs no evaluation labels or reference probabilities.
    assert len(Snapshot.load(copied_run).batch()["records"]) == 1853


@pytest.mark.parametrize("filename", ["source.json", "test-input.json", "model.joblib", "summary.json", "manifest.json"])
def test_missing_necessary_artifact_fails(copied_run, filename):
    from jit_baseline.artifacts import Snapshot
    (copied_run / filename).unlink()
    with pytest.raises(ValueError, match="不可用"):
        Snapshot.load(copied_run)


def test_corrupted_model_fails_before_deserialization(copied_run):
    from jit_baseline.artifacts import Snapshot
    with (copied_run / "model.joblib").open("ab") as file:
        file.write(b"bad")
    with pytest.raises(ValueError, match="校验"):
        Snapshot.load(copied_run)


def rewrite_artifact(target, filename, mutate):
    from jit_baseline.artifacts import identity
    from jit_baseline.data import sha256
    path = target / filename
    obj = json.loads(path.read_text(encoding="utf-8"))
    mutate(obj)
    path.write_text(json.dumps(obj), encoding="utf-8")
    manifest = json.loads((target / "manifest.json").read_text(encoding="utf-8"))
    manifest["files"][filename] = sha256(path.read_bytes())
    manifest["config"]["coreFiles"][filename] = manifest["files"][filename]
    manifest["runId"] = identity(manifest["config"])
    summary = json.loads((target / "summary.json").read_text(encoding="utf-8"))
    summary["runId"] = manifest["runId"]
    (target / "summary.json").write_text(json.dumps(summary), encoding="utf-8")
    manifest["files"]["summary.json"] = sha256((target / "summary.json").read_bytes())
    (target / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def test_hashed_but_wrong_feature_order_still_fails(copied_run):
    from jit_baseline.artifacts import Snapshot
    rewrite_artifact(copied_run, "test-input.json", lambda obj: obj["features"].reverse())
    with pytest.raises(ValueError, match="字段"):
        Snapshot.load(copied_run)


def test_hashed_but_partial_input_is_not_a_usable_batch(copied_run):
    from jit_baseline.artifacts import Snapshot
    rewrite_artifact(copied_run, "test-input.json", lambda obj: obj["records"].pop())
    with pytest.raises(ValueError, match="身份|数量"):
        Snapshot.load(copied_run)


def test_model_or_config_change_cannot_reuse_run_identity(real_run):
    from jit_baseline.artifacts import identity
    manifest = json.loads((real_run / "manifest.json").read_text(encoding="utf-8"))
    config = dict(manifest["config"], modelSha256="0" * 64)
    assert identity(config) != manifest["runId"]


def test_run_never_overwrites_existing_output(real_run):
    from jit_baseline.artifacts import build_run
    before = (real_run / "manifest.json").read_bytes()
    with pytest.raises(ValueError, match="已存在"):
        build_run(BACKEND / "data/openstack", real_run)
    assert (real_run / "manifest.json").read_bytes() == before
