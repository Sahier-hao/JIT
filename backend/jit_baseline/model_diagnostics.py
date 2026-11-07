"""Frozen train/validation/test diagnostics for legacy model artifacts."""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from .artifacts import PARTITION_DIAGNOSTICS_VERSION, PARTITIONS, Snapshot, read_json, write_json
from .config import BACKEND, SOURCES
from .data import BaselineError, parse_source, sha256
from .datasets import load_all, load_manifest
from .metrics import DEFAULT_METRIC_SET, evaluate
from .model import predict_risks
from .schemas import resolve

REPORT_KIND = "model-partition-diagnostics"
REPORT_VERSION = 1
PARTITION_LABELS = {
    "train": "拟合诊断",
    "validation": "模型选择背景",
    "test": "冻结泛化评价",
}
DEFAULT_REPORT_ROOTS = (BACKEND / "artifacts/model-diagnostics",
                        BACKEND.parent / "docs/evidence/model-diagnostics")
MAX_REPORT_BYTES = 2 * 1024 * 1024


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def split_digest(partitions):
    return hashlib.sha256(_canonical({
        name: partitions[name]["ids"] for name in PARTITIONS
    })).hexdigest()


def _dataset_source(config, summary, dataset_root=None):
    schema = resolve(config.get("schema") or config.get("protocol"))
    declared = config.get("datasetManifest")
    if declared:
        if not isinstance(declared, dict) or not isinstance(declared.get("path"), str):
            raise BaselineError("ARTIFACT_INVALID", "数据集描述文件声明无效")
        path = Path(declared["path"])
        path = path if path.is_absolute() else BACKEND / path
        if sha256(path.read_bytes()) != declared.get("sha256"):
            raise BaselineError("INTEGRITY_ERROR", "数据集描述文件校验不匹配")
        manifest = load_manifest(path)
        csv_path = Path(manifest["file"]["path"])
        csv_path = csv_path if csv_path.is_absolute() else BACKEND / csv_path
        return manifest, csv_path, manifest["cohort"]

    try:
        registered = load_all(dataset_root)
    except BaselineError:
        registered = {}
    manifest = registered.get(summary.get("datasetVersion"))
    if manifest is not None:
        path = Path(manifest["manifestPath"])
        path = path if path.is_absolute() else BACKEND / path
        manifest = load_manifest(path)
        csv_path = Path(manifest["file"]["path"])
        csv_path = csv_path if csv_path.is_absolute() else BACKEND / csv_path
        return manifest, csv_path, manifest["cohort"]

    # 九个早期 OpenStack 产物在数据集描述文件机制之前生成；只接受其自身声明的
    # 来源哈希与固定 OpenStack 文件完全一致的情况，不按名称猜测其他数据。
    source = summary.get("source") or {}
    expected = SOURCES["openstack.csv"]["sha256"]
    if schema.name == "openstack-six-v1" and source.get("sha256") == expected:
        return None, BACKEND / "data/openstack/openstack.csv", config.get("cohort")
    raise BaselineError("DATASET_UNAVAILABLE", "模型声明的数据集来源不可用")


