"""Shared collection-to-registration primitives for analysis and dataset builds."""
import hashlib
from pathlib import Path

from . import admission, collect, store
from .config import BACKEND
from .data import BaselineError, parse_source
from .datasets import DATASETS, manifest_relative


def persist_collected_dataset(storage, dataset_root, *, repository_url, since, until,
                              collected, usage, source_id):
    """Persist one collected branch/PR snapshot without training or scoring.

    写入原始 CSV、逐提交标签状态旁车与观察声明；返回可进入成熟训练的成员，
    调用方不能把评分覆盖数当作训练样本数。
    """
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
    status_entries = collected.get("status") or collected.get("statusEntries")
    observation = collected.get("observation")
    if status_entries is None or observation is None:
        # 没有观察事实的采集结果只能登记为历史协议版本：可审计、可评分，
        # 但不能进入新训练或完整可信评价。
        registered = store.publish_unique(
            room, dataset, version, collected["blob"], schema=schema, cohort=cohort,
            root=root,
            extra={"collection": collected["collection"], "usage": usage, source_key: source_id},
            provenance={"publisher": "collected",
                        "revision": (collected["collection"].get("repository") or {}).get("head")
                        or "0" * 40,
                        "url": repository_url,
                        "citation": "由仓库采集生成（未记录观察窗口的历史版本）"},
            after=lambda entry, csv: store.import_dataset(csv, _absolute(entry["path"]), storage),
        )
        manifest_path = _absolute(registered["path"])
        view = {"protocol": admission.LEGACY_PROTOCOL, "policy": admission.LEGACY_PROTOCOL,
                "available": False, "restricted": True,
                "reason": {"code": "LABEL_OBSERVATION_UNKNOWN",
                           "message": "采集结果没有观察窗口事实，不能进入新训练；请按当前采集器重建"},
                "counts": {"originalRecords": len(parsed), "eligibleRecords": 0,
                           "excludedImmature": 0, "excludedUnknown": len(parsed),
                           "positivesOriginal": sum(record["label"] for record in parsed),
                           "positivesEligible": 0}}
        return (manifest_path, registered["version"], [], bool(registered.get("created")), view)

    status_bytes = admission.status_bytes(status_entries)
    status_digest = hashlib.sha256(status_bytes).hexdigest()
    status_path = room / f"{dataset}-label-status-{status_digest[:16]}.jsonl"
    if status_path.exists():
        if status_path.read_bytes() != status_bytes:
            raise BaselineError("DATASET_EXISTS", "逐提交状态旁车已存在且内容不同，不覆盖")
    else:
        temporary = status_path.with_name(status_path.name + ".tmp")
        temporary.write_bytes(status_bytes)
        temporary.replace(status_path)
    status_meta = {"path": manifest_relative(status_path), "sha256": status_digest,
                   "records": len(status_entries), "rule": admission.STATUS_RULE}
    labeling = admission.declaration(
        label_rule=observation["labelRule"], sample_window=observation["sampleWindow"],
        observation_window=observation["observationWindow"],
        observed_through=observation["observedThrough"],
        maturity_days=observation["maturityDays"], revision=observation["revision"],
        revision_epoch=observation["revisionEpoch"], history_status=observation["historyStatus"],
        coverage=observation["coverage"], entries=status_entries, status_file=status_meta,
        requested_through=observation.get("requestedThrough"))

    source_key = "sourceSyncId" if usage in ("branch", "pr") else "sourceBuildId"

    def import_after(entry, csv):
        return store.import_dataset(csv, _absolute(entry["path"]), storage)

    registered = store.publish_unique(
        room, dataset, version, collected["blob"], schema=schema, cohort=cohort,
        root=root, identity=labeling["identity"],
        extra={
            "collection": collected["collection"],
            "labeling": labeling,
            "labelStatusFile": status_meta,
            "usage": usage,
            source_key: source_id,
        },
        provenance={
            "publisher": "collected",
            "revision": collected["collection"]["repository"]["head"],
            "url": repository_url,
            "citation": "由仓库采集生成（完整 SZZ）",
        },
        after=import_after,
    )
    manifest_path = _absolute(registered["path"])
    evaluate_manifest = {"schemaName": schema, "collection": collected["collection"],
                         "labeling": labeling}
    evaluated = admission.evaluate(evaluate_manifest, parsed)
    if not evaluated["available"]:
        # 观察不完整或证据截断的版本可以登记与审计，但不能进入新训练。
        trainable = []
    else:
        trainable = evaluated["eligible"]
    return (manifest_path, registered["version"], trainable,
            bool(registered.get("created")), admission.view(evaluated))


def dataset_manifest_path(value):
    path = Path(value)
    return path if path.is_absolute() else BACKEND / path


def public_manifest_path(path):
    return manifest_relative(path)


def _absolute(path):
    path = Path(path)
    return path if path.is_absolute() else BACKEND / path
