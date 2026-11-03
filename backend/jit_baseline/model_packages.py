"""Portable, verifiable model packages for deployment environments."""
from __future__ import annotations

import json
import hashlib
import os
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from uuid import UUID, uuid4

from .algorithms import ALGORITHMS
from .api_errors import RequestError
from .artifacts import CORE_FILES, Snapshot
from .catalog import ModelCatalog, REPOSITORY_SCHEMAS
from .catalog_storage import utc_now
from .data import sha256
from .errors import BaselineError


PACKAGE_KIND = "jit-model-package"
PACKAGE_VERSION = 1
PACKAGE_MANIFEST = "model-package.json"
MAX_PACKAGE_ENTRIES = 10_000
MAX_FILE_BYTES = 1024 * 1024 * 1024
MAX_EXPANDED_BYTES = 4 * 1024 * 1024 * 1024
MODEL_FILES = tuple(dict.fromkeys((*CORE_FILES, "summary.json", "manifest.json")))
ITEM_KEYS = {
    "sourceModelId", "sourceRunId", "artifactRunId", "artifactKey", "method",
    "schema", "datasetVersion", "model", "metricSet", "compatibility",
    "compatibilityReason", "dependencies", "manifestSha256", "packagePath", "files",
}
FILE_KEYS = {"path", "sha256", "size"}
MODEL_KEYS = {"id", "name", "sha256"}


def _hash_file(path):
    digest = sha256(Path(path).read_bytes())
    return digest


def _hash_path(directory, name):
    return _hash_file(Path(directory) / name)


def _zip_hash(archive, info):
    digest = hashlib.sha256()
    with archive.open(info) as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_relative(value, *, field):
    if not isinstance(value, str) or not value:
        raise BaselineError("PACKAGE_INVALID", f"模型包字段无效：{field}")
    if "\\" in value or ":" in value or value.startswith("/"):
        raise BaselineError("PACKAGE_INVALID", f"模型包包含非规范路径：{field}")
    path = PurePosixPath(value)
    if (not path.parts or any(part in ("", ".", "..") or part.startswith(".")
                              for part in path.parts)):
        raise BaselineError("PACKAGE_INVALID", f"模型包包含隐藏或越界路径：{field}")
    return path


def _uuid_text(value, *, field):
    if not isinstance(value, str):
        raise BaselineError("PACKAGE_INVALID", f"模型包字段无效：{field}")
    try:
        return str(UUID(value))
    except ValueError as exc:
        raise BaselineError("PACKAGE_INVALID", f"模型包字段无效：{field}") from exc


def _hash_text(value, *, field):
    if not isinstance(value, str) or len(value) != 64 or any(ch not in "0123456789abcdef" for ch in value):
        raise BaselineError("PACKAGE_INVALID", f"模型包哈希无效：{field}")
    return value


def _read_manifest(archive):
    try:
        blob = archive.read(PACKAGE_MANIFEST)
    except KeyError as exc:
        raise BaselineError("PACKAGE_INVALID", "模型包缺少清单") from exc
    if len(blob) > 2 * 1024 * 1024:
        raise BaselineError("PACKAGE_INVALID", "模型包清单过大")
    try:
        manifest = json.loads(blob.decode("utf-8"))
    except (UnicodeError, ValueError) as exc:
        raise BaselineError("PACKAGE_INVALID", "模型包清单不是有效 UTF-8 JSON") from exc
    if not isinstance(manifest, dict):
        raise BaselineError("PACKAGE_INVALID", "模型包清单根节点必须是对象")
    if manifest.get("kind") != PACKAGE_KIND:
        raise BaselineError("PACKAGE_INVALID", "不是 JIT 模型包")
    if manifest.get("packageVersion") != PACKAGE_VERSION:
        raise BaselineError("PACKAGE_VERSION_UNSUPPORTED", "模型包版本不受支持")
    if not isinstance(manifest.get("models"), list) or not manifest["models"]:
        raise BaselineError("PACKAGE_INVALID", "模型包没有模型")
    return manifest


