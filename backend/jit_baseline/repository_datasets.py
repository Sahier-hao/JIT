"""Shared collection-to-registration primitives for analysis and dataset builds."""
from pathlib import Path

from . import collect, store
from .config import BACKEND
from .data import BaselineError, parse_source
from .datasets import DATASETS, manifest_relative


def persist_collected_dataset(storage, dataset_root, *, repository_url, since, until,
                              collected, usage, source_id):
    """Persist one collected branch/PR snapshot without training or scoring."""
    records = collected["rawRecords"]
    schema = collect.SCHEMA_NAME
    dataset = f"{schema}-{collect.dataset_name(repository_url)}"
    cohort = collect.cohort(since, until)
    parsed, _ = parse_source(collected["blob"], schema, cohort)
    if not parsed:
        raise BaselineError("DATASET_INVALID", "采集结果没有可纳入的记录；请确认分支存在且仓库可读")
    days = [record["time"][:10] for record in parsed]
    version = f"{dataset}-{min(days)}_{max(days)}"
    root = Path(dataset_root) if dataset_root is not None else DATASETS
    room = root / dataset
    try:
        room.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise BaselineError("DATASET_UNAVAILABLE", "数据集目录不可写，请检查存储权限") from exc

    source_key = "sourceSyncId" if usage in ("branch", "pr") else "sourceBuildId"

    def import_after(entry, csv):
        return store.import_dataset(csv, _absolute(entry["path"]), storage)

    registered = store.publish_unique(
        room, dataset, version, collected["blob"], schema=schema, cohort=cohort,
        root=root,
        extra={
            "collection": collected["collection"],
            "usage": usage,
            source_key: source_id,
        },
        provenance={
            "publisher": "collected",
            "revision": collected["collection"]["repository"]["head"],
            "url": repository_url,
            "citation": "由仓库采集生成（简化 SZZ）",
        },
        after=import_after,
    )
    manifest_path = _absolute(registered["path"])
    return manifest_path, registered["version"], parsed, bool(registered.get("created"))


def dataset_manifest_path(value):
    path = Path(value)
    return path if path.is_absolute() else BACKEND / path


def public_manifest_path(path):
    return manifest_relative(path)


def _absolute(path):
    path = Path(path)
    return path if path.is_absolute() else BACKEND / path
