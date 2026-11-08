"""数据集登记、提交入库与只读查询的编排层。

规范来源：`change add-dataset-registry-and-commit-persistence` 的 DSR-01..07 与
CMP-01..06。这里只做编排：描述文件读写交给 `datasets.py`，事务与表结构交给
`catalog_storage.py`，纳入规则与质量统计复用 `data.parse_source`。
"""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import os
import uuid

from . import datasets
from .config import BACKEND
from .data import BaselineError, parse_source, sha256
from .schemas import resolve


def _now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def registry(root=None):
    """已登记的数据集描述文件；缺失或校验失败即为错误（DSR-06）。"""
    return datasets.load_all(root)


def register(csv_path, schema=None, dataset=None, version=None, root=None, cohort=None, provenance=None,
             extra=None):
    return datasets.register(csv_path, schema=schema, dataset=dataset, version=version, root=root,
                             cohort=cohort, provenance=provenance, extra=extra)


def publish_unique(room, dataset, version, blob, *, after=None, **kwargs):
    """把 CSV 以不可覆盖方式发布到数据集目录，再登记描述文件。

    目标已存在且字节相同即复用；字节不同时追加内容哈希作为新版本，仍冲突则失败。
    命令行和服务端同步共用这条路径，避免先替换旧文件再登记。
    """
    digest = hashlib.sha256(blob).hexdigest()
    last = None
    for name in (version, f"{version}-{digest[:8]}"):
        path = Path(room) / f"{name}.csv"
        manifest_path = Path(room) / f"{name}.json"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            if manifest_path.exists():
                existing = datasets.load_manifest(manifest_path)
                declared = existing.get("file") or {}
                if declared.get("sha256") != digest or declared.get("bytes") != len(blob):
                    last = f"同名描述文件描述了不同内容：{name}"
                    continue
            if not path.exists():
                temporary = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
                try:
                    temporary.write_bytes(blob)
                    try:
                        os.link(temporary, path)
                    except FileExistsError:
                        pass
                finally:
                    temporary.unlink(missing_ok=True)
            if path.read_bytes() != blob:
                last = f"已有 CSV 内容不同：{name}"
                continue
            try:
                registered = register(path, dataset=dataset, version=name, **kwargs)
            except BaselineError as exc:
                if exc.code != "DATASET_EXISTS" or not manifest_path.exists():
                    raise
                # 描述文件已确认描述本次 CSV 内容，按幂等复用处理。
                entry = {"dataset": dataset, "version": name,
                         "path": datasets.manifest_relative(manifest_path),
                         "csvPath": datasets.manifest_relative(path),
                         "sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
                         "created": False}
                if after is not None:
                    try:
                        after(entry, path)
                    except BaselineError as import_exc:
                        if import_exc.code != "DATASET_EXISTS":
                            raise
                return entry
            registered["csvPath"] = datasets.manifest_relative(path)
            if after is not None:
                after(registered, path)
            return registered
        except BaselineError as exc:
            if exc.code != "DATASET_EXISTS":
                raise
            last = exc
        except OSError as exc:
            raise BaselineError("DATASET_UNAVAILABLE", "采集结果写入失败，请检查存储权限") from exc
    raise last


def dataset_references(storage, version):
    """被分析、模型或导入过程引用的数据集版本不可清理。"""
    references = []
    with storage.connection() as db:
        if db.execute('SELECT 1 FROM repository_sync WHERE dataset_version=? LIMIT 1', (version,)).fetchone():
            references.append('analysis')
        if db.execute('SELECT 1 FROM dataset_build_task WHERE dataset_version=? LIMIT 1',
                      (version,)).fetchone():
            references.append('dataset-build')
        if db.execute("SELECT 1 FROM model_version WHERE json_extract(payload_json, '$.datasetVersion')=? "
                      'LIMIT 1', (version,)).fetchone():
            references.append('model')
        if db.execute("SELECT 1 FROM model_version WHERE json_extract(payload_json, "
                      "'$.artifactDatasetVersion')=? LIMIT 1", (version,)).fetchone():
            if 'model' not in references:
                references.append('model')
    return references


def prunable_datasets(storage, registered, keep=10):
    """列出超出保留数量且无引用的 PR 数据集版本；分支数据集不参与。"""
    keep = max(0, int(keep))
    with storage.connection() as db:
        rows = db.execute('SELECT dataset_version,dataset_name,usage,created_at FROM dataset_record '
                          'ORDER BY created_at DESC, dataset_version DESC').fetchall()
    grouped = {}
    for row in rows:
        if row['usage'] != 'pr':
            continue
        grouped.setdefault(row['dataset_name'], []).append(row)
    result = []
    for name, items in grouped.items():
        for index, row in enumerate(items):
            if index < keep:
                continue
            references = dataset_references(storage, row['dataset_version'])
            if references:
                continue
            manifest = registered.get(row['dataset_version'])
            if manifest is None:
                continue
            result.append({'dataset': name, 'version': row['dataset_version'],
                           'createdAt': row['created_at'], 'references': references,
                           'manifest': manifest})
    return result


