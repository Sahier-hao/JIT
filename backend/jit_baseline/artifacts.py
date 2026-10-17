"""Auditable fixed runs and a read-only, label-free inference snapshot."""
import json
import platform
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

import joblib
import numpy as np
from sklearn.pipeline import Pipeline

from . import trends
from .algorithms import DEFAULT_ALGORITHM, get_algorithm, model_descriptor
from .config import BACKEND, BASE_URL, COHORT, LIMITATIONS, REVISION, SOURCES, THRESHOLD
from .data import BaselineError, parse_source, sha256, verified_bytes
from .metrics import DEFAULT_METRIC_SET, declared_metric_set, evaluate
from .model import feature_matrix, fit_model, predict_risks, temporal_split
from .schemas import DEFAULT_SCHEMA, get_schema, resolve

DEFAULT_RUN = BACKEND / "artifacts/baseline"
CORE_FILES = ("source.json", "split.json", "test-input.json", "test-labels.json", "model.joblib", "reference-predictions.json", "metrics.json")
SERVICE_FILES = ("source.json", "split.json", "test-input.json", "model.joblib", "metrics.json", "summary.json")
TRAINING_CODE = ("config.py", "data.py", "model.py", "metrics.py", "artifacts.py",
                 "schemas.py", "algorithms.py", "errors.py", "trends.py")
# 每个运行都记录的基础依赖；方法可在其声明里追加自己需要的包（PDB-11）。
BASE_PACKAGES = ("numpy", "scipy", "scikit-learn", "joblib", "threadpoolctl", "fastapi", "uvicorn")


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


def environment(requires=()):
    """运行记录的环境：基础包加该方法声明的依赖（PDB-11）。

    声明的依赖在本机取不到版本时在此给出可定位的领域错误：既不抛出未归类的
    `PackageNotFoundError`，也不把缺失的依赖从记录里省略——省略会让声明与
    实际的运行条件不符，而"运行可追踪"要求声明与事实一致。
    """
    packages = dict.fromkeys((*BASE_PACKAGES, *requires))
    recorded = {}
    for name in packages:
        try:
            recorded[name] = version(name)
        except PackageNotFoundError:
            raise BaselineError("ARTIFACT_INVALID", f"方法声明的依赖未安装：{name}") from None
    return {"python": platform.python_version(), "platform": platform.platform(),
            "packages": recorded}


def environment_matches_this_machine(recorded):
    """该运行是否产生于与本机相同的平台与 Python。

    这只用于**分类**该运行是本机产生还是外部产生，不再作为准入条件：
    跨机器时平台与本机不同是常态，不是失败理由（PDB-16）。
    """
    return (recorded.get("python") == platform.python_version()
            and recorded.get("platform") == platform.platform())


def check_environment(recorded, *, local=None):
    """校验收录的环境声明（PDB-11／PDB-16）。

    结构与取值永远校验。**仅当该运行产生于本机环境时**，才要求它声明的依赖在
    本机以相同版本被满足；外部产生的运行不以此为准入条件——本机满不满足它的
    训练环境，与本机能否加载并重算它无关，后者由加载与重算把关（PDB-17／PDB-18）。
    这样新增依赖（如深度框架）不会作废既有运行，也不会把跨机器产物挡在门外。
    """
    if not isinstance(recorded, dict) or set(recorded) != {"python", "platform", "packages"}:
        raise BaselineError("ARTIFACT_INVALID", "环境声明结构不完整")
    packages = recorded["packages"]
    if not isinstance(packages, dict) or not packages:
        raise BaselineError("ARTIFACT_INVALID", "依赖声明缺失")
    for name in sorted(packages):
        expected = packages[name]
        if not isinstance(expected, str) or not expected:
            raise BaselineError("ARTIFACT_INVALID", f"依赖声明无效：{name}")
    if local is None:
        local = environment_matches_this_machine(recorded)
    if not local:
        return
    for name in sorted(packages):
        expected = packages[name]
        try:
            actual = version(name)
        except PackageNotFoundError:
            raise BaselineError("ARTIFACT_INVALID", f"声明的依赖未安装：{name}") from None
        if actual != expected:
            raise BaselineError("ARTIFACT_INVALID", f"依赖版本不符：{name}（声明 {expected}，当前 {actual}）")


def run_origin(manifest):
    """该运行是本机产生还是外部产生（PDB-19）。

    只依赖产物自身声明的产出环境与本机的比较，不依赖任何本机既存的运行目录或
    某个人本地的状态，因此任一席位在任一台机器上得到一致结论（PDB-15 第四场景）。
    这是校验方的判定，不写回产物：产物只声明它自己的产出环境。
    """
    config = manifest["config"]
    recorded = config.get("trainingEnvironment") or config.get("environment")
    return "local" if environment_matches_this_machine(recorded) else "external"


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


