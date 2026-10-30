"""Controlled import of the audited JIT-Fine 14-dimensional benchmark."""
import csv
import hashlib
import io
import os
import warnings
import zipfile
from pathlib import Path

import numpy as np

from . import datasets
from .data import BaselineError
from .model import temporal_split

ADAPTER = "jit-fine-v1"
DATASET_NAME = "jit-fine-kamei14"
SCHEMA_NAME = "kamei14-benchmark-v1"
SOURCE_REPOSITORY = "https://github.com/jacknichao/JIT-Fine"
SOURCE_REVISION = "584799fdec6095ab75a45fd2a5f8db5b12163aa5"
SOURCE_BLOB_SHA1 = "6cd2f45d97a7c430533cde382be6bf42d9ff3649"
SOURCE_ARCHIVE_SHA256 = "9e5ca1a393b70ee7e87c410b162005958775f3f3732f9f83da9dd24a7dfe2b47"
SOURCE_LICENSE = "NOASSERTION"
MIN_ROWS = 5000
MIN_POSITIVES = 500

FEATURE_FIELDS = (
    "ns", "nd", "nf", "entropy", "la", "ld", "lt", "fix",
    "ndev", "age", "nuc", "exp", "rexp", "sexp",
)
INTEGER_FIELDS = frozenset(("ns", "nd", "nf", "la", "ld", "ndev", "nuc"))
SOURCE_COLUMNS = frozenset((
    "project", "parent_hashes", "commit_hash", "author_name", "author_email",
    "author_date", "author_date_unix_timestamp", "commit_message", "la", "ld",
    "fileschanged", "nf", "ns", "nd", "entropy", "ndev", "lt", "nuc", "age",
    "exp", "rexp", "sexp", "classification", "fix", "is_buggy_commit",
))
SPLITS = {
    "train": ("data/jitfine/features_train.pkl",
              "0b9992d77cd07f45a71bd327a3d408ed3f0ab7a907ffdc10f9916a8f226dc42a", 16374),
    "valid": ("data/jitfine/features_valid.pkl",
              "e2ee48d5cd9e7f59bea726d4f6a71ef58712ae58d3388d8195a798369cf0d2cf", 5465),
    "test": ("data/jitfine/features_test.pkl",
             "136eebbb1c1719bffbfed8f0d686e3c015c5756a7b3c43d6f700a07687ab58fa", 5480),
}
LABEL = {
    "kind": "jit-fine-is-buggy-commit",
    "rule": "is_buggy_commit in {0, 1}; transported as bugcount only for the canonical CSV contract",
    "sourceColumn": "is_buggy_commit",
    "limitations": [
        "标签来自 JIT-Fine 发布数据，未在本项目重新执行 SZZ。",
        "JIT-Fine 仓库未声明许可证，原始与规范化数据不随仓库分发。",
    ],
}


def _sha256(blob):
    return hashlib.sha256(blob).hexdigest()


def _frame_bytes(frames):
    """Serialize canonical rows deterministically."""
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=("commit_id", "author_date", "bugcount", "project", *FEATURE_FIELDS),
                            lineterminator="\n")
    writer.writeheader()
    for row in frames:
        writer.writerow(row)
    return stream.getvalue().encode("utf-8")


def _bool01(value):
    if isinstance(value, (bool, np.bool_)):
        return int(value)
    if isinstance(value, (int, float, np.integer, np.floating)) and float(value) in (0.0, 1.0):
        return int(value)
    text = str(value).strip().lower()
    if text in ("true", "1", "1.0"):
        return 1
    if text in ("false", "0", "0.0"):
        return 0
    return None


