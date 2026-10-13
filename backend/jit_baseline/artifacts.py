"""Auditable fixed runs and a read-only, label-free inference snapshot."""
import json
import platform
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

import joblib
import numpy as np
from sklearn.pipeline import Pipeline

from .algorithms import DEFAULT_ALGORITHM, get_algorithm, model_descriptor
from .config import BACKEND, BASE_URL, COHORT, LIMITATIONS, MODEL_CONFIG, REVISION, SOURCES, THRESHOLD
from .data import BaselineError, parse_source, sha256, verified_bytes
from .metrics import evaluate
from .model import feature_matrix, fit_model, predict_risks, temporal_split
from .schemas import DEFAULT_SCHEMA, get_schema, resolve

DEFAULT_RUN = BACKEND / "artifacts/baseline"
CORE_FILES = ("source.json", "split.json", "test-input.json", "test-labels.json", "model.joblib", "reference-predictions.json", "metrics.json")
SERVICE_FILES = ("source.json", "split.json", "test-input.json", "model.joblib", "metrics.json", "summary.json")
TRAINING_CODE = ("config.py", "data.py", "model.py", "metrics.py", "artifacts.py",
                 "schemas.py", "algorithms.py", "errors.py")


def identity(obj):
    return sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8"))


def write_json(path, obj):
    Path(path).write_text(json.dumps(obj, ensure_ascii=False, sort_keys=True, allow_nan=False, indent=2) + "\n", encoding="utf-8")


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError as exc:
        raise BaselineError("ARTIFACT_UNAVAILABLE", f"产物不可用：{Path(path).name}") from exc
    except (ValueError, UnicodeError) as exc:
        raise BaselineError("ARTIFACT_INVALID", f"产物格式无效：{Path(path).name}") from exc


def environment():
    return {"python": platform.python_version(), "platform": platform.platform(),
            "packages": {name: version(name) for name in ("numpy", "scipy", "scikit-learn", "joblib", "threadpoolctl", "fastapi", "uvicorn")}}


def feature_schema(schema):
    """摘要里的特征来源说明：已提供与未提供字段及原因（FSV-01、CRR-13）。"""
    return {"name": schema.name,
            "inModel": list(schema.in_model_names()),
            "unavailable": [{"name": field.name, "reason": field.reason} for field in schema.unavailable()]}


def limitations(schema):
    """按当前 schema 生成局限说明，第一项如实列出未提供字段。"""
    fields = "、".join(schema.in_model_names())
    gaps = schema.unavailable()
    if gaps:
        first = (f"特征为具名 schema {schema.name}，入模 {len(schema.in_model_names())} 项（{fields}）；"
                 + "未提供：" + "；".join(f"{field.name}（{field.reason}）" for field in gaps)
                 + "。预测解释未提供。")
    else:
        first = f"特征为具名 schema {schema.name}（{fields}），尚非完整 Kamei14；预测解释未提供。"
    return [first, *LIMITATIONS]


