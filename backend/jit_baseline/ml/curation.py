"""Preview and derive curated dataset versions without modifying the source."""
import csv
import hashlib
import io
import json
import math
import zipfile
from datetime import date
from pathlib import Path

from ..config import BACKEND
from ..data import BaselineError, parse_source, sha256
from ..schemas import KAMEI_2013_SCHEMA, resolve
from . import admission, datasets


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


def _finite_number(value, message):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise BaselineError("INPUT_INVALID", message)
    return value


def _schema_fields(schema):
    if schema is None:
        return None
    return set(resolve(schema).in_model_names())


def _validated_field(field, allowed):
    if not isinstance(field, str) or not field:
        raise BaselineError("INPUT_INVALID", "清洗规则需要字段名")
    if allowed is not None and field not in allowed:
        raise BaselineError("INPUT_INVALID", f"字段 {field} 不属于当前特征 schema")
    return field


def _date_value(value, name):
    if not isinstance(value, str):
        raise BaselineError("INPUT_INVALID", f"{name} 必须是 YYYY-MM-DD 日期")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise BaselineError("INPUT_INVALID", f"{name} 必须是 YYYY-MM-DD 日期") from exc
    if parsed.isoformat() != value:
        raise BaselineError("INPUT_INVALID", f"{name} 必须是 YYYY-MM-DD 日期")
    return value


def normalize(recipe, schema=None):
    if not isinstance(recipe, dict) or set(recipe) - {"version", "rules"}:
        raise BaselineError("INPUT_INVALID", "清洗配方无效")
    version = recipe.get("version", 1)
    if version not in (1, 2):
        raise BaselineError("INPUT_INVALID", "清洗配方版本无效")
    rules = recipe.get("rules")
    if not isinstance(rules, list) or not rules:
        raise BaselineError("INPUT_INVALID", "清洗配方至少需要一条规则")
    allowed_fields = _schema_fields(schema)
    normalized = []
    for rule in rules:
        if not isinstance(rule, dict):
            raise BaselineError("INPUT_INVALID", "清洗规则无效")
        rule_id = rule.get("id")
        if rule_id == "drop-missing":
            fields = rule.get("fields")
            if not isinstance(fields, list) or not fields or not all(isinstance(f, str) for f in fields):
                raise BaselineError("INPUT_INVALID", "drop-missing 需要字段列表")
            if len(fields) != len(set(fields)):
                raise BaselineError("INPUT_INVALID", "drop-missing 字段不能重复")
            normalized.append({"id": rule_id, "fields": [
                _validated_field(field, allowed_fields) for field in fields
            ]})
        elif rule_id == "max-value":
            field, value = rule.get("field"), rule.get("value")
            if not isinstance(field, str) or isinstance(value, bool) or not isinstance(value, (int, float)):
                raise BaselineError("INPUT_INVALID", "max-value 需要字段和数值")
            normalized.append({"id": rule_id, "field": _validated_field(field, allowed_fields),
                               "value": _finite_number(value, "max-value 需要有限数值")})
        elif rule_id == "drop-duplicates":
            normalized.append({"id": rule_id})
        elif version == 1:
            raise BaselineError("INPUT_INVALID", f"未知清洗规则：{rule_id}")
        elif rule_id == "min-value":
            field, value = rule.get("field"), rule.get("value")
            if not isinstance(field, str):
                raise BaselineError("INPUT_INVALID", "min-value 需要字段和数值")
            normalized.append({"id": rule_id, "field": _validated_field(field, allowed_fields),
                               "value": _finite_number(value, "min-value 需要有限数值")})
        elif rule_id == "keep-range":
            field = _validated_field(rule.get("field"), allowed_fields)
            minimum = rule.get("min")
            maximum = rule.get("max")
            if minimum is None and maximum is None:
                raise BaselineError("INPUT_INVALID", "keep-range 至少需要一个边界")
            item = {"id": rule_id, "field": field}
            if minimum is not None:
                item["min"] = _finite_number(minimum, "keep-range 下界必须是有限数值")
            if maximum is not None:
                item["max"] = _finite_number(maximum, "keep-range 上界必须是有限数值")
            if "min" in item and "max" in item and item["min"] > item["max"]:
                raise BaselineError("INPUT_INVALID", "keep-range 下界不能大于上界")
            normalized.append(item)
        elif rule_id == "quantile-range":
            field = _validated_field(rule.get("field"), allowed_fields)
            lower = _finite_number(rule.get("lower"), "quantile-range 下分位必须是 0 到 1 的数值")
            upper = _finite_number(rule.get("upper"), "quantile-range 上分位必须是 0 到 1 的数值")
            if not 0 <= lower < upper <= 1:
                raise BaselineError("INPUT_INVALID", "quantile-range 分位须满足 0 ≤ lower < upper ≤ 1")
            normalized.append({"id": rule_id, "field": field, "lower": lower, "upper": upper})
        elif rule_id == "keep-date":
            start = rule.get("start")
            end = rule.get("end")
            if start is None and end is None:
                raise BaselineError("INPUT_INVALID", "keep-date 至少需要一个日期边界")
            item = {"id": rule_id}
            if start is not None:
                item["start"] = _date_value(start, "start")
            if end is not None:
                item["end"] = _date_value(end, "end")
            if "start" in item and "end" in item and item["start"] > item["end"]:
                raise BaselineError("INPUT_INVALID", "keep-date 开始日期不能晚于结束日期")
            normalized.append(item)
        else:
            raise BaselineError("INPUT_INVALID", f"未知清洗规则：{rule_id}")
    return {"version": version, "rules": normalized}


