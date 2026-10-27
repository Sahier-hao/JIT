"""多数据集套件运行与跨项目报告（MDE-01..06）。

套件是 `build_run` 的编排层：逐方法复用既有训练/校验/落盘路径，只负责选方法、
放目录、记录成功与失败；跨项目报告只并列、不排名。
"""
from datetime import datetime, timezone
from pathlib import Path

from .algorithms import ALGORITHMS, get_algorithm
from .artifacts import build_run, read_json, write_json
from .config import BACKEND
from .data import BaselineError, sha256
from .datasets import load_manifest
from .metrics import get_metric_set

SUITE_FILE = "suite.json"
SUITE_METRIC_SET = "metric-set-v2"

PUBLISHER_LABEL_LIMITATIONS = (
    "零或空 bugcount 表示未观测到缺陷引入，不是已证实无缺陷。",
)
SZZ_LABEL_LIMITATIONS = (
    "特征为提交级聚合，与 Kamei 论文的文件级样本单位不同。",
    "标签由简化 SZZ 生成，未处理重命名、跨文件传播与 issue 关联，不是完整 SZZ。",
)


def select_methods(requested=None):
    """未指定或 all 时返回全部已注册方法；未知方法名被拒绝。"""
    if not requested or list(requested) in (["all"], ("all",)):
        return list(ALGORITHMS)
    names = [name for name in requested if name]
    if not names:
        raise BaselineError("ALGORITHM_UNKNOWN", "未选择任何方法")
    for name in names:
        get_algorithm(name)
    return names


def label_semantics(dataset):
    """由数据集描述文件推导标签语义与限制；不把简化 SZZ 当作完整 SZZ。"""
    collection = dataset.get("collection") or {}
    if collection.get("kind") == "git-repository" or dataset["schemaName"] == "kamei14-git-v1":
        rule = (collection.get("szz") or {}).get("rule") or "szz-simple-v1"
        limitations = tuple(collection.get("limitations") or SZZ_LABEL_LIMITATIONS)
        return {"kind": "simplified-szz", "rule": rule, "limitations": list(limitations)}
    return {"kind": "publisher-labels", "rule": "bugcount > 0",
            "limitations": list(PUBLISHER_LABEL_LIMITATIONS)}


def run_suite(dataset_manifest, output_root, methods=None, metric_set=None, runner=None):
    """对一个已登记数据集运行方法套件；单方法失败不阻塞其余方法。"""
    manifest_path = Path(dataset_manifest)
    dataset = load_manifest(manifest_path)
    names = select_methods(methods)
    metric_set = metric_set or SUITE_METRIC_SET
    get_metric_set(metric_set)
    root = Path(output_root)
    if root.exists():
        raise BaselineError("OUTPUT_EXISTS", "套件目录已存在，请换一个新目录")
    root.mkdir(parents=True)
    run = runner or build_run
    entries = []
    for name in names:
        target = root / name
        try:
            manifest = run(BACKEND / "data/openstack", target, dataset["schemaName"], name,
                           metric_set, dataset_manifest=manifest_path)
            entries.append({"method": name, "status": "succeeded",
                            "runId": manifest["runId"], "path": name})
        except BaselineError as exc:
            entries.append({"method": name, "status": "failed",
                            "code": exc.code, "message": str(exc)})
        except Exception as exc:  # 失败隔离：记录类型与原因，继续其余方法
            entries.append({"method": name, "status": "failed",
                            "code": "MODEL_INVALID", "message": f"{type(exc).__name__}: {exc}"})
    suite = {
        "kind": "multi-dataset-suite",
        "dataset": dataset["dataset"],
        "version": dataset["version"],
        "schemaName": dataset["schemaName"],
        "datasetManifest": {"path": str(manifest_path.resolve()),
                            "sha256": sha256(manifest_path.read_bytes())},
        "csvSha256": dataset["file"]["sha256"],
        "metricSet": metric_set,
        "labelSemantics": label_semantics(dataset),
        "methods": entries,
        "status": "complete" if all(entry["status"] == "succeeded" for entry in entries) else "partial",
        "generatedUtc": datetime.now(timezone.utc).isoformat(),
    }
    write_json(root / SUITE_FILE, suite)
    return suite


