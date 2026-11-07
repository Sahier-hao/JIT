"""Read-only split previews backed by one registered dataset manifest."""
from pathlib import Path

from .config import BACKEND
from .data import BaselineError, parse_source, sha256
from .datasets import load_all, load_manifest
from .splits import PARTITIONS, preset_view, resolve_preset, split_records


def _records(manifest):
    declared = Path(manifest["file"]["path"])
    path = declared if declared.is_absolute() else BACKEND / declared
    try:
        blob = path.read_bytes()
    except OSError as exc:
        raise BaselineError("DATASET_UNAVAILABLE", f"原始 CSV 不可用：{path.name}") from exc
    if sha256(blob) != manifest["file"]["sha256"]:
        raise BaselineError("DATASET_INVALID", "原始 CSV 校验值与描述文件不一致")
    records, quality = parse_source(blob, manifest["schemaName"], manifest["cohort"])
    if quality != manifest["quality"]:
        raise BaselineError("DATASET_INVALID", "按描述文件规则重算的质量统计与描述不一致")
    return records


def dataset_split_preview(dataset_root, dataset_version, preset=None):
    """Return a no-write preview; invalid membership is data, not a failed request."""
    preset = resolve_preset(preset)
    registered = load_all(dataset_root)
    dataset = registered.get(dataset_version)
    if dataset is None:
        raise BaselineError("DATASET_INVALID", "数据集版本未登记")
    declared = Path(dataset["manifestPath"])
    manifest_path = declared if declared.is_absolute() else BACKEND / declared
    manifest = load_manifest(manifest_path)
    records = _records(manifest)
    base = {
        "datasetVersion": dataset_version,
        "schemaName": manifest["schemaName"],
        "preset": preset_view(preset),
        "timezone": "UTC",
        "datasetRecords": len(records),
    }
    try:
        split, _, policy = split_records(records, preset)
    except BaselineError as exc:
        return {
            **base,
            "available": False,
            "reason": {"code": exc.code, "message": str(exc)},
            "partitions": None,
            "policy": None,
        }
    partitions = {
        name: {
            "records": len(split[name]),
            "positives": sum(record["label"] for record in split[name]),
            "start": split[name][0]["time"],
            "end": split[name][-1]["time"],
        }
        for name in PARTITIONS
    }
    return {
        **base,
        "available": True,
        "reason": None,
        "partitions": partitions,
        "policy": policy,
    }


def validate_dataset_split(dataset_root, dataset_version, preset=None):
    preview = dataset_split_preview(dataset_root, dataset_version, preset)
    if not preview["available"]:
        reason = preview["reason"]
        raise BaselineError(reason["code"], reason["message"])
    return preview
