"""Safe, read-only model-card projections shared by users and administrators."""
from __future__ import annotations

from .artifacts import PARTITIONS
from .benefit_reports import BenefitReportService
from .data import BaselineError
from .model_diagnostics import PARTITION_LABELS, DiagnosticReportService
from .schemas import resolve


def _partition_summary(summary):
    split = summary.get("split") or {}
    result = {}
    for name in PARTITIONS:
        raw = split.get(name) or {}
        result[name] = {
            "label": PARTITION_LABELS[name],
            "records": raw.get("count"),
            "positives": raw.get("positiveCount"),
            "negatives": (raw.get("count") - raw.get("positiveCount")
                          if isinstance(raw.get("count"), int)
                          and isinstance(raw.get("positiveCount"), int) else None),
            "start": raw.get("start"),
            "end": raw.get("end"),
        }
    return result


def _data_scale(summary, schema):
    existing = summary.get("dataScale")
    if isinstance(existing, dict):
        return existing
    split = summary.get("split") or {}
    return {
        "records": sum(part.get("count", 0) for part in split.values()
                       if isinstance(part.get("count"), int)),
        "featureWidth": schema.input_width(),
        "expertFeatureWidth": len(schema.in_model_names()),
        "semanticFeatureWidth": schema.semantic_dim() if schema.semantic else 0,
        "partitions": {
            name: {
                "records": (split.get(name) or {}).get("count"),
                "positives": (split.get(name) or {}).get("positiveCount"),
                "negatives": (
                    (split.get(name) or {}).get("count") - (split.get(name) or {}).get("positiveCount")
                    if isinstance((split.get(name) or {}).get("count"), int)
                    and isinstance((split.get(name) or {}).get("positiveCount"), int) else None
                ),
            }
            for name in PARTITIONS
        },
    }


def _training_performance(summary, split):
    existing = summary.get("trainingPerformance")
    if isinstance(existing, dict):
        return existing
    duration = summary.get("trainingSeconds")
    records = (split.get("train") or {}).get("count")
    return {
        "durationSeconds": duration,
        "trainingRecords": records,
        "recordsPerSecond": (
            round(records / duration, 6)
            if isinstance(duration, (int, float)) and duration > 0
            and isinstance(records, int) else None
        ),
    }


def _partition_metrics(summary, diagnostics):
    recorded = summary.get("metricsByPartition")
    if isinstance(recorded, dict) and set(recorded) == set(PARTITIONS):
        return {
            name: {"label": PARTITION_LABELS[name], "available": True,
                   "source": "artifact", "metrics": recorded[name]}
            for name in PARTITIONS
        }, {"available": False, "reason": "该模型产物已直接记录三档指标"}
    test = summary.get("metrics")
    if diagnostics is not None:
        report = diagnostics["report"]
        return {
            name: {"label": PARTITION_LABELS[name], "available": True,
                   "source": "frozen-diagnostic", "metrics": report["metricsByPartition"][name]}
            for name in PARTITIONS
        }, {
            "available": True,
            "reportId": diagnostics["reportId"],
            "source": diagnostics["source"],
            "splitDigest": report["splitDigest"],
        }
    result = {}
    for name in PARTITIONS:
        if name == "test" and isinstance(test, dict):
            result[name] = {"label": PARTITION_LABELS[name], "available": True,
                            "source": "artifact", "metrics": test}
        else:
            result[name] = {
                "label": PARTITION_LABELS[name],
                "available": False,
                "source": "not-recorded",
                "reason": "旧模型未记录该分区诊断，且没有匹配的冻结补充报告",
                "metrics": None,
            }
    return result, {"available": False, "reason": "旧模型未记录三档诊断"}


def _benefit_projection(service, run_id):
    entry, error = service.for_run(run_id)
    if error is not None:
        return {"available": False, "reason": error["message"]}
    if entry is None:
        return {"available": False, "reason": "尚无该模型的收益评估报告"}
    report = entry["report"]
    return {
        "available": True,
        "reportId": entry["reportId"],
        "reportVersion": report.get("reportVersion"),
        "test": report["test"],
        "conclusion": report["conclusion"],
        "boundary": report["boundary"],
        "strategies": report["strategies"],
        "comparisons": report.get("comparisons") or {},
        "limitations": report["limitations"],
    }


class ModelCardService:
    def __init__(self, catalog, diagnostics=None, benefits=None):
        self.catalog = catalog
        self.diagnostics = diagnostics or DiagnosticReportService()
        self.benefits = benefits or BenefitReportService()

    def get(self, model_id):
        try:
            snapshot, payload = self.catalog.load_model(model_id)
        except BaselineError as exc:
            try:
                identity = self.catalog.identity(model_id)
            except BaselineError:
                raise
            return {
                "available": False,
                "reason": str(exc),
                "error": {"code": exc.code},
                "modelId": identity["modelId"],
                "name": identity.get("name") or identity["modelId"],
                "method": identity.get("method"),
                "featureSchemaVersion": identity.get("featureSchemaVersion"),
                "enabled": identity.get("enabled"),
                "isDefault": identity.get("isDefault"),
                "limitations": [],
            }

        summary = snapshot.summary
        manifest = snapshot.manifest
        schema = snapshot.schema
        metric_set = manifest["config"].get("metricSet")
        diagnostic_entry, diagnostic_error = self.diagnostics.for_run(
            manifest["runId"], model_sha256=manifest["config"]["modelSha256"],
            dataset_version=summary["datasetVersion"], schema=schema.name,
            metric_set=metric_set)
        metrics, diagnostic_meta = _partition_metrics(summary, diagnostic_entry)
        if diagnostic_error is not None and not diagnostic_meta.get("available"):
            diagnostic_meta = {
                "available": False,
                "reason": diagnostic_error["message"],
            }
        source = summary.get("source") or {}
        model = summary.get("model") or {}
        return {
            "available": bool(payload.get("enabled") and payload.get("state") == "ready"),
            "reason": None if payload.get("enabled") else "模型已停用",
            "modelId": model_id,
            "name": model.get("name") or payload.get("name") or model_id,
            "method": manifest["config"].get("algorithmVersion"),
            "featureSchemaVersion": schema.name,
            "enabled": bool(payload.get("enabled")),
            "isDefault": bool(payload.get("isDefault")),
            "runId": payload.get("runId"),
            "artifactRunId": manifest["runId"],
            "modelSha256": manifest["config"]["modelSha256"],
            "datasetVersion": summary["datasetVersion"],
            "datasetSha256": source.get("sha256"),
            "source": {
                "publisher": source.get("publisher"),
                "revision": source.get("revision"),
                "url": source.get("url"),
                "citation": source.get("citation"),
                "labelRule": source.get("labelRule"),
            },
            "metricSet": metric_set,
            "threshold": summary.get("threshold"),
            "splitRule": summary.get("splitRule"),
            "partitions": _partition_summary(summary),
            "metricsByPartition": metrics,
            "diagnostics": diagnostic_meta,
            "dataScale": _data_scale(summary, schema),
            "trainingPerformance": _training_performance(summary, summary.get("split") or {}),
            "limitations": list(summary.get("limitations") or []),
            "benefit": _benefit_projection(self.benefits, manifest["runId"]),
            "compatibility": {
                "repositoryPredictionSupported": schema.name in (
                    "openstack-six-v1", "kamei14-git-v1", "kamei14-git-v2")
            },
        }
