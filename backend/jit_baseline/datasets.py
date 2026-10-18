"""数据集描述文件：登记、校验与加载。

描述文件是数据集的事实来源（DSR-01..DSR-05）：原始文件校验值、字段定义、质量统计
与时间范围都在登记时从真实 CSV 重算并写入，之后只读，不再由运行产物派生。

字段定义直接取自 `schemas.py` 的具名 schema（D2），不复制字段表；质量统计复用
`data.parse_source`，保证登记与训练使用同一套纳入规则。
"""
import json
import re
from pathlib import Path

from .config import BACKEND, BASE_URL, COHORT, REVISION, SOURCES
from .data import parse_source, sha256
from .errors import BaselineError
from .schemas import DEFAULT_SCHEMA, resolve

MANIFEST_SCHEMA = 1
DATASETS = BACKEND / "data" / "datasets"
VERSION_PATTERN = re.compile(
    r"^(?P<dataset>[a-z0-9][a-z0-9._-]*)-(?P<start>\d{4}-\d{2}-\d{2})_(?P<end>\d{4}-\d{2}-\d{2})$")
DATASET_PATTERN = re.compile(r"[a-z0-9][a-z0-9._-]*")
HEX64 = re.compile(r"[0-9a-f]{64}")
QUALITY_KEYS = ("rawRows", "includedRows", "positiveLabels", "blankLabels", "featureMissing", "excluded")
EXCLUDED_KEYS = ("outsideWindow", "noAddedLines", "tooMuchChurn", "tooManyFiles", "missingRequiredField")
REQUIRED = ("schema", "dataset", "version", "publisher", "revision", "url", "citation", "schemaName",
            "file", "fields", "cohort", "quality", "timeRange", "samples")
CITATION = "McIntosh & Kamei (2018), Are Fix-Inducing Changes a Moving Target? TSE 44(5), 412-428."


def _dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False, indent=2) + "\n"


def field_definitions(schema):
    """按 schema 声明生成描述文件的字段定义（顺序、来源列、入模标记与变换）。"""
    return [{"name": field.name, "source": field.source, "inModel": field.in_model,
             "transform": field.transform, "blank": field.blank, "integer": field.integer,
             "binary": field.binary, "status": field.status, "reason": field.reason}
            for field in resolve(schema).fields]


def _source_file(csv_path):
    """描述文件里的来源路径：优先相对 backend 根目录，便于跨机器复现。"""
    resolved = Path(csv_path).resolve()
    try:
        relative = resolved.relative_to(BACKEND.resolve()).as_posix()
    except ValueError:
        relative = resolved.as_posix()
    try:
        blob = resolved.read_bytes()
    except OSError as exc:
        raise BaselineError("DATASET_INVALID", f"来源不可用：{resolved.name}") from exc
    return resolved, relative, blob


def build_manifest(csv_path, schema=None, dataset=None, version=None, cohort=None, provenance=None,
                   extra=None):
    """从原始 CSV 生成描述文件内容；不写盘。

    `cohort` 省略时用 OpenStack 固定窗口；仓库采集传入自己的范围与阈值。
    `provenance` 可覆盖发布者、revision、URL 与引用，默认保持原公开数据集元信息。
    `extra` 附加来源证据（如采集记录），不得覆盖必需字段。
    """
    schema = resolve(schema if schema is not None else DEFAULT_SCHEMA)
    resolved, relative, blob = _source_file(csv_path)
    records, quality = parse_source(blob, schema, cohort)
    if not records:
        raise BaselineError("DATASET_INVALID", "没有纳入记录，无法登记数据集")
    name = dataset or schema.name
    if not isinstance(name, str) or not DATASET_PATTERN.fullmatch(name):
        raise BaselineError("DATASET_INVALID", f"数据集名无效：{name}")
    start, end = records[0]["time"][:10], records[-1]["time"][:10]
    computed = f"{name}-{start}_{end}"
    if version is None:
        version = computed
    match = VERSION_PATTERN.fullmatch(version or "")
    if not match or match["dataset"] != name:
        raise BaselineError("DATASET_INVALID", f"版本名须为 <数据集>-<起始日>_<结束日>：{version}")
    if (match["start"], match["end"]) != (start, end):
        raise BaselineError("DATASET_INVALID",
                            f"版本名时间范围与数据不符（数据为 {start}_{end}）：{version}")
    source = SOURCES.get("openstack.csv", {})
    published = dict(provenance or {})
    published_url = (BASE_URL + source.get("path", "data/openstack.csv")
                     if resolved.name == "openstack.csv" else resolved.as_uri())
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "dataset": name,
        "version": version,
        "publisher": published.get("publisher", "software-rebels/JITMovingTarget"),
        "revision": published.get("revision", REVISION),
        "url": published.get("url", published_url),
        "citation": published.get("citation", CITATION),
        "schemaName": schema.name,
        "file": {"name": resolved.name, "path": relative, "sha256": sha256(blob), "bytes": len(blob)},
        "fields": field_definitions(schema),
        "cohort": dict(COHORT if cohort is None else cohort),
        "quality": quality,
        "timeRange": {"start": records[0]["time"], "end": records[-1]["time"],
                      "startEpoch": records[0]["epoch"], "endEpoch": records[-1]["epoch"]},
        "samples": [{"id": record["id"], "time": record["time"]}
                    for record in records[:3] + records[-2:]],
    }
    for key, value in (extra or {}).items():
        if key in REQUIRED:
            raise BaselineError("DATASET_INVALID", f"附加证据不能覆盖必需字段：{key}")
        manifest[key] = value
    return manifest