COMPARISON_KEYS = {"datasetVersion": "数据版本", "schema": "特征 schema",
                   "metricSet": "指标集", "threshold": "分类阈值", "test": "测试成员"}


def run_facts(run_dir):
    """只读运行产物，得到比较所需事实（不加载模型）。"""
    summary = read_json(run_dir / "summary.json")
    manifest = read_json(run_dir / "manifest.json")
    split = read_json(run_dir / "split.json")
    return {"runId": manifest["runId"], "datasetVersion": summary["datasetVersion"],
            "schema": summary["featureSchema"]["name"],
            "metricSet": manifest["config"].get("metricSet"),
            "threshold": summary["threshold"],
            "test": tuple(split["partitions"]["test"]["ids"]),
            "testCount": split["partitions"]["test"]["count"],
            "metrics": summary["metrics"],
            "trainingSeconds": summary.get("trainingSeconds")}


def within_project(facts):
    """沿用既有比较键的项目内判定（PDB-20 / MDE-05）。"""
    if len(facts) < 2:
        return {"directlyRankable": False, "reasons": ["成功方法少于两个，无法做项目内比较"]}
    reasons = []
    base = facts[0]
    for fact in facts[1:]:
        for key, label in COMPARISON_KEYS.items():
            if fact[key] != base[key]:
                reasons.append(f"{fact['runId'][:12]} 的{label}与 {base['runId'][:12]} 不同")
    return {"directlyRankable": not reasons, "reasons": sorted(set(reasons))}


def compare_projects(suite_dirs):
    """按项目分组报告；跨项目固定不可直接排名，不给出排名或择优结论。"""
    if not suite_dirs:
        raise BaselineError("EVALUATION_INVALID", "没有可比较的套件")
    projects = []
    for directory in suite_dirs:
        directory = Path(directory)
        suite = read_json(directory / SUITE_FILE)
        facts, methods = [], []
        for item in suite["methods"]:
            entry = {"method": item["method"], "status": item["status"]}
            if item["status"] == "succeeded":
                current = run_facts(directory / item["method"])
                facts.append(current)
                entry.update({"runId": current["runId"], "datasetVersion": current["datasetVersion"],
                              "metrics": current["metrics"], "testCount": current["testCount"],
                              "trainingSeconds": current["trainingSeconds"]})
            else:
                entry.update({"code": item.get("code"), "message": item.get("message")})
            methods.append(entry)
        projects.append({"dataset": suite["dataset"], "version": suite["version"],
                         "schema": suite["schemaName"], "metricSet": suite["metricSet"],
                         "datasetVersion": facts[0]["datasetVersion"] if facts else None,
                         "labelSemantics": suite["labelSemantics"],
                         "limitations": suite["labelSemantics"]["limitations"],
                         "methods": methods, "withinProject": within_project(facts)})
    reasons = []
    base = projects[0]
    cross_keys = (("datasetVersion", "数据集版本"), ("schema", "特征 schema"),
                  ("metricSet", "指标集"), ("labelSemantics", "标签语义"))
    for project in projects[1:]:
        for key, label in cross_keys:
            if project[key] != base[key]:
                reasons.append(f"{project['dataset']} 的{label}与 {base['dataset']} 不同")
    if not reasons:
        reasons.append("不同项目的人群与标签语义不可直接比较，即使声明相同")
    return {"kind": "cross-project-report", "directlyRankable": False,
            "reasons": sorted(set(reasons)),
            "note": "跨项目只并列、不排名；项目内比较见各项目 withinProject。",
            "projects": projects}
