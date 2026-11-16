"""Label maturity policy shared by dataset collection, training and qualification."""

from .errors import BaselineError

MATURE_ONLY = "mature-only"
INCLUDE_IMMATURE = "include-immature"
LEGACY_UNRECORDED = "legacy-unrecorded"
POLICIES = (MATURE_ONLY, INCLUDE_IMMATURE)
STATUSES = ("positive", "unobserved", "immature", "unrecorded")


def resolve_policy(value=None):
    policy = value or MATURE_ONLY
    if policy not in POLICIES:
        raise BaselineError(
            "MATURITY_POLICY_INVALID",
            "标签成熟策略必须是 mature-only 或 include-immature",
        )
    return policy


def status_counts(records):
    counts = {name: 0 for name in STATUSES}
    for record in records:
        status = record.get("labelStatus") or "unrecorded"
        if status not in STATUSES:
            raise BaselineError("DATASET_INVALID", f"未知标签成熟状态：{status}")
        counts[status] += 1
    return counts


def apply_label_maturity(records, policy=None):
    """Return filtered records and auditable policy metadata.

    Legacy datasets without maturity columns remain trainable through the
    legacy-unrecorded path, but they are not eligible for formal release
    qualification.
    """
    requested = resolve_policy(policy)
    counts = status_counts(records)
    recorded = counts["unrecorded"] == 0
    observed_values = {
        int(record["observedThroughEpoch"])
        for record in records
        if record.get("observedThroughEpoch") is not None
    }
    maturity_values = {
        int(record["maturityDays"])
        for record in records
        if record.get("maturityDays") is not None
    }
    if recorded and (len(observed_values) != 1 or len(maturity_values) != 1):
        raise BaselineError(
            "DATASET_INVALID",
            "标签成熟状态记录的观察终点或成熟期不一致",
        )
    if requested == INCLUDE_IMMATURE:
        kept = list(records)
        effective = INCLUDE_IMMATURE
        release_eligible = False
    elif not recorded:
        kept = list(records)
        effective = LEGACY_UNRECORDED
        release_eligible = False
    else:
        kept = [record for record in records if record["labelStatus"] != "immature"]
        effective = MATURE_ONLY
        release_eligible = True
    if not kept:
        raise BaselineError("SPLIT_INVALID", "标签成熟策略过滤后没有可训练记录")
    return kept, {
        "requestedPolicy": requested,
        "effectivePolicy": effective,
        "releaseEligible": release_eligible,
        "inputRecords": len(records),
        "excludedImmature": counts["immature"] if effective == MATURE_ONLY else 0,
        "statusCounts": counts,
        "observedThroughEpoch": next(iter(observed_values), None),
        "maturityDays": next(iter(maturity_values), None),
    }