def validate_manifest(manifest):
    """校验描述文件的必需字段、schema 绑定与质量统计结构；不重算 CSV。"""
    if not isinstance(manifest, dict):
        raise BaselineError("DATASET_INVALID", "描述文件必须是 JSON 对象")
    missing = [key for key in REQUIRED if key not in manifest]
    if missing:
        raise BaselineError("DATASET_INVALID", "描述文件缺少必需字段：" + "、".join(missing))
    if manifest["schema"] != MANIFEST_SCHEMA:
        raise BaselineError("DATASET_INVALID", f"描述文件 schema 版本无效：{manifest['schema']}")
    name, version = manifest["dataset"], manifest["version"]
    if not isinstance(name, str) or not DATASET_PATTERN.fullmatch(name):
        raise BaselineError("DATASET_INVALID", f"数据集名无效：{name}")
    match = VERSION_PATTERN.fullmatch(version or "")
    if not match or match["dataset"] != name:
        raise BaselineError("DATASET_INVALID", f"版本名无效：{version}")
    try:
        schema = resolve(manifest["schemaName"])
    except BaselineError as exc:
        raise BaselineError("DATASET_INVALID", f"描述文件引用了未注册的 schema：{manifest['schemaName']}") from exc
    if manifest["fields"] != field_definitions(schema):
        raise BaselineError("DATASET_INVALID", f"字段定义与 schema {schema.name} 声明不一致")
    file = manifest["file"]
    if not isinstance(file, dict) or not isinstance(file.get("path"), str) or not HEX64.fullmatch(file.get("sha256") or ""):
        raise BaselineError("DATASET_INVALID", "描述文件的来源校验记录无效")
    quality = manifest["quality"]
    if not isinstance(quality, dict) or any(key not in quality for key in QUALITY_KEYS):
        raise BaselineError("DATASET_INVALID", "描述文件的质量统计不完整")
    if not isinstance(quality.get("featureMissing"), dict) or isinstance(quality.get("featureMissing"), list):
        raise BaselineError("DATASET_INVALID", "描述文件的字段缺失统计无效")
    excluded = quality.get("excluded")
    if not isinstance(excluded, dict) or any(key not in excluded for key in EXCLUDED_KEYS):
        raise BaselineError("DATASET_INVALID", "描述文件的排除规则统计不完整")
    if set(quality["featureMissing"]) != set(schema.in_model_names()):
        raise BaselineError("DATASET_INVALID", "字段缺失统计与 schema 不一致")
    if not isinstance(manifest["cohort"], dict) or set(manifest["cohort"]) != set(COHORT):
        raise BaselineError("DATASET_INVALID", "描述文件的纳入规则无效")
    time_range = manifest["timeRange"]
    if not isinstance(time_range, dict) or not isinstance(time_range.get("start"), str) or not isinstance(time_range.get("end"), str):
        raise BaselineError("DATASET_INVALID", "描述文件的时间范围无效")
    if (time_range["start"][:10], time_range["end"][:10]) != (match["start"], match["end"]):
        raise BaselineError("DATASET_INVALID", "版本名时间范围与描述的时间范围不一致")
    if not isinstance(manifest["samples"], list) or not manifest["samples"]:
        raise BaselineError("DATASET_INVALID", "描述文件缺少样本")
    return manifest


