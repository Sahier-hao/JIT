"""JIT-Fine controlled adapter tests with synthetic frames; not benchmark results."""
from datetime import datetime, timezone

import pandas as pd
import pytest


def frame(rows=4, start=1_600_000_000):
    values = []
    for index in range(rows):
        values.append({
            "project": "project-a", "parent_hashes": "a" * 40,
            "commit_hash": f"{index + 1:040x}",
            "author_name": "Author", "author_email": "author@example.com",
            "author_date": datetime.fromtimestamp(start + index * 86400, timezone.utc).ctime(),
            "author_date_unix_timestamp": str(start + index * 86400),
            "commit_message": "message", "la": "5", "ld": "2", "fileschanged": "1",
            "nf": "1", "ns": "1", "nd": "1", "entropy": "0.5", "ndev": "1",
            "lt": "12.5", "nuc": "1", "age": "3.5", "exp": "2", "rexp": "1.5",
            "sexp": "1", "classification": None, "fix": bool(index % 2),
            "is_buggy_commit": float(index % 2),
        })
    return pd.DataFrame(values)


def small_splits(monkeypatch):
    from jit_baseline import benchmark
    frames = {"train": frame(4, 1_600_000_000), "valid": frame(4, 1_600_400_000),
              "test": frame(4, 1_600_800_000)}
    for index, value in enumerate(frames.values()):
        value["commit_hash"] = [f"{index * 100 + n + 1:040x}" for n in range(4)]
    monkeypatch.setattr(benchmark, "SPLITS", {
        split: (f"data/{split}.pkl", str(index + 1) * 64, 4)
        for index, split in enumerate(("train", "valid", "test"))
    })
    monkeypatch.setattr(benchmark, "MIN_ROWS", 10)
    monkeypatch.setattr(benchmark, "MIN_POSITIVES", 2)
    return frames


def test_jit_fine_normalizes_commit_rows_and_excludes_negative_fields(monkeypatch):
    from jit_baseline import benchmark
    frames = small_splits(monkeypatch)
    frames["train"].loc[0, "lt"] = -1.0
    rows, source = benchmark.normalize_jit_fine_frames(frames)
    assert len(rows) == 11
    assert source["sourceRows"] == 12
    assert source["excludedRows"] == 1
    assert source["excludedByField"]["lt"] == 1
    assert source["sampleUnit"] == "commit"
    assert all(list(row)[:4] == ["commit_id", "author_date", "bugcount", "project"] for row in rows)
    assert all(sum(key in benchmark.FEATURE_FIELDS for key in row) == 14 for row in rows)


@pytest.mark.parametrize("mutate,message", [
    (lambda data: data.rename(columns={"lt": "unknown"}), "列结构"),
    (lambda data: data.assign(is_buggy_commit=2.0), "标签"),
    (lambda data: data.assign(rexp=None), "缺失"),
    (lambda data: data.assign(author_date_unix_timestamp="bad"), "author_date"),
])
def test_jit_fine_rejects_invalid_source_contract(monkeypatch, mutate, message):
    from jit_baseline import benchmark
    from jit_baseline.data import BaselineError
    frames = small_splits(monkeypatch)
    frames["train"] = mutate(frames["train"])
    with pytest.raises(BaselineError, match=message) as info:
        benchmark.normalize_jit_fine_frames(frames)
    assert info.value.code == "DATA_INVALID"


def test_jit_fine_rejects_cross_split_duplicate(monkeypatch):
    from jit_baseline import benchmark
    from jit_baseline.data import BaselineError
    frames = small_splits(monkeypatch)
    frames["test"].loc[0, "commit_hash"] = frames["train"].loc[0, "commit_hash"]
    with pytest.raises(BaselineError, match="重复") as info:
        benchmark.normalize_jit_fine_frames(frames)
    assert info.value.code == "DATA_INVALID"


def test_import_writes_and_registers_then_is_idempotent(tmp_path, monkeypatch):
    from jit_baseline import benchmark
    frames = small_splits(monkeypatch)
    monkeypatch.setattr(benchmark, "read_jit_fine_frames", lambda _path: frames)
    csv_path = tmp_path / "collected" / "jit-fine.csv"
    first = benchmark.import_jit_fine("unused.zip", csv_path, root=tmp_path / "registry")
    second = benchmark.import_jit_fine("unused.zip", csv_path, root=tmp_path / "registry")
    assert first["csvSha256"] == second["csvSha256"]
    assert csv_path.is_file()
    assert (tmp_path / "registry" / first["dataset"] / f"{first['version']}.json").is_file()


def test_import_rejects_existing_csv_with_different_content(tmp_path, monkeypatch):
    from jit_baseline import benchmark
    from jit_baseline.data import BaselineError
    frames = small_splits(monkeypatch)
    monkeypatch.setattr(benchmark, "read_jit_fine_frames", lambda _path: frames)
    csv_path = tmp_path / "collected" / "jit-fine.csv"
    benchmark.import_jit_fine("unused.zip", csv_path, root=tmp_path / "registry")
    before = csv_path.read_bytes()
    csv_path.write_bytes(before + b"different\n")
    with pytest.raises(BaselineError) as info:
        benchmark.import_jit_fine("unused.zip", csv_path, root=tmp_path / "registry")
    assert info.value.code == "DATASET_EXISTS"
    assert csv_path.read_bytes() == before + b"different\n"


def test_import_removes_new_csv_if_registration_fails(tmp_path, monkeypatch):
    from jit_baseline import benchmark, datasets
    from jit_baseline.data import BaselineError
    frames = small_splits(monkeypatch)
    monkeypatch.setattr(benchmark, "read_jit_fine_frames", lambda _path: frames)
    monkeypatch.setattr(datasets, "register",
                        lambda *args, **kwargs: (_ for _ in ()).throw(
                            BaselineError("DATASET_EXISTS", "conflict")))
    csv_path = tmp_path / "out.csv"
    with pytest.raises(BaselineError):
        benchmark.import_jit_fine("unused.zip", csv_path)
    assert not csv_path.exists()


def test_archive_hash_mismatch_is_rejected_before_pickle_read(tmp_path):
    from jit_baseline import benchmark
    from jit_baseline.data import BaselineError
    path = tmp_path / "data.zip"
    path.write_bytes(b"not the pinned archive")
    with pytest.raises(BaselineError) as info:
        benchmark.read_jit_fine_frames(path)
    assert info.value.code == "INTEGRITY_ERROR"
