"""Test fixture: register a git-schema dataset with a mature observation declaration."""
import hashlib

from jit_baseline import admission, datasets


def register_labeled(csv_path, records, *, schema, dataset, root, cohort,
                     maturity_days=90, revision=None):
    """Write a status sidecar and manifest labeling so tests exercise the new protocol.

    This is test scaffolding, not evidence: the revision is a placeholder unless the
    caller supplies a real one.
    """
    observed = max(record["epoch"] for record in records) + maturity_days * 86400
    status = admission.build_status(records, observed, maturity_days)
    status_bytes = admission.status_bytes(status)
    digest = hashlib.sha256(status_bytes).hexdigest()
    status_path = root / f"{dataset}-label-status-{digest[:16]}.jsonl"
    status_path.parent.mkdir(parents=True, exist_ok=True)
    status_path.write_bytes(status_bytes)
    status_meta = {"path": datasets.manifest_relative(status_path), "sha256": digest,
                   "records": len(status), "rule": admission.STATUS_RULE}
    labeling = admission.declaration(
        label_rule="szz-full-v1",
        sample_window={"since": None, "until": None, "startEpoch": None, "endEpoch": None},
        observation_window={"fromEpoch": None, "throughEpoch": observed, "through": None},
        observed_through=observed, maturity_days=maturity_days,
        revision=revision or "a" * 40, revision_epoch=observed,
        history_status="complete",
        coverage={"complete": True, "truncated": False, "historyBounded": False,
                  "unresolvedRanges": 0, "reason": None},
        entries=status, status_file=status_meta)
    return datasets.register(csv_path, schema=schema, dataset=dataset, root=root,
                             cohort=cohort,
                             extra={"labeling": labeling, "labelStatusFile": status_meta})
