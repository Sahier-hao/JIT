"""Label maturity is an explicit, reproducible training input."""

import pytest

from jit_baseline.data import BaselineError
from jit_baseline.label_maturity import (
    INCLUDE_IMMATURE,
    LEGACY_UNRECORDED,
    MATURE_ONLY,
    apply_label_maturity,
)


def records():
    common = {
        "observedThroughEpoch": 1_700_000_000,
        "maturityDays": 90,
    }
    return [
        {"id": "a" * 40, "epoch": 1_690_000_000, "label": 1,
         "labelStatus": "positive", **common},
        {"id": "b" * 40, "epoch": 1_690_000_000, "label": 0,
         "labelStatus": "unobserved", **common},
        {"id": "c" * 40, "epoch": 1_699_990_000, "label": 0,
         "labelStatus": "immature", **common},
    ]


def test_mature_only_excludes_immature_before_training():
    kept, metadata = apply_label_maturity(records())
    assert [record["labelStatus"] for record in kept] == ["positive", "unobserved"]
    assert metadata["effectivePolicy"] == MATURE_ONLY
    assert metadata["excludedImmature"] == 1
    assert metadata["releaseEligible"] is True
    assert metadata["statusCounts"]["immature"] == 1


def test_sensitivity_policy_is_not_release_eligible():
    kept, metadata = apply_label_maturity(records(), INCLUDE_IMMATURE)
    assert len(kept) == 3
    assert metadata["effectivePolicy"] == INCLUDE_IMMATURE
    assert metadata["excludedImmature"] == 0
    assert metadata["releaseEligible"] is False


def test_legacy_status_is_not_inferred():
    legacy = [{key: value for key, value in record.items()
               if key not in {"labelStatus", "observedThroughEpoch", "maturityDays"}}
              for record in records()]
    kept, metadata = apply_label_maturity(legacy)
    assert len(kept) == 3
    assert metadata["effectivePolicy"] == LEGACY_UNRECORDED
    assert metadata["releaseEligible"] is False


def test_unknown_policy_is_rejected():
    with pytest.raises(BaselineError) as raised:
        apply_label_maturity(records(), "random-split")
    assert raised.value.code == "MATURITY_POLICY_INVALID"