def _apply_rule(records, rule):
    kept, excluded = [], []
    seen = set() if rule["id"] == "drop-duplicates" else None
    quantile_bounds = None
    if rule["id"] == "quantile-range":
        values = [
            value for value in (_number((record.get("metrics") or {}).get(rule["field"]))
                                for record in records)
            if value is not None
        ]
        if not values:
            raise BaselineError("DATASET_INVALID", f"字段 {rule['field']} 没有可计算的分位值")
        ordered = sorted(values)

        def quantile(fraction):
            position = (len(ordered) - 1) * fraction
            lower = int(position)
            upper = min(lower + 1, len(ordered) - 1)
            return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)

        quantile_bounds = {"min": quantile(rule["lower"]), "max": quantile(rule["upper"]),
                           "lower": rule["lower"], "upper": rule["upper"]}
    for record in records:
        reason = None
        rule_id = rule["id"]
        if rule_id == "drop-duplicates":
            if record["id"] in seen:
                reason = "duplicate"
            else:
                seen.add(record["id"])
        elif rule_id == "drop-missing":
            if any(record["metrics"].get(field) in (None, "") for field in rule["fields"]):
                reason = "missing"
        elif rule_id == "max-value":
            value = record["metrics"].get(rule["field"])
            if isinstance(value, (int, float)) and value > rule["value"]:
                reason = "max-value"
        elif rule_id == "min-value":
            value = record["metrics"].get(rule["field"])
            if isinstance(value, (int, float)) and value < rule["value"]:
                reason = "min-value"
        elif rule_id == "keep-range":
            value = _number(record["metrics"].get(rule["field"]))
            if value is None:
                reason = "missing"
            elif "min" in rule and value < rule["min"]:
                reason = "below-min"
            elif "max" in rule and value > rule["max"]:
                reason = "above-max"
        elif rule_id == "quantile-range":
            value = _number(record["metrics"].get(rule["field"]))
            if value is None:
                reason = "missing"
            elif value < quantile_bounds["min"]:
                reason = "below-quantile"
            elif value > quantile_bounds["max"]:
                reason = "above-quantile"
        elif rule_id == "keep-date":
            day = record["time"][:10]
            if "start" in rule and day < rule["start"]:
                reason = "before-date"
            elif "end" in rule and day > rule["end"]:
                reason = "after-date"
        if reason:
            excluded.append({"id": record["id"], "reason": reason})
        else:
            kept.append(record)
    return kept, excluded, quantile_bounds


def apply(records, recipe):
    kept, excluded, _ = apply_steps(records, recipe)
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


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(float(value)):
        return None
    return float(value)


def _quantiles(values, count=10):
    ordered = sorted(values)
    if not ordered:
        return []
    edges = []
    for index in range(1, count):
        position = (len(ordered) - 1) * index / count
        lower = int(position)
        upper = min(lower + 1, len(ordered) - 1)
        fraction = position - lower
        edges.append(ordered[lower] + (ordered[upper] - ordered[lower]) * fraction)
    unique = []
    for edge in edges:
        if not unique or edge > unique[-1]:
            unique.append(edge)
    return unique


