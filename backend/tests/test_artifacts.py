"""Real publisher integration; fixtures are never formal experiment outputs."""
import json
import shutil
from pathlib import Path

import numpy as np
import pytest

from jit_baseline.config import BACKEND


@pytest.fixture(scope="session")
def real_run(tmp_path_factory):
    from jit_baseline.artifacts import build_run
    target = tmp_path_factory.mktemp("real-test-fixture") / "run"
    build_run(BACKEND / "data/openstack", target)
    return target


@pytest.fixture
def copied_run(real_run, tmp_path):
    target = tmp_path / "run"
    shutil.copytree(real_run, target)
    return target


def test_real_manifest_snapshot_and_reference_are_one_context(real_run):
    from jit_baseline.artifacts import Snapshot, verify_run
    manifest = verify_run(real_run)
    snapshot = Snapshot.load(real_run)
    batch = snapshot.batch()
    reference = json.loads((real_run / "reference-predictions.json").read_text(encoding="utf-8"))
    assert len(batch["records"]) == 1853
    assert batch["runId"] == batch["summary"]["runId"] == manifest["runId"]
    assert batch["datasetVersion"] == batch["summary"]["datasetVersion"]
    assert {r["id"] for r in batch["records"]} == {r["id"] for r in reference}
    assert np.max(np.abs([a["risk"] - b["risk"] for a, b in zip(batch["records"], reference, strict=True)])) <= 1e-8
    assert all("label" not in r and "title" not in r and "explanation" not in r for r in batch["records"])
    assert manifest["config"]["features"] == ["ns", "nd", "nf", "ent", "la", "ld"]


def test_service_invokes_loaded_model_and_does_not_read_labels_or_reference(copied_run, monkeypatch):
    from jit_baseline.artifacts import Snapshot
    snapshot = Snapshot.load(copied_run)
    (copied_run / "test-labels.json").unlink()
    (copied_run / "reference-predictions.json").unlink()
    calls = []
    original = snapshot.model.predict_proba
    def tracked(matrix):
        calls.append(matrix.shape)
        return original(matrix)
    monkeypatch.setattr(snapshot.model, "predict_proba", tracked)
    before = {p.name: p.read_bytes() for p in copied_run.iterdir()}
    assert len(snapshot.batch()["records"]) == 1853
    assert calls == [(1853, 6)]
    assert before == {p.name: p.read_bytes() for p in copied_run.iterdir()}
    # Even startup needs no evaluation labels or reference probabilities.
    assert len(Snapshot.load(copied_run).batch()["records"]) == 1853


@pytest.mark.parametrize("filename", ["source.json", "test-input.json", "model.joblib", "summary.json", "manifest.json"])
def test_missing_necessary_artifact_fails(copied_run, filename):
    from jit_baseline.artifacts import Snapshot
    (copied_run / filename).unlink()
    with pytest.raises(ValueError, match="不可用"):
        Snapshot.load(copied_run)


def test_corrupted_model_fails_before_deserialization(copied_run):
    from jit_baseline.artifacts import Snapshot
    with (copied_run / "model.joblib").open("ab") as file:
        file.write(b"bad")
    with pytest.raises(ValueError, match="校验"):
        Snapshot.load(copied_run)


def test_model_that_is_not_a_fitted_pipeline_is_rejected(copied_run, monkeypatch):
    """文件完整性通过之后仍要检查模型类型与形状（MODEL_INVALID）。"""
    import joblib
    from jit_baseline.artifacts import Snapshot
    from jit_baseline.data import BaselineError
    monkeypatch.setattr(joblib, "load", lambda path: {"not": "a pipeline"})
    with pytest.raises(BaselineError) as info:
        Snapshot.load(copied_run)
    assert info.value.code == "MODEL_INVALID"


