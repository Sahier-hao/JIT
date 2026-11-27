"""User-scoped batch scoring over registered datasets and compatible models."""
import json
from bisect import bisect_left
from uuid import uuid4

from ..catalog_storage import utc_now
from ..data import BaselineError
from ..ml import attribution
from ..ml.model import predict_risks

MAX_RECORDS = 20_000
EXPLANATION_LIMIT = 10
RELIABLE_LABEL_STATUSES = {"positive", "unobserved"}


def _threshold_preview(records, risks):
    positives, negatives = [], []
    for record, risk in zip(records, risks, strict=True):
        (positives if record["label"] == 1 else negatives).append(risk)
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


def _label_status_counts(records):
    counts = {}
    for record in records:
        status = record.get("labelStatus") or "unknown"
        counts[status] = counts.get(status, 0) + 1
    return counts


def _evaluation_summary(records, risks, manifest):
    included = [
        (record, risk) for record, risk in zip(records, risks, strict=True)
        if record["labelStatus"] in RELIABLE_LABEL_STATUSES
    ]
    status_counts = _label_status_counts(records)
    included_records = [record for record, _ in included]
    included_risks = [risk for _, risk in included]
    preview = _threshold_preview(included_records, included_risks)
    positive_count = preview["positives"]
    negative_count = preview["negatives"]
    partition = manifest.get("evaluationPartition")
    fixed_partition = (
        isinstance(partition, dict)
        and partition.get("kind") == "test"
        and isinstance(partition.get("memberSha256"), str)
        and len(partition["memberSha256"]) == 64
    )
    if positive_count == 0 or negative_count == 0:
        reason = "缺少可靠的{}标签".format(
            "正例" if positive_count == 0 else "负例")
    elif not fixed_partition:
        reason = "预测批次未声明固定测试分区，只能进行探索性复核"
    else:
        reason = None
    formal = reason is None
    return {
        "format": "model-evaluation-v1",
        "source": "prediction-batch",
        "mode": "formal" if formal else "exploratory",
        "formalAvailable": formal,
        "formalUnavailableReason": reason,
        "partition": {
            "kind": "test" if fixed_partition else "batch",
            "memberSha256": partition.get("memberSha256") if fixed_partition else None,
            "labelSnapshot": True,
        },
        "labelPolicy": {
            "version": "mature-binary-v1",
            "included": sorted(RELIABLE_LABEL_STATUSES),
            "excludedCounts": {
                status: count for status, count in status_counts.items()
                if status not in RELIABLE_LABEL_STATUSES
            },
        },
        "sampleCounts": {
            "included": len(included_records),
            "positives": positive_count,
            "negatives": negative_count,
            "excluded": len(records) - len(included_records),
        },
        "thresholdPreview": preview,
    }


def _model_view(model):
    return {
        "modelId": model["modelId"],
        "name": model.get("name"),
        "method": model.get("method"),
        "runId": model.get("runId"),
        "artifactRunId": model.get("artifactRunId"),
        "featureSchemaVersion": model.get("featureSchemaVersion"),
        "artifactDatasetVersion": model.get("artifactDatasetVersion"),
        "parameters": model.get("parameters"),
        "isDefault": bool(model.get("isDefault")),
    }