def build_run(source_dir, output, schema=None):
    output, source_dir = Path(output), Path(source_dir)
    schema = resolve(schema if schema is not None else DEFAULT_SCHEMA)
    fields = list(schema.in_model_names())
    if output.exists():
        raise BaselineError("OUTPUT_EXISTS", "运行目录已存在，请为独立复现指定新目录")
    sources = {name: {"url": BASE_URL + relative, "sha256": expected, "bytes": len(verified_bytes(source_dir / name, expected))}
               for name, (relative, expected) in SOURCES.items()}
    records, quality = parse_source(verified_bytes(source_dir / "openstack.csv", SOURCES["openstack.csv"][1]), schema)
    split, boundaries = temporal_split(records)
    pipeline = fit_model(split["train"], schema=schema)
    risks = predict_risks(pipeline, split["test"], schema)
    metrics = evaluate(split["test"], risks)
    dataset_version = "openstack-" + identity({"sources": sources, "cohort": COHORT, "features": fields,
                                               "labelRule": "bugcount > 0; blank = 0", "protocol": schema.name})
    stats = {key: {"count": len(part), "positiveCount": sum(r["label"] for r in part),
                   "start": part[0]["time"], "end": part[-1]["time"], "ids": [r["id"] for r in part]}
             for key, part in split.items()}
    source = {"publisher": "software-rebels/JITMovingTarget", "revision": REVISION,
              "url": "https://github.com/software-rebels/JITMovingTarget/tree/" + REVISION,
              "citation": "McIntosh & Kamei (2018), Are Fix-Inducing Changes a Moving Target? TSE 44(5), 412–428.",
              "files": sources, "sha256": SOURCES["openstack.csv"][1], "quality": quality,
              "labelRule": "bugcount > 0 为 1；零或空计数为未观测到缺陷引入（0），并非已证实无缺陷。"}
    # No usable manifest exists until every artifact is written and checked.
    output.mkdir(parents=True)
    write_json(output / "source.json", source)
    write_json(output / "split.json", {"boundaries": boundaries, "rule": "UTC distinct timestamps, floor(0.70G), floor(0.85G)", "partitions": stats})
    inputs = [{k: r[k] for k in ("id", "time", "epoch", "sourceRow", "metrics", "features")} for r in split["test"]]
    write_json(output / "test-input.json", {"features": fields, "records": inputs})
    write_json(output / "test-labels.json", [{"id": r["id"], "label": r["label"]} for r in split["test"]])
    joblib.dump(pipeline, output / "model.joblib")
    write_json(output / "reference-predictions.json", [{"id": r["id"], "risk": p} for r, p in zip(split["test"], risks, strict=True)])
    write_json(output / "metrics.json", metrics)
    files = {name: sha256((output / name).read_bytes()) for name in CORE_FILES}
    config = {"protocol": schema.name, "schema": schema.name, "algorithmVersion": DEFAULT_ALGORITHM,
              "datasetVersion": dataset_version, "features": fields, "cohort": COHORT,
              "threshold": THRESHOLD, "model": MODEL_CONFIG, "modelSha256": files["model.joblib"], "coreFiles": files,
              "environment": environment(), "sourceCode": {name: sha256((Path(__file__).parent / name).read_bytes()) for name in TRAINING_CODE}}
    run_id = identity(config)
    label = model_descriptor(schema.name)
    summary = {"runId": run_id, "datasetVersion": dataset_version, "modelSha256": files["model.joblib"], "source": source,
               "features": fields, "featureSchema": feature_schema(schema), "cohort": COHORT,
               "split": {key: {k: v for k, v in stat.items() if k != "ids"} for key, stat in stats.items()},
               "metrics": metrics, "threshold": THRESHOLD, "protocolVersion": schema.name,
               "algorithmVersion": DEFAULT_ALGORITHM, "model": {"id": label["id"], "name": label["name"]},
               "limitations": limitations(schema)}
    write_json(output / "summary.json", summary)
    files = dict(files, **{"summary.json": sha256((output / "summary.json").read_bytes())})
    manifest = {"schema": 1, "runId": run_id, "config": config, "files": files,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "command": f"python -m jit_baseline.cli run --output {output.as_posix()}"}
    write_json(output / "manifest.json", manifest)
    verify_run(output)
    return manifest


def declared_schema(config):
    """运行声明的 schema：新运行用 `schema`，旧运行以 `protocol` 作声明；未知名称被拒绝。"""
    return get_schema(config.get("schema") or config.get("protocol"))


