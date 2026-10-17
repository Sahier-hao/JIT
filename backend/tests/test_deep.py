"""表格型深度方法：适配器契约、四架构与注册条目；合成小样例，不代表真实效果。"""
import numpy as np
import pytest


def synthetic(n=64, d=6, seed=0):
    rng = np.random.default_rng(seed)
    features = rng.normal(size=(n, d))
    labels = (features[:, 0] + 0.5 * features[:, 1] > 0).astype(int)
    return features, labels


CASES = [
    ("mlp", {"hidden": [8, 4]}),
    ("tabular-resnet", {"hidden": 8, "blocks": 2}),
    ("ft-transformer", {"d_token": 8, "heads": 2, "layers": 1}),
    ("wide-deep", {"deep": [8, 4]}),
]


@pytest.mark.parametrize("architecture,kwargs", CASES)
def test_adapter_fits_predicts_and_round_trips(architecture, kwargs, tmp_path):
    import joblib
    from jit_baseline.deep import TorchTabularClassifier
    features, labels = synthetic()
    model = TorchTabularClassifier(architecture, epochs=3, batch_size=32, dropout=0.1, **kwargs)
    model.fit(features, labels)
    proba = model.predict_proba(features)
    assert proba.shape == (len(features), 2)
    assert np.allclose(proba.sum(axis=1), 1.0)
    assert model.n_features_in_ == features.shape[1]
    assert model.classes_.tolist() == [0, 1]
    path = tmp_path / "model.joblib"
    joblib.dump(model, path)
    loaded = joblib.load(path)
    assert np.allclose(loaded.predict_proba(features), proba, atol=1e-8, rtol=0)


def test_deep_entries_declare_torch_scaling_and_tolerance():
    from jit_baseline.algorithms import ALGORITHMS, DEEP
    from jit_baseline.deep import TorchTabularClassifier
    from jit_baseline.model import ESTIMATORS, build_estimator
    deep = {name: entry for name, entry in ALGORITHMS.items() if entry["category"] == DEEP}
    assert set(deep) == {"mlp-v1", "tabular-resnet-v1", "ft-transformer-v1", "wide-deep-v1"}
    for name, entry in deep.items():
        assert entry["requires"] == ("torch",), name
        assert entry["preprocess"] == ("scale",), name
        assert entry["kwargs"] == entry["params"], name
        assert entry["estimator"] in ESTIMATORS, name
        assert entry["reproducibility"]["mode"] == "tolerance", name
        assert isinstance(build_estimator(entry), TorchTabularClassifier), name


def test_sequence_architecture_is_rejected():
    from jit_baseline.data import BaselineError
    from jit_baseline.deep import TorchTabularClassifier
    features, labels = synthetic()
    with pytest.raises(BaselineError) as info:
        TorchTabularClassifier("lstm", epochs=1).fit(features, labels)
    assert info.value.code == "ALGORITHM_UNKNOWN"


def test_environment_records_the_declared_framework():
    from jit_baseline.artifacts import environment
    recorded = environment(("torch",))
    assert "torch" in recorded["packages"]
    assert "scikit-learn" in recorded["packages"]


def test_same_frozen_declaration_is_reproducible():
    """同一冻结声明（种子/超参/epoch）两次训练应得到一致预测。"""
    from jit_baseline.deep import torch_mlp
    features, labels = synthetic(128)
    first = torch_mlp(hidden=[8, 4], dropout=0.1, epochs=3).fit(features, labels)
    second = torch_mlp(hidden=[8, 4], dropout=0.1, epochs=3).fit(features, labels)
    assert np.allclose(first.predict_proba(features), second.predict_proba(features), atol=1e-8, rtol=0)
