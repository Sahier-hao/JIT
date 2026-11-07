"""Registered chronological split presets and deterministic partition profiles."""
from datetime import datetime, timezone
import hashlib
import json
import math

from .data import BaselineError


PRESETS = {
    "temporal-70-15-15": {"train": 70, "validation": 15, "test": 15},
    "temporal-80-10-10": {"train": 80, "validation": 10, "test": 10},
    "temporal-60-20-20": {"train": 60, "validation": 20, "test": 20},
}
DEFAULT_PRESET = "temporal-70-15-15"
TIMEZONE = "UTC"
PARTITIONS = ("train", "validation", "test")


def resolve_preset(value=None):
    """Resolve an omitted preset to the legacy 70/15/15 policy; reject aliases."""
    preset = DEFAULT_PRESET if value is None else value
    if not isinstance(preset, str) or preset not in PRESETS:
        raise BaselineError("SPLIT_POLICY_INVALID", "第一版只支持已注册的时间切分预设")
    return preset


def preset_view(value=None):
    preset = resolve_preset(value)
    return {"id": preset, "ratios": dict(PRESETS[preset]), "timezone": TIMEZONE}


def _time(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _digest(value):
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def membership_digest(partitions):
    members = {
        name: list(partitions.get(name, {}).get("ids") or [])
        for name in PARTITIONS
    }
    return _digest(members)


def split_records(records, preset=None):
    """Split unique records by sorted timestamp groups without crossing a boundary."""
    preset = resolve_preset(preset)
    if not records or len({record["id"] for record in records}) != len(records):
        raise BaselineError("SPLIT_INVALID", "分区为空或提交身份重复")
    if any(not isinstance(record["epoch"], int) or isinstance(record["epoch"], bool)
           for record in records):
        raise BaselineError("SPLIT_INVALID", "分区时间无效")
    ordered = sorted(records, key=lambda record: (record["epoch"], record["id"]))
    times = sorted({record["epoch"] for record in ordered})
    if len(times) < 3:
        raise BaselineError("SPLIT_INVALID", "时间组不足，不能形成三个非空分区")
    ratios = PRESETS[preset]
    first = math.floor(ratios["train"] / 100 * len(times))
    second = math.floor((ratios["train"] + ratios["validation"]) / 100 * len(times))
    if first <= 0 or second <= first or second >= len(times):
        raise BaselineError("SPLIT_INVALID", "时间组不足以按所选预设形成三个非空分区")
    boundaries = [times[first], times[second]]
    split = {name: [] for name in PARTITIONS}
    for record in ordered:
        partition = ("train" if record["epoch"] < boundaries[0]
                     else "validation" if record["epoch"] < boundaries[1]
                     else "test")
        split[partition].append(record)
    if any(not part for part in split.values()):
        raise BaselineError("SPLIT_INVALID", "时间分区包含空集合")
    if any({record["label"] for record in split[name]} != {0, 1}
           for name in ("train", "test")):
        raise BaselineError("SPLIT_INVALID", "训练与测试必须包含两类发布标签")
    members = {name: [record["id"] for record in split[name]] for name in PARTITIONS}
    counts = {
        name: {
            "records": len(split[name]),
            "positives": sum(record["label"] for record in split[name]),
            "start": split[name][0].get("time") or _time(split[name][0]["epoch"]),
            "end": split[name][-1].get("time") or _time(split[name][-1]["epoch"]),
        }
        for name in PARTITIONS
    }
    policy = {
        **preset_view(preset),
        "boundaries": [
            {"epoch": boundaries[0], "time": _time(boundaries[0])},
            {"epoch": boundaries[1], "time": _time(boundaries[1])},
        ],
        "partitionCounts": counts,
        "memberSha256": membership_digest(
            {name: {"ids": members[name]} for name in PARTITIONS}),
    }
    return split, boundaries, policy


def rule_text(preset=None):
    profile = preset_view(preset)
    ratios = profile["ratios"]
    return (f"UTC distinct timestamps, floor({ratios['train'] / 100:.2f}G), "
            f"floor({(ratios['train'] + ratios['validation']) / 100:.2f}G)")
