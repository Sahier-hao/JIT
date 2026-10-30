"""语义输入契约与嵌入表溯源（CSF-02/CSF-03/CSF-05）。"""
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

from jit_baseline.config import BACKEND


def test_semantic_matrices_follow_declared_mode():
    from jit_baseline.model import feature_matrix
    records = [{"features": [float(index + 1)] * 14, "semantic": [0.1] * 768}
               for index in range(3)]
    fused = feature_matrix(records, "kamei14-semantic-codebert-v1")
    assert fused.shape == (3, 782)
    only = feature_matrix(records, "code-semantic-codebert-v1")
    assert only.shape == (3, 768)
    plain = [{"features": [1, 2, 3, 0.5, 4, 5]} for _ in range(2)]
    assert feature_matrix(plain, "openstack-six-v1").shape == (2, 6)


def test_missing_semantic_vector_is_rejected():
    from jit_baseline.data import BaselineError
    from jit_baseline.model import feature_matrix
    records = [{"features": [1.0] * 14} for _ in range(2)]
    with pytest.raises(BaselineError) as info:
        feature_matrix(records, "kamei14-semantic-codebert-v1")
    assert info.value.code == "FEATURES_INVALID"


def test_semantic_only_pipeline_exposes_declared_input_width():
    from jit_baseline.model import fit_model
    records = [{"features": [1.0] * 14, "semantic": [float((index + column) % 7) for column in range(768)],
                "label": index % 2} for index in range(40)]
    model = fit_model(records, schema="code-semantic-codebert-v1",
                      algorithm="logistic-regression-l2-v1")
    assert model.n_features_in_ == 768
    assert model.named_steps["model"].n_features_in_ == 768


def test_semantic_schema_rejects_textless_dataset():
    from jit_baseline.artifacts import build_run
    from jit_baseline.data import BaselineError
    with pytest.raises(BaselineError) as info:
        build_run(BACKEND / "data/openstack", Path("unused"),
                  schema="kamei14-semantic-codebert-v1")
    assert info.value.code == "DATASET_INVALID"


def write_embedding_table(directory, ids, vectors):
    from jit_baseline.semantic import EMBEDDING_FILE, IDS_FILE, META_FILE
    directory.mkdir(parents=True)
    embeddings = np.asarray(vectors, dtype="float32")
    np.save(directory / EMBEDDING_FILE, embeddings)
    (directory / IDS_FILE).write_text(json.dumps(ids), encoding="utf-8")
    meta = {"model": "fake", "revision": "r1", "dim": embeddings.shape[1],
            "pooling": "mean", "maxLength": 8, "count": len(ids),
            "embeddingsSha256": hashlib.sha256((directory / EMBEDDING_FILE).read_bytes()).hexdigest()}
    (directory / META_FILE).write_text(json.dumps(meta), encoding="utf-8")
    return meta


def test_embedding_table_roundtrip_and_integrity(tmp_path):
    from jit_baseline.data import BaselineError
    from jit_baseline.semantic import EMBEDDING_FILE, load_embeddings
    directory = tmp_path / "emb"
    write_embedding_table(directory, ["a", "b"], [[0.1, 0.2], [0.3, 0.4]])
    table, meta = load_embeddings(directory)
    assert meta["dim"] == 2 and set(table) == {"a", "b"}
    np.save(directory / EMBEDDING_FILE, np.zeros((2, 2), dtype="float32"))
    with pytest.raises(BaselineError) as info:
        load_embeddings(directory)
    assert info.value.code == "INTEGRITY_ERROR"
    with pytest.raises(BaselineError) as info:
        load_embeddings(tmp_path / "missing")
    assert info.value.code == "ARTIFACT_UNAVAILABLE"


def test_embedding_metadata_is_bound_to_schema_and_dataset_text():
    from jit_baseline.data import BaselineError
    from jit_baseline.schemas import get_schema
    from jit_baseline.semantic import validate_embedding_meta
    semantic = get_schema("code-semantic-codebert-v1").semantic
    meta = {**semantic, "count": 1, "embeddingsSha256": "b" * 64, "textSha256": "c" * 64}
    with pytest.raises(BaselineError) as info:
        validate_embedding_meta(meta, semantic, {"sha256": "a" * 64})
    assert info.value.code == "ARTIFACT_INVALID"


def test_scheme_comparison_retains_failed_input(tmp_path):
    from jit_baseline.semantic import compare_schemes
    run = tmp_path / "success"
    run.mkdir()
    (run / "summary.json").write_text(json.dumps({
        "featureSchema": {"name": "expert"}, "datasetVersion": "data-v1",
        "threshold": 0.5, "metrics": {"rocAuc": {"value": 0.5}}}), encoding="utf-8")
    (run / "manifest.json").write_text(json.dumps({
        "runId": "a" * 64, "config": {"metricSet": "metric-set-v2"}}), encoding="utf-8")
    (run / "split.json").write_text(json.dumps({
        "partitions": {"test": {"ids": ["one"], "count": 1}}}), encoding="utf-8")
    report = compare_schemes([run, tmp_path / "failed"])
    assert report["directlyComparable"] is False
    assert report["testCount"] == 1
    assert report["schemes"][1]["failed"] is True
    assert any("运行失败" in reason for reason in report["reasons"])


def test_build_embeddings_writes_meta_with_hashes(tmp_path, monkeypatch):
    from jit_baseline import semantic
    text = tmp_path / "text.jsonl"
    text.write_text("\n".join(json.dumps({"commit_id": identity, "subject": "s", "diff": "d"})
                              for identity in ("a", "b")) + "\n", encoding="utf-8")

    def fake_encode(entries, **kwargs):
        return np.asarray([[0.1, 0.2], [0.3, 0.4]], dtype="float32"), {
            "model": "fake", "revision": "r1", "dim": 2, "pooling": "mean",
            "maxLength": 8, "count": len(entries)}

    monkeypatch.setattr(semantic, "encode_entries", fake_encode)
    meta = semantic.build_embeddings(text, tmp_path / "out")
    assert meta["textSha256"] == hashlib.sha256(text.read_bytes()).hexdigest()
    assert meta["embeddingsSha256"]
    table, loaded = semantic.load_embeddings(tmp_path / "out")
    assert set(table) == {"a", "b"} and loaded["model"] == "fake"
