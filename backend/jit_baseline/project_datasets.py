"""Project-scoped dataset projections and verified exports."""
import csv
import io
import json
import os
import re
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from openpyxl import Workbook

from . import datasets
from .config import BACKEND
from .data import BaselineError, sha256

MAX_EXPORT_BYTES = 64 * 1024 * 1024
MAX_XLSX_ROWS = 100_000


def _scrub_absolute_paths(value):
    if isinstance(value, dict):
        for key in list(value):
            item = value[key]
            if key == "path" and isinstance(item, str) and Path(item).is_absolute():
                value.pop(key)
            else:
                _scrub_absolute_paths(item)
    elif isinstance(value, list):
        for item in value:
            _scrub_absolute_paths(item)


def _absolute(path):
    value = Path(path)
    return value if value.is_absolute() else BACKEND / value


def _safe_source(manifest):
    collection = manifest.get("collection") or {}
    repository = collection.get("repository") or {}
    url = manifest.get("url")
    parsed = urlparse(url or "")
    public_url = url if parsed.scheme in ("http", "https") else None
    return {
        "publisher": manifest.get("publisher"),
        "url": public_url,
        "revision": manifest.get("revision"),
        "citation": manifest.get("citation"),
        "branch": repository.get("resolvedBranch") or repository.get("branch"),
        "head": repository.get("head"),
        "window": collection.get("window"),
    }


def _label_rule(manifest):
    declared = manifest.get("label") or {}
    collection = manifest.get("collection") or {}
    return declared.get("rule") or (collection.get("szz") or {}).get("rule") or manifest.get("labelRule")


def _limitations(manifest):
    declared = manifest.get("label") or {}
    collection = manifest.get("collection") or {}
    return list(declared.get("limitations") or collection.get("limitations") or [])


def _declared_files(manifest):
    result = []
    for key in ("file", "text", "labelEvidenceFile"):
        entry = manifest.get(key)
        if isinstance(entry, dict) and entry.get("path"):
            result.append((key, entry))
    curation = manifest.get("curation") or {}
    entry = curation.get("decisionsFile")
    if isinstance(entry, dict) and entry.get("path"):
        result.append(("curationDecisions", entry))
    return result


def _read_verified(path, expected_sha256, label):
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise BaselineError("DATASET_UNAVAILABLE", f"数据集文件不可用：{label}") from exc
    if size > MAX_EXPORT_BYTES:
        raise BaselineError("DATASET_EXPORT_LIMIT_EXCEEDED", f"数据集文件超过导出上限：{label}")
    try:
        blob = path.read_bytes()
    except OSError as exc:
        raise BaselineError("DATASET_UNAVAILABLE", f"数据集文件不可用：{label}") from exc
    if sha256(blob) != expected_sha256:
        raise BaselineError("DATASET_INTEGRITY_ERROR", f"数据集文件校验不匹配：{label}")
    return blob


def resolve_project_dataset(repository_id, sync_id, sync_service, registry_root=None):
    try:
        sync = sync_service.get(sync_id)
    except BaselineError as exc:
        if exc.code == "NOT_FOUND":
            raise BaselineError("REPOSITORY_ANALYSIS_UNKNOWN", "指定分析不属于该仓库或不存在") from exc
        raise
    if sync.get("repositoryId") != repository_id:
        raise BaselineError("REPOSITORY_ANALYSIS_UNKNOWN", "指定分析不属于该仓库或不存在")
    if sync.get("status") != "completed" or sync.get("sourceKind") != "branch":
        raise BaselineError("REPOSITORY_ANALYSIS_UNAVAILABLE", "指定分析尚未成功完成或不是分支分析")
    version = sync.get("datasetVersion")
    if not version:
        raise BaselineError("DATASET_UNAVAILABLE", "该分析没有可用的数据集版本")
    registered = datasets.load_all(registry_root)
    item = registered.get(version)
    if item is None:
        raise BaselineError("DATASET_UNAVAILABLE", "分析引用的数据集版本未登记")
    manifest_path = _absolute(item["manifestPath"])
    manifest = datasets.load_manifest(manifest_path)
    if manifest.get("version") != version:
        raise BaselineError("CONTEXT_MISMATCH", "分析引用的数据版本与登记文件不一致")
    if manifest.get("usage", "branch") != "branch":
        raise BaselineError("REPOSITORY_ANALYSIS_UNAVAILABLE", "指定分析没有可用的分支数据集")
    try:
        manifest_bytes = manifest_path.read_bytes()
    except OSError as exc:
        raise BaselineError("DATASET_UNAVAILABLE", "数据集描述文件不可用") from exc
    files = []
    for label, entry in _declared_files(manifest):
        path = _absolute(entry["path"])
        blob = _read_verified(path, entry.get("sha256"), label)
        files.append({"kind": label, "path": path, "bytes": blob, "sha256": sha256(blob)})
    if sum(len(item["bytes"]) for item in files) + len(manifest_bytes) > MAX_EXPORT_BYTES:
        raise BaselineError("DATASET_EXPORT_LIMIT_EXCEEDED", "数据集导出总大小超过上限")
    return {
        "sync": sync,
        "manifest": manifest,
        "manifestPath": manifest_path,
        "manifestBytes": manifest_bytes,
        "files": files,
    }


