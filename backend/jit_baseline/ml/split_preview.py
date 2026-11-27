"""Read-only split previews backed by one registered dataset manifest."""
from pathlib import Path

from . import admission

from .artifacts import _label_admission
from ..config import BACKEND
from ..data import BaselineError, parse_source, sha256
from .datasets import load_all, load_manifest
from .label_maturity import resolve_policy
from .splits import PARTITIONS, preset_view, resolve_split, split_records


def request_ratios(train=None, validation=None, test=None):
    values = (train, validation, test)
    if all(value is None for value in values):
        return None
    if any(value is None for value in values):
        raise BaselineError("SPLIT_POLICY_INVALID", "自定义切分必须同时提交训练、验证、测试三个比例")
    return {"train": train, "validation": validation, "test": test}


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


def dataset_split_preview(dataset_root, dataset_version, preset=None, maturity_policy=None, *,
                          ratios=None,
                          allow_legacy=False, allow_restricted=False, manifest=None):
    """Return a no-write preview; invalid membership is data, not a failed request."""
    preset = resolve_split(preset, ratios)
    maturity_policy = resolve_policy(maturity_policy)
    if manifest is None:
        dataset = load_all(dataset_root).get(dataset_version)
        if dataset is None:
            raise BaselineError("DATASET_INVALID", "数据集版本未登记")
        declared = Path(dataset["manifestPath"])
        manifest_path = declared if declared.is_absolute() else BACKEND / declared
        manifest = load_manifest(manifest_path)
    if manifest["version"] != dataset_version:
        raise BaselineError("DATASET_INVALID", "描述文件的数据集版本已变化")
    records = _records(manifest)
    try:
        eligible, maturity, evaluated = _label_admission(
            manifest, records, maturity_policy,
            allow_legacy=allow_legacy, allow_restricted=allow_restricted,
        )
    except BaselineError as exc:
        result = admission.evaluate(
            manifest, records, allow_legacy=allow_legacy,
            allow_restricted=allow_restricted,
        )
        return {
            "datasetVersion": dataset_version,
            "schemaName": manifest["schemaName"],
            "preset": preset_view(preset),
            "timezone": "UTC",
            "datasetRecords": len(records),
            "eligibleRecords": 0,
            "maturityPolicy": maturity_policy,
            "maturity": None,
            "admission": admission.view(result),
            "available": False,
            "reason": {"code": exc.code, "message": str(exc)},
            "partitions": None,
            "policy": None,
        }
    base = {
        "datasetVersion": dataset_version,
        "schemaName": manifest["schemaName"],
        "preset": preset_view(preset),
        "timezone": "UTC",
        "datasetRecords": len(records),
        "eligibleRecords": len(eligible),
        "maturityPolicy": maturity_policy,
        "maturity": maturity,
        "admission": admission.view(evaluated),
    }
    try:
        split, boundaries, policy = split_records(eligible, preset, require_classes=False)
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
    invalid = [name for name in PARTITIONS
               if {record["label"] for record in split[name]} != {0, 1}]
    if invalid:
        labels = {"train": "训练集", "validation": "验证集", "test": "测试集"}
        details = "；".join(
            f"{labels[name]} {partitions[name]['records']} 行、{partitions[name]['positives']} 正例"
            for name in invalid
        )
        return {
            **base,
            "available": False,
            "reason": {
                "code": "SPLIT_INVALID",
                "message": f"切分后只有一类标签（{details}）。请更换比例或补充正/负样本。",
            },
            "partitions": partitions,
            "policy": policy,
        }
    return {
        **base,
        "available": True,
        "reason": None,
        "partitions": partitions,
        "policy": {**policy, "admission": evaluated["identity"] or evaluated["policy"]},
    }


def validate_dataset_split(dataset_root, dataset_version, preset=None, maturity_policy=None, *,
                           ratios=None,
                           allow_legacy=False, allow_restricted=False, manifest=None):
    preview = dataset_split_preview(dataset_root, dataset_version, preset,
                                     maturity_policy, allow_legacy=allow_legacy,
                                     allow_restricted=allow_restricted, manifest=manifest,
                                     ratios=ratios)
    if not preview["available"]:
        reason = preview["reason"]
        raise BaselineError(reason["code"], reason["message"])
    return preview