def check_files(directory, names):
    directory = Path(directory)
    manifest = read_json(directory / "manifest.json")
    try:
        config = manifest["config"]
        if manifest["schema"] != 1 or identity(config) != manifest["runId"]:
            raise BaselineError("ARTIFACT_INVALID", "运行身份不匹配")
        # 校验按该运行声明的 schema，而不是模块级常量；旧运行按自身声明继续通过。
        schema = declared_schema(config)
        if config["features"] != list(schema.in_model_names()) or config["protocol"] != schema.name:
            raise BaselineError("ARTIFACT_INVALID", "声明字段或协议与 schema 不一致")
        if config["model"] != MODEL_CONFIG or config["cohort"] != COHORT or config["threshold"] != THRESHOLD:
            raise BaselineError("ARTIFACT_INVALID", "固定模型、纳入或阈值不匹配")
        if config.get("algorithmVersion") is not None:
            get_algorithm(config["algorithmVersion"])
        if config["modelSha256"] != manifest["files"]["model.joblib"]:
            raise BaselineError("ARTIFACT_INVALID", "模型身份不匹配")
        for name in names:
            try:
                blob = (directory / name).read_bytes()
            except OSError as exc:
                raise BaselineError("ARTIFACT_UNAVAILABLE", f"产物不可用：{name}") from exc
            if sha256(blob) != manifest["files"][name]:
                raise BaselineError("INTEGRITY_ERROR", f"产物校验不匹配：{name}")
            if name in CORE_FILES and manifest["files"][name] != config["coreFiles"][name]:
                raise BaselineError("INTEGRITY_ERROR", f"产物与运行配置校验不匹配：{name}")
        # 源码指纹是溯源记录（D6）：不再要求与当前文件逐字节相同，运行身份由 identity(config) 与声明算法版本约束。
        code = config.get("sourceCode")
        if not isinstance(code, dict) or not code or any(not isinstance(value, str) or len(value) != 64 for value in code.values()):
            raise BaselineError("ARTIFACT_INVALID", "训练代码溯源记录缺失或无效")
        if environment() != config["environment"]:
            raise BaselineError("ARTIFACT_INVALID", "模型环境版本不匹配")
    except (KeyError, TypeError) as exc:
        raise BaselineError("ARTIFACT_INVALID", "运行 manifest 结构不完整") from exc
    return manifest


@dataclass
class Snapshot:
    model: Pipeline
    records: list
    summary: dict
    manifest: dict
    schema: object = None

    @classmethod
    def load(cls, directory):
        directory = Path(directory)
        manifest = check_files(directory, SERVICE_FILES)
        config = manifest["config"]
        schema = declared_schema(config)
        fields = list(schema.in_model_names())
        inputs, source = read_json(directory / "test-input.json"), read_json(directory / "source.json")
        partitions, summary = read_json(directory / "split.json"), read_json(directory / "summary.json")
        metrics = read_json(directory / "metrics.json")
        try:
            if inputs["features"] != fields or summary["features"] != fields:
                raise BaselineError("ARTIFACT_INVALID", "输入字段顺序不匹配")
            if source != summary["source"] or source["revision"] != REVISION or source["sha256"] != SOURCES["openstack.csv"][1]:
                raise BaselineError("ARTIFACT_INVALID", "摘要来源不匹配")
            if metrics != summary["metrics"] or summary["runId"] != manifest["runId"] or summary["datasetVersion"] != manifest["config"]["datasetVersion"] or summary["modelSha256"] != manifest["config"]["modelSha256"]:
                raise BaselineError("ARTIFACT_INVALID", "摘要与运行身份不匹配")
            records = inputs["records"]
            expected_ids = partitions["partitions"]["test"]["ids"]
            if not records or [r["id"] for r in records] != expected_ids or len(set(expected_ids)) != len(expected_ids) or len(records) != summary["split"]["test"]["count"] or len(records) != metrics["counts"]["records"]:
                raise BaselineError("ARTIFACT_INVALID", "测试身份或数量不一致")
            feature_matrix(records, schema)
            for r in records:
                if set(r) != {"id", "time", "epoch", "sourceRow", "metrics", "features"} or set(r["metrics"]) != set(fields) or r["features"] != [r["metrics"][f] for f in fields]:
                    raise BaselineError("ARTIFACT_INVALID", "原始字段与模型输入不一致")
                if datetime.fromisoformat(r["time"]).timestamp() != r["epoch"]:
                    raise BaselineError("ARTIFACT_INVALID", "提交时间与原始时间不一致")
        except (KeyError, TypeError, ValueError) as exc:
            if isinstance(exc, BaselineError):
                raise
            raise BaselineError("ARTIFACT_INVALID", "输入或摘要结构无效") from exc
        try:
            model = joblib.load(directory / "model.joblib")
            if not isinstance(model, Pipeline) or model.n_features_in_ != len(fields) or set(model.classes_.tolist()) != {0, 1}:
                raise ValueError("model shape")
        except Exception as exc:
            raise BaselineError("MODEL_INVALID", "模型无法加载或类型无效") from exc
        return cls(model, records, summary, manifest, schema)

    def batch(self):
        risks = predict_risks(self.model, self.records, self.schema)
        records = [{"id": r["id"], "time": r["time"], "risk": p, "lines": r["metrics"]["la"] + r["metrics"]["ld"],
                    "files": r["metrics"]["nf"], "metrics": r["metrics"]} for r, p in zip(self.records, risks, strict=True)]
        label = self.summary.get("model") or model_descriptor(self.schema.name)
        return {"contractVersion": 1, "mode": "historical", "project": "OpenStack", "version": self.summary["datasetVersion"],
                "datasetVersion": self.summary["datasetVersion"], "runId": self.manifest["runId"],
                "model": {"id": label["id"], "name": label["name"], "sha256": self.summary["modelSha256"]},
                "summary": self.summary, "records": records}


