"""具名方法注册表与 (schema, 方法) 标识的契约测试；不训练真实模型。"""
import pytest


def test_registry_entries_declare_every_required_field():
    from jit_baseline.algorithms import ALGORITHMS, CLASSIC, DEEP
    assert set(ALGORITHMS) == {"logistic-regression-l2-v1", "decision-tree-v1", "random-forest-v1"}
    for name, entry in ALGORITHMS.items():
        assert set(entry) >= {"label", "name", "category", "detail", "params", "estimator",
                              "kwargs", "preprocess", "requires", "reproducibility", "explanation"}, name
        assert entry["category"] in (CLASSIC, DEEP), name
        assert entry["label"] and entry["name"] and entry["detail"], name
        assert isinstance(entry["params"], dict) and entry["params"], name
        assert isinstance(entry["kwargs"], dict) and entry["kwargs"], name
        assert isinstance(entry["preprocess"], tuple), name
        assert isinstance(entry["requires"], tuple), name


def test_at_least_one_method_declares_a_dependency():
    """`requires` 非空的方法必须真实存在：这条路径此前从未被走过（PDB-11）。"""
    from jit_baseline.algorithms import ALGORITHMS
    declaring = {name: entry["requires"] for name, entry in ALGORITHMS.items() if entry["requires"]}
    assert declaring, "注册表里没有任何方法声明所需依赖，环境声明与子集校验这条路径无实际对象"
    for name, requires in declaring.items():
        assert all(isinstance(package, str) and package for package in requires), name


def test_declared_params_and_estimator_kwargs_agree():
    """防止 `params`（运行声明与校验用）与 `kwargs`（构造估计器用）各自漂移。"""
    from jit_baseline.algorithms import get_algorithm
    linear = get_algorithm("logistic-regression-l2-v1")
    params, kwargs = linear["params"], linear["kwargs"]
    assert (kwargs["C"], kwargs["solver"], kwargs["max_iter"], kwargs["tol"], kwargs["class_weight"]) == \
           (params["C"], params["solver"], params["max_iter"], params["tol"], params["class_weight"])
    assert kwargs["random_state"] == params["seed"] == 2026
    assert params["regularization"] == "L2" and kwargs["l1_ratio"] == 0.0
    assert params["threads"] == 1
    tree = get_algorithm("decision-tree-v1")
    assert (tree["kwargs"]["criterion"], tree["kwargs"]["max_depth"], tree["kwargs"]["min_samples_leaf"]) == \
           (tree["params"]["criterion"], tree["params"]["max_depth"], tree["params"]["min_samples_leaf"])
    assert tree["kwargs"]["random_state"] == tree["params"]["seed"]
    forest = get_algorithm("random-forest-v1")
    assert (forest["kwargs"]["n_estimators"], forest["kwargs"]["criterion"], forest["kwargs"]["max_depth"],
            forest["kwargs"]["min_samples_leaf"]) == \
           (forest["params"]["n_estimators"], forest["params"]["criterion"], forest["params"]["max_depth"],
            forest["params"]["min_samples_leaf"])
    assert forest["kwargs"]["random_state"] == forest["params"]["seed"] == 2026
    assert forest["requires"] and "scipy" in forest["requires"]


def test_reproducibility_discipline_is_declared_per_method():
    from jit_baseline.algorithms import ALGORITHMS
    for name, entry in ALGORITHMS.items():
        discipline = entry["reproducibility"]
        assert set(discipline) >= {"mode", "atol", "rtol"}, name
        assert discipline["mode"] in ("tolerance", "independent-protocol"), name
        if discipline["mode"] == "tolerance":
            assert discipline["atol"] > 0 and discipline["rtol"] >= 0, name


def test_explanation_policy_is_declared_as_not_implemented():
    """本 change 未实现解释：注册条目必须如实说明，不能空着或暗示已提供。"""
    from jit_baseline.algorithms import ALGORITHMS
    for name, entry in ALGORITHMS.items():
        assert entry["explanation"]["method"] is None, name
        assert entry["explanation"]["reason"], name


def test_unknown_method_is_rejected_without_fallback():
    from jit_baseline.algorithms import get_algorithm, resolve_algorithm
    from jit_baseline.data import BaselineError
    with pytest.raises(BaselineError) as info:
        get_algorithm("logistic-regression-l2-v9")
    assert info.value.code == "ALGORITHM_UNKNOWN"
    with pytest.raises(BaselineError) as info:
        resolve_algorithm("decision-tree-v9")
    assert info.value.code == "ALGORITHM_UNKNOWN"


def test_missing_method_declaration_falls_back_to_the_first_frozen_method():
    from jit_baseline.algorithms import DEFAULT_ALGORITHM, get_algorithm, resolve_algorithm
    assert resolve_algorithm(None) is get_algorithm(DEFAULT_ALGORITHM)
    assert resolve_algorithm("") is get_algorithm(DEFAULT_ALGORITHM)


def test_model_identity_is_decided_by_schema_and_method_together():
    from jit_baseline.algorithms import model_descriptor
    # 既有两项保持既有标识，使既有运行的来源信息可继续追溯。
    assert model_descriptor("openstack-six-v1", "logistic-regression-l2-v1") == \
        {"id": "logistic-regression-six-v1", "name": "逻辑回归 · 六字段"}
    assert model_descriptor("kamei14-v1", "logistic-regression-l2-v1") == \
        {"id": "logistic-regression-kamei14-v1", "name": "逻辑回归 · Kamei14（12 字段入模）"}
    # 无方法声明的旧运行回退到首个冻结方法，仍得到既有标识。
    assert model_descriptor("openstack-six-v1")["id"] == "logistic-regression-six-v1"
    # 同一 schema 的第二个方法必须得到不同标识。
    linear = model_descriptor("openstack-six-v1", "logistic-regression-l2-v1")
    tree = model_descriptor("openstack-six-v1", "decision-tree-v1")
    assert tree["id"] != linear["id"]
    assert tree["name"] != linear["name"]
