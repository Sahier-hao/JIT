"""打分模型来源判定：四个分支与 14 维到 6 维投影（RCL-09 / D3）。"""

import pytest

from jit_baseline.errors import BaselineError
from jit_baseline.sync import (GENERIC, GENERIC_PROJECTION, TRAINED, choose_model,
                               generic_inputs)

DAY = 86400
START = 1_700_000_000


def _records(count, positive_every=3, days=1):
    """按天递增的提交序列；标签按固定间隔出现，保证训练/测试都含两类。"""
    return [{"id": f"c{index:04d}", "epoch": START + index * days * DAY,
             "label": 1 if index % positive_every == 0 else 0,
             "features": [0] * 14, "metrics": {}}
            for index in range(count)]


def _holdout(records):
    return records[-1]["epoch"] - 30 * DAY


def test_auto_enough_samples_trains():
    records = _records(400, days=1)
    decision = choose_model(records, "auto", _holdout(records))
    assert decision["modelStrategy"] == TRAINED
    assert decision["degradeReason"] is None
    assert decision["trainRecords"] >= 200
    assert decision["trainPositives"] >= 20


def test_auto_few_records_degrades():
    records = _records(120, days=1)
    decision = choose_model(records, "auto", _holdout(records))
    assert decision["modelStrategy"] == GENERIC
    assert decision["degradeReason"] == "fewRecords"


def test_auto_few_positives_degrades():
    records = _records(400, positive_every=40, days=1)
    decision = choose_model(records, "auto", _holdout(records))
    assert decision["modelStrategy"] == GENERIC
    assert decision["degradeReason"] == "fewPositives"
    assert decision["trainRecords"] >= 200
    assert decision["trainPositives"] < 20


def test_force_train_ignores_soft_thresholds_but_records_samples():
    records = _records(120, days=1)
    decision = choose_model(records, "force-train", _holdout(records))
    assert decision["modelStrategy"] == TRAINED
    assert decision["degradeReason"] is None
    assert decision["trainRecords"] < 200


def test_force_train_without_two_label_classes_fails():
    records = [{"id": f"c{index}", "epoch": START + index * DAY, "label": 0,
                "features": [0] * 14, "metrics": {}} for index in range(300)]
    with pytest.raises(BaselineError) as error:
        choose_model(records, "force-train", _holdout(records))
    assert error.value.code == "SPLIT_INVALID"
    assert "现成模型" in str(error.value)


def test_force_train_with_fewer_than_three_time_groups_fails():
    records = [{"id": "a", "epoch": START, "label": 0, "features": [0] * 14, "metrics": {}},
               {"id": "b", "epoch": START + DAY, "label": 1, "features": [0] * 14, "metrics": {}}]
    with pytest.raises(BaselineError) as error:
        choose_model(records, "force-train", _holdout(records))
    assert error.value.code == "SPLIT_INVALID"


def test_generic_strategy_skips_training_and_keeps_counts():
    records = _records(400, days=1)
    decision = choose_model(records, "generic-model", _holdout(records))
    assert decision["modelStrategy"] == GENERIC
    assert decision["degradeReason"] is None
    assert decision["trainRecords"] > 0


def test_projection_maps_entropy_to_ent_and_keeps_other_names():
    from jit_baseline.schemas import resolve
    fields = resolve("openstack-six-v1").in_model_names()
    record = {"id": "c1", "epoch": START, "label": 0,
              "features": [0] * 14,
              "metrics": {"ns": 1, "nd": 2, "nf": 3, "entropy": 0.5, "la": 4, "ld": 5}}
    inputs = generic_inputs([record], fields)
    assert inputs[0]["features"] == [1, 2, 3, 0.5, 4, 5]
    assert GENERIC_PROJECTION == {"ent": "entropy"}
    assert fields.index("ent") == 3