def delete_dataset_version(storage, manifest):
    """两阶段删除数据集：先移除登记与提交记录，再删除描述、CSV 与旁注文件。"""
    version = manifest['version']
    files = []
    for entry in (manifest.get('file'), manifest.get('text'), manifest.get('labelEvidenceFile')):
        if isinstance(entry, dict) and entry.get('path'):
            path = Path(entry['path'])
            files.append(path if path.is_absolute() else BACKEND / path)
    tables = ('commit_label_evidence', 'feature_record', 'modified_entity',
              'commit_record', 'import_run', 'dataset_record')
    with storage.connection(write=True) as db:
        for table in tables:
            db.execute(f'DELETE FROM {table} WHERE dataset_version=?', (version,))
    errors = []
    for path in files:
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            errors.append({'path': path.name, 'message': str(exc)})
    return {'version': version, 'deleted': not errors, 'fileErrors': errors}


def dataset_list(registered):
    """按数据集名分组，返回名称、版本与来源摘要（DSR-07）。"""
    grouped = {}
    for manifest in registered.values():
        grouped.setdefault(manifest["dataset"], []).append({
            "version": manifest["version"], "schema": manifest["schemaName"],
            "timeRange": manifest["timeRange"], "quality": manifest["quality"],
            "file": manifest["file"], "manifestPath": manifest.get("manifestPath"),
            "source": _source(manifest), "labelRule": _label_rule(manifest),
            "label": manifest.get("label") or (manifest.get("collection") or {}).get("label") or {}, "szz": (manifest.get("collection") or {}).get("szz") or {},
            "usage": manifest.get("usage", "branch"), "sourceSyncId": manifest.get("sourceSyncId"),
            "limitations": _limitations(manifest)})
    return [{"dataset": name, "versions": sorted(versions, key=lambda item: item["version"])}
            for name, versions in sorted(grouped.items())]


def version_view(registered, name):
    """某个数据集的版本列表；未知数据集返回 None（不空成功）。"""
    matches = [manifest for manifest in registered.values() if manifest["dataset"] == name]
    if not matches:
        return None
    return {"dataset": name,
            "versions": [{"version": manifest["version"], "schema": manifest["schemaName"],
                          "timeRange": manifest["timeRange"], "quality": manifest["quality"],
                          "file": manifest["file"], "manifestPath": manifest.get("manifestPath"),
                          "source": _source(manifest), "labelRule": _label_rule(manifest),
                          "label": manifest.get("label") or (manifest.get("collection") or {}).get("label") or {}, "szz": (manifest.get("collection") or {}).get("szz") or {},
                          "usage": manifest.get("usage", "branch"), "sourceSyncId": manifest.get("sourceSyncId"),
                          "limitations": _limitations(manifest)}
                         for manifest in sorted(matches, key=lambda item: item["version"])]}


def _source(manifest):
    collection = manifest.get("collection") or {}
    repository = collection.get("repository") or {}
    return {
        "publisher": manifest.get("publisher"),
        "url": manifest.get("url"),
        "revision": manifest.get("revision"),
        "citation": manifest.get("citation"),
        "branch": repository.get("resolvedBranch") or repository.get("branch"),
        "head": repository.get("head"),
        "window": collection.get("window"),
    }


def _label_rule(manifest):
    declared = manifest.get("label") or {}
    if declared.get("rule"):
        return declared["rule"]
    collection = manifest.get("collection") or {}
    return (collection.get("szz") or {}).get("rule") or manifest.get("labelRule")


def _limitations(manifest):
    declared = manifest.get("label") or {}
    collection = manifest.get("collection") or {}
    return list(declared.get("limitations") or collection.get("limitations") or [])


def import_dataset(csv_path, manifest_path, storage):
    """读描述文件与原始 CSV，单事务导入提交级数据（CMP-01..CMP-06）。

    `csv_path` 省略时按描述文件的 `file.path` 定位（绝对路径直接使用，相对路径相对 `backend/`）。
    """
    manifest = datasets.load_manifest(manifest_path)
    if csv_path is None:
        declared = Path(manifest["file"]["path"])
        csv_path = declared if declared.is_absolute() else BACKEND / declared
    csv_path = Path(csv_path)
    started = _now()
    try:
        try:
            blob = csv_path.read_bytes()
        except OSError as exc:
            raise BaselineError("DATASET_UNAVAILABLE", f"原始 CSV 不可用：{csv_path.name}") from exc
        if sha256(blob) != manifest["file"]["sha256"]:
            raise BaselineError("DATASET_INVALID", f"原始 CSV 校验值与描述文件不一致：{csv_path.name}")
        schema = resolve(manifest["schemaName"])
        records, quality = parse_source(blob, schema, manifest["cohort"])
        if quality != manifest["quality"]:
            raise BaselineError("DATASET_INVALID", "按描述文件规则重算的质量统计与描述不一致")
        in_model = set(schema.in_model_names())
        for record in records:
            if set(record["metrics"]) != in_model:
                raise BaselineError("DATASET_INVALID",
                                    f"提交 {record['id']} 的特征字段与 schema 声明不一致")
        return storage.import_dataset(manifest, records)
    except BaselineError as exc:
        storage.record_import_failure(manifest["version"], exc.code, started)
        raise


def feature_means(storage, version, fields):
    """特征归因基线（PEX-02）：按数据集版本取字段均值，缺失字段不补零。"""
    return storage.feature_means(version, fields)


def commit_view(storage, version, commit_id):
    """按数据集版本与提交标识查询；版本或提交未知返回 None（CMP-05）。"""
    record = storage.commit(version, commit_id)
    if record is None:
        return None
    return record
