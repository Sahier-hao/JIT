"""数据集登记、提交入库与只读查询的编排层。

规范来源：`change add-dataset-registry-and-commit-persistence` 的 DSR-01..07 与
CMP-01..06。这里只做编排：描述文件读写交给 `datasets.py`，事务与表结构交给
`catalog_storage.py`，纳入规则与质量统计复用 `data.parse_source`。
"""
from datetime import datetime, timezone
from pathlib import Path

from . import datasets
from .data import BaselineError, parse_source, sha256
from .schemas import resolve


def _now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def registry(root=None):
    """已登记的数据集描述文件；缺失或校验失败即为错误（DSR-06）。"""
    return datasets.load_all(root)


def register(csv_path, schema=None, dataset=None, version=None, root=None):
    return datasets.register(csv_path, schema=schema, dataset=dataset, version=version, root=root)


def dataset_list(registered):
    """按数据集名分组，返回名称、版本与来源摘要（DSR-07）。"""
    grouped = {}
    for manifest in registered.values():
        grouped.setdefault(manifest["dataset"], []).append({
            "version": manifest["version"], "schema": manifest["schemaName"],
            "timeRange": manifest["timeRange"], "quality": manifest["quality"],
            "file": manifest["file"], "manifestPath": manifest.get("manifestPath")})
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
                          "file": manifest["file"], "manifestPath": manifest.get("manifestPath")}
                         for manifest in sorted(matches, key=lambda item: item["version"])]}


def import_dataset(csv_path, manifest_path, storage):
    """读描述文件与原始 CSV，单事务导入提交级数据（CMP-01..CMP-06）。"""
    manifest = datasets.load_manifest(manifest_path)
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
        records, quality = parse_source(blob, schema)
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


def commit_view(storage, version, commit_id):
    """按数据集版本与提交标识查询；版本或提交未知返回 None（CMP-05）。"""
    record = storage.commit(version, commit_id)
    if record is None:
        return None
    return record