def normalize_jit_fine_frames(frames):
    """Validate and normalize the three published JIT-Fine feature frames."""
    import pandas as pd

    if set(frames) != set(SPLITS):
        raise BaselineError("DATA_INVALID", "JIT-Fine 必须同时包含 train、valid、test 三个分区")
    checked = []
    member_hashes = {}
    for split, expected in SPLITS.items():
        frame = frames[split]
        if not isinstance(frame, pd.DataFrame):
            raise BaselineError("DATA_INVALID", f"JIT-Fine {split} 不是 DataFrame")
        if len(frame) != expected[2]:
            raise BaselineError("DATA_INVALID", f"JIT-Fine {split} 行数与适配器声明不一致")
        if len(frame.columns) != len(set(frame.columns)) or set(frame.columns) != SOURCE_COLUMNS:
            raise BaselineError("DATA_INVALID", f"JIT-Fine {split} 列结构未知或重复")
        checked.append(frame.copy())

    data = pd.concat(checked, ignore_index=True)
    if data["commit_hash"].astype(str).duplicated().any():
        raise BaselineError("DATA_INVALID", "JIT-Fine 含跨分区重复 commit_hash")
    if not data["commit_hash"].astype(str).str.fullmatch(r"[0-9a-f]{40}").all():
        raise BaselineError("DATA_INVALID", "JIT-Fine 含无效 commit_hash")
    if data["project"].isna().any() or (data["project"].astype(str).str.strip() == "").any():
        raise BaselineError("DATA_INVALID", "JIT-Fine 含无效 project")
    epochs = pd.to_numeric(data["author_date_unix_timestamp"], errors="coerce")
    if epochs.isna().any() or (~np.isfinite(epochs.to_numpy())) .any() or (epochs <= 0).any():
        raise BaselineError("DATA_INVALID", "JIT-Fine 含无效 author_date_unix_timestamp")
    labels = pd.to_numeric(data["is_buggy_commit"], errors="coerce")
    if labels.isna().any() or not set(labels.astype(float).unique()).issubset({0.0, 1.0}):
        raise BaselineError("DATA_INVALID", "JIT-Fine 标签只能是 0 或 1")
    fixes = data["fix"].map(_bool01)
    if fixes.isna().any():
        raise BaselineError("DATA_INVALID", "JIT-Fine fix 只能是布尔值或 0/1")

    numeric, invalid_fields = {}, {}
    for field in FEATURE_FIELDS:
        if field == "fix":
            numeric[field] = fixes.astype(float)
            continue
        values = data[field]
        if values.isna().any() or (values.astype(str).str.strip() == "").any():
            raise BaselineError("DATA_INVALID", f"JIT-Fine 字段 {field} 含缺失值")
        values = pd.to_numeric(values, errors="coerce")
        if values.isna().any() or (~np.isfinite(values.to_numpy(dtype=float))).any():
            raise BaselineError("DATA_INVALID", f"JIT-Fine 字段 {field} 含非数值或非有限值")
        if field in INTEGER_FIELDS and (np.abs(values - np.round(values)) > 1e-9).any():
            raise BaselineError("DATA_INVALID", f"JIT-Fine 字段 {field} 违反整数约束")
        numeric[field] = values.astype(float)
        invalid_fields[field] = int((values < 0).sum())

    invalid = np.zeros(len(data), dtype=bool)
    for values in numeric.values():
        invalid |= (values.to_numpy(dtype=float) < 0)
    valid = data.loc[~invalid].copy()
    if valid.empty:
        raise BaselineError("DATA_INVALID", "JIT-Fine 规范化后没有有效记录")
    if len(valid) < MIN_ROWS or int((labels.loc[valid.index] == 1).sum()) < MIN_POSITIVES:
        raise BaselineError("DATA_INVALID", "JIT-Fine 规范化后不满足大型基准样本门槛")

    rows = []
    for index, row in valid.iterrows():
        normalized = {
            "commit_id": str(row["commit_hash"]),
            "author_date": str(int(epochs.loc[index])),
            "bugcount": str(int(labels.loc[index])),
            "project": str(row["project"]),
        }
        for field in FEATURE_FIELDS:
            value = numeric[field].loc[index]
            normalized[field] = str(int(value)) if field in INTEGER_FIELDS or field == "fix" else repr(float(value))
        rows.append(normalized)
    rows.sort(key=lambda row: (int(row["author_date"]), row["commit_id"]))

    split_records = [{"id": row["commit_id"], "epoch": int(row["author_date"]),
                      "label": int(row["bugcount"])} for row in rows]
    try:
        temporal_split(split_records)
    except BaselineError as exc:
        raise BaselineError("DATA_INVALID", f"JIT-Fine 无法形成有效时间切分：{exc}") from exc

    for split, (member, expected_hash, _) in SPLITS.items():
        member_hashes[member] = expected_hash
    return rows, {
        "adapter": ADAPTER,
        "sourceRepository": SOURCE_REPOSITORY,
        "sourceRevision": SOURCE_REVISION,
        "sourceBlobSha1": SOURCE_BLOB_SHA1,
        "sourceArchiveSha256": SOURCE_ARCHIVE_SHA256,
        "memberSha256": member_hashes,
        "license": SOURCE_LICENSE,
        "sampleUnit": "commit",
        "sourceRows": len(data),
        "normalizedRows": len(rows),
        "positiveRows": sum(int(row["bugcount"]) for row in rows),
        "projects": sorted({row["project"] for row in rows}),
        "excludedRows": int(invalid.sum()),
        "excludedByField": {field: count for field, count in invalid_fields.items() if count},
    }


