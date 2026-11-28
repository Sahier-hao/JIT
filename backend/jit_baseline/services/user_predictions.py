"""User-scoped single and batch scoring over datasets, project commits and CSV."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
from bisect import bisect_left
from datetime import datetime
from uuid import uuid4

from ..catalog_storage import utc_now
from ..data import BaselineError
from ..ml import attribution, splits
from ..ml.model import predict_risks
from ..schemas import resolve

MAX_RECORDS = 20_000
MAX_UPLOAD_BYTES = 16 * 1024 * 1024
EXPLANATION_LIMIT = 10
PARTITIONS = ("train", "validation", "test")
AVAILABLE_LABEL_STATUSES = frozenset(("positive", "unobserved"))
UNLABELED_META_COLUMNS = {
    "recordid", "commitid", "id", "authortime", "recordtime", "source",
}


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False)


def _digest(value):
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _member_sha(record_ids):
    return _digest({"ids": sorted({str(value) for value in record_ids})})


def _label_availability(label, status):
    status = status if isinstance(status, str) and status else "unknown"
    if status in AVAILABLE_LABEL_STATUSES:
        if label not in (0, 1):
            raise BaselineError("DATASET_INVALID", "可用标签必须为 0 或 1")
        return int(label), status, "available"
    return None, status, "unavailable"


def _threshold_preview(prepared):
    positives, negatives = [], []
    for record in prepared:
        if record["labelAvailability"] != "available":
            continue
        (positives if record["label"] == 1 else negatives).append(record["risk"])
    positives.sort()
    negatives.sort()
    thresholds = [index / 100 for index in range(101)]
    return {
        "thresholds": thresholds,
        "positives": len(positives),
        "negatives": len(negatives),
        "truePositives": [len(positives) - bisect_left(positives, threshold)
                          for threshold in thresholds],
        "falsePositives": [len(negatives) - bisect_left(negatives, threshold)
                           for threshold in thresholds],
    }


def _status_counts(prepared):
    counts = {}
    for record in prepared:
        status = record.get("labelStatus") or "unknown"
        counts[status] = counts.get(status, 0) + 1
    return counts


def _availability_counts(prepared):
    counts = {"available": 0, "unavailable": 0}
    for record in prepared:
        counts[record["labelAvailability"]] += 1
    return counts


def _classification(preview, tick):
    tick = int(tick)
    hit = preview["truePositives"][tick]
    false_alarm = preview["falsePositives"][tick]
    positives = preview["positives"]
    negatives = preview["negatives"]
    precision = hit / (hit + false_alarm) if hit + false_alarm else None
    recall = hit / positives if positives else None
    f1 = (2 * precision * recall / (precision + recall)
          if precision is not None and recall is not None and precision + recall else None)
    return {
        "threshold": tick / 100,
        "confusion": {
            "tp": hit,
            "fp": false_alarm,
            "tn": negatives - false_alarm,
            "fn": positives - hit,
        },
        "precision": precision,
        "recall": recall,
        "f1": f1,
    }


def _model_view(model, feature_names=None):
    feature_schema = model.get("featureSchemaVersion")
    if feature_names is None and isinstance(feature_schema, str):
        try:
            feature_names = list(resolve(feature_schema).in_model_names())
        except BaselineError:
            feature_names = []
    return {
        "modelId": model["modelId"],
        "name": model.get("name"),
        "method": model.get("method"),
        "runId": model.get("runId") or model.get("artifactRunId"),
        "artifactRunId": model.get("artifactRunId"),
        "featureSchemaVersion": feature_schema,
        "artifactDatasetVersion": model.get("artifactDatasetVersion"),
        "parameters": model.get("parameters"),
        "isDefault": bool(model.get("isDefault")),
        "featureNames": list(feature_names or []),
    }


def _source_kind_label(kind):
    return {
        "dataset": "数据版本",
        "dataset-partition": "冻结分区",
        "single-dataset": "数据版本单条",
        "single-project": "项目分析提交",
        "single-manual": "手工特征",
        "unlabeled-csv": "无标签 CSV",
    }.get(kind, kind)


def _evaluation_state(counts):
    available = counts["labeledAvailable"]
    if available == 0:
        return False, "所有记录均无可用真实标签，不进入评估"
    if counts["positives"] == 0 or counts["negatives"] == 0:
        return False, "可用真实标签只覆盖单一类别，不能形成完整分类评估"
    return True, "包含可用真实标签，可进入评估"


def _feature_vector(features, names, record_label, *, strict):
    if not isinstance(features, dict):
        raise BaselineError("FEATURES_INVALID", f"{record_label} 的特征不是对象")
    if strict:
        unknown = sorted(set(features) - set(names))
        if unknown:
            raise BaselineError(
                "FEATURES_INVALID",
                f"{record_label} 包含当前模型未声明的字段：{', '.join(unknown)}",
            )
    missing = [name for name in names if name not in features]
    if missing:
        raise BaselineError(
            "FEATURES_INVALID",
            f"{record_label} 缺少入模字段：{', '.join(missing)}",
        )
    values = []
    for name in names:
        value = features[name]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise BaselineError("FEATURES_INVALID", f"{record_label} 的字段 {name} 不是数值")
        value = float(value)
        if not math.isfinite(value):
            raise BaselineError("FEATURES_INVALID", f"{record_label} 的字段 {name} 不是有限数值")
        values.append(value)
    return values


def _split_inputs(records):
    result = []
    for record in records:
        try:
            epoch = int(datetime.fromisoformat(
                str(record["authorTime"]).replace("Z", "+00:00"),
            ).timestamp())
        except (KeyError, TypeError, ValueError) as exc:
            raise BaselineError("DATASET_INVALID", "提交时间无法用于时间切分") from exc
        result.append({
            "id": record["commitId"],
            "epoch": epoch,
            "label": int(record["label"]),
            "time": record["authorTime"],
        })
    return result


class UserPredictionService:
    def __init__(self, storage, catalog):
        self.storage = storage
        self.catalog = catalog

    def models(self, username, schema_name=None):
        result = []
        for model in self.catalog.registered_models(state="ready"):
            if not model.get("enabled"):
                continue
            if not (model.get("shared") or model.get("ownerUserId") == username):
                continue
            if schema_name and model.get("featureSchemaVersion") != schema_name:
                continue
            result.append(dict(
                _model_view(model),
                mine=model.get("ownerUserId") == username,
                shared=bool(model.get("shared")),
            ))
        result.sort(key=lambda item: (not item["isDefault"], item["name"] or "", item["modelId"]))
        return {"models": result, "maxRecords": MAX_RECORDS}

    def _visible_model(self, username, model_id, expected_schema=None):
        snapshot, model = self.catalog.load_model(model_id)
        owner = model.get("ownerUserId")
        if not (model.get("shared") or owner == username):
            raise BaselineError("MODEL_FORBIDDEN", "该模型未对当前账户开放，不能使用")
        if not model.get("enabled"):
            raise BaselineError("MODEL_DISABLED", "所选模型已停用，请重新选择")
        if expected_schema and snapshot.schema.name != expected_schema:
            raise BaselineError(
                "INPUT_SCHEMA_MISMATCH",
                f"模型特征 schema {snapshot.schema.name} 与数据 {expected_schema} 不一致",
            )
        if snapshot.schema.semantic is not None or snapshot.schema.input_width() <= 0:
            raise BaselineError("INPUT_SCHEMA_MISMATCH", "该模型不能直接读取表格特征")
        return snapshot, model, list(snapshot.schema.in_model_names())

    def _owned(self, username, batch_id):
        with self.storage.connection() as db:
            row = db.execute(
                "SELECT * FROM user_prediction_batch WHERE id=? AND owner_user_id=?",
                (batch_id, username),
            ).fetchone()
        if row is None:
            raise BaselineError("NOT_FOUND", "预测批次不存在")
        try:
            payload = json.loads(row["payload_json"])
        except (TypeError, ValueError) as exc:
            raise BaselineError("STORAGE_UNAVAILABLE", "预测批次内容不可用") from exc
        if (payload.get("batchId") != batch_id
                or payload.get("model", {}).get("modelId") != row["model_id"]):
            raise BaselineError("STORAGE_UNAVAILABLE", "预测批次身份不一致")
        return row, payload

    def list(self, username, limit=20, offset=0):
        if not 1 <= limit <= 50 or offset < 0:
            raise BaselineError("INPUT_INVALID", "预测批次分页参数无效")
        with self.storage.connection() as db:
            rows = db.execute(
                "SELECT payload_json,mode,source_kind,dataset_version "
                "FROM user_prediction_batch "
                "WHERE owner_user_id=? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                (username, limit, offset),
            ).fetchall()
            total = db.execute(
                "SELECT COUNT(*) FROM user_prediction_batch WHERE owner_user_id=?",
                (username,),
            ).fetchone()[0]
        batches = []
        for row in rows:
            try:
                payload = json.loads(row["payload_json"])
            except (TypeError, ValueError):
                continue
            batches.append({
                **{
                    key: payload.get(key) for key in (
                        "format", "batchId", "mode", "source", "sourceKind",
                        "datasetVersion", "dataset", "splitPreset", "partition",
                        "memberSha256", "model", "threshold", "counts",
                        "labelStatusCounts", "labelAvailabilityCounts",
                        "thresholdPreview", "evaluationEligible", "evaluationReason",
                        "explanationCoverage", "featureNames", "createdAt", "limitations",
                    )
                },
                "mode": payload.get("mode") or row["mode"],
                "sourceKind": payload.get("sourceKind") or row["source_kind"],
                "datasetVersion": payload.get("datasetVersion") or row["dataset_version"],
            })
        return {"batches": batches, "total": total, "limit": limit, "offset": offset}

    @staticmethod
    def _reopen_metrics(rows):
        prepared = [{
            "risk": float(row["risk"]),
            "label": row["label"],
            "labelStatus": row["label_status"],
            "labelAvailability": row["label_availability"],
        } for row in rows]
        return prepared, _threshold_preview(prepared)

    @staticmethod
    def _payload_counts(prepared, preview, threshold):
        available = sum(1 for item in prepared if item["labelAvailability"] == "available")
        tick = max(0, min(100, round(float(threshold) * 100)))
        return {
            "records": len(prepared),
            "labeledAvailable": available,
            "unavailable": len(prepared) - available,
            "positives": preview["positives"],
            "negatives": preview["negatives"],
            "flagged": preview["truePositives"][tick] + preview["falsePositives"][tick],
        }

    def get(self, username, batch_id, limit=100, offset=0, sort="risk", search=None):
        if not 1 <= limit <= 500 or offset < 0 or sort not in ("risk", "time"):
            raise BaselineError("INPUT_INVALID", "预测记录分页参数无效")
        text = (search or "").strip()
        if len(text) > 200:
            raise BaselineError("INPUT_INVALID", "搜索词不能超过 200 个字符")
        row, payload = self._owned(username, batch_id)
        order = ("risk DESC, author_time DESC, record_id" if sort == "risk"
                 else "author_time DESC, record_id")
        clauses = ["batch_id=?"]
        params = [batch_id]
        if text:
            escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            clauses.append("record_id LIKE ? ESCAPE '\\'")
            params.append(f"%{escaped}%")
        where = " AND ".join(clauses)
        with self.storage.connection() as db:
            rows = db.execute(
                "SELECT id,record_id,author_time,label,label_status,label_availability,"
                "source_kind,source_ref,risk,features_json,explanation_json "
                f"FROM user_prediction_record WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
                (*params, limit, offset),
            ).fetchall()
            all_rows = db.execute(
                "SELECT label,label_status,label_availability,risk "
                "FROM user_prediction_record WHERE batch_id=?",
                (batch_id,),
            ).fetchall()
        records = []
        for item in rows:
            try:
                features = json.loads(item["features_json"])
                explanation = (json.loads(item["explanation_json"])
                               if item["explanation_json"] else None)
            except (TypeError, ValueError):
                continue
            records.append({
                "predictionId": item["id"],
                "recordId": item["record_id"],
                "authorTime": item["author_time"],
                "label": item["label"],
                "labelStatus": item["label_status"],
                "labelAvailability": item["label_availability"],
                "sourceKind": item["source_kind"],
                "sourceRef": item["source_ref"],
                "risk": item["risk"],
                "features": features,
                "explanation": explanation,
            })
        threshold = float(payload.get("threshold", 0.5))
        prepared, preview = self._reopen_metrics(all_rows)
        counts = self._payload_counts(prepared, preview, threshold)
        evaluation_eligible, evaluation_reason = _evaluation_state(counts)
        return {
            **payload,
            "mode": row["mode"],
            "sourceKind": row["source_kind"],
            "sourceRef": row["source_ref"],
            "splitPreset": row["split_preset"],
            "partition": row["partition"],
            "memberSha256": row["member_sha256"],
            "counts": counts,
            "labelStatusCounts": _status_counts(prepared),
            "labelAvailabilityCounts": _availability_counts(prepared),
            "thresholdPreview": preview,
            "evaluationEligible": evaluation_eligible,
            "evaluationReason": evaluation_reason,
            "records": records,
            "limit": limit,
            "offset": offset,
            "sort": sort,
            "search": text or None,
        }

    def evaluation(self, username, batch_id):
        detail = self.get(username, batch_id, limit=1, offset=0, sort="risk")
        tick = max(0, min(100, round(float(detail["threshold"]) * 100)))
        classification = _classification(detail["thresholdPreview"], tick)
        return {
            "format": "user-prediction-evaluation-v1",
            "batchId": detail["batchId"],
            "mode": detail["mode"],
            "model": detail["model"],
            "datasetVersion": detail.get("datasetVersion"),
            "dataset": detail.get("dataset"),
            "source": detail.get("source"),
            "sourceKind": detail["sourceKind"],
            "splitPreset": detail.get("splitPreset"),
            "partition": detail.get("partition"),
            "memberSha256": detail.get("memberSha256"),
            "threshold": detail["threshold"],
            "eligible": detail["evaluationEligible"],
            "reason": detail["evaluationReason"],
            "counts": detail["counts"],
            "labelStatusCounts": detail["labelStatusCounts"],
            "labelAvailabilityCounts": detail["labelAvailabilityCounts"],
            "thresholdPreview": detail["thresholdPreview"],
            **classification,
            "limitations": list(detail.get("limitations") or []) + [
                "评估只使用数据版本中已成熟且可用的真实标签；无标签和未成熟记录不进入指标。",
                "预测分数是模型估计，不是已确认缺陷。",
            ],
        }

    def export_csv(self, username, batch_id):
        _row, payload = self._owned(username, batch_id)
        threshold = float(payload.get("threshold", 0.5))
        names = [name for name in payload.get("featureNames") or [] if isinstance(name, str)]
        with self.storage.connection() as db:
            rows = db.execute(
                "SELECT record_id,author_time,label,label_status,label_availability,"
                "source_kind,source_ref,risk,features_json "
                "FROM user_prediction_record WHERE batch_id=? ORDER BY risk DESC, record_id",
                (batch_id,),
            ).fetchall()
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer)
        writer.writerow([
            "recordId", "提交级预测分数", "当前阈值分类", "真实标签", "标签可用性",
            "标签状态", "时间", "来源", "来源引用", *names,
        ])
        for row in rows:
            try:
                features = json.loads(row["features_json"])
            except (TypeError, ValueError) as exc:
                raise BaselineError("STORAGE_UNAVAILABLE", "预测特征内容不可用") from exc
            writer.writerow([
                row["record_id"], f"{row['risk']:.8f}",
                "达到阈值（模型估计，不是已确认缺陷）" if row["risk"] >= threshold else "未达到阈值",
                row["label"] if row["label"] is not None else "无标签",
                "可用" if row["label_availability"] == "available" else "不可用",
                row["label_status"], row["author_time"] or "", row["source_kind"],
                row["source_ref"] or "",
                *[features.get(name, "") for name in names],
            ])
        return buffer.getvalue().encode("utf-8-sig"), f"{batch_id}.csv"

    def samples(self, username, dataset_version, manifest, limit=20, offset=0, search=None):
        if not 1 <= limit <= 100 or offset < 0:
            raise BaselineError("INPUT_INVALID", "数据行分页参数无效")
        text = (search or "").strip()
        if len(text) > 200:
            raise BaselineError("INPUT_INVALID", "搜索词不能超过 200 个字符")
        total = self.storage.count_commits(dataset_version, search=text or None)
        if total is None:
            raise BaselineError("DATASET_UNAVAILABLE", "数据集尚未导入可评分的提交记录")
        rows = self.storage.commits(
            dataset_version, limit, offset, search=text or None, order="desc",
        ) or []
        samples = []
        for record in rows:
            label, status, availability = _label_availability(
                record.get("label"), record.get("labelStatus"),
            )
            samples.append({
                "recordId": record["commitId"],
                "authorTime": record["authorTime"],
                "label": label,
                "labelStatus": status,
                "labelAvailability": availability,
                "features": record.get("features") or {},
                "sourceKind": "dataset",
            })
        return {
            "datasetVersion": dataset_version,
            "dataset": manifest.get("dataset"),
            "schema": manifest.get("schemaName"),
            "total": total,
            "limit": limit,
            "offset": offset,
            "search": text or None,
            "samples": samples,
        }

    @staticmethod
    def _read_model_split(catalog, model_id, model, dataset_version):
        if model.get("artifactDatasetVersion") != dataset_version:
            return None
        try:
            directory = catalog.model_directory(model_id)
            split = json.loads((directory / "split.json").read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            return None
        partitions = split.get("partitions")
        if not isinstance(partitions, dict) or set(partitions) != set(PARTITIONS):
            return None
        result = {}
        for name in PARTITIONS:
            entry = partitions.get(name)
            ids = entry.get("ids") if isinstance(entry, dict) else None
            if (not isinstance(ids, list) or not ids
                    or any(not isinstance(item, str) or not item for item in ids)):
                return None
            result[name] = {
                "ids": list(dict.fromkeys(ids)),
                "count": len(set(ids)),
                "positives": entry.get("positiveCount"),
                "start": entry.get("start"),
                "end": entry.get("end"),
            }
        policy = split.get("policy") if isinstance(split.get("policy"), dict) else {}
        digest = policy.get("memberSha256")
        computed = splits.membership_digest(partitions)
        if digest and digest != computed:
            return None
        return {
            "source": "model",
            "modelId": model_id,
            "splitPreset": policy.get("id"),
            "memberSha256": digest or computed,
            "partitions": result,
        }

    def split_options(self, username, dataset_version, manifest, model_id):
        snapshot, model, _ = self._visible_model(
            username, model_id, expected_schema=manifest.get("schemaName"),
        )
        records = self.storage.commits(dataset_version) or []
        if not records:
            raise BaselineError("DATASET_UNAVAILABLE", "数据集没有可评分的提交记录")
        known = {record["commitId"] for record in records}
        model_split = self._read_model_split(self.catalog, model_id, model, dataset_version)
        if model_split is not None:
            if any(not set(item["ids"]).issubset(known)
                   for item in model_split["partitions"].values()):
                model_split = None
        split_inputs = _split_inputs(records)
        presets = []
        for preset in splits.PRESETS:
            try:
                split, _boundaries, policy = splits.split_records(
                    split_inputs, preset, require_classes=False,
                )
            except BaselineError as exc:
                presets.append({
                    "id": preset,
                    "available": False,
                    "reason": str(exc),
                    "ratios": dict(splits.PRESETS[preset]),
                })
                continue
            presets.append({
                "id": preset,
                "available": True,
                "reason": None,
                "ratios": dict(splits.PRESETS[preset]),
                "memberSha256": policy["memberSha256"],
                "partitions": {
                    name: {
                        "count": len(split[name]),
                        "positives": sum(1 for item in split[name] if item.get("label") == 1),
                        "start": split[name][0]["time"] if split[name] else None,
                        "end": split[name][-1]["time"] if split[name] else None,
                    }
                    for name in PARTITIONS
                },
            })
        return {
            "datasetVersion": dataset_version,
            "modelId": model_id,
            "featureSchemaVersion": snapshot.schema.name,
            "full": {"count": len(records), "memberSha256": _member_sha(known)},
            "modelSplit": model_split,
            "presets": presets,
        }

    def _selected_partition(self, model_id, dataset_version, records, partition,
                            split_source, split_preset):
        if not partition:
            if split_source or split_preset:
                raise BaselineError("INPUT_INVALID", "未选择分区时不能指定切分来源")
            return (records, None, None, _member_sha([item["commitId"] for item in records]),
                    "dataset")
        if partition not in PARTITIONS:
            raise BaselineError("INPUT_INVALID", "分区只能是 train、validation 或 test")
        if split_source == "model":
            model_payload = next((
                candidate for candidate in self.catalog.registered_models(state="ready")
                if candidate.get("modelId") == model_id
            ), None)
            if model_payload is None:
                raise BaselineError("MODEL_NOT_READY", "模型不可用")
            model_split = self._read_model_split(
                self.catalog, model_id, model_payload, dataset_version,
            )
            if model_split is None:
                raise BaselineError("SPLIT_UNAVAILABLE", "所选模型没有该数据版本的冻结分区")
            ids = set(model_split["partitions"][partition]["ids"])
            selected = [item for item in records if item["commitId"] in ids]
            if len(selected) != len(ids):
                raise BaselineError("SPLIT_INVALID", "冻结分区成员与数据版本不一致")
            return (selected, model_split["splitPreset"], partition,
                    model_split["memberSha256"], "dataset-partition")
        if split_source == "preset":
            preset = splits.resolve_preset(split_preset)
            split, _boundaries, policy = splits.split_records(
                _split_inputs(records), preset, require_classes=False,
            )
            ids = {item["id"] for item in split[partition]}
            selected = [item for item in records if item["commitId"] in ids]
            return (selected, preset, partition, policy["memberSha256"], "dataset-partition")
        raise BaselineError("INPUT_INVALID", "分区必须来自模型冻结分区或已注册时间切分预设")

    @staticmethod
    def _dataset_prepared(records):
        prepared = []
        for record in records:
            label, status, availability = _label_availability(
                record.get("label"), record.get("labelStatus"),
            )
            prepared.append({
                "id": record["commitId"],
                "time": record["authorTime"],
                "label": label,
                "labelStatus": status,
                "labelAvailability": availability,
                "featureMap": record.get("features") or {},
                "sourceKind": "dataset",
                "sourceRef": record["commitId"],
            })
        return prepared

    @staticmethod
    def _validate_prepared(prepared, names, strict):
        result = []
        for index, record in enumerate(prepared, start=1):
            values = _feature_vector(
                record["featureMap"], names, f"第 {index} 条记录", strict=strict,
            )
            result.append({**record, "features": values})
        return result

    def _explanations(self, dataset_version, model_id, model, snapshot, names, ranked):
        items, failed = {}, 0
        limitations = []
        baseline, note = {}, None
        try:
            directory = self.catalog.model_directory(model_id)
            partition_ids = attribution.training_partition_ids(directory)
            baseline_version = model.get("artifactDatasetVersion") or dataset_version
            if baseline_version:
                baseline = attribution.feature_baseline(
                    self.storage, baseline_version, names, partition_ids,
                )
            if not baseline:
                note = "训练分区基线不可用，缺失字段按零基线计算。"
                limitations.append(note)
            elif any(name not in baseline for name in names):
                note = "部分入模特征缺少训练分区均值；这些字段的归因按零基线计算。"
                limitations.append(note)

            def predictor(values):
                return predict_risks(
                    snapshot.model, [{"features": values}], snapshot.schema,
                )

            for record, _risk in ranked:
                try:
                    explained = attribution.explain(
                        predictor, record["features"], baseline, names,
                    )
                except Exception:
                    failed += 1
                    continue
                summary = explained["summary"]
                if note:
                    summary = f"{summary}（{note}）"
                items[record["id"]] = {
                    "status": "supported",
                    "method": explained["method"],
                    "items": explained["items"],
                    "summary": summary,
                }
        except Exception:
            return {
                "items": {},
                "recorded": 0,
                "failed": len(ranked),
                "limitations": ["本轮归因计算不可用；模型分数仍然有效。"],
            }
        if failed:
            limitations.append(f"{failed} 条高风险记录未生成归因。")
        return {
            "items": items,
            "recorded": len(items),
            "failed": failed,
            "limitations": limitations,
        }

    @staticmethod
    def _threshold(value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise BaselineError("INPUT_INVALID", "阈值必须是 0 到 1 之间的数值")
        value = float(value)
        if not math.isfinite(value) or not 0 <= value <= 1:
            raise BaselineError("INPUT_INVALID", "阈值必须在 0 到 1 之间")
        return value

    def _save(self, username, *, mode, source_kind, source, dataset_version, dataset_name,
              model, snapshot, names, prepared, threshold, split_preset, partition,
              member_sha256, extra_limitations=None):
        if not prepared:
            raise BaselineError("DATASET_UNAVAILABLE", "没有可预测的记录")
        if len(prepared) > MAX_RECORDS:
            raise BaselineError(
                "PREDICTION_TOO_LARGE",
                f"一次最多预测 {MAX_RECORDS:,} 条记录；当前有 {len(prepared):,} 条",
            )
        try:
            risks = predict_risks(snapshot.model, prepared, snapshot.schema)
        except BaselineError as exc:
            raise BaselineError(
                "FEATURES_INVALID",
                f"模型无法使用整批特征：{exc}",
            ) from exc
        for record, risk in zip(prepared, risks, strict=True):
            record["risk"] = float(risk)
        ordered = sorted(
            zip(prepared, risks, strict=True),
            key=lambda item: (-item[1], item[0]["time"] or "", item[0]["id"]),
        )
        explanations = self._explanations(
            dataset_version, model["modelId"], model, snapshot, names,
            ordered[:EXPLANATION_LIMIT],
        )
        batch_id = str(uuid4())
        created_at = utc_now()
        preview = _threshold_preview(prepared)
        status_counts = _status_counts(prepared)
        availability_counts = _availability_counts(prepared)
        tick = max(0, min(100, round(threshold * 100)))
        counts = {
            "records": len(prepared),
            "labeledAvailable": availability_counts["available"],
            "unavailable": availability_counts["unavailable"],
            "positives": preview["positives"],
            "negatives": preview["negatives"],
            "flagged": preview["truePositives"][tick] + preview["falsePositives"][tick],
        }
        eligible, evaluation_reason = _evaluation_state(counts)
        limitations = [
            "预测分数是提交级模型估计，不是缺陷概率。",
            "分类阈值只用于查看结果，不改变已保存分数。",
            "无标签或标签未成熟的记录不进入评估指标。",
            f"仅保存风险最高的 {EXPLANATION_LIMIT} 条记录的特征归因。",
            *explanations["limitations"],
            *(extra_limitations or []),
        ]
        payload = {
            "format": "user-prediction-batch-v1",
            "batchId": batch_id,
            "mode": mode,
            "sourceKind": source_kind,
            "source": source,
            "datasetVersion": dataset_version,
            "dataset": dataset_name,
            "splitPreset": split_preset,
            "partition": partition,
            "memberSha256": member_sha256,
            "model": _model_view(model, names),
            "threshold": threshold,
            "counts": counts,
            "labelStatusCounts": status_counts,
            "labelAvailabilityCounts": availability_counts,
            "thresholdPreview": preview,
            "evaluationEligible": eligible,
            "evaluationReason": evaluation_reason,
            "explanationCoverage": {
                "method": attribution.METHOD,
                "limit": EXPLANATION_LIMIT,
                "recorded": explanations["recorded"],
                "failed": explanations["failed"],
            },
            "featureNames": names,
            "createdAt": created_at,
            "limitations": limitations,
        }
        record_rows = []
        model_view = _model_view(model, names)
        for record in prepared:
            record_rows.append((
                str(uuid4()), batch_id, record["id"], record.get("time"),
                record.get("label"), record.get("labelStatus") or "unknown",
                record.get("labelAvailability", "unavailable"),
                record.get("sourceKind") or source_kind,
                record.get("sourceRef"),
                record["risk"],
                json.dumps(record["featureMap"], ensure_ascii=False, sort_keys=True,
                           allow_nan=False),
                (json.dumps(explanations["items"][record["id"]], ensure_ascii=False,
                            sort_keys=True, allow_nan=False)
                 if record["id"] in explanations["items"] else None),
            ))
        source_ref = source.get("reference") if isinstance(source, dict) else None
        with self.storage.connection(write=True) as db:
            db.execute(
                "INSERT INTO user_prediction_batch "
                "(id,owner_user_id,dataset_version,mode,source_kind,source_ref,split_preset,"
                "partition,member_sha256,model_id,model_name,model_method,run_id,"
                "feature_schema_version,payload_json,created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (batch_id, username, dataset_version, mode, source_kind,
                 _canonical(source_ref) if source_ref is not None else None,
                 split_preset, partition, member_sha256, model["modelId"],
                 model_view["name"], model_view["method"], model_view["runId"],
                 snapshot.schema.name,
                 json.dumps(payload, ensure_ascii=False, sort_keys=True, allow_nan=False),
                 created_at),
            )
            db.executemany(
                "INSERT INTO user_prediction_record "
                "(id,batch_id,record_id,author_time,label,label_status,label_availability,"
                "source_kind,source_ref,risk,features_json,explanation_json) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                record_rows,
            )
        return {**payload, "records": [], "limit": 100, "offset": 0, "sort": "risk"}

    def create(self, username, dataset_version, manifest, model_id, threshold=0.5,
               partition=None, split_source=None, split_preset=None):
        threshold = self._threshold(threshold)
        snapshot, model, names = self._visible_model(
            username, model_id, expected_schema=manifest.get("schemaName"),
        )
        records = self.storage.commits(dataset_version) or []
        if not records:
            raise BaselineError("DATASET_UNAVAILABLE", "数据集没有可评分的提交记录")
        selected, preset, part, member_sha, source_kind = self._selected_partition(
            model_id, dataset_version, records, partition, split_source, split_preset,
        )
        prepared = self._validate_prepared(
            self._dataset_prepared(selected), names, strict=False,
        )
        source = {
            "kind": source_kind,
            "label": _source_kind_label(source_kind),
            "reference": {
                "datasetVersion": dataset_version,
                "partition": part,
                "splitPreset": preset,
            },
        }
        return self._save(
            username, mode="batch", source_kind=source_kind, source=source,
            dataset_version=dataset_version, dataset_name=manifest.get("dataset"),
            model=model, snapshot=snapshot, names=names, prepared=prepared,
            threshold=threshold, split_preset=preset, partition=part,
            member_sha256=member_sha,
        )

    def create_single_dataset(self, username, dataset_version, manifest, model_id,
                              record_id, threshold=0.5):
        threshold = self._threshold(threshold)
        snapshot, model, names = self._visible_model(
            username, model_id, expected_schema=manifest.get("schemaName"),
        )
        record = self.storage.commit(dataset_version, record_id)
        if record is None:
            raise BaselineError("NOT_FOUND", "数据版本中没有该记录")
        prepared = self._validate_prepared(
            self._dataset_prepared([record]), names, strict=False,
        )
        source = {
            "kind": "single-dataset",
            "label": _source_kind_label("single-dataset"),
            "reference": {"datasetVersion": dataset_version, "recordId": record_id},
        }
        return self._save(
            username, mode="single", source_kind="single-dataset", source=source,
            dataset_version=dataset_version, dataset_name=manifest.get("dataset"),
            model=model, snapshot=snapshot, names=names, prepared=prepared,
            threshold=threshold, split_preset=None, partition=None,
            member_sha256=_member_sha([record_id]),
        )

    def create_single_project(self, username, model_id, project_record, source,
                              threshold=0.5):
        threshold = self._threshold(threshold)
        snapshot, model, names = self._visible_model(username, model_id)
        prepared = [{
            "id": project_record["commitId"],
            "time": project_record.get("authorTime"),
            "label": None,
            "labelStatus": "unavailable",
            "labelAvailability": "unavailable",
            "featureMap": project_record["features"],
            "sourceKind": "single-project",
            "sourceRef": _canonical(source.get("reference")),
        }]
        prepared = self._validate_prepared(prepared, names, strict=False)
        return self._save(
            username, mode="single", source_kind="single-project", source=source,
            dataset_version=None, dataset_name=source.get("datasetName"),
            model=model, snapshot=snapshot, names=names, prepared=prepared,
            threshold=threshold, split_preset=None, partition=None,
            member_sha256=_member_sha([project_record["commitId"]]),
            extra_limitations=["项目分析提交按无标签单条记录预测，不进入评估。"],
        )

    def create_single_manual(self, username, model_id, features, record_id=None,
                             threshold=0.5):
        threshold = self._threshold(threshold)
        snapshot, model, names = self._visible_model(username, model_id)
        if record_id is not None and not isinstance(record_id, str):
            raise BaselineError("INPUT_INVALID", "单条记录标识必须是文本")
        record_id = (record_id or f"manual-{uuid4()}").strip()
        if not record_id or len(record_id) > 200:
            raise BaselineError("INPUT_INVALID", "单条记录标识无效")
        prepared = [{
            "id": record_id,
            "time": None,
            "label": None,
            "labelStatus": "unavailable",
            "labelAvailability": "unavailable",
            "featureMap": features,
            "sourceKind": "single-manual",
            "sourceRef": record_id,
        }]
        prepared = self._validate_prepared(prepared, names, strict=True)
        source = {
            "kind": "single-manual",
            "label": _source_kind_label("single-manual"),
            "reference": {"recordId": record_id},
        }
        return self._save(
            username, mode="single", source_kind="single-manual", source=source,
            dataset_version=None, dataset_name="手工输入",
            model=model, snapshot=snapshot, names=names, prepared=prepared,
            threshold=threshold, split_preset=None, partition=None,
            member_sha256=_member_sha([record_id]),
            extra_limitations=["手工特征单条预测不带真实标签，不进入评估。"],
        )

    def create_unlabeled(self, username, model_id, blob, file_name, threshold=0.5):
        if not isinstance(blob, (bytes, bytearray)) or not blob:
            raise BaselineError("INPUT_INVALID", "CSV 文件为空")
        if len(blob) > MAX_UPLOAD_BYTES:
            raise BaselineError("PREDICTION_TOO_LARGE", "无标签 CSV 超过 16 MiB 上限")
        threshold = self._threshold(threshold)
        snapshot, model, names = self._visible_model(username, model_id)
        try:
            text = bytes(blob).decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise BaselineError("INPUT_INVALID", "CSV 必须使用 UTF-8 编码") from exc
        reader = csv.reader(io.StringIO(text))
        try:
            header = [cell.strip() for cell in next(reader)]
        except StopIteration as exc:
            raise BaselineError("INPUT_INVALID", "CSV 没有表头") from exc
        if not header or any(not cell for cell in header):
            raise BaselineError("INPUT_INVALID", "CSV 表头包含空字段")
        if len(set(header)) != len(header):
            raise BaselineError("INPUT_INVALID", "CSV 表头包含重复字段")
        lowered = [cell.lower() for cell in header]
        if len(set(lowered)) != len(lowered):
            raise BaselineError("INPUT_INVALID", "CSV 表头包含仅大小写不同的重复字段")
        if set(lowered) & {"label", "labelstatus", "bug", "bugcount", "is_defect", "target"}:
            raise BaselineError("INPUT_INVALID", "无标签 CSV 不应包含标签列")
        missing = [name for name in names if name not in header]
        if missing:
            raise BaselineError("FEATURES_INVALID", f"CSV 缺少入模字段：{', '.join(missing)}")
        meta = {
            cell.lower(): index for index, cell in enumerate(header)
            if cell.lower() in UNLABELED_META_COLUMNS
        }
        unknown = [
            cell for index, cell in enumerate(header)
            if cell not in names and index not in meta.values()
        ]
        if unknown:
            raise BaselineError("FEATURES_INVALID", f"CSV 包含未声明字段：{', '.join(unknown)}")
        index_of = {name: header.index(name) for name in names}
        prepared, seen = [], set()
        for row_number, row in enumerate(reader, start=2):
            if not any(cell.strip() for cell in row):
                continue
            if len(row) != len(header):
                raise BaselineError("INPUT_INVALID", f"CSV 第 {row_number} 行列数与表头不一致")
            record_id = ""
            for key in ("recordid", "commitid", "id"):
                if key in meta and row[meta[key]].strip():
                    record_id = row[meta[key]].strip()
                    break
            record_id = record_id or f"row-{row_number - 1}"
            if record_id in seen:
                raise BaselineError("INPUT_INVALID", f"CSV 记录标识重复：{record_id}")
            seen.add(record_id)
            features = {}
            for name in names:
                raw = row[index_of[name]].strip()
                if not raw:
                    raise BaselineError("FEATURES_INVALID", f"CSV 第 {row_number} 行缺少字段 {name}")
                try:
                    features[name] = float(raw)
                except ValueError as exc:
                    raise BaselineError(
                        "FEATURES_INVALID",
                        f"CSV 第 {row_number} 行字段 {name} 不是数值",
                    ) from exc
            author_time = None
            for key in ("authortime", "recordtime"):
                if key in meta and row[meta[key]].strip():
                    author_time = row[meta[key]].strip()
                    break
            prepared.append({
                "id": record_id,
                "time": author_time,
                "label": None,
                "labelStatus": "unavailable",
                "labelAvailability": "unavailable",
                "featureMap": features,
                "sourceKind": "unlabeled-csv",
                "sourceRef": record_id,
            })
            if len(prepared) > MAX_RECORDS:
                raise BaselineError(
                    "PREDICTION_TOO_LARGE",
                    f"一次最多预测 {MAX_RECORDS:,} 条记录",
                )
        if not prepared:
            raise BaselineError("INPUT_INVALID", "CSV 没有数据行")
        prepared = self._validate_prepared(prepared, names, strict=True)
        source = {
            "kind": "unlabeled-csv",
            "label": _source_kind_label("unlabeled-csv"),
            "reference": {
                "fileName": file_name,
                "memberSha256": _member_sha(seen),
            },
        }
        return self._save(
            username, mode="batch", source_kind="unlabeled-csv", source=source,
            dataset_version=None, dataset_name=file_name,
            model=model, snapshot=snapshot, names=names, prepared=prepared,
            threshold=threshold, split_preset=None, partition=None,
            member_sha256=_member_sha(seen),
            extra_limitations=["上传 CSV 按无标签预测处理，不写回训练数据，不进入评估。"],
        )
