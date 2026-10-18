"""并列比较与新增经典方法的契约测试；真跑固定数据，但不作为正式效果结论。"""
import json

import pytest


def test_new_classic_methods_declare_consistent_params_and_kwargs():
    from jit_baseline.algorithms import CLASSIC, get_algorithm
    bayes = get_algorithm("gaussian-naive-bayes-v1")
    assert bayes["category"] == CLASSIC
    assert bayes["kwargs"]["var_smoothing"] == bayes["params"]["var_smoothing"] == 1e-9
    assert bayes["preprocess"] == () and bayes["requires"] == ()
    boosting = get_algorithm("gradient-boosting-v1")
    assert boosting["category"] == CLASSIC
    for field in ("n_estimators", "learning_rate", "max_depth", "min_samples_leaf"):
        assert boosting["kwargs"][field] == boosting["params"][field]
    assert boosting["kwargs"]["random_state"] == boosting["params"]["seed"] == 2026
    assert boosting["preprocess"] == () and boosting["requires"] == ()


def test_every_declared_estimator_has_an_implementation():
    from jit_baseline.algorithms import ALGORITHMS
    from jit_baseline.model import ESTIMATORS, build_estimator
    assert {entry["estimator"] for entry in ALGORITHMS.values()} <= set(ESTIMATORS)
    for name, entry in ALGORITHMS.items():
        if "torch" in entry.get("requires", ()):
            try:
                import torch  # noqa: F401
            except ImportError:
                continue  # 本机未安装 torch 时只验证可选框架之外的方法
        assert build_estimator(entry).__class__.__name__, name


@pytest.fixture(scope="session")
def six_runs(tmp_path_factory):
    from jit_baseline.artifacts import build_run
    from jit_baseline.config import BACKEND
    root = tmp_path_factory.mktemp("comparison-runs")
    targets = {}
    for name in ("decision-tree-v1", "gaussian-naive-bayes-v1"):
        target = root / name
        build_run(BACKEND / "data/openstack", target, None, name)
        targets[name] = target
    return targets


@pytest.fixture(scope="session")
def kamei_run(tmp_path_factory):
    from jit_baseline.artifacts import build_run
    from jit_baseline.config import BACKEND
    target = tmp_path_factory.mktemp("comparison-kamei") / "run"
    build_run(BACKEND / "data/openstack", target, "kamei14-v1", "logistic-regression-l2-v1")
    return target


def test_same_context_methods_are_directly_rankable(six_runs):
    from jit_baseline.artifacts import compare_methods
    report = compare_methods(list(six_runs.values()))
    assert report["directlyRankable"] is True and report["reasons"] == []
    assert {entry["method"] for entry in report["methods"]} == set(six_runs)
    assert report["testCount"] == 1853
    for entry in report["methods"]:
        assert entry["parameters"] and entry["trainingSeconds"] is not None
        assert entry["metrics"]["rocAuc"]["value"] is not None
        assert entry["counts"]["records"] == report["testCount"]


def test_cross_schema_comparison_is_not_directly_rankable(six_runs, kamei_run):
    from jit_baseline.artifacts import compare_methods
    report = compare_methods([six_runs["decision-tree-v1"], kamei_run])
    assert report["directlyRankable"] is False
    assert report["reasons"]
    # 数据版本由描述文件唯一确定（同一来源与纳入规则），跨 schema 只在
    # 测试成员与特征 schema 上不同；两者都要被列出。
    for label in ("测试成员", "特征 schema"):
        assert any(label in reason for reason in report["reasons"]), label


def test_empty_comparison_is_an_error_not_an_empty_report(tmp_path):
    from jit_baseline.artifacts import compare_methods
    from jit_baseline.data import BaselineError
    with pytest.raises(BaselineError) as info:
        compare_methods([])
    assert info.value.code == "EVALUATION_INVALID"


def test_training_seconds_do_not_change_run_identity(six_runs):
    """耗时记在摘要里，不进入运行身份：同输入两次运行的 runId 必须相同。"""
    target = six_runs["decision-tree-v1"]
    manifest = json.loads((target / "manifest.json").read_text(encoding="utf-8"))
    summary = json.loads((target / "summary.json").read_text(encoding="utf-8"))
    assert "trainingSeconds" in summary
    assert "trainingSeconds" not in manifest["config"]
    from jit_baseline.artifacts import identity
    config = dict(manifest["config"])
    assert identity(config) == manifest["runId"]


@pytest.fixture(scope="session")
def v2_run(tmp_path_factory):
    from jit_baseline.artifacts import build_run
    from jit_baseline.config import BACKEND
    target = tmp_path_factory.mktemp("comparison-v2") / "run"
    build_run(BACKEND / "data/openstack", target, None, "decision-tree-v1", "metric-set-v2")
    return target


def test_cross_metric_set_comparison_is_not_directly_rankable(six_runs, v2_run):
    from jit_baseline.artifacts import compare_methods
    report = compare_methods([six_runs["decision-tree-v1"], v2_run])
    assert report["directlyRankable"] is False
    assert any("指标集" in reason for reason in report["reasons"])
    assert report["methods"][1]["metrics"]["popt"]["value"] is not None