def build_run(source_dir, output, schema=None, algorithm=None, metric_set=None):
    output, source_dir = Path(output), Path(source_dir)
    schema = resolve(schema if schema is not None else DEFAULT_SCHEMA)
    algorithm_version = algorithm if algorithm else DEFAULT_ALGORITHM
    entry = get_algorithm(algorithm_version)
    metric_set = metric_set if metric_set else DEFAULT_METRIC_SET
    declared_metric_set(metric_set)
    fields = list(schema.in_model_names())
    if output.exists():
        raise BaselineError("OUTPUT_EXISTS", "运行目录已存在，请为独立复现指定新目录")
    sources = {name: {"url": BASE_URL + relative, "sha256": expected, "bytes": len(verified_bytes(source_dir / name, expected))}
               for name, (relative, expected) in SOURCES.items()}
    records, quality = parse_source(verified_bytes(source_dir / "openstack.csv", SOURCES["openstack.csv"][1]), schema)
    split, boundaries = temporal_split(records)
    started = time.perf_counter()
    pipeline = fit_model(split["train"], schema=schema, algorithm=algorithm_version)
    training_seconds = round(time.perf_counter() - started, 6)
    risks = predict_risks(pipeline, split["test"], schema)
    metrics = evaluate(split["test"], risks, metric_set)
    # 时间桶聚合在离线产生（design D1/D10）：产物里只有聚合值，服务不必读测试标签。
    trend = trends.build_trend_buckets(split, risks)
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
    config = {"protocol": schema.name, "schema": schema.name, "algorithmVersion": algorithm_version,
              "metricSet": metric_set,
              "datasetVersion": dataset_version, "features": fields, "cohort": COHORT,
              "threshold": THRESHOLD, "model": entry["params"], "modelSha256": files["model.joblib"], "coreFiles": files,
              "trainingEnvironment": environment(entry["requires"]), "sourceCode": {name: sha256((Path(__file__).parent / name).read_bytes()) for name in TRAINING_CODE}}
    run_id = identity(config)
    label = model_descriptor(schema.name, algorithm_version)
    summary = {"runId": run_id, "datasetVersion": dataset_version, "modelSha256": files["model.joblib"], "source": source,
               "features": fields, "featureSchema": feature_schema(schema), "cohort": COHORT,
               "split": {key: {k: v for k, v in stat.items() if k != "ids"} for key, stat in stats.items()},
               "metrics": metrics, "threshold": THRESHOLD, "protocolVersion": schema.name,
               "algorithmVersion": algorithm_version, "metricSet": metric_set,
               "model": {"id": label["id"], "name": label["name"]},
               "trainingSeconds": training_seconds,
               trends.TREND_KEY: trend,
               "limitations": limitations(schema)}
    write_json(output / "summary.json", summary)
    files = dict(files, **{"summary.json": sha256((output / "summary.json").read_bytes())})
    manifest = {"schema": 1, "runId": run_id, "config": config, "files": files,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "command": (f"python -m jit_baseline.cli run --output {output.as_posix()}"
                            f" --schema {schema.name} --algorithm {algorithm_version}")}
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
        # 按该运行声明的方法校验超参，不再与模块级常量比较（PDB-10）；
        # 未注册的方法名在这里以 ALGORITHM_UNKNOWN 被拒绝。
        algorithm_version = config.get("algorithmVersion") or DEFAULT_ALGORITHM
        entry = get_algorithm(algorithm_version)
        if config["model"] != entry["params"]:
            raise BaselineError("ARTIFACT_INVALID", f"运行声明的超参与 {algorithm_version} 的注册声明不一致")
        if config["cohort"] != COHORT or config["threshold"] != THRESHOLD:
            raise BaselineError("ARTIFACT_INVALID", "纳入或阈值不匹配")
        # 未注册的指标集名称在这里以 METRIC_SET_UNKNOWN 被拒绝（PDB-12）。
        declared_metric_set(config.get("metricSet"))
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
        # 环境声明按运行自身记录：新运行用 `trainingEnvironment`（产出它的环境），
        # 无该字段的旧运行回退到 `environment`。是否为本机产生由声明分类，不由外部传参。
        check_environment(config.get("trainingEnvironment") or config.get("environment"))
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
        label = self.summary.get("model") or model_descriptor(self.schema.name, self.manifest["config"].get("algorithmVersion"))
        return {"contractVersion": 1, "mode": "historical", "project": "OpenStack", "version": self.summary["datasetVersion"],
                "datasetVersion": self.summary["datasetVersion"], "runId": self.manifest["runId"],
                "model": {"id": label["id"], "name": label["name"], "sha256": self.summary["modelSha256"]},
                "summary": self.summary, "records": records}