def load_manifest(path):
    path = Path(path)
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise BaselineError("DATASET_UNAVAILABLE", f"描述文件不可用：{path.name}") from exc
    except (ValueError, UnicodeError) as exc:
        raise BaselineError("DATASET_INVALID", f"描述文件格式无效：{path.name}") from exc
    return validate_manifest(manifest)


def manifest_relative(path):
    path = Path(path).resolve()
    try:
        return path.relative_to(BACKEND.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def register(csv_path, schema=None, dataset=None, version=None, root=None, cohort=None, provenance=None,
             extra=None):
    """登记数据集：写 `<root>/<dataset>/<version>.json`；同内容重复登记幂等。"""
    manifest = build_manifest(csv_path, schema=schema, dataset=dataset, version=version,
                              cohort=cohort, provenance=provenance, extra=extra)
    text = _dump(manifest)
    root = Path(root) if root is not None else DATASETS
    target = root / manifest["dataset"] / (manifest["version"] + ".json")
    if target.exists():
        try:
            existing = target.read_text(encoding="utf-8")
        except OSError as exc:
            raise BaselineError("DATASET_UNAVAILABLE", f"描述文件不可读：{target.name}") from exc
        if existing == text:
            return {"dataset": manifest["dataset"], "version": manifest["version"],
                    "path": manifest_relative(target), "sha256": sha256(text.encode("utf-8")), "created": False}
        raise BaselineError("DATASET_EXISTS", f"版本已登记且内容不同，不覆盖：{manifest['version']}")
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(target.name + ".tmp")
    try:
        temp.write_text(text, encoding="utf-8")
        temp.replace(target)
    except OSError as exc:
        raise BaselineError("DATASET_UNAVAILABLE", f"描述文件写入失败：{target.name}") from exc
    return {"dataset": manifest["dataset"], "version": manifest["version"],
            "path": manifest_relative(target), "sha256": sha256(text.encode("utf-8")), "created": True}


def load_all(root=None):
    """加载全部已登记描述文件；目录为空即失败，不退回内建常量（DSR-06）。"""
    root = Path(root) if root is not None else DATASETS
    if not root.is_dir():
        raise BaselineError("DATASET_REGISTRY_EMPTY", f"数据集描述目录不存在：{root}")
    registered = {}
    for path in sorted(root.glob("*/*.json")):
        if path.name.endswith(".tmp"):
            continue
        manifest = load_manifest(path)
        if manifest["version"] in registered:
            raise BaselineError("DATASET_INVALID", f"数据集版本重复登记：{manifest['version']}")
        registered[manifest["version"]] = dict(manifest, manifestPath=manifest_relative(path))
    if not registered:
        raise BaselineError("DATASET_REGISTRY_EMPTY", f"没有已登记的数据集描述文件：{root}")
    return registered


def check_run(registry, config):
    """运行声明与描述文件一致（DSR-06）：返回该运行声明的描述文件；旧运行返回 None。"""
    declared = config.get("datasetManifest")
    if declared is None:
        return None
    if not isinstance(declared, dict) or not isinstance(declared.get("path"), str) or not HEX64.fullmatch(declared.get("sha256") or ""):
        raise BaselineError("ARTIFACT_INVALID", "运行声明的数据集描述文件记录无效")
    path = Path(declared["path"])
    if not path.is_absolute():
        path = BACKEND / path
    manifest = load_manifest(path)
    if sha256(path.read_bytes()) != declared["sha256"]:
        raise BaselineError("ARTIFACT_INVALID", f"数据集描述文件校验不匹配：{manifest['version']}")
    if manifest["version"] != config.get("datasetVersion"):
        raise BaselineError("ARTIFACT_INVALID", "数据集版本与描述文件不一致")
    if manifest["cohort"] != config.get("cohort"):
        raise BaselineError("ARTIFACT_INVALID", "纳入规则与描述文件不一致")
    if manifest["version"] not in registry:
        raise BaselineError("DATASET_REGISTRY_EMPTY", f"描述文件未登记：{manifest['version']}")
    return manifest