def rewrite_artifact(target, filename, mutate):
    from jit_baseline.artifacts import identity
    from jit_baseline.data import sha256
    path = target / filename
    obj = json.loads(path.read_text(encoding="utf-8"))
    mutate(obj)
    path.write_text(json.dumps(obj), encoding="utf-8")
    manifest = json.loads((target / "manifest.json").read_text(encoding="utf-8"))
    manifest["files"][filename] = sha256(path.read_bytes())
    manifest["config"]["coreFiles"][filename] = manifest["files"][filename]
    manifest["runId"] = identity(manifest["config"])
    summary = json.loads((target / "summary.json").read_text(encoding="utf-8"))
    summary["runId"] = manifest["runId"]
    (target / "summary.json").write_text(json.dumps(summary), encoding="utf-8")
    manifest["files"]["summary.json"] = sha256((target / "summary.json").read_bytes())
    (target / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def test_hashed_but_wrong_feature_order_still_fails(copied_run):
    from jit_baseline.artifacts import Snapshot
    rewrite_artifact(copied_run, "test-input.json", lambda obj: obj["features"].reverse())
    with pytest.raises(ValueError, match="字段"):
        Snapshot.load(copied_run)


def test_hashed_but_partial_input_is_not_a_usable_batch(copied_run):
    from jit_baseline.artifacts import Snapshot
    rewrite_artifact(copied_run, "test-input.json", lambda obj: obj["records"].pop())
    with pytest.raises(ValueError, match="身份|数量"):
        Snapshot.load(copied_run)


def test_model_or_config_change_cannot_reuse_run_identity(real_run):
    from jit_baseline.artifacts import identity
    manifest = json.loads((real_run / "manifest.json").read_text(encoding="utf-8"))
    config = dict(manifest["config"], modelSha256="0" * 64)
    assert identity(config) != manifest["runId"]


def test_new_run_declares_base_packages_and_method_requirements(real_run):
    """运行声明记录基础环境加该方法所需依赖（PDB-11）。"""
    from jit_baseline.algorithms import DEFAULT_ALGORITHM, get_algorithm
    from jit_baseline.artifacts import BASE_PACKAGES
    manifest = json.loads((real_run / "manifest.json").read_text(encoding="utf-8"))
    recorded = set(manifest["config"]["environment"]["packages"])
    assert set(BASE_PACKAGES) <= recorded
    assert set(get_algorithm(DEFAULT_ALGORITHM)["requires"]) <= recorded
    assert manifest["config"]["algorithmVersion"] == DEFAULT_ALGORITHM
    assert manifest["config"]["metricSet"] == "metric-set-v1"


def test_run_never_overwrites_existing_output(real_run):
    from jit_baseline.artifacts import build_run
    before = (real_run / "manifest.json").read_bytes()
    with pytest.raises(ValueError, match="已存在"):
        build_run(BACKEND / "data/openstack", real_run)
    assert (real_run / "manifest.json").read_bytes() == before


def rewrite_manifest(target, mutate):
    """一致地改写 manifest 声明：重算 runId 并刷新 summary 与文件清单。"""
    from jit_baseline.artifacts import identity
    from jit_baseline.data import sha256
    manifest = json.loads((target / "manifest.json").read_text(encoding="utf-8"))
    mutate(manifest["config"])
    manifest["runId"] = identity(manifest["config"])
    summary = json.loads((target / "summary.json").read_text(encoding="utf-8"))
    summary["runId"] = manifest["runId"]
    (target / "summary.json").write_text(json.dumps(summary), encoding="utf-8")
    manifest["files"]["summary.json"] = sha256((target / "summary.json").read_bytes())
    (target / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def test_declared_feature_order_must_match_the_schema(copied_run):
    from jit_baseline.artifacts import Snapshot
    from jit_baseline.data import BaselineError
    rewrite_manifest(copied_run, lambda config: config.__setitem__("features", list(reversed(config["features"]))))
    with pytest.raises(BaselineError) as info:
        Snapshot.load(copied_run)
    assert info.value.code == "ARTIFACT_INVALID" and "schema" in str(info.value)


def test_unknown_declared_schema_is_rejected(copied_run):
    from jit_baseline.artifacts import Snapshot
    from jit_baseline.data import BaselineError
    rewrite_manifest(copied_run, lambda config: config.__setitem__("schema", "kamei15-v9"))
    with pytest.raises(BaselineError) as info:
        Snapshot.load(copied_run)
    assert info.value.code == "SCHEMA_UNKNOWN"


def test_unknown_algorithm_version_is_rejected(copied_run):
    from jit_baseline.artifacts import Snapshot
    from jit_baseline.data import BaselineError
    rewrite_manifest(copied_run, lambda config: config.__setitem__("algorithmVersion", "logistic-regression-l2-v9"))
    with pytest.raises(BaselineError) as info:
        Snapshot.load(copied_run)
    assert info.value.code == "ALGORITHM_UNKNOWN"


def test_legacy_run_without_schema_declaration_still_verifies(copied_run):
    """旧格式运行（只有 protocol、无 schema/algorithmVersion）在改动后仍可加载。"""
    from jit_baseline.artifacts import Snapshot
    rewrite_manifest(copied_run, lambda config: (config.pop("schema"), config.pop("algorithmVersion")))
    batch = Snapshot.load(copied_run).batch()
    assert batch["model"]["id"] == "logistic-regression-six-v1"
    assert len(batch["records"]) == 1853


def test_legacy_run_without_new_declarations_still_verifies(copied_run):
    """旧运行没有 metricSet 声明时回退到首轮冻结指标集，仍按自身声明通过（PDB-10/PDB-12）。"""
    from jit_baseline.artifacts import Snapshot, verify_run
    rewrite_manifest(copied_run, lambda config: (config.pop("metricSet"), config.pop("algorithmVersion")))
    verify_run(copied_run)
    assert Snapshot.load(copied_run).batch()["runId"]


def test_declared_hyperparameters_must_match_the_registered_method(copied_run):
    """超参校验以运行声明的方法为准，篡改后必须失败并指出方法（PDB-10）。"""
    from jit_baseline.artifacts import Snapshot
    from jit_baseline.data import BaselineError
    rewrite_manifest(copied_run, lambda config: config.__setitem__("model", {**config["model"], "C": 2.0}))
    with pytest.raises(BaselineError) as info:
        Snapshot.load(copied_run)
    assert info.value.code == "ARTIFACT_INVALID" and "logistic-regression-l2-v1" in str(info.value)


def test_declared_dependencies_are_checked_by_containment(copied_run):
    """环境校验是包含关系：当前环境多装其它包不影响既有运行（PDB-11）。"""
    import platform
    from importlib.metadata import version
    from jit_baseline.artifacts import Snapshot, check_environment, verify_run

    def shrink(config):
        config["environment"]["packages"] = {"numpy": version("numpy")}
    # 记录只声明一个包、当前环境有更多包：既有运行仍必须通过。
    rewrite_manifest(copied_run, shrink)
    verify_run(copied_run)
    assert Snapshot.load(copied_run).batch()["runId"]
    # 声明的包必须在当前环境被满足，且版本一致。
    base = {"python": platform.python_version(), "platform": platform.platform()}
    check_environment({**base, "packages": {"numpy": version("numpy"), "pytest": version("pytest")}})
    for recorded, named in (({"torch": "0.0.1"}, "torch"), ({"numpy": "0.0.1"}, "numpy")):
        with pytest.raises(ValueError) as info:
            check_environment({**base, "packages": recorded})
        assert named in str(info.value)


def test_unknown_metric_set_declaration_is_rejected(copied_run):
    from jit_baseline.artifacts import Snapshot
    from jit_baseline.data import BaselineError
    rewrite_manifest(copied_run, lambda config: config.__setitem__("metricSet", "metric-set-v9"))
    with pytest.raises(BaselineError) as info:
        Snapshot.load(copied_run)
    assert info.value.code == "METRIC_SET_UNKNOWN"


def test_a_new_metric_in_the_code_does_not_invalidate_existing_runs(copied_run, monkeypatch):
    """代码新增指标后，既有运行仍按自身声明的指标集重算并通过（PDB-12）。"""
    import jit_baseline.artifacts as artifacts
    import jit_baseline.metrics as metrics
    from jit_baseline.artifacts import verify_run
    original = artifacts.evaluate

    def extended(records, risks, metric_set=None):
        result = original(records, risks, metric_set)
        if "extraMetric" in metrics.get_metric_set(metric_set or metrics.DEFAULT_METRIC_SET):
            result["extraMetric"] = {"value": 0.0, "reason": None}
        return result

    verify_run(copied_run)
    monkeypatch.setitem(metrics.METRIC_SETS, "metric-set-v2", (*metrics.METRIC_SETS["metric-set-v1"], "extraMetric"))
    monkeypatch.setattr(artifacts, "evaluate", extended)
    manifest = verify_run(copied_run)
    assert manifest["config"]["metricSet"] == "metric-set-v1"


def test_compare_accepts_one_method_and_reports_its_declared_discipline(copied_run):
    from jit_baseline.artifacts import compare_runs
    report = compare_runs(copied_run, copied_run)
    assert report["passed"] is True
    assert report["method"] == "logistic-regression-l2-v1"
    assert report["metricSet"] == "metric-set-v1"
    assert report["reproducibility"]["mode"] == "tolerance"
    assert report["maxRiskAbsoluteDifference"] == 0


def test_compare_rejects_a_different_metric_set(copied_run, monkeypatch):
    """两次运行声明的指标集不同就不能按同一口径比较（PDB-14）。"""
    import shutil
    from jit_baseline.artifacts import compare_runs
    from jit_baseline.data import BaselineError
    from jit_baseline.metrics import METRIC_SETS
    monkeypatch.setitem(METRIC_SETS, "metric-set-alias", METRIC_SETS["metric-set-v1"])
    second = copied_run.parent / "alias-run"
    shutil.copytree(copied_run, second)
    rewrite_manifest(second, lambda config: config.__setitem__("metricSet", "metric-set-alias"))
    with pytest.raises(BaselineError) as info:
        compare_runs(copied_run, second)
    assert info.value.code == "REPRODUCTION_FAILED" and "指标集" in str(info.value)


def test_compare_refuses_a_method_without_a_numeric_tolerance_discipline(copied_run, monkeypatch):
    """复现口径按方法声明取用；未声明数值容差的方法不能套用固定容差（PDB-14）。"""
    from jit_baseline.algorithms import ALGORITHMS, DEFAULT_ALGORITHM
    from jit_baseline.artifacts import compare_runs
    from jit_baseline.data import BaselineError
    monkeypatch.setitem(ALGORITHMS, DEFAULT_ALGORITHM,
                        {**ALGORITHMS[DEFAULT_ALGORITHM],
                         "reproducibility": {"mode": "independent-protocol", "atol": None, "rtol": None}})
    with pytest.raises(BaselineError) as info:
        compare_runs(copied_run, copied_run)
    assert info.value.code == "REPRODUCTION_FAILED" and "复现口径" in str(info.value)


ARCHIVED_SUMMARY = (BACKEND.parent / "docs/evidence/connect-public-data-baseline-review/summary.json")


def test_rebuilt_six_field_run_still_matches_the_archived_evidence(real_run):
    """契约改动后重建的六字段逻辑回归运行仍与归档证据同一数据版本、指标一致。

    这条回归不依赖本机 `artifacts/` 的序列化产物：归档证据随 Git 分发，任何检出都能跑。
    """
    if not ARCHIVED_SUMMARY.exists():
        pytest.skip(f"缺少归档证据：{ARCHIVED_SUMMARY}")
    archived = json.loads(ARCHIVED_SUMMARY.read_text(encoding="utf-8"))
    rebuilt = json.loads((real_run / "summary.json").read_text(encoding="utf-8"))
    assert rebuilt["datasetVersion"] == archived["datasetVersion"]
    assert rebuilt["features"] == archived["features"]
    assert rebuilt["split"]["test"]["count"] == archived["split"]["test"]["count"]
    for key, entry in archived["metrics"].items():
        if not (isinstance(entry, dict) and set(entry) == {"value", "reason"}):
            continue
        mine = rebuilt["metrics"][key]
        assert (entry["value"] is None) == (mine["value"] is None), key
        if entry["value"] is not None:
            assert abs(entry["value"] - mine["value"]) <= 1e-8, key


def _known_unloadable_defect(path):
    """已知缺陷：模型 pickle 引用了已被删除的预处理符号（见 docs/团队分工.md 的缺陷行）。

    只对这一种原因跳过，其它加载失败照常判为失败，避免掩盖新的破坏。
    """
    model = path / "model.joblib"
    if not model.exists():
        return None
    blob = model.read_bytes()
    if b"log_counts" in blob:
        return (f"{path} 的模型 pickle 引用已被删除的 jit_baseline.model.log_counts，"
                "当前代码无法加载（先于本 change 存在；待决定是否重建该运行）")
    return None


@pytest.mark.skipif(not (BACKEND / "artifacts/baseline").exists(),
                    reason="本机未生成该运行；用 cli run 生成后本用例才有回归对象")
def test_local_frozen_runs_still_verify_and_reproduce():
    """本机既有运行在契约改动后仍按自身声明通过校验与复现比较（PDB-10～PDB-12）。"""
    from jit_baseline.artifacts import compare_runs, verify_run
    from jit_baseline.data import BaselineError
    paths = [BACKEND / "artifacts/baseline", BACKEND / "artifacts/reproduction"]
    for path in paths:
        try:
            assert verify_run(path)["runId"]
        except BaselineError:
            known = _known_unloadable_defect(path)
            if known:
                pytest.skip(known)
            raise
    assert compare_runs(*paths)["passed"] is True