def declared_reproducibility(manifest):
    """该运行声明的方法所声明的复现口径（PDB-14）；无方法声明的旧运行回退到首个冻结方法。"""
    method = manifest["config"].get("algorithmVersion") or DEFAULT_ALGORITHM
    return method, get_algorithm(method)["reproducibility"]


def check_reference_predictions(manifest, current, references):
    """按方法**声明的复现口径**比较重算风险与交付的参考预测（PDB-18）。

    不套用统一容差：数值容差按其声明的 `atol`／`rtol` 判定；声明了其它口径（如独立
    协议）的方法，本机不套用数值容差，也不静默接受——以可定位原因判为不可用，该口径
    的判定方式留待其实现冻结后接入（与 `compare_runs` 的既有立场一致）。
    """
    method, discipline = declared_reproducibility(manifest)
    mode = discipline.get("mode")
    if mode != "tolerance":
        raise BaselineError("REPRODUCTION_FAILED",
                            f"方法 {method} 声明的复现口径为 {mode}，本机校验不套用统一数值容差，"
                            "该口径的风险比较尚未接入")
    if not np.allclose(current, references, rtol=discipline["rtol"], atol=discipline["atol"]):
        raise BaselineError("ARTIFACT_INVALID",
                            f"参考风险与真实模型不一致（超出方法 {method} 声明的容差 atol={discipline['atol']}）")


def verify_run(directory):
    manifest = check_files(directory, (*CORE_FILES, "summary.json"))
    snapshot = Snapshot.load(directory)
    references = read_json(Path(directory) / "reference-predictions.json")
    labels = read_json(Path(directory) / "test-labels.json")
    ids = [r["id"] for r in snapshot.records]
    if ids != [r["id"] for r in references] or ids != [r["id"] for r in labels]:
        raise BaselineError("ARTIFACT_INVALID", "参考风险或评价标签身份不一致")
    current = predict_risks(snapshot.model, snapshot.records, snapshot.schema)
    # 按该运行声明的方法所声明的复现口径比较，不再写死固定容差（PDB-14、PDB-18）。
    check_reference_predictions(manifest, current, [r["risk"] for r in references])
    evaluation_records = [dict(r, label=y["label"]) for r, y in zip(snapshot.records, labels, strict=True)]
    # 按该运行声明的指标集重算：新增指标不影响既有运行（PDB-12）。
    metric_set = manifest["config"].get("metricSet")
    if identity(evaluate(evaluation_records, current, metric_set)) != identity(snapshot.summary["metrics"]):
        raise BaselineError("ARTIFACT_INVALID", "指标与完整测试风险不一致")
    # 声明提供时间桶聚合的运行：重算测试分区的桶并核对守恒（PDB-21）。
    # 未声明的既有运行不受影响：缺少该键时这里不做任何检查。
    recorded_trend = snapshot.summary.get(trends.TREND_KEY)
    if recorded_trend is not None:
        trends.check_aggregate(recorded_trend, evaluation_records, current,
                               snapshot.summary["split"], snapshot.summary["source"]["quality"])
    return manifest


def comparable_metrics(metrics):
    """可数值比较的标量指标：{value, reason} 形态；混淆矩阵等结构项不参与容差比较。"""
    return {name: entry for name, entry in metrics.items()
            if isinstance(entry, dict) and set(entry) == {"value", "reason"}}