def _feature_summary(records, kept_ids, field):
    before_values, after_values = [], []
    before_missing = after_missing = 0
    for record in records:
        value = _number((record.get("metrics") or {}).get(field))
        if value is None:
            before_missing += 1
        else:
            before_values.append(value)
            if record["id"] in kept_ids:
                after_values.append(value)
        if record["id"] in kept_ids and value is None:
            after_missing += 1
    if not before_values:
        return None
    edges = _quantiles(before_values)
    labels = []
    starts = [min(before_values), *edges]
    ends = [*edges, max(before_values)]
    for start, end in zip(starts, ends, strict=True):
        labels.append({"start": start, "end": end})
    before_counts = [0] * len(labels)
    after_counts = [0] * len(labels)

    def bucket(value):
        if not labels:
            return 0
        for index, item in enumerate(labels):
            if value <= item["end"] or index == len(labels) - 1:
                return index
        return len(labels) - 1

    for value in before_values:
        before_counts[bucket(value)] += 1
    for value in after_values:
        after_counts[bucket(value)] += 1

    def summary(values, missing):
        ordered = sorted(values)
        return {
            "records": len(values) + missing,
            "present": len(values),
            "missing": missing,
            "mean": sum(values) / len(values) if values else None,
            "median": ordered[len(ordered) // 2] if ordered else None,
            "min": ordered[0] if ordered else None,
            "max": ordered[-1] if ordered else None,
        }

    return {
        "field": field,
        "bins": labels,
        "before": {**summary(before_values, before_missing),
                   "bucketCounts": before_counts},
        "after": {**summary(after_values, after_missing),
                  "bucketCounts": after_counts},
    }


def apply_steps(records, recipe, fields=None):
    """按顺序执行规则，并为每一步保留在应用当刻的前后事实。"""
    field_names = list(fields) if fields is not None else (
        list((records[0].get("metrics") or {})) if records else []
    )
    current = list(records)
    all_excluded = []
    steps = []
    for index, rule in enumerate(recipe["rules"], start=1):
        next_records, excluded, details = _apply_rule(current, rule)
        before_stats = _stats(current, [], len(current))
        after_stats = _stats(next_records, excluded, len(current))
        feature_comparison = [
            item for item in (_feature_summary(
                current, {record["id"] for record in next_records}, field
            ) for field in field_names)
            if item is not None
        ]
        steps.append({
            "index": index,
            "rule": rule,
            "details": ({rule["field"]: details} if rule["id"] == "quantile-range" and details else {}),
            "beforeStats": before_stats,
            "afterStats": after_stats,
            "featureComparison": feature_comparison,
        })
        current = next_records
        all_excluded.extend(excluded)
    return current, all_excluded, steps


def preview(dataset_version, recipe, root=None):
    manifest, csv_path = _manifest(dataset_version, root)
    schema = manifest["schemaName"]
    normalized = normalize(recipe, schema)
    try:
        blob = csv_path.read_bytes()
    except OSError as exc:
        raise BaselineError("DATASET_UNAVAILABLE", "来源 CSV 不可读") from exc
    records, _ = parse_source(blob, schema, manifest["cohort"])
    fields = list(resolve(schema).in_model_names())
    kept, excluded, steps = apply_steps(records, normalized, fields)
    if not kept:
        raise BaselineError("DATASET_INVALID", "清洗后没有保留记录")
    before_stats = _stats(records, [], len(records))
    feature_comparison = steps[-1]["featureComparison"] if steps else []
    return {"sourceVersion": dataset_version, "recipe": normalized,
            "recipeSha256": sha256(_canonical(normalized).encode("utf-8")),
            "stats": _stats(kept, excluded, len(records)),
            "beforeStats": before_stats,
            "featureComparison": feature_comparison,
            "steps": steps}


def derive(dataset_version, recipe, root=None):
    manifest, csv_path = _manifest(dataset_version, root)
    result = preview(dataset_version, recipe, root)
    normalized = result["recipe"]
    blob = csv_path.read_bytes()
    records, _ = parse_source(blob, manifest["schemaName"], manifest["cohort"])
    kept, excluded, steps = apply_steps(
        records, normalized, resolve(manifest["schemaName"]).in_model_names()
    )
    kept = sorted(kept, key=lambda record: (record["time"], record["id"]))
    days = [record["time"][:10] for record in kept]
    version = f"{manifest['dataset']}-{min(days)}_{max(days)}-{result['recipeSha256'][:8]}"
    root = Path(root) if root is not None else datasets.DATASETS
    room = root / manifest["dataset"]
    room.mkdir(parents=True, exist_ok=True)
    target = room / f"{version}.csv"
    derived_bytes = _csv(kept, manifest["schemaName"], blob)
    if target.exists():
        if target.read_bytes() != derived_bytes:
            raise BaselineError("DATASET_EXISTS", "派生版本已存在且内容不同，不覆盖")
    else:
        target.write_bytes(derived_bytes)
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
                            "decisions": {
                                **_stats(kept, excluded, len(records)),
                                "beforeStats": result["beforeStats"],
                                "featureComparison": result["featureComparison"],
                                "steps": steps,
                            },
                            "decisionsFile": ({"path": datasets.manifest_relative(decisions_path),
                                               "sha256": hashlib.sha256(decisions_bytes).hexdigest(),
                                               "records": len(excluded)} if decisions_bytes else None)},
               **{key: manifest[key] for key in ("benchmark", "label")
                  if manifest.get("benchmark") and key in manifest},
               **_derived_labeling(manifest, room, kept)})
    return {"dataset": registered, "preview": result}


