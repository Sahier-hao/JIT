"""Preview and derive curated dataset versions without modifying the source."""
import hashlib
import io
import json
import zipfile
from pathlib import Path

from . import datasets, store
from .config import BACKEND
from .data import BaselineError, parse_source, sha256
from .schemas import resolve


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _manifest(dataset_version, root=None):
    registered = datasets.load_all(root)
    item = registered.get(dataset_version)
    if item is None:
        raise BaselineError("DATASET_INVALID", "数据集版本未登记")
    path = Path(item["manifestPath"])
    path = path if path.is_absolute() else BACKEND / path
    manifest = datasets.load_manifest(path)
    csv_path = Path(manifest["file"]["path"])
    csv_path = csv_path if csv_path.is_absolute() else BACKEND / csv_path
    return manifest, csv_path


def normalize(recipe):
    if not isinstance(recipe, dict) or set(recipe) - {"version", "rules"}:
        raise BaselineError("INPUT_INVALID", "清洗配方无效")
    rules = recipe.get("rules")
    if not isinstance(rules, list) or not rules:
        raise BaselineError("INPUT_INVALID", "清洗配方至少需要一条规则")
    normalized = []
    for rule in rules:
        if not isinstance(rule, dict):
            raise BaselineError("INPUT_INVALID", "清洗规则无效")
        rule_id = rule.get("id")
        if rule_id == "drop-missing":
            fields = rule.get("fields")
            if not isinstance(fields, list) or not fields or not all(isinstance(f, str) for f in fields):
                raise BaselineError("INPUT_INVALID", "drop-missing 需要字段列表")
            normalized.append({"id": rule_id, "fields": fields})
        elif rule_id == "max-value":
            field, value = rule.get("field"), rule.get("value")
            if not isinstance(field, str) or isinstance(value, bool) or not isinstance(value, (int, float)):
                raise BaselineError("INPUT_INVALID", "max-value 需要字段和数值")
            normalized.append({"id": rule_id, "field": field, "value": value})
        elif rule_id == "drop-duplicates":
            normalized.append({"id": rule_id})
        else:
            raise BaselineError("INPUT_INVALID", f"未知清洗规则：{rule_id}")
    return {"version": 1, "rules": normalized}


def apply(records, recipe):
    kept, excluded = [], []
    seen = set()
    for record in records:
        reason = None
        for rule in recipe["rules"]:
            if rule["id"] == "drop-duplicates":
                if record["id"] in seen:
                    reason = "duplicate"
                    break
                seen.add(record["id"])
            elif rule["id"] == "drop-missing":
                if any(record["metrics"].get(field) in (None, "") for field in rule["fields"]):
                    reason = "missing"
                    break
            elif rule["id"] == "max-value":
                value = record["metrics"].get(rule["field"])
                if isinstance(value, (int, float)) and value > rule["value"]:
                    reason = "max-value"
                    break
        if reason:
            excluded.append({"id": record["id"], "reason": reason})
        else:
            kept.append(record)
    return kept, excluded


def _stats(records, excluded, total):
    return {
        "rawRows": total,
        "includedRows": len(records),
        "excludedRows": len(excluded),
        "positiveLabels": sum(1 for record in records if record["label"] == 1),
        "timeRange": ({"start": records[0]["time"], "end": records[-1]["time"]} if records else None),
        "excluded": {reason: sum(1 for item in excluded if item["reason"] == reason)
                     for reason in sorted({item["reason"] for item in excluded})},
        "sampleExcluded": excluded[:20],
    }


def preview(dataset_version, recipe, root=None):
    manifest, csv_path = _manifest(dataset_version, root)
    normalized = normalize(recipe)
    try:
        blob = csv_path.read_bytes()
    except OSError as exc:
        raise BaselineError("DATASET_UNAVAILABLE", "来源 CSV 不可读") from exc
    records, _ = parse_source(blob, manifest["schemaName"], manifest["cohort"])
    kept, excluded = apply(records, normalized)
    if not kept:
        raise BaselineError("DATASET_INVALID", "清洗后没有保留记录")
    return {"sourceVersion": dataset_version, "recipe": normalized,
            "recipeSha256": sha256(_canonical(normalized).encode("utf-8")),
            "stats": _stats(kept, excluded, len(records))}


