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
    from jit_baseline.algorithms import DEFAULT_ALGORITHM, get_algorithm
    from jit_baseline.model import fit_model, predict_risks
    train = samples(40)
    model = fit_model(train)
    risks = predict_risks(model, train)
    assert len(risks) == 40 and all(0 <= p <= 1 for p in risks)
    path = tmp_path / "model.joblib"
    joblib.dump(model, path)
    assert np.allclose(predict_risks(joblib.load(path), train), risks, atol=1e-8, rtol=0)
    # 估计器与其超参来自该方法的注册声明，而不是写死在流水线构造里。
    declared = get_algorithm(DEFAULT_ALGORITHM)["kwargs"]
    fitted = model.named_steps["model"].get_params()
    assert all(fitted[key] == value for key, value in declared.items())


def test_declared_method_selects_its_estimator_and_preprocessing_steps():
    from jit_baseline.algorithms import DEFAULT_ALGORITHM, get_algorithm
    from jit_baseline.model import fit_model, predict_risks
    linear = fit_model(samples(40))
    assert list(linear.named_steps) == ["counts", "scale", "model"]
    assert get_algorithm(DEFAULT_ALGORITHM)["preprocess"] == ("scale",)
    tree = fit_model(samples(40), algorithm="decision-tree-v1")
    assert list(tree.named_steps) == ["counts", "model"]
    assert get_algorithm("decision-tree-v1")["preprocess"] == ()
    assert len(predict_risks(tree, samples(5))) == 5


def test_test_labels_do_not_affect_risks_or_training_statistics():
    from jit_baseline.algorithms import DEFAULT_ALGORITHM, get_algorithm
    from jit_baseline.model import fit_model, predict_risks
    train = samples(40)
    test = samples(12)
    model = fit_model(train)
    changed = deepcopy(test)
    for r in changed:
        r["label"] = 1 - r["label"]
    assert predict_risks(model, changed) == predict_risks(model, test)
    if "scale" in get_algorithm(DEFAULT_ALGORITHM)["preprocess"]:
        expected_train_mean = np.column_stack([np.log1p(np.array([r["features"] for r in train])[:, [0, 1, 2, 4, 5]]), np.full(40, .5)]).mean(axis=0)
        # Original column order is retained by the transformation.
        assert np.allclose(model.named_steps["scale"].mean_, expected_train_mean[[0, 1, 2, 5, 3, 4]])


def test_test_feature_distribution_cannot_change_a_fitted_model():
    import pickle
    from jit_baseline.model import fit_model, predict_risks
    train = samples(40)
    model = fit_model(train)
    # 与估计器无关的泄漏检查：推理不得改动已拟合的模型对象本身。
    before = pickle.dumps(model)
    changed = samples(12)
    for r in changed:
        r["features"][4] = 1_000_000
    predict_risks(model, changed)
    assert pickle.dumps(model) == before


def test_nonconvergence_is_not_a_usable_model(monkeypatch):
    from jit_baseline.algorithms import ALGORITHMS, DEFAULT_ALGORITHM
    from jit_baseline.model import fit_model
    # 收敛契约来自方法声明：换一个收紧迭代上限的声明即触发不收敛失败。
    entry = dict(ALGORITHMS[DEFAULT_ALGORITHM], kwargs={**ALGORITHMS[DEFAULT_ALGORITHM]["kwargs"], "max_iter": 1})
    monkeypatch.setitem(ALGORITHMS, "test-nonconvergent-v1", entry)
    with pytest.raises(ValueError, match="收敛"):
        fit_model(samples(100), algorithm="test-nonconvergent-v1")


@pytest.mark.parametrize("patch", [[1, 2], [1, 2, 3, float('nan'), 4, 5], [1, 2, 3, .5, -1, 5]])
def test_inference_rejects_invalid_feature_vectors(patch):
    from jit_baseline.model import fit_model, predict_risks
    model = fit_model(samples(40))
    invalid = samples(1)
    invalid[0]["features"] = patch
    with pytest.raises(ValueError):
        predict_risks(model, invalid)