def _archive_manifest(path):
    try:
        package_sha = _hash_file(path)
        archive = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as exc:
        raise BaselineError("PACKAGE_INVALID", "模型包不是可读取的 ZIP") from exc
    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_PACKAGE_ENTRIES:
            raise BaselineError("PACKAGE_INVALID", "模型包文件数量超限")
        if sum(item.file_size for item in infos) > MAX_EXPANDED_BYTES:
            raise BaselineError("PACKAGE_INVALID", "模型包解压大小超限")
        names = {}
        for item in infos:
            name = item.filename
            _safe_relative(name, field="archivePath")
            if item.flag_bits & 0x1:
                raise BaselineError("PACKAGE_INVALID", "模型包不允许加密文件")
            if ((item.external_attr >> 16) & 0o170000) == 0o120000:
                raise BaselineError("PACKAGE_INVALID", "模型包不允许符号链接")
            if item.is_dir():
                continue
            if name in names:
                raise BaselineError("PACKAGE_INVALID", "模型包包含重复路径")
            if item.file_size > MAX_FILE_BYTES:
                raise BaselineError("PACKAGE_INVALID", f"模型包文件过大：{name}")
            names[name] = item
        manifest = _read_manifest(archive)
    return manifest, names, package_sha


def inspect_model_package(path):
    """Validate package structure and return its manifest and content identity."""
    path = Path(path)
    manifest, names, package_sha = _archive_manifest(path)
    seen_models = set()
    declared = {PACKAGE_MANIFEST}
    try:
        archive = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as exc:
        raise BaselineError("PACKAGE_INVALID", "模型包不是可读取的 ZIP") from exc
    with archive:
        for item in manifest["models"]:
            if not isinstance(item, dict) or set(item) != ITEM_KEYS:
                raise BaselineError("PACKAGE_INVALID", "模型包条目结构无效")
            artifact_run_id = _hash_text(item["artifactRunId"], field="artifactRunId")
            if artifact_run_id in seen_models:
                raise BaselineError("PACKAGE_INVALID", "模型包包含重复运行身份")
            seen_models.add(artifact_run_id)
            _uuid_text(item["sourceModelId"], field="sourceModelId")
            _uuid_text(item["sourceRunId"], field="sourceRunId")
            key = _safe_relative(item["artifactKey"], field="artifactKey")
            package_path = _safe_relative(item["packagePath"], field="packagePath")
            if (len(package_path.parts) != 2 or package_path.parts[0] != "models"
                    or len(package_path.parts[1]) != 3
                    or not package_path.parts[1].isdigit()):
                raise BaselineError("PACKAGE_INVALID", "模型包条目目录无效")
            _hash_text(item["manifestSha256"], field="manifestSha256")
            if item["method"] not in ALGORITHMS:
                raise BaselineError("PACKAGE_INVALID", f"模型包方法未注册：{item['method']}")
            if item["compatibility"] not in {"repository-analysis", "offline-only",
                                              "input-unsupported", "schema-incompatible"}:
                raise BaselineError("PACKAGE_INVALID", "模型包兼容性状态无效")
            if not isinstance(item["dependencies"], list) or any(
                    not isinstance(name, str) or not name for name in item["dependencies"]):
                raise BaselineError("PACKAGE_INVALID", "模型包依赖声明无效")
            if not isinstance(item["schema"], str) or not item["schema"]:
                raise BaselineError("PACKAGE_INVALID", "模型包字段无效：schema")
            if not isinstance(item["datasetVersion"], str) or not item["datasetVersion"]:
                raise BaselineError("PACKAGE_INVALID", "模型包字段无效：datasetVersion")
            if item["metricSet"] is not None and not isinstance(item["metricSet"], str):
                raise BaselineError("PACKAGE_INVALID", "模型包字段无效：metricSet")
            if (item["compatibilityReason"] is not None
                    and not isinstance(item["compatibilityReason"], str)):
                raise BaselineError("PACKAGE_INVALID", "模型包字段无效：compatibilityReason")
            model = item["model"]
            if not isinstance(model, dict) or set(model) != MODEL_KEYS:
                raise BaselineError("PACKAGE_INVALID", "模型包模型身份无效")
            if (not isinstance(model["id"], str) or not model["id"]
                    or not isinstance(model["name"], str) or not model["name"]):
                raise BaselineError("PACKAGE_INVALID", "模型包模型身份无效")
            _hash_text(model["sha256"], field="model.sha256")
            if not isinstance(item["files"], list) or not item["files"]:
                raise BaselineError("PACKAGE_INVALID", "模型包条目没有文件")
            listed = set()
            for entry in item["files"]:
                if not isinstance(entry, dict) or set(entry) != FILE_KEYS:
                    raise BaselineError("PACKAGE_INVALID", "模型包文件条目结构无效")
                relative = _safe_relative(entry["path"], field="file.path")
                if str(relative) in listed:
                    raise BaselineError("PACKAGE_INVALID", "模型包条目包含重复文件")
                listed.add(str(relative))
                if not isinstance(entry["size"], int) or entry["size"] < 0 or entry["size"] > MAX_FILE_BYTES:
                    raise BaselineError("PACKAGE_INVALID", "模型包文件大小无效")
                _hash_text(entry["sha256"], field="file.sha256")
                archive_name = (package_path / relative).as_posix()
                if archive_name not in names:
                    raise BaselineError("PACKAGE_INVALID", f"模型包缺少声明文件：{relative}")
                actual = names[archive_name]
                if actual.file_size != entry["size"] or _zip_hash(archive, actual) != entry["sha256"]:
                    raise BaselineError("PACKAGE_INVALID", f"模型包文件校验失败：{relative}")
                if relative.as_posix() == "manifest.json":
                    if entry["sha256"] != item["manifestSha256"]:
                        raise BaselineError("PACKAGE_INVALID", "模型包 manifest 哈希不一致")
                declared.add(archive_name)
            if item["artifactKey"] != key.as_posix():
                raise BaselineError("PACKAGE_INVALID", "模型包产物路径非规范")
            manifest_name = (package_path / "manifest.json").as_posix()
            summary_name = (package_path / "summary.json").as_posix()
            if manifest_name not in names or summary_name not in names:
                raise BaselineError("PACKAGE_INVALID", "模型包条目缺少 manifest 或摘要")
            try:
                artifact_manifest = json.loads(archive.read(names[manifest_name]).decode("utf-8"))
                artifact_summary = json.loads(archive.read(names[summary_name]).decode("utf-8"))
            except (UnicodeError, ValueError) as exc:
                raise BaselineError("PACKAGE_INVALID", "模型包清单或摘要不是有效 JSON") from exc
            config = artifact_manifest.get("config") or {}
            if (artifact_manifest.get("runId") != artifact_run_id
                    or (config.get("algorithmVersion") or "logistic-regression-l2-v1") != item["method"]
                    or (config.get("schema") or config.get("protocol")) != item["schema"]
                    or config.get("datasetVersion") != item["datasetVersion"]
                    or config.get("modelSha256") != model["sha256"]
                    or (artifact_summary.get("model") or {}).get("id") != model["id"]):
                raise BaselineError("PACKAGE_INVALID", "模型包元数据与 manifest 不一致")
    if set(names) != declared:
        raise BaselineError("PACKAGE_INVALID", "模型包包含未声明文件")
    return {
        "kind": PACKAGE_KIND,
        "packageVersion": PACKAGE_VERSION,
        "packageSha256": package_sha,
        "packageName": path.name,
        "modelCount": len(manifest["models"]),
        "fileCount": sum(len(item["files"]) for item in manifest["models"]),
        "uncompressedBytes": sum(names[name].file_size for name in declared if name in names),
        "models": manifest["models"],
    }