def derive(dataset_version, recipe, root=None):
    manifest, csv_path = _manifest(dataset_version, root)
    result = preview(dataset_version, recipe, root)
    normalized = result["recipe"]
    blob = csv_path.read_bytes()
    records, _ = parse_source(blob, manifest["schemaName"], manifest["cohort"])
    kept, excluded = apply(records, normalized)
    kept = sorted(kept, key=lambda record: (record["time"], record["id"]))
    days = [record["time"][:10] for record in kept]
    version = f"{manifest['dataset']}-{min(days)}_{max(days)}-{result['recipeSha256'][:8]}"
    root = Path(root) if root is not None else datasets.DATASETS
    room = root / manifest["dataset"]
    room.mkdir(parents=True, exist_ok=True)
    target = room / f"{version}.csv"
    if target.exists():
        if target.read_bytes() != _csv(kept, manifest["schemaName"]):
            raise BaselineError("DATASET_EXISTS", "派生版本已存在且内容不同，不覆盖")
    else:
        target.write_bytes(_csv(kept, manifest["schemaName"]))
    decisions_path = target.with_name(target.stem + ".curation.jsonl")
    decisions_bytes = (b"\n".join(json.dumps(item, ensure_ascii=False, sort_keys=True).encode("utf-8")
                                  for item in excluded) + b"\n") if excluded else b""
    if decisions_bytes:
        if decisions_path.exists() and decisions_path.read_bytes() != decisions_bytes:
            raise BaselineError("DATASET_EXISTS", "派生决策文件已存在且内容不同，不覆盖")
        if not decisions_path.exists():
            decisions_path.write_bytes(decisions_bytes)
    registered = datasets.register(
        target, schema=manifest["schemaName"], dataset=manifest["dataset"], version=version,
        root=root, cohort=manifest["cohort"],
        provenance={"publisher": "curated", "revision": manifest["revision"],
                    "url": manifest["url"], "citation": "由已登记数据集清洗生成"},
        extra={"curation": {"sourceVersion": dataset_version, "recipe": normalized,
                            "recipeSha256": result["recipeSha256"],
                            "decisions": _stats(kept, excluded, len(records)),
                            "decisionsFile": ({"path": datasets.manifest_relative(decisions_path),
                                               "sha256": hashlib.sha256(decisions_bytes).hexdigest(),
                                               "records": len(excluded)} if decisions_bytes else None)}})
    return {"dataset": registered, "preview": result}


def export_bundle(version, root=None):
    """导出派生版本的 CSV、描述文件、决策旁车和哈希清单。"""
    manifest, csv_path = _manifest(version, root)
    registered = datasets.load_all(root)
    manifest_path = Path(registered[version]["manifestPath"])
    manifest_path = manifest_path if manifest_path.is_absolute() else BACKEND / manifest_path
    decisions = (manifest.get("curation") or {}).get("decisionsFile")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(csv_path, csv_path.name)
        archive.write(manifest_path, manifest_path.name)
        if decisions and decisions.get("path"):
            path = Path(decisions["path"])
            path = path if path.is_absolute() else BACKEND / path
            archive.write(path, path.name)
        hashes = [f"{hashlib.sha256(item.read_bytes()).hexdigest()}  {item.name}"
                  for item in (csv_path, manifest_path)]
        archive.writestr("SHA256SUMS", "\n".join(hashes) + "\n")
    return buffer.getvalue()


def compare(source_version, derived_version, root=None):
    source, _ = _manifest(source_version, root)
    derived, _ = _manifest(derived_version, root)
    if source["schemaName"] != derived["schemaName"]:
        raise BaselineError("DATASET_INVALID", "两个版本 schema 不同，不能直接对比")
    curation = derived.get("curation") or {}
    if curation.get("sourceVersion") != source_version:
        raise BaselineError("DATASET_INVALID", "派生版本来源不匹配")
    return {"source": {"version": source_version, "quality": source["quality"],
                       "timeRange": source["timeRange"]},
            "derived": {"version": derived_version, "quality": derived["quality"],
                        "timeRange": derived["timeRange"]},
            "recipe": curation.get("recipe"), "recipeSha256": curation.get("recipeSha256")}


def _csv(records, schema_name):
    from .collect import _csv_bytes
    return _csv_bytes(records, resolve(schema_name).in_model_names())