class UserPredictionService:
    def __init__(self, storage, catalog):
        self.storage = storage
        self.catalog = catalog

    def models(self, username, schema_name):
        result = []
        # 选择列表读取已保存的校验状态，避免为每次页面加载完整校验全部模型产物；
        # 真正打分前 create() 会加载并重新校验所选模型。
        for model in self.catalog.registered_models(state="ready"):
            if not model.get("enabled"):
                continue
            if not (model.get("shared") or model.get("ownerUserId") == username):
                continue
            if model.get("featureSchemaVersion") != schema_name:
                continue
            result.append(dict(_model_view(model),
                               mine=model.get("ownerUserId") == username,
                               shared=bool(model.get("shared"))))
        result.sort(key=lambda item: (not item["isDefault"], item["name"] or "", item["modelId"]))
        return {"models": result, "maxRecords": MAX_RECORDS}

    def _owned(self, username, batch_id):
        with self.storage.connection() as db:
            row = db.execute(
                "SELECT payload_json FROM user_prediction_batch "
                "WHERE id=? AND owner_user_id=?",
                (batch_id, username),
            ).fetchone()
        if row is None:
            raise BaselineError("NOT_FOUND", "预测批次不存在")
        try:
            payload = json.loads(row["payload_json"])
        except (TypeError, ValueError) as exc:
            raise BaselineError("STORAGE_UNAVAILABLE", "预测批次内容不可用") from exc
        if payload.get("batchId") != batch_id:
            raise BaselineError("STORAGE_UNAVAILABLE", "预测批次身份不一致")
        return payload

    def list(self, username, limit=20, offset=0):
        if not 1 <= limit <= 50 or offset < 0:
            raise BaselineError("INPUT_INVALID", "预测批次分页参数无效")
        with self.storage.connection() as db:
            rows = db.execute(
                "SELECT payload_json FROM user_prediction_batch "
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
            batches.append({key: payload.get(key) for key in (
                "batchId", "datasetVersion", "dataset", "model", "threshold",
                "counts", "labelStatusCounts", "createdAt",
            )})
        return {"batches": batches, "total": total, "limit": limit, "offset": offset}

    def get(self, username, batch_id, limit=100, offset=0, sort="risk"):
        if not 1 <= limit <= 500 or offset < 0 or sort not in ("risk", "time"):
            raise BaselineError("INPUT_INVALID", "预测记录分页参数无效")
        payload = self._owned(username, batch_id)
        order = "risk DESC, author_time DESC, record_id" if sort == "risk" else \
            "author_time, record_id"
        with self.storage.connection() as db:
            rows = db.execute(
                "SELECT id,record_id,author_time,label,label_status,risk,"
                f"features_json,explanation_json FROM user_prediction_record "
                f"WHERE batch_id=? ORDER BY {order} LIMIT ? OFFSET ?",
                (batch_id, limit, offset),
            ).fetchall()
        records = []
        for row in rows:
            try:
                features = json.loads(row["features_json"])
                explanation = (json.loads(row["explanation_json"])
                               if row["explanation_json"] else None)
            except (TypeError, ValueError):
                continue
            records.append({
                "predictionId": row["id"],
                "recordId": row["record_id"],
                "authorTime": row["author_time"],
                "label": row["label"],
                "labelStatus": row["label_status"],
                "risk": row["risk"],
                "features": features,
                "explanation": explanation,
            })
        if "evaluation" not in payload:
            payload = {
                **payload,
                "evaluation": {
                    "format": "model-evaluation-v1",
                    "source": "prediction-batch",
                    "mode": "exploratory",
                    "formalAvailable": False,
                    "formalUnavailableReason": "历史批次未保存可靠标签资格，只能按保存标签复核",
                    "partition": {"kind": "batch", "memberSha256": None,
                                  "labelSnapshot": True},
                    "labelPolicy": None,
                    "sampleCounts": None,
                    "thresholdPreview": payload.get("thresholdPreview"),
                },
            }
        return {**payload, "records": records, "limit": limit, "offset": offset, "sort": sort}

    def create(self, username, dataset_version, manifest, model_id, threshold=0.5):
        if isinstance(threshold, bool) or not isinstance(threshold, (int, float)):
            raise BaselineError("INPUT_INVALID", "阈值必须是 0 到 1 之间的数值")
        threshold = float(threshold)
        if not 0 <= threshold <= 1:
            raise BaselineError("INPUT_INVALID", "阈值必须在 0 到 1 之间")
        total = self.storage.count_commits(dataset_version)
        if total is None:
            raise BaselineError("DATASET_UNAVAILABLE", "数据集尚未导入可评分的提交记录")
        if total == 0:
            raise BaselineError("DATASET_UNAVAILABLE", "数据集没有可评分的提交记录")
        if total > MAX_RECORDS:
            raise BaselineError(
                "PREDICTION_TOO_LARGE",
                f"一次最多试算 {MAX_RECORDS:,} 条提交；当前数据有 {total:,} 条",
            )
        snapshot, model = self.catalog.load_model(model_id)
        owner = model.get("ownerUserId")
        if not (model.get("shared") or owner == username):
            raise BaselineError("MODEL_FORBIDDEN", "该模型未对当前账户开放，不能使用")
        if snapshot.schema.name != manifest.get("schemaName"):
            raise BaselineError(
                "INPUT_SCHEMA_MISMATCH",
                "模型特征 schema 与数据版本不一致",
            )
        if snapshot.schema.semantic is not None or snapshot.schema.input_width() <= 0:
            raise BaselineError("INPUT_SCHEMA_MISMATCH", "该模型不能直接读取表格特征")
        records = self.storage.commits(dataset_version)
        if not records:
            raise BaselineError("DATASET_UNAVAILABLE", "数据集没有可评分的提交记录")
        names = list(snapshot.schema.in_model_names())
        prepared = []
        for record in records:
            features = record.get("features") or {}
            missing = [name for name in names if name not in features]
            if missing:
                raise BaselineError(
                    "DATASET_INVALID",
                    f"提交 {record['commitId']} 缺少入模字段：{', '.join(missing)}",
                )
            prepared.append({
                "id": record["commitId"],
                "time": record["authorTime"],
                "label": record["label"],
                "labelStatus": record.get("labelStatus") or "unknown",
                "featureMap": features,
                "features": [features[name] for name in names],
            })
        risks = predict_risks(snapshot.model, prepared, snapshot.schema)
        ordered = sorted(zip(prepared, risks, strict=True),
                         key=lambda item: (-item[1], item[0]["time"] or "", item[0]["id"]))
        explanations = self._explanations(
            dataset_version, model_id, model, snapshot,
            names, ordered[:EXPLANATION_LIMIT],
        )
        batch_id = str(uuid4())
        created_at = utc_now()
        preview = _threshold_preview(prepared, risks)
        label_status_counts = _label_status_counts(prepared)
        evaluation = _evaluation_summary(prepared, risks, manifest)
        flagged = sum(1 for risk in risks if risk >= threshold)
        limitation_explanation = (
            f"仅为风险最高的 {EXPLANATION_LIMIT} 条记录保存归因；其余记录只显示模型分数。"
        )
        payload = {
            "format": "user-prediction-batch-v1",
            "batchId": batch_id,
            "datasetVersion": dataset_version,
            "dataset": manifest.get("dataset"),
            "model": _model_view(model),
            "threshold": threshold,
            "counts": {
                "records": len(prepared),
                "positives": preview["positives"],
                "negatives": preview["negatives"],
                "flagged": flagged,
            },
            "labelStatusCounts": label_status_counts,
            "thresholdPreview": preview,
            "evaluation": evaluation,
            "explanationCoverage": {
                "method": attribution.METHOD,
                "limit": EXPLANATION_LIMIT,
                "recorded": explanations["recorded"],
                "failed": explanations["failed"],
            },
            "featureNames": names,
            "createdAt": created_at,
            "limitations": [
                "阈值指标按数据版本现有标签试算，不等同于独立测试集验证。",
                "风险是提交级模型估计，不是缺陷概率，也不提供行级定位。",
                "正式评估只使用可靠正例和成熟未观察负例；其余状态单独排除。",
                *([evaluation["formalUnavailableReason"]]
                  if evaluation["formalUnavailableReason"] else []),
                limitation_explanation,
                *explanations["limitations"],
            ],
        }
        record_rows = []
        for record, risk in zip(prepared, risks, strict=True):
            record_rows.append((
                str(uuid4()),
                batch_id,
                record["id"],
                record["time"],
                record["label"],
                record["labelStatus"],
                risk,
                json.dumps(record["featureMap"], ensure_ascii=False, sort_keys=True,
                           allow_nan=False),
                (json.dumps(explanations["items"][record["id"]], ensure_ascii=False,
                            sort_keys=True, allow_nan=False)
                 if record["id"] in explanations["items"] else None),
            ))
        with self.storage.connection(write=True) as db:
            db.execute(
                "INSERT INTO user_prediction_batch VALUES (?,?,?,?,?,?)",
                (batch_id, username, dataset_version, model_id,
                 json.dumps(payload, ensure_ascii=False, sort_keys=True, allow_nan=False),
                 created_at),
            )
            db.executemany(
                "INSERT INTO user_prediction_record VALUES (?,?,?,?,?,?,?,?,?)",
                record_rows,
            )
        return {**payload, "records": [], "limit": 100, "offset": 0, "sort": "risk"}

    def _explanations(self, dataset_version, model_id, model, snapshot,
                      names, ranked):
        items, failed = {}, 0
        limitations = []
        try:
            baseline_version = model.get("artifactDatasetVersion") or dataset_version
            partition_ids = attribution.training_partition_ids(
                self.catalog.model_directory(model_id)
            )
            baseline = attribution.feature_baseline(
                self.storage, baseline_version, names, partition_ids,
            )
            if any(name not in baseline for name in names):
                limitations.append(
                    "部分入模特征缺少训练分区均值；这些字段的归因按零基线计算。"
                )
            def predictor(values):
                return predict_risks(
                    snapshot.model, [{"features": values}], snapshot.schema,
                )
            for record, _risk in ranked:
                try:
                    result = attribution.explain(
                        predictor, record["features"], baseline, names,
                    )
                except Exception:
                    failed += 1
                    continue
                items[record["id"]] = {
                    "status": "supported",
                    "method": result["method"],
                    "items": result["items"],
                    "summary": result["summary"],
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