def read_jit_fine_frames(archive_path):
    """Verify the pinned archive and member hashes, then load its feature frames."""
    import pandas as pd

    archive_path = Path(archive_path)
    try:
        archive_bytes = archive_path.read_bytes()
    except OSError as exc:
        raise BaselineError("SOURCE_UNAVAILABLE", f"JIT-Fine 数据包不可用：{archive_path.name}") from exc
    if _sha256(archive_bytes) != SOURCE_ARCHIVE_SHA256:
        raise BaselineError("INTEGRITY_ERROR", "JIT-Fine 数据包 SHA-256 与固定来源不一致")
    frames = {}
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            for split, (member, expected_hash, expected_rows) in SPLITS.items():
                raw = archive.read(member)
                if _sha256(raw) != expected_hash:
                    raise BaselineError("INTEGRITY_ERROR", f"JIT-Fine 成员校验失败：{member}")
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", DeprecationWarning)
                    frames[split] = pd.read_pickle(io.BytesIO(raw))
                if len(frames[split]) != expected_rows:
                    raise BaselineError("DATA_INVALID", f"JIT-Fine {split} 行数与固定来源不一致")
    except (OSError, KeyError, zipfile.BadZipFile) as exc:
        raise BaselineError("SOURCE_INVALID", f"JIT-Fine 数据包结构无效：{exc}") from exc
    return frames


def import_jit_fine(archive_path, csv_path, *, dataset=DATASET_NAME, version=None, root=None):
    """Normalize JIT-Fine, atomically publish CSV, and register its manifest."""
    frames = read_jit_fine_frames(archive_path)
    rows, source = normalize_jit_fine_frames(frames)
    blob = _frame_bytes(rows)
    output = Path(csv_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    created = False
    if output.exists():
        try:
            existing = output.read_bytes()
        except OSError as exc:
            raise BaselineError("DATASET_UNAVAILABLE", f"规范化 CSV 不可读：{output.name}") from exc
        if existing != blob:
            raise BaselineError("DATASET_EXISTS", f"规范化 CSV 已存在且内容不同：{output.name}")
    else:
        temporary = output.with_name(output.name + f".{os.getpid()}.tmp")
        try:
            temporary.write_bytes(blob)
            os.replace(temporary, output)
            created = True
        finally:
            temporary.unlink(missing_ok=True)

    min_epoch = min(int(row["author_date"]) for row in rows)
    max_epoch = max(int(row["author_date"]) for row in rows)
    max_churn = max(int(row["la"]) + int(row["ld"]) for row in rows)
    max_files = max(int(row["nf"]) for row in rows)
    cohort = {"startEpochInclusive": min_epoch, "endEpochExclusive": max_epoch + 1,
              "addedLinesGreaterThan": 0, "maxChurnInclusive": max_churn,
              "maxFilesInclusive": max_files}
    extra = {"benchmark": source, "label": LABEL, "labelRule": LABEL["rule"]}
    try:
        registered = datasets.register(
            output, schema=SCHEMA_NAME, dataset=dataset, version=version, root=root,
            cohort=cohort, provenance={
                "publisher": "JIT-Fine / JIT-Defect4J",
                "revision": SOURCE_REVISION,
                "url": SOURCE_REPOSITORY,
                "citation": "Ni et al. (2022), The Best of Both Worlds: Integrating Semantic Features with Expert Features for Defect Prediction and Localization, FSE.",
            }, extra=extra)
    except Exception:
        if created:
            try:
                if _sha256(output.read_bytes()) == _sha256(blob):
                    output.unlink()
            except OSError:
                pass
        raise
    return {"kind": "jit-benchmark-imported", "adapter": ADAPTER,
            "dataset": registered["dataset"], "version": registered["version"],
            "csvPath": str(output), "manifestPath": registered["path"],
            "csvSha256": _sha256(blob), **source}