def verify_run(directory):
    manifest = check_files(directory, (*CORE_FILES, "summary.json"))
    snapshot = Snapshot.load(directory)
    references = read_json(Path(directory) / "reference-predictions.json")
    labels = read_json(Path(directory) / "test-labels.json")
    ids = [r["id"] for r in snapshot.records]
    if ids != [r["id"] for r in references] or ids != [r["id"] for r in labels]:
        raise BaselineError("ARTIFACT_INVALID", "参考风险或评价标签身份不一致")
    current = predict_risks(snapshot.model, snapshot.records, snapshot.schema)
    if not np.allclose(current, [r["risk"] for r in references], rtol=0, atol=1e-8):
        raise BaselineError("ARTIFACT_INVALID", "参考风险与真实模型不一致")
    evaluation_records = [dict(r, label=y["label"]) for r, y in zip(snapshot.records, labels, strict=True)]
    if identity(evaluate(evaluation_records, current)) != identity(snapshot.summary["metrics"]):
        raise BaselineError("ARTIFACT_INVALID", "指标与完整测试风险不一致")
    return manifest


def compare_runs(first, second):
    a, b = Snapshot.load(first), Snapshot.load(second)
    verify_run(first)
    verify_run(second)
    if read_json(Path(first) / "split.json") != read_json(Path(second) / "split.json"):
        raise BaselineError("REPRODUCTION_FAILED", "复现分区不一致")
    maximum = float(np.max(np.abs(np.array(predict_risks(a.model, a.records, a.schema)) - np.array(predict_risks(b.model, b.records, b.schema)))))
    differences = {}
    for key in ("rocAuc", "averagePrecision", "precision", "recall", "f1", "recall20Loc"):
        x, y = a.summary["metrics"][key]["value"], b.summary["metrics"][key]["value"]
        if (x is None) != (y is None):
            raise BaselineError("REPRODUCTION_FAILED", "指标定义状态不同")
        differences[key] = None if x is None else abs(x - y)
    if maximum > 1e-8 or any(d is not None and d > 1e-8 for d in differences.values()):
        raise BaselineError("REPRODUCTION_FAILED", "复现数值超出容差")
    return {"kind": "real-independent-reproduction", "firstRunId": a.manifest["runId"], "secondRunId": b.manifest["runId"],
            "partitionMembershipExact": True, "testCount": len(a.records), "maxRiskAbsoluteDifference": maximum,
            "metricAbsoluteDifferences": differences, "tolerance": 1e-8, "passed": True}
