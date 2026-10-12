"""Time and leakage tests on synthetic inputs; never formal model effects."""
from copy import deepcopy

import numpy as np
import pytest


def samples(count=100):
    return [{"id": f"{i:040x}", "epoch": 1_350_000_000 + i, "time": f"synthetic-{i}",
             "features": [1, 2, 3, 0.5, 2 + i % 11, i % 5], "label": i % 2}
            for i in range(count)]


def test_time_groups_do_not_cross_partitions():
    from jit_baseline.model import temporal_split
    records = samples()
    records[70]["epoch"] = records[69]["epoch"]
    split, boundaries = temporal_split(records)
    times = [set(r["epoch"] for r in split[name]) for name in ["train", "validation", "test"]]
    assert all(not times[i] & times[j] for i in range(3) for j in range(i + 1, 3))
    assert max(times[0]) < min(times[1]) and max(times[1]) < min(times[2])
    assert sum(map(len, split.values())) == 100
    assert len(boundaries) == 2


def test_split_is_independent_of_labels_and_input_order():
    from jit_baseline.model import temporal_split
    original = samples()
    changed = list(reversed(deepcopy(original)))
    for r in changed:
        r["label"] = 1 - r["label"]
    a, _ = temporal_split(original)
    b, _ = temporal_split(changed)
    assert {k: [r["id"] for r in v] for k, v in a.items()} == {k: [r["id"] for r in v] for k, v in b.items()}


@pytest.mark.parametrize("records", [[], samples(2), [{**r, "label": 0} for r in samples()]])
def test_empty_or_single_class_partitions_fail(records):
    from jit_baseline.model import temporal_split
    with pytest.raises(ValueError):
        temporal_split(records)


def test_duplicate_commit_cannot_appear_in_two_partitions():
    from jit_baseline.model import temporal_split
    records = samples()
    records[-1]["id"] = records[0]["id"]
    with pytest.raises(ValueError, match="重复"):
        temporal_split(records)


def test_fixed_model_uses_class_one_and_can_be_reloaded(tmp_path):
    import joblib
    from jit_baseline.model import fit_model, predict_risks
    train = samples(40)
    model = fit_model(train)
    risks = predict_risks(model, train)
    assert len(risks) == 40 and all(0 <= p <= 1 for p in risks)
    path = tmp_path / "model.joblib"
    joblib.dump(model, path)
    assert np.allclose(predict_risks(joblib.load(path), train), risks, atol=1e-8, rtol=0)
    assert model.named_steps["model"].C == 1
    assert model.named_steps["model"].class_weight is None


def test_test_labels_do_not_affect_risks_or_training_statistics():
    from jit_baseline.model import fit_model, predict_risks
    train = samples(40)
    test = samples(12)
    model = fit_model(train)
    changed = deepcopy(test)
    for r in changed:
        r["label"] = 1 - r["label"]
    assert predict_risks(model, changed) == predict_risks(model, test)
    expected_train_mean = np.column_stack([np.log1p(np.array([r["features"] for r in train])[:, [0, 1, 2, 4, 5]]), np.full(40, .5)]).mean(axis=0)
    # Original column order is retained by the transformation.
    assert np.allclose(model.named_steps["scale"].mean_, expected_train_mean[[0, 1, 2, 5, 3, 4]])


def test_test_feature_distribution_cannot_change_a_fitted_model():
    from jit_baseline.model import fit_model, predict_risks
    train = samples(40)
    model = fit_model(train)
    before = model.named_steps["scale"].mean_.copy(), model.named_steps["model"].coef_.copy()
    changed = samples(12)
    for r in changed:
        r["features"][4] = 1_000_000
    predict_risks(model, changed)
    assert np.array_equal(before[0], model.named_steps["scale"].mean_)
    assert np.array_equal(before[1], model.named_steps["model"].coef_)


def test_nonconvergence_is_not_a_usable_model():
    from jit_baseline.model import fit_model
    with pytest.raises(ValueError, match="收敛"):
        fit_model(samples(100), max_iter=1)


@pytest.mark.parametrize("patch", [[1, 2], [1, 2, 3, float('nan'), 4, 5], [1, 2, 3, .5, -1, 5]])
def test_inference_rejects_invalid_feature_vectors(patch):
    from jit_baseline.model import fit_model, predict_risks
    model = fit_model(samples(40))
    invalid = samples(1)
    invalid[0]["features"] = patch
    with pytest.raises(ValueError):
        predict_risks(model, invalid)