def public_view(resolved):
    manifest = resolved["manifest"]
    csv_file = next((item for item in resolved["files"] if item["kind"] == "file"), None)
    if csv_file is None:
        raise BaselineError("DATASET_UNAVAILABLE", "数据集缺少原始 CSV")
    return {
        "syncId": resolved["sync"]["syncId"],
        "datasetId": manifest["dataset"],
        "version": manifest["version"],
        "schema": manifest["schemaName"],
        "timeRange": manifest["timeRange"],
        "quality": manifest["quality"],
        "file": {
            "name": Path(manifest["file"]["path"]).name,
            "sha256": csv_file["sha256"],
            "bytes": len(csv_file["bytes"]),
        },
        "source": _safe_source(manifest),
        "labelRule": _label_rule(manifest),
        "limitations": _limitations(manifest),
    }


def _temp_path(suffix):
    descriptor, name = tempfile.mkstemp(prefix="jit-dataset-", suffix=suffix)
    os.close(descriptor)
    return Path(name)


def export_zip(resolved):
    manifest = resolved["manifest"]
    output = _temp_path(".zip")
    hashes = []
    renamed = {}
    used = set()
    try:
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for item in resolved["files"]:
                name = Path(item["path"]).name
                if name in used:
                    name = f"{Path(name).stem}-{item['kind']}{Path(name).suffix}"
                suffix = 2
                while name in used:
                    stem = Path(name).stem
                    name = f"{stem}-{suffix}{Path(name).suffix}"
                    suffix += 1
                used.add(name)
                renamed[item["kind"]] = name
                archive.writestr(name, item["bytes"])
                hashes.append(f"{item['sha256']}  {name}")
            portable = json.loads(resolved["manifestBytes"])
            for key in ("file", "text", "labelEvidenceFile"):
                entry = portable.get(key)
                if isinstance(entry, dict) and entry.get("path"):
                    entry["path"] = renamed.get(key, Path(entry["path"]).name)
            decisions = (portable.get("curation") or {}).get("decisionsFile")
            if isinstance(decisions, dict) and decisions.get("path"):
                decisions["path"] = renamed.get("curationDecisions", Path(decisions["path"]).name)
            _scrub_absolute_paths(portable)
            portable_bytes = (json.dumps(portable, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
            manifest_name = f"{manifest['version']}.json"
            archive.writestr(manifest_name, portable_bytes)
            hashes.append(f"{sha256(portable_bytes)}  {manifest_name}")
            archive.writestr("SHA256SUMS", "\n".join(hashes) + "\n")
    except Exception:
        output.unlink(missing_ok=True)
        raise
    csv_sha = next(item["sha256"] for item in resolved["files"] if item["kind"] == "file")
    return output, f"{manifest['version']}-{csv_sha[:8]}.zip"


def _excel_value(value):
    if not isinstance(value, str):
        return value
    if re.fullmatch(r"-?(?:0|[1-9]\d{0,14})", value):
        return int(value)
    if re.fullmatch(r"-?(?:0|[1-9]\d{0,14})\.\d+", value):
        return float(value)
    return value


def export_xlsx(resolved):
    manifest = resolved["manifest"]
    csv_file = next(item for item in resolved["files"] if item["kind"] == "file")
    try:
        text = csv_file["bytes"].decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise BaselineError("DATASET_INVALID", "数据集不是 UTF-8 CSV") from exc
    output = _temp_path(".xlsx")
    workbook = Workbook(write_only=True)
    metadata = workbook.create_sheet("metadata")
    rows = [
        ("字段", "值"),
        ("数据集", manifest["dataset"]),
        ("版本", manifest["version"]),
        ("CSV SHA-256", csv_file["sha256"]),
        ("schema", manifest["schemaName"]),
        ("时间范围", f"{manifest['timeRange']['start']} 至 {manifest['timeRange']['end']}"),
        ("标签规则", _label_rule(manifest) or ""),
        ("限制", "\n".join(_limitations(manifest))),
        ("生成时刻", datetime.now(timezone.utc).isoformat()),
    ]
    for row in rows:
        metadata.append(row)
    data = workbook.create_sheet("data")
    try:
        reader = csv.reader(io.StringIO(text, newline=""))
        header = next(reader, None)
        if not header:
            raise BaselineError("DATASET_INVALID", "数据集 CSV 为空")
        data.append(header)
        count = 0
        for row in reader:
            count += 1
            if count > MAX_XLSX_ROWS:
                raise BaselineError("DATASET_EXPORT_LIMIT_EXCEEDED",
                                    f"XLSX 导出行数超过 {MAX_XLSX_ROWS} 行上限")
            data.append([_excel_value(value) for value in row])
        workbook.save(output)
    except Exception:
        output.unlink(missing_ok=True)
        raise
    return output, f"{manifest['version']}-{csv_file['sha256'][:8]}.xlsx"