def _load_partition_records(run_dir, snapshot, split_doc, dataset_root):
    summary = snapshot.summary
    config = snapshot.manifest["config"]
    manifest, csv_path, cohort = _dataset_source(config, summary, dataset_root)
    try:
        blob = csv_path.read_bytes()
    except OSError as exc:
        raise BaselineError("DATASET_UNAVAILABLE", "模型数据集来源文件不可用") from exc
    expected_hash = (manifest["file"]["sha256"] if manifest
                     else (summary.get("source") or {}).get("sha256"))
    if not isinstance(expected_hash, str) or sha256(blob) != expected_hash:
        raise BaselineError("INTEGRITY_ERROR", "模型数据集来源文件校验不匹配")
    records, quality = parse_source(blob, snapshot.schema, cohort)
    if manifest and quality != manifest["quality"]:
        raise BaselineError("DATASET_INVALID", "数据集质量统计无法重算")
    if not manifest and quality != (summary.get("source") or {}).get("quality"):
        raise BaselineError("DATASET_INVALID", "数据集质量统计无法重算")
    by_id = {record["id"]: record for record in records}
    partitions = split_doc.get("partitions")
    if not isinstance(partitions, dict) or set(partitions) != set(PARTITIONS):
        raise BaselineError("ARTIFACT_INVALID", "切分摘要缺少三个分区")
    selected = {}
    for name in PARTITIONS:
        ids = partitions[name].get("ids")
        if (not isinstance(ids, list) or not ids or len(ids) != len(set(ids))
                or any(not isinstance(value, str) for value in ids)):
            raise BaselineError("ARTIFACT_INVALID", f"{name} 分区成员无效")
        try:
            selected[name] = [by_id[value] for value in ids]
        except KeyError as exc:
            raise BaselineError("ARTIFACT_INVALID", f"{name} 分区含未登记提交") from exc
        if (len(selected[name]) != partitions[name].get("count")
                or sum(item["label"] for item in selected[name]) != partitions[name].get("positiveCount")):
            raise BaselineError("ARTIFACT_INVALID", f"{name} 分区数量与摘要不一致")
    if [item["id"] for item in selected["test"]] != [item["id"] for item in snapshot.records]:
        raise BaselineError("ARTIFACT_INVALID", "测试分区成员与模型产物不一致")
    if set().union(*(set(item["id"] for item in part) for part in selected.values())):
        all_ids = [item["id"] for part in selected.values() for item in part]
        if len(all_ids) != len(set(all_ids)):
            raise BaselineError("ARTIFACT_INVALID", "切分分区存在重叠成员")
    return manifest, blob, selected


def generate_report(run_dir, *, dataset_root=None, generated_utc=None):
    run_dir = Path(run_dir)
    snapshot = Snapshot.load(run_dir)
    split_doc = read_json(run_dir / "split.json")
    manifest, source_blob, selected = _load_partition_records(
        run_dir, snapshot, split_doc, dataset_root)
    metric_set = snapshot.manifest["config"].get("metricSet") or DEFAULT_METRIC_SET
    metrics = {}
    for name in PARTITIONS:
        records = selected[name]
        risks = predict_risks(snapshot.model, records, snapshot.schema)
        metrics[name] = evaluate(records, risks, metric_set)
    if metrics["test"] != snapshot.summary["metrics"]:
        raise BaselineError("REPORT_CONFLICT", "重算测试指标与原模型摘要冲突")
    partitions = {}
    for name in PARTITIONS:
        raw = split_doc["partitions"][name]
        partitions[name] = {
            "label": PARTITION_LABELS[name],
            "count": raw["count"],
            "positives": raw["positiveCount"],
            "negatives": raw["count"] - raw["positiveCount"],
            "start": raw.get("start"),
            "end": raw.get("end"),
            "idsDigest": hashlib.sha256(_canonical(raw["ids"])).hexdigest(),
        }
    source = snapshot.summary.get("source") or {}
    try:
        command_run = run_dir.resolve().relative_to(BACKEND.resolve()).as_posix()
    except ValueError:
        command_run = run_dir.name
    return {
        "kind": REPORT_KIND,
        "reportVersion": REPORT_VERSION,
        "diagnosticsVersion": PARTITION_DIAGNOSTICS_VERSION,
        "artifactRunId": snapshot.manifest["runId"],
        "modelSha256": snapshot.manifest["config"]["modelSha256"],
        "datasetVersion": snapshot.summary["datasetVersion"],
        "sourceSha256": sha256(source_blob),
        "schema": snapshot.schema.name,
        "metricSet": metric_set,
        "threshold": snapshot.summary["threshold"],
        "splitRule": split_doc.get("rule"),
        "splitDigest": split_digest(split_doc["partitions"]),
        "partitions": partitions,
        "metricsByPartition": metrics,
        "generatedUtc": generated_utc or datetime.now(timezone.utc).isoformat(),
        "generationCommand": (
            "python -m jit_baseline.cli diagnose-model "
            f"--run {command_run} --output docs/evidence/model-diagnostics"
        ),
    }


def write_report(report, output):
    output = Path(output)
    target = output if output.suffix == ".json" else output / f"{report['artifactRunId']}.json"
    if target.exists():
        existing = read_json(target)
        _validate(existing)
        comparable = ("artifactRunId", "modelSha256", "datasetVersion", "sourceSha256",
                      "schema", "metricSet", "threshold", "splitDigest",
                      "metricsByPartition")
        if any(existing.get(key) != report.get(key) for key in comparable):
            raise BaselineError("REPORT_CONFLICT", "诊断报告已存在且内容不同，不覆盖")
        return existing, target, False
    target.parent.mkdir(parents=True, exist_ok=True)
    write_json(target, report)
    return report, target, True