def _derived_labeling(manifest, room, kept):
    """派生版本沿用源版本的观察事实，并为保留成员生成新的逐提交状态旁车。"""
    source = manifest.get("labeling")
    if not source:
        return {}
    entries_by_id = admission.read_entries(manifest)
    entries = sorted((entries_by_id[record["id"]] for record in kept
                      if record["id"] in entries_by_id), key=lambda item: item["id"])
    status_bytes = admission.status_bytes(entries)
    digest = hashlib.sha256(status_bytes).hexdigest()
    status_path = room / f"{manifest['dataset']}-label-status-{digest[:16]}.jsonl"
    if status_path.exists():
        if status_path.read_bytes() != status_bytes:
            raise BaselineError("DATASET_EXISTS", "派生状态的旁车文件已存在且内容不同，不覆盖")
    else:
        status_path.write_bytes(status_bytes)
    status_meta = {"path": datasets.manifest_relative(status_path), "sha256": digest,
                   "records": len(entries), "rule": admission.STATUS_RULE}
    labeling, _ = admission.derive_labeling(source, [record["id"] for record in kept],
                                            entries_by_id, status_meta)
    return {"labeling": labeling, "labelStatusFile": status_meta}


def export_bundle(version, root=None):
    """导出派生版本的 CSV、描述文件、决策旁车和哈希清单。"""
    manifest, csv_path = _manifest(version, root)
    registered = datasets.load_all(root)
    manifest_path = Path(registered[version]["manifestPath"])
    manifest_path = manifest_path if manifest_path.is_absolute() else BACKEND / manifest_path
    decisions = (manifest.get("curation") or {}).get("decisionsFile")
    status_file = manifest.get("labelStatusFile") or (manifest.get("labeling") or {}).get("statusFile")
    buffer = io.BytesIO()
    extras = []
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(csv_path, csv_path.name)
        archive.write(manifest_path, manifest_path.name)
        if decisions and decisions.get("path"):
            path = Path(decisions["path"])
            path = path if path.is_absolute() else BACKEND / path
            archive.write(path, path.name)
            extras.append(path)
        if status_file and status_file.get("path"):
            path = Path(status_file["path"])
            path = path if path.is_absolute() else BACKEND / path
            archive.write(path, path.name)
            extras.append(path)
        hashes = [f"{hashlib.sha256(item.read_bytes()).hexdigest()}  {item.name}"
                  for item in (csv_path, manifest_path, *extras)]
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
            "recipe": curation.get("recipe"), "recipeSha256": curation.get("recipeSha256"),
            "decisions": curation.get("decisions")}


def _csv(records, schema_name, source_blob=None):
    if schema_name == KAMEI_2013_SCHEMA:
        kept_rows = {record["sourceRow"] for record in records}
        output = io.StringIO()
        reader = csv.reader(io.StringIO(source_blob.decode("utf-8-sig")))
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(next(reader))
        writer.writerows(row for index, row in enumerate(reader, 2) if index in kept_rows)
        return output.getvalue().encode("utf-8")
    from .collect import _csv_bytes
    return _csv_bytes(records, resolve(schema_name).in_model_names())