def _write_zip(path, manifest, directories):
    def add(archive, name, data):
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, data)

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        add(archive, PACKAGE_MANIFEST,
            (json.dumps(manifest, ensure_ascii=False, sort_keys=True,
                        allow_nan=False, indent=2) + "\n").encode("utf-8"))
        for item, directory in zip(manifest["models"], directories):
            for entry in item["files"]:
                add(archive, f"{item['packagePath']}/{entry['path']}",
                    (directory / entry["path"]).read_bytes())


def export_model_package(catalog: ModelCatalog, model_ids, output):
    """Export explicitly selected ready catalog models to one portable ZIP."""
    if not isinstance(model_ids, (list, tuple)) or not model_ids:
        raise RequestError("INPUT_INVALID", field="modelIds")
    if len(set(model_ids)) != len(model_ids):
        raise RequestError("INPUT_INVALID", field="modelIds")
    output = Path(output).resolve()
    checksum = output.with_name(output.name + ".sha256")
    if output.exists() or checksum.exists():
        raise BaselineError("OUTPUT_EXISTS", "模型包输出已存在")
    entries, directories = [], []
    for index, model_id in enumerate(model_ids):
        snapshot, payload = catalog.load_model(model_id)
        row = catalog._row(model_id)
        directory = catalog._nested_directory(row["relative_key"])
        files = []
        for name in sorted(MODEL_FILES):
            path = directory / name
            if path.is_symlink() or not path.is_file():
                raise BaselineError("ARTIFACT_INVALID", f"模型包导出缺少文件：{name}")
            files.append({"path": name, "sha256": _hash_path(directory, name),
                          "size": path.stat().st_size})
        compatibility = catalog._compatibility(snapshot.schema.name)
        environment = (snapshot.manifest["config"].get("trainingEnvironment")
                       or snapshot.manifest["config"].get("environment") or {})
        dependencies = sorted((environment.get("packages") or {}).keys())
        package_path = f"models/{index:03d}"
        entries.append({
            "sourceModelId": _uuid_text(payload["modelId"], field="modelId"),
            "sourceRunId": _uuid_text(payload["runId"], field="runId"),
            "artifactRunId": payload["artifactRunId"],
            "artifactKey": row["relative_key"],
            "method": snapshot.manifest["config"].get("algorithmVersion")
                      or "logistic-regression-l2-v1",
            "schema": snapshot.schema.name,
            "datasetVersion": snapshot.manifest["config"]["datasetVersion"],
            "model": {"id": payload["artifactModelId"], "name": payload["name"],
                      "sha256": payload["sha256"]},
            "metricSet": snapshot.manifest["config"].get("metricSet"),
            "compatibility": compatibility["state"],
            "compatibilityReason": compatibility["reason"],
            "dependencies": dependencies,
            "manifestSha256": _hash_path(directory, "manifest.json"),
            "packagePath": package_path,
            "files": files,
        })
        directories.append(directory)
    manifest = {
        "kind": PACKAGE_KIND,
        "packageVersion": PACKAGE_VERSION,
        "createdUtc": datetime.now(timezone.utc).isoformat(),
        "models": entries,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.{uuid4().hex}.tmp")
    try:
        _write_zip(temporary, manifest, directories)
        inspected = inspect_model_package(temporary)
        os.replace(temporary, output)
        package_sha = _hash_file(output)
        checksum_tmp = checksum.with_name(f".{checksum.name}.{uuid4().hex}.tmp")
        try:
            checksum_tmp.write_text(f"{package_sha}  {output.name}\n", encoding="ascii")
            os.replace(checksum_tmp, checksum)
        except Exception:
            checksum_tmp.unlink(missing_ok=True)
            raise
    except Exception:
        temporary.unlink(missing_ok=True)
        # The output is created only after inspection. Remove it when publishing
        # the sidecar fails so no caller observes a package that looks complete.
        output.unlink(missing_ok=True)
        checksum.unlink(missing_ok=True)
        raise
    return {
        "kind": PACKAGE_KIND,
        "output": str(output),
        "checksumPath": str(checksum),
        "packageSha256": package_sha,
        "packageVersion": PACKAGE_VERSION,
        "modelCount": len(entries),
        "fileCount": inspected["fileCount"],
        "uncompressedBytes": inspected["uncompressedBytes"],
        "packageBytes": output.stat().st_size,
    }


def _item_error(item, code, message):
    return {
        "artifactRunId": item.get("artifactRunId"),
        "sourceModelId": item.get("sourceModelId"),
        "artifactKey": item.get("artifactKey"),
        "status": "conflict" if code in {"ARTIFACT_KEY_CONFLICT", "CONTEXT_MISMATCH"} else "failed",
        "modelId": None,
        "runId": None,
        "code": code,
        "message": message,
    }


def _destination(root, key):
    relative = _safe_relative(key, field="artifactKey")
    current = Path(root)
    for part in relative.parts:
        current = current / part
        if current.exists() and current.is_symlink():
            raise BaselineError("PACKAGE_INVALID", "目标产物路径包含符号链接")
    path = current.resolve()
    if not path.is_relative_to(Path(root).resolve()) or path == Path(root).resolve():
        raise BaselineError("PACKAGE_INVALID", "目标产物路径越界")
    return path


def _same_directory(directory, item):
    if not directory.is_dir() or directory.is_symlink():
        return False
    try:
        if _hash_path(directory, "manifest.json") != item["manifestSha256"]:
            return False
        return all((directory / entry["path"]).is_file()
                   and not (directory / entry["path"]).is_symlink()
                   and _hash_path(directory, entry["path"]) == entry["sha256"]
                   for entry in item["files"])
    except OSError:
        return False


def _extract_item(archive, item, root):
    item_dir = root / item["packagePath"]
    item_dir.mkdir(parents=True)
    for entry in item["files"]:
        archive_name = f"{item['packagePath']}/{entry['path']}"
        data = archive.read(archive_name)
        if len(data) != entry["size"] or sha256(data) != entry["sha256"]:
            raise BaselineError("PACKAGE_INVALID", f"模型包文件校验失败：{entry['path']}")
        target = item_dir / entry["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return item_dir


def _record_import(storage, *, import_id, package_sha, version, package_name,
                   items, code=None, message=None):
    registered = sum(item["status"] == "registered" for item in items)
    reused = sum(item["status"] == "reused" for item in items)
    already = sum(item["status"] == "already-registered" for item in items)
    conflicts = sum(item["status"] == "conflict" for item in items)
    failed = sum(item["status"] == "failed" for item in items)
    successes = registered + reused + already
    status = "failed" if successes == 0 and (conflicts or failed or code) else (
        "completed" if not conflicts and not failed and not code else "partial"
    )
    report = {
        "importId": import_id,
        "packageSha256": package_sha,
        "packageVersion": version,
        "packageName": package_name,
        "status": status,
        "modelCount": len(items),
        "registeredCount": registered,
        "reusedCount": reused,
        "alreadyRegisteredCount": already,
        "conflictCount": conflicts,
        "failedCount": failed,
        "code": code,
        "message": message,
        "createdAt": utc_now(),
        "items": items,
    }
    return storage.record_model_package_import(report)


def import_model_package(catalog: ModelCatalog, package):
    """Validate and import one package; each model item commits independently."""
    package = Path(package).resolve()
    import_id = str(uuid4())
    try:
        package_sha = _hash_file(package)
    except OSError as exc:
        raise BaselineError("PACKAGE_UNAVAILABLE", f"模型包不可用：{package.name}") from exc
    package_name = package.name
    try:
        inspected = inspect_model_package(package)
    except BaselineError as exc:
        return _record_import(catalog.store, import_id=import_id, package_sha=package_sha,
                              version=0, package_name=package_name, items=[],
                              code=exc.code, message=str(exc))

    results = []
    with tempfile.TemporaryDirectory(prefix="jit-model-package-") as temporary:
        extract_root = Path(temporary)
        with zipfile.ZipFile(package) as archive:
            for item in inspected["models"]:
                try:
                    item_dir = _extract_item(archive, item, extract_root)
                    manifest = json.loads((item_dir / "manifest.json").read_text(encoding="utf-8"))
                    summary = json.loads((item_dir / "summary.json").read_text(encoding="utf-8"))
                    config = manifest.get("config") or {}
                    if (manifest.get("runId") != item["artifactRunId"]
                            or config.get("algorithmVersion", "logistic-regression-l2-v1") != item["method"]
                            or (config.get("schema") or config.get("protocol")) != item["schema"]
                            or config.get("datasetVersion") != item["datasetVersion"]
                            or (summary.get("model") or {}).get("id") != item["model"]["id"]):
                        raise BaselineError("PACKAGE_INVALID", "模型包元数据与 manifest 不一致")
                    registered = catalog._registered_runs().get(item["artifactRunId"])
                    if registered:
                        comparison_error = None
                        try:
                            _, payload = catalog.load_model(registered["modelId"])
                            row = catalog._row(registered["modelId"])
                            saved = json.loads(row["manifest_json"])
                            if (row["relative_key"] != item["artifactKey"]
                                    or saved.get("sha256") != item["manifestSha256"]
                                    or payload.get("artifactRunId") != item["artifactRunId"]
                                    or payload.get("sha256") != item["model"]["sha256"]
                                    or not _same_directory(
                                        catalog._nested_directory(row["relative_key"]), item)):
                                comparison_error = BaselineError(
                                    "CONTEXT_MISMATCH", "目标环境已有相同运行身份但内容不同")
                        except BaselineError as exc:
                            row = catalog._row(registered["modelId"])
                            if row["relative_key"] != item["artifactKey"]:
                                comparison_error = BaselineError(
                                    "CONTEXT_MISMATCH",
                                    "目标环境已有相同运行身份但原产物不可用且位置不同",
                                )
                            else:
                                comparison_error = exc
                        if comparison_error is not None:
                            # A broken registered model can be recovered only at its
                            # recorded location. Never replace another run's identity
                            # or preferred location from a package.
                            if comparison_error.code != "CONTEXT_MISMATCH":
                                pass
                            else:
                                raise comparison_error
                        else:
                            results.append({
                                "artifactRunId": item["artifactRunId"],
                                "sourceModelId": item["sourceModelId"],
                                "artifactKey": item["artifactKey"],
                                "status": "already-registered",
                                "modelId": registered["modelId"],
                                "runId": registered["runId"],
                                "code": None,
                                "message": None,
                            })
                            continue
                    destination = _destination(catalog.root, item["artifactKey"])
                    created_destination = False
                    if destination.exists():
                        if not _same_directory(destination, item):
                            raise BaselineError("ARTIFACT_KEY_CONFLICT", "目标产物位置已有不同运行")
                    else:
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        staging = destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")
                        try:
                            shutil.copytree(item_dir, staging)
                            try:
                                os.replace(staging, destination)
                            except OSError:
                                shutil.rmtree(staging, ignore_errors=True)
                                if not _same_directory(destination, item):
                                    raise BaselineError(
                                        "ARTIFACT_KEY_CONFLICT", "目标产物位置已有不同运行",
                                    )
                            else:
                                created_destination = True
                        except Exception:
                            shutil.rmtree(staging, ignore_errors=True)
                            raise
                    try:
                        registered = catalog.register(
                            catalog._candidate_id(item["artifactKey"]),
                            item["manifestSha256"],
                            channel="local-cli",
                            request_id=import_id,
                            preferred_model_id=item["sourceModelId"],
                        )
                    except Exception:
                        if created_destination:
                            shutil.rmtree(destination, ignore_errors=True)
                        raise
                    results.append({
                        "artifactRunId": item["artifactRunId"],
                        "sourceModelId": item["sourceModelId"],
                        "artifactKey": item["artifactKey"],
                        "status": "registered" if registered["created"] else "reused",
                        "modelId": registered["model"]["modelId"],
                        "runId": registered["model"]["runId"],
                        "code": None,
                        "message": None,
                    })
                except (BaselineError, OSError, ValueError, KeyError, TypeError) as exc:
                    code = exc.code if isinstance(exc, BaselineError) else "PACKAGE_INVALID"
                    results.append(_item_error(item, code, str(exc)))
    return _record_import(catalog.store, import_id=import_id,
                          package_sha=inspected["packageSha256"],
                          version=inspected["packageVersion"],
                          package_name=package_name, items=results)


def latest_model_package_import(storage):
    return storage.latest_model_package_import()