def _validate(report):
    if not isinstance(report, dict) or report.get("kind") != REPORT_KIND:
        raise BaselineError("REPORT_INVALID", "不是模型分区诊断报告")
    if report.get("reportVersion") != REPORT_VERSION:
        raise BaselineError("REPORT_INVALID", "分区诊断报告版本不受支持")
    for key in ("artifactRunId", "modelSha256", "datasetVersion", "sourceSha256",
                "schema", "metricSet", "splitDigest"):
        if not isinstance(report.get(key), str) or not report[key]:
            raise BaselineError("REPORT_INVALID", f"分区诊断报告缺少 {key}")
    partitions = report.get("partitions")
    metrics = report.get("metricsByPartition")
    if not isinstance(partitions, dict) or set(partitions) != set(PARTITIONS):
        raise BaselineError("REPORT_INVALID", "分区诊断报告缺少三个分区")
    if not isinstance(metrics, dict) or set(metrics) != set(PARTITIONS):
        raise BaselineError("REPORT_INVALID", "分区诊断报告缺少三档指标")
    for name in PARTITIONS:
        part = partitions[name]
        if (not isinstance(part, dict) or not isinstance(part.get("count"), int)
                or not isinstance(part.get("positives"), int)
                or not isinstance(part.get("idsDigest"), str)):
            raise BaselineError("REPORT_INVALID", f"{name} 分区摘要无效")
        counts = metrics[name].get("counts") if isinstance(metrics[name], dict) else None
        if not isinstance(counts, dict) or counts.get("records") != part["count"]:
            raise BaselineError("REPORT_INVALID", f"{name} 分区指标与数量不一致")
    if report.get("threshold") is None or not isinstance(report.get("splitRule"), str):
        raise BaselineError("REPORT_INVALID", "分区诊断报告缺少阈值或切分规则")
    return report


class DiagnosticReportService:
    def __init__(self, roots=None):
        configured = os.environ.get("JIT_MODEL_DIAGNOSTICS_ROOT")
        self.roots = [Path(item) for item in configured.split(os.pathsep) if item.strip()] \
            if configured else [Path(item) for item in (roots or DEFAULT_REPORT_ROOTS)]

    def _entries(self):
        seen = set()
        for root in self.roots:
            try:
                root = root.resolve()
            except OSError:
                continue
            if not root.is_dir():
                continue
            for path in sorted(root.glob("**/*.json")):
                try:
                    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_REPORT_BYTES:
                        continue
                    real = path.resolve()
                    if not real.is_relative_to(root):
                        continue
                    blob = real.read_bytes()
                except OSError:
                    continue
                digest = sha256(blob)
                if digest in seen:
                    continue
                seen.add(digest)
                yield path, root, blob

    def for_run(self, run_id, *, model_sha256, dataset_version, schema, metric_set):
        candidates, invalid = [], None
        for path, root, blob in self._entries():
            try:
                report = _validate(json.loads(blob.decode("utf-8")))
            except (BaselineError, UnicodeError, ValueError) as exc:
                try:
                    raw = json.loads(blob.decode("utf-8"))
                except (UnicodeError, ValueError):
                    continue
                if isinstance(raw, dict) and raw.get("artifactRunId") == run_id:
                    invalid = {"code": getattr(exc, "code", "REPORT_INVALID"),
                               "message": str(exc), "source": self._display(path, root)}
                continue
            if report["artifactRunId"] != run_id:
                continue
            mismatch = (
                report["modelSha256"] != model_sha256
                or report["datasetVersion"] != dataset_version
                or report["schema"] != schema
                or report["metricSet"] != metric_set
            )
            if mismatch:
                invalid = {"code": "REPORT_CONFLICT",
                           "message": "分区诊断报告与模型身份或评价口径不一致",
                           "source": self._display(path, root)}
                continue
            candidates.append({"reportId": sha256(blob)[:24],
                               "source": self._display(path, root),
                               "report": report})
        if candidates:
            candidates.sort(key=lambda item: (
                item["report"].get("generatedUtc") or "", item["reportId"]), reverse=True)
            return candidates[0], None
        return None, invalid

    @staticmethod
    def _display(path, root):
        try:
            return path.resolve().relative_to(BACKEND.parent.resolve()).as_posix()
        except ValueError:
            return path.name