def compare_runs(first, second):
    """独立复现比较；容差与指标口径均取自两个运行自身声明的方法（PDB-14）。"""
    a, b = Snapshot.load(first), Snapshot.load(second)
    verify_run(first)
    verify_run(second)
    if read_json(Path(first) / "split.json") != read_json(Path(second) / "split.json"):
        raise BaselineError("REPRODUCTION_FAILED", "复现分区不一致")
    config_a, config_b = a.manifest["config"], b.manifest["config"]
    method_a = config_a.get("algorithmVersion") or DEFAULT_ALGORITHM
    method_b = config_b.get("algorithmVersion") or DEFAULT_ALGORITHM
    if method_a != method_b:
        raise BaselineError("REPRODUCTION_FAILED", f"两次运行声明的方法不同（{method_a} 与 {method_b}），不能按同一口径比较")
    set_a = config_a.get("metricSet") or DEFAULT_METRIC_SET
    set_b = config_b.get("metricSet") or DEFAULT_METRIC_SET
    if set_a != set_b:
        raise BaselineError("REPRODUCTION_FAILED", f"两次运行声明的指标集不同（{set_a} 与 {set_b}），不能按同一口径比较")
    discipline = get_algorithm(method_a)["reproducibility"]
    if discipline.get("mode") != "tolerance":
        raise BaselineError("REPRODUCTION_FAILED", f"方法 {method_a} 声明的复现口径为 {discipline.get('mode')}，本检查只处理数值容差口径")
    atol = discipline["atol"]
    maximum = float(np.max(np.abs(np.array(predict_risks(a.model, a.records, a.schema)) - np.array(predict_risks(b.model, b.records, b.schema)))))
    metrics_a, metrics_b = comparable_metrics(a.summary["metrics"]), comparable_metrics(b.summary["metrics"])
    if set(metrics_a) != set(metrics_b):
        raise BaselineError("REPRODUCTION_FAILED", "两次运行的标量指标集不一致")
    differences = {}
    for key in sorted(metrics_a):
        x, y = metrics_a[key]["value"], metrics_b[key]["value"]
        if (x is None) != (y is None):
            raise BaselineError("REPRODUCTION_FAILED", f"指标 {key} 的定义状态不同")
        differences[key] = None if x is None else abs(x - y)
    if maximum > atol or any(d is not None and d > atol for d in differences.values()):
        raise BaselineError("REPRODUCTION_FAILED", f"复现数值超出 {method_a} 声明的容差（atol={atol}）")
    return {"kind": "real-independent-reproduction", "firstRunId": a.manifest["runId"], "secondRunId": b.manifest["runId"],
            "partitionMembershipExact": True, "testCount": len(a.records), "maxRiskAbsoluteDifference": maximum,
            "metricAbsoluteDifferences": differences, "method": method_a, "metricSet": set_a,
            "reproducibility": discipline, "tolerance": atol, "passed": True}


COMPARISON_PROTOCOL_KEYS = ("name", "ordering", "policy")
COMPARISON_LABELS = {"test": "测试成员", "datasetVersion": "数据版本", "featureSchema": "特征 schema",
                     "threshold": "分类阈值", "metricSet": "指标集", "protocol": "评价协议"}


def compare_methods(directories):
    """并列比较多个方法的运行；只有测试成员与评价口径一致时才声明可直接排名（PDB-20）。

    训练耗时是墙钟量，记在摘要里仅供展示，不进入运行身份。
    """
    if not directories:
        raise BaselineError("EVALUATION_INVALID", "没有可比较的运行")
    entries, reasons, baseline = [], [], None
    for directory in directories:
        snapshot = Snapshot.load(directory)
        summary, config = snapshot.summary, snapshot.manifest["config"]
        metrics = summary["metrics"]
        method = config.get("algorithmVersion") or DEFAULT_ALGORITHM
        entries.append({"method": method, "runId": snapshot.manifest["runId"],
                        "datasetVersion": summary["datasetVersion"],
                        "featureSchema": summary["featureSchema"]["name"],
                        "parameters": config["model"], "threshold": summary["threshold"],
                        "metricSet": config.get("metricSet") or DEFAULT_METRIC_SET,
                        "trainingSeconds": summary.get("trainingSeconds"),
                        "metrics": comparable_metrics(metrics),
                        "counts": metrics.get("counts"), "confusion": metrics.get("confusion"),
                        "effort": metrics.get("effort")})
        current = {"test": tuple(r["id"] for r in snapshot.records),
                   "datasetVersion": summary["datasetVersion"],
                   "featureSchema": summary["featureSchema"]["name"],
                   "threshold": summary["threshold"],
                   "metricSet": config.get("metricSet") or DEFAULT_METRIC_SET,
                   "protocol": tuple((metrics.get("effort") or {}).get(key) for key in COMPARISON_PROTOCOL_KEYS)}
        if baseline is None:
            baseline = current
            continue
        for key, label in COMPARISON_LABELS.items():
            if current[key] != baseline[key]:
                reasons.append(f"{entries[-1]['method']} 的{label}与 {entries[0]['method']} 不同")
    return {"kind": "method-comparison", "directlyRankable": not reasons, "reasons": sorted(set(reasons)),
            "testCount": len(baseline["test"]), "threshold": baseline["threshold"],
            "featureSchema": baseline["featureSchema"], "datasetVersion": baseline["datasetVersion"],
            "metricSet": baseline["metricSet"], "methods": entries,
            "note": "同口径时可并列比较；口径不一致时不可直接排名，也不得据此择优。"}
