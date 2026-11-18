"""标签观察与成熟样本准入（DSP-03、RCL-28、RCL-29、DSR-12）。

采集阶段把“哪些提交进入样本”和“修复观察到什么时候”分开记录，写入受哈希保护的
逐提交状态旁车。训练与正式评价入口共用本模块的准入判断：只有观察覆盖完整、且距实际
观察终点达到声明成熟期的提交进入合格总体。旧 SZZ 版本没有观察事实时默认拒绝新训练，
只能显式按历史协议复现；发布者数据沿用其原始标签语义，不套用 SZZ 成熟期。
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .config import BACKEND
from .data import BaselineError

PROTOCOL = "mature-observed-v1"
LEGACY_PROTOCOL = "legacy-unobserved-v1"
PUBLISHER_PROTOCOL = "publisher-labels-v1"
STATUS_RULE = "commit-label-status-v1"
DEFAULT_MATURITY_DAYS = 90
STATUS_PATH_KEY = "labeling"
DAY_SECONDS = 86400
SZZ_SCHEMAS = ("kamei14-git-v1", "kamei14-git-v2", "kamei14-v1")


def _digest(value):
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _iso(epoch):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def is_szz(manifest):
    """是否为 SZZ 生成的数据版本；发布者数据不走成熟期规则。"""
    schema = str(manifest.get("schemaName") or "")
    collection = manifest.get("collection") or {}
    return schema in SZZ_SCHEMAS or collection.get("kind") == "git-repository"


def maturity_status(epoch, observed_through, maturity_days):
    """UTC 秒级成熟判断；观察终点未知时返回 unknown，不退化为成熟。"""
    if not isinstance(observed_through, int) or not isinstance(maturity_days, int):
        return "unknown"
    if observed_through - epoch >= maturity_days * DAY_SECONDS:
        return "mature"
    return "immature"


def status_entry(record, observed_through, maturity_days):
    maturity = maturity_status(record["epoch"], observed_through, maturity_days)
    entry = {
        "id": record["id"],
        "label": int(record["label"]),
        "evidenceStatus": "positive" if record["label"] else "unobserved",
        "maturityStatus": maturity,
        "admission": "included" if maturity == "mature" else "excluded",
        "reason": None if maturity == "mature" else maturity,
        "epoch": record["epoch"],
    }
    return entry


def build_status(records, observed_through, maturity_days):
    """逐提交状态按提交标识排序，保证同输入得到同字节。"""
    entries = [status_entry(record, observed_through, maturity_days) for record in records]
    return sorted(entries, key=lambda item: item["id"])


def status_bytes(entries):
    if not entries:
        return b""
    return b"\n".join(json.dumps(entry, ensure_ascii=False, sort_keys=True).encode("utf-8")
                      for entry in entries) + b"\n"


def count_summary(entries):
    counts = {
        "originalRecords": len(entries),
        "eligibleRecords": 0,
        "excludedImmature": 0,
        "excludedUnknown": 0,
        "positivesOriginal": 0,
        "positivesEligible": 0,
    }
    for entry in entries:
        counts["positivesOriginal"] += entry["label"]
        if entry["admission"] == "included":
            counts["eligibleRecords"] += 1
            counts["positivesEligible"] += entry["label"]
        elif entry["reason"] == "unknown":
            counts["excludedUnknown"] += 1
        else:
            counts["excludedImmature"] += 1
    return counts


def declaration(*, label_rule, sample_window, observation_window, observed_through, maturity_days,
                revision, revision_epoch, history_status, coverage, entries, status_file=None,
                requested_through=None):
    """构造写入描述文件的观察与准入声明；identity 覆盖全部语义字段。"""
    counts = count_summary(entries)
    status_sha = hashlib.sha256(status_bytes(entries)).hexdigest()
    base = {
        "protocol": PROTOCOL,
        "labelRule": label_rule,
        "sampleWindow": sample_window,
        "observationWindow": observation_window,
        "observedThrough": observed_through,
        "observedThroughIso": _iso(observed_through) if isinstance(observed_through, int) else None,
        "requestedThrough": requested_through,
        "maturityDays": maturity_days,
        "revision": revision,
        "revisionEpoch": revision_epoch,
        "historyStatus": history_status,
        "coverage": coverage,
        "statusRule": STATUS_RULE,
        "statusSha256": status_sha,
        "counts": counts,
    }
    if status_file is not None:
        base["statusFile"] = status_file
    # 内容身份不包含本机路径：导出后重新加载仍应通过同一身份核对。
    base["identity"] = _identity_payload(base)
    return base


def _identity_payload(declared):
    value = dict(declared)
    value.pop("identity", None)
    value.pop("statusFile", None)
    return _digest(value)


def status_path(manifest):
    """描述文件声明的逐提交状态旁车绝对路径；未声明时返回 None。"""
    declaration_value = manifest.get("labeling") or {}
    file = declaration_value.get("statusFile") or {}
    path = file.get("path")
    if not isinstance(path, str) or not path:
        return None
    resolved = Path(path)
    return resolved if resolved.is_absolute() else BACKEND / resolved


def _load_entries(manifest):
    path = status_path(manifest)
    if path is None:
        raise BaselineError("LABEL_STATUS_MISSING", "数据版本没有声明逐提交标签状态文件")
    file = (manifest.get("labeling") or {}).get("statusFile") or {}
    try:
        blob = path.read_bytes()
    except OSError as exc:
        raise BaselineError("LABEL_STATUS_MISSING", f"标签状态文件不可读：{path.name}") from exc
    if hashlib.sha256(blob).hexdigest() != file.get("sha256"):
        raise BaselineError("LABEL_STATUS_INVALID", "标签状态文件校验值与描述文件不一致")
    entries = []
    for line in blob.decode("utf-8").splitlines():
        if not line.strip():
            continue
        try:
            entries.append(json.loads(line))
        except ValueError as exc:
            raise BaselineError("LABEL_STATUS_INVALID", "标签状态文件包含无效行") from exc
    if len(entries) != file.get("records"):
        raise BaselineError("LABEL_STATUS_INVALID", "标签状态文件记录数与描述文件不一致")
    return entries


def _validate_entries(manifest, records, entries):
    """按原始时间重算状态，核对旁车与 CSV 标签，不信任单个 mature 布尔值。"""
    declared = manifest.get("labeling") or {}
    observed = declared.get("observedThrough")
    maturity = declared.get("maturityDays")
    by_id = {entry.get("id"): entry for entry in entries}
    if len(by_id) != len(entries):
        raise BaselineError("LABEL_STATUS_INVALID", "标签状态文件包含重复提交")
    if set(by_id) != {record["id"] for record in records}:
        raise BaselineError("LABEL_STATUS_INVALID", "标签状态文件与原始 CSV 的提交集合不一致")
    for record in records:
        entry = by_id[record["id"]]
        expected = maturity_status(record["epoch"], observed, maturity)
        if entry.get("label") != record["label"] or entry.get("maturityStatus") != expected:
            raise BaselineError("LABEL_STATUS_INVALID", "标签状态无法从原始内容重算一致")
        if entry.get("admission") != ("included" if expected == "mature" else "excluded"):
            raise BaselineError("LABEL_STATUS_INVALID", "标签状态准入结果与成熟边界不一致")
    return by_id


def _unavailable(code, message, policy, **extra):
    return {"protocol": policy, "policy": policy, "available": False,
            "reason": {"code": code, "message": message}, **extra}


def evaluate(manifest, records, *, allow_legacy=False, allow_restricted=False):
    """判断一个数据版本能否进入成熟训练/评价，并返回合格成员。

    - 发布者数据：保留原始标签语义，全部记录可用。
    - 新协议：校验状态旁车，只有成熟提交进入合格总体；观察不完整或证据截断默认拒绝，
      `allow_restricted` 仅用于显式诊断，结果仍标为受限。
    - 旧 SZZ：默认拒绝新训练；`allow_legacy` 显式按历史协议复现全部记录。
    """
    if not is_szz(manifest):
        return {
            "protocol": PUBLISHER_PROTOCOL, "available": True, "reason": None,
            "policy": PUBLISHER_PROTOCOL, "restricted": False,
            "observedThrough": None, "maturityDays": None,
            "counts": {"originalRecords": len(records), "eligibleRecords": len(records),
                       "excludedImmature": 0, "excludedUnknown": 0,
                       "positivesOriginal": sum(record["label"] for record in records),
                       "positivesEligible": sum(record["label"] for record in records)},
            "identity": None, "eligible": list(records), "status": {},
        }
    declared = manifest.get("labeling") or {}
    if declared.get("protocol") != PROTOCOL:
        if not allow_legacy:
            return _unavailable(
                "LABEL_OBSERVATION_UNKNOWN",
                "这份数据缺少标签成熟度记录，无法安全判断哪些提交可用于训练；"
                "请重新采集为当前版本，或选择其他数据", LEGACY_PROTOCOL,
                restricted=True, eligible=[],
                counts={"originalRecords": len(records), "eligibleRecords": 0,
                        "excludedImmature": 0, "excludedUnknown": len(records),
                        "positivesOriginal": sum(record["label"] for record in records),
                        "positivesEligible": 0})
        return {
            "protocol": LEGACY_PROTOCOL, "available": True, "reason": None,
            "policy": LEGACY_PROTOCOL, "restricted": True,
            "observedThrough": None, "maturityDays": None,
            "counts": {"originalRecords": len(records), "eligibleRecords": len(records),
                       "excludedImmature": 0, "excludedUnknown": 0,
                       "positivesOriginal": sum(record["label"] for record in records),
                       "positivesEligible": sum(record["label"] for record in records)},
            "identity": None, "eligible": list(records), "status": {},
        }
    try:
        entries = _load_entries(manifest)
        by_id = _validate_entries(manifest, records, entries)
        recomputed_identity = _identity_from_manifest(manifest)
        if declared.get("identity") != recomputed_identity:
            raise BaselineError("LABEL_STATUS_INVALID", "观察声明内容身份与描述文件字段不一致")
    except BaselineError as exc:
        return _unavailable(exc.code, str(exc), PROTOCOL,
                            restricted=True, eligible=[],
                            counts={"originalRecords": len(records), "eligibleRecords": 0,
                                    "excludedImmature": 0, "excludedUnknown": len(records),
                                    "positivesOriginal": sum(record["label"] for record in records),
                                    "positivesEligible": 0})
    coverage = declared.get("coverage") or {}
    history = declared.get("historyStatus")
    incomplete = None
    if history != "complete":
        incomplete = ("LABEL_OBSERVATION_UNKNOWN",
                      f"仓库历史状态为 {history or 'unknown'}，不能声明完整观察")
    elif coverage.get("complete") is not True:
        incomplete = ("LABEL_EVIDENCE_TRUNCATED",
                      "SZZ 证据在预算内被截断，不能用于完整可信评价")
    counts = count_summary(entries)
    base = {
        "protocol": PROTOCOL, "policy": PROTOCOL,
        "observedThrough": declared.get("observedThrough"),
        "observedThroughIso": declared.get("observedThroughIso"),
        "maturityDays": declared.get("maturityDays"),
        "sampleWindow": declared.get("sampleWindow"),
        "observationWindow": declared.get("observationWindow"),
        "revision": declared.get("revision"),
        "revisionEpoch": declared.get("revisionEpoch"),
        "historyStatus": history, "coverage": coverage,
        "counts": counts, "identity": declared.get("identity"),
        "statusFile": declared.get("statusFile"),
    }
    if incomplete is not None and not allow_restricted:
        return {**base, "available": False, "restricted": True,
                "reason": {"code": incomplete[0], "message": incomplete[1]}, "eligible": []}
    eligible = [record for record in records
                if by_id[record["id"]]["admission"] == "included"]
    return {**base, "available": True, "restricted": incomplete is not None,
            "reason": (None if incomplete is None else
                       {"code": incomplete[0], "message": incomplete[1]}),
            "eligible": eligible, "status": by_id}


def _identity_from_manifest(manifest):
    """从描述文件的观察声明重算内容身份（不含 identity 与本机路径）。"""
    return _identity_payload(manifest.get("labeling") or {})


def summary(observation, entries):
    """由采集事实直接构造准入摘要；不读取旁车文件，供登记前回报使用。"""
    counts = count_summary(entries)
    complete = (observation.get("historyStatus") == "complete"
                and (observation.get("coverage") or {}).get("complete") is True)
    reason = None
    if observation.get("historyStatus") != "complete":
        reason = {"code": "LABEL_OBSERVATION_UNKNOWN",
                  "message": f"仓库历史状态为 {observation.get('historyStatus') or 'unknown'}，不能声明完整观察"}
    elif not complete:
        reason = {"code": "LABEL_EVIDENCE_TRUNCATED",
                  "message": "SZZ 证据在预算内被截断，不能用于完整可信评价"}
    return {
        "protocol": PROTOCOL, "policy": PROTOCOL,
        "available": complete, "restricted": not complete, "reason": reason,
        "observedThrough": observation.get("observedThrough"),
        "observedThroughIso": observation.get("observedThroughIso"),
        "maturityDays": observation.get("maturityDays"),
        "sampleWindow": observation.get("sampleWindow"),
        "observationWindow": observation.get("observationWindow"),
        "revision": observation.get("revision"),
        "revisionEpoch": observation.get("revisionEpoch"),
        "historyStatus": observation.get("historyStatus"),
        "coverage": observation.get("coverage"),
        "counts": counts, "identity": None,
    }


def view(result):
    """安全投影：不含本机路径，只保留准入事实与计数。"""
    return {
        "protocol": result.get("protocol"),
        "policy": result.get("policy"),
        "available": result.get("available"),
        "restricted": result.get("restricted"),
        "reason": result.get("reason"),
        "observedThrough": result.get("observedThrough"),
        "observedThroughIso": result.get("observedThroughIso"),
        "maturityDays": result.get("maturityDays"),
        "sampleWindow": result.get("sampleWindow"),
        "observationWindow": result.get("observationWindow"),
        "revision": result.get("revision"),
        "revisionEpoch": result.get("revisionEpoch"),
        "historyStatus": result.get("historyStatus"),
        "coverage": result.get("coverage"),
        "counts": result.get("counts"),
        "identity": result.get("identity"),
        "statusRule": (result.get("statusFile") or {}).get("rule") or STATUS_RULE,
    }


def derive_labeling(source, kept_ids, entries_by_id, status_file):
    """清洗派生版本沿用源版本的观察事实，只保留派生后成员的逐提交状态。"""
    declared = dict(source or {})
    if declared.get("protocol") != PROTOCOL:
        return None, None
    entries = [entries_by_id[identity] for identity in kept_ids if identity in entries_by_id]
    declared.pop("identity", None)
    declared.pop("statusFile", None)
    declared["counts"] = count_summary(entries)
    declared["statusSha256"] = hashlib.sha256(status_bytes(entries)).hexdigest()
    declared["statusFile"] = status_file
    declared["identity"] = _identity_payload(declared)
    return declared, status_bytes(entries)


def read_entries(manifest):
    """读取并校验旁车；供导出与派生使用。"""
    entries = _load_entries(manifest)
    return {entry["id"]: entry for entry in entries}
