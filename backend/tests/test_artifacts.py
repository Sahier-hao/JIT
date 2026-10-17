"""Real publisher integration; fixtures are never formal experiment outputs."""
import json
import shutil
from pathlib import Path

import numpy as np
import pytest
from sklearn.base import BaseEstimator, ClassifierMixin

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


@pytest.fixture(scope="session")
def external_run(real_run, tmp_path_factory):
    """模拟一份经仓库交付的外部产物：内容同本机运行，但产出环境是另一台（有加速设备的）机器。"""
    from importlib.metadata import version
    target = tmp_path_factory.mktemp("external-run") / "delivered"
    shutil.copytree(real_run, target)
    rewrite_manifest(target, lambda config: config.__setitem__("trainingEnvironment", {
        "python": "3.11.9",
        "platform": "Linux-5.15.0-105-generic-x86_64-with-glibc2.35",
        "packages": {"numpy": version("numpy"), "scikit-learn": version("scikit-learn"),
                     "torch": "2.1.0+cu121"},
    }))
    return target


@pytest.fixture
def external_copy(external_run, tmp_path):
    target = tmp_path / "delivered"
    shutil.copytree(external_run, target)
    return target


class StandInEstimator(ClassifierMixin, BaseEstimator):
    """替身估计器：模拟"自定义估计器接在流水线末步"的（将来深度）模型。

    模块级 `BaseEstimator` 子类：joblib 能按模块路径重建它，sklearn 流水线能代理它的
    `classes_`／`n_features_in_`／`predict_proba`。不依赖任何加速设备，即设计里的
    "设备中立交付"。
    """

    def __init__(self, n_features=0, positive_rate=0.5):
        self.n_features = n_features
        self.positive_rate = positive_rate

    def fit(self, matrix, labels):
        self.n_features_in_ = matrix.shape[1]
        self.classes_ = np.unique(np.asarray(labels))
        return self

    def predict_proba(self, matrix):
        if matrix.shape[1] != self.n_features_in_:
            raise ValueError("输入维度与模型不符")
        return np.column_stack([np.full(len(matrix), 1.0 - self.positive_rate),
                                np.full(len(matrix), self.positive_rate)])


def _resync(run, names):
    """模型或指标文件被改写后，把清单哈希与运行身份同步到与磁盘一致。"""
    from jit_baseline.artifacts import identity, read_json, write_json
    from jit_baseline.data import sha256
    manifest = read_json(run / "manifest.json")
    for name in names:
        manifest["files"][name] = sha256((run / name).read_bytes())
        if name in manifest["config"]["coreFiles"]:
            manifest["config"]["coreFiles"][name] = manifest["files"][name]
    manifest["config"]["modelSha256"] = manifest["files"]["model.joblib"]
    manifest["runId"] = identity(manifest["config"])
    summary = read_json(run / "summary.json")
    summary["runId"] = manifest["runId"]
    summary["modelSha256"] = manifest["files"]["model.joblib"]
    write_json(run / "summary.json", summary)
    manifest["files"]["summary.json"] = sha256((run / "summary.json").read_bytes())
    write_json(run / "manifest.json", manifest)


def _perturb_reference(run, delta):
    """把参考预测的第一条风险挪动 delta，并把清单哈希与身份同步到磁盘。"""
    from jit_baseline.artifacts import read_json, write_json
    references = read_json(run / "reference-predictions.json")
    references[0]["risk"] = references[0]["risk"] + delta
    write_json(run / "reference-predictions.json", references)
    _resync(run, ("reference-predictions.json",))


def _install_stand_in_model(run, positive_rate=0.5):
    """把运行里的模型换成一个设备中立的替身流水线，并同步参考预测、指标与身份。"""
    import joblib
    from sklearn.pipeline import Pipeline
    from jit_baseline.artifacts import read_json, write_json
    from jit_baseline.metrics import evaluate
    from jit_baseline.model import predict_risks
    from jit_baseline.schemas import get_schema
    config = read_json(run / "manifest.json")["config"]
    schema = get_schema(config.get("schema") or config.get("protocol"))
    records = read_json(run / "test-input.json")["records"]
    labels = {row["id"]: row["label"] for row in read_json(run / "test-labels.json")}
    # 用两行合成数据拟合，只固定 n_features_in_ 与 classes_，不接触测试数据。
    stand_in = StandInEstimator(n_features=len(config["features"]), positive_rate=positive_rate)
    stand_in.fit(np.zeros((2, len(config["features"]))), [0, 1])
    pipeline = Pipeline([("model", stand_in)])
    joblib.dump(pipeline, run / "model.joblib")
    risks = predict_risks(pipeline, records, schema)
    write_json(run / "reference-predictions.json",
               [{"id": r["id"], "risk": p} for r, p in zip(records, risks, strict=True)])
    metrics = evaluate([dict(r, label=labels[r["id"]]) for r in records], risks, config.get("metricSet"))
    write_json(run / "metrics.json", metrics)
    summary = read_json(run / "summary.json")
    summary["metrics"] = metrics
    # 聚合里的风险分布由模型决定：换模型后按新风险重建这一列，计数与分区拆分不变。
    # 计数本身与模型无关（标签没有变），只有风险列会陈旧——这正是 verify 会抓住的耦合。
    from jit_baseline import trends
    trend = summary.get(trends.TREND_KEY)
    if trend:
        with_labels = [dict(r, label=labels[r["id"]]) for r in records]
        rebuilt = trends.build_trend_buckets({"test": with_labels}, risks, min_sample=trend["minSample"])
        by_start = {bucket["start"]: bucket["risk"] for bucket in rebuilt["buckets"]}
        for bucket in trend["buckets"]:
            bucket["risk"] = by_start.get(bucket["start"])
    write_json(run / "summary.json", summary)
    _resync(run, ("model.joblib", "reference-predictions.json", "metrics.json"))


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


def test_frozen_legacy_baseline_artifacts_still_load_and_reproduce():
    """仓库内冻结的旧六字段产物必须在当前代码下可加载（joblib 兼容入口，见 model.log_counts）。"""
    from jit_baseline.artifacts import Snapshot
    run = BACKEND / "artifacts/baseline"
    snapshot = Snapshot.load(run)
    batch = snapshot.batch()
    reference = json.loads((run / "reference-predictions.json").read_text(encoding="utf-8"))
    assert len(batch["records"]) == 1853
    assert {r["id"] for r in batch["records"]} == {r["id"] for r in reference}
    assert np.max(np.abs([a["risk"] - b["risk"] for a, b in zip(batch["records"], reference, strict=True)])) <= 1e-8


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
    """运行声明记录基础环境加该方法所需依赖（PDB-11）；该字段是本运行的产出环境（PDB-16）。"""
    from jit_baseline.algorithms import DEFAULT_ALGORITHM, get_algorithm
    from jit_baseline.artifacts import BASE_PACKAGES
    manifest = json.loads((real_run / "manifest.json").read_text(encoding="utf-8"))
    config = manifest["config"]
    assert "trainingEnvironment" in config and "environment" not in config
    recorded = set(config["trainingEnvironment"]["packages"])
    assert set(BASE_PACKAGES) <= recorded
    assert set(get_algorithm(DEFAULT_ALGORITHM)["requires"]) <= recorded
    assert config["algorithmVersion"] == DEFAULT_ALGORITHM
    assert config["metricSet"] == "metric-set-v1"


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
        config["trainingEnvironment"]["packages"] = {"numpy": version("numpy")}
    # 记录只声明一个包、当前环境有更多包：既有运行仍必须通过。
    rewrite_manifest(copied_run, shrink)
    verify_run(copied_run)
    assert Snapshot.load(copied_run).batch()["runId"]
    # 声明的包必须在当前环境被满足，且版本一致（该运行产生于本机，故按本机校验）。
    base = {"python": platform.python_version(), "platform": platform.platform()}
    check_environment({**base, "packages": {"numpy": version("numpy"), "pytest": version("pytest")}})
    for recorded, named in (({"torch": "0.0.1"}, "torch"), ({"numpy": "0.0.1"}, "numpy")):
        with pytest.raises(ValueError) as info:
            check_environment({**base, "packages": recorded})
        assert named in str(info.value)


def test_a_foreign_training_environment_is_not_an_admission_condition(copied_run):
    """产方平台或 Python 与本机不同不是失败理由，本机也不需满足产方依赖（PDB-16、PDB-11）。"""
    from importlib.metadata import version
    from jit_baseline.artifacts import Snapshot, verify_run

    def to_a_cuda_machine(config):
        config["trainingEnvironment"]["platform"] = "Linux-5.15.0-105-generic-x86_64-with-glibc2.35"
        config["trainingEnvironment"]["python"] = "3.11.9"
        # 产方环境含本机没有的训练框架：作为溯源记录合法，不要求本机满足它。
        config["trainingEnvironment"]["packages"] = {"numpy": version("numpy"), "torch": "2.1.0+cu121"}

    rewrite_manifest(copied_run, to_a_cuda_machine)
    assert verify_run(copied_run)["runId"]
    assert Snapshot.load(copied_run).batch()["runId"]
    assert json.loads((copied_run / "manifest.json").read_text(encoding="utf-8"))["config"][
        "trainingEnvironment"]["packages"]["torch"] == "2.1.0+cu121"


def test_omitting_the_producer_environment_breaks_the_run_identity(copied_run):
    """产方环境是运行身份的一部分：为迎合本机而省略依赖会被识别（PDB-16）。"""
    from jit_baseline.artifacts import Snapshot
    from jit_baseline.data import BaselineError
    manifest = json.loads((copied_run / "manifest.json").read_text(encoding="utf-8"))
    manifest["config"]["trainingEnvironment"]["packages"].pop("scipy")
    (copied_run / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(BaselineError) as info:
        Snapshot.load(copied_run)
    assert info.value.code == "ARTIFACT_INVALID" and "身份" in str(info.value)


def test_an_external_run_is_verified_through_the_same_entry_point(external_run):
    """外部产物与本机运行共用既有校验入口，不新增"收包"命令（PDB-15）。"""
    from jit_baseline.artifacts import Snapshot, run_origin, verify_run
    manifest = verify_run(external_run)
    assert run_origin(manifest) == "external"
    assert Snapshot.load(external_run).batch()["runId"] == manifest["runId"]


def test_an_external_run_keeps_its_own_run_id_and_shows_its_producer(external_run):
    """来源如实记录：沿用产方运行标识、标明外部产生、保留产方训练环境（PDB-19）。"""
    from jit_baseline.artifacts import Snapshot, identity, run_origin, verify_run
    manifest = verify_run(external_run)
    config = manifest["config"]
    assert run_origin(manifest) == "external"
    assert identity(config) == manifest["runId"]  # 沿用产方标识，本机不重算
    assert Snapshot.load(external_run).batch()["runId"] == manifest["runId"]
    assert config["trainingEnvironment"]["packages"]["torch"] == "2.1.0+cu121"
    assert config["trainingEnvironment"]["platform"].startswith("Linux")


def _desync_summary(run):
    """改写摘要里的指标但不改 metrics.json，使清单与摘要互相矛盾（清单本身仍自洽）。"""
    from jit_baseline.artifacts import write_json
    from jit_baseline.data import sha256
    summary = json.loads((run / "summary.json").read_text(encoding="utf-8"))
    summary["metrics"] = {"tampered": {"value": 0.0, "reason": None}}
    write_json(run / "summary.json", summary)
    manifest = json.loads((run / "manifest.json").read_text(encoding="utf-8"))
    manifest["files"]["summary.json"] = sha256((run / "summary.json").read_bytes())
    (run / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


@pytest.mark.parametrize("damage, expected", [
    (lambda run: (run / "source.json").unlink(), "不可用"),
    (lambda run: (run / "model.joblib").open("ab").write(b"bad"), "校验"),
    (_desync_summary, "摘要"),
])
def test_a_damaged_external_artifact_is_rejected_with_a_located_reason(external_copy, damage, expected):
    """缺文件、哈希不符、清单与摘要矛盾三种情形各被拒绝并指出具体项（PDB-15）。"""
    from jit_baseline.artifacts import verify_run
    damage(external_copy)
    with pytest.raises(ValueError, match=expected):
        verify_run(external_copy)


def test_verification_does_not_rewrite_the_delivered_artifact(external_copy):
    """校验不重训、不覆盖产方声明、不改写产物本身（PDB-15 第三场景）。"""
    from jit_baseline.artifacts import verify_run
    before = {p.name: p.read_bytes() for p in sorted(external_copy.iterdir())}
    config_before = json.loads((external_copy / "manifest.json").read_text(encoding="utf-8"))["config"]
    assert verify_run(external_copy)["runId"]
    assert {p.name: p.read_bytes() for p in sorted(external_copy.iterdir())} == before
    assert json.loads((external_copy / "manifest.json").read_text(encoding="utf-8"))["config"] == config_before


def test_the_verdict_does_not_depend_on_the_working_directory_or_local_runs(external_copy, tmp_path):
    """同一份产物在任一台机器上得到一致判定，不依赖本机既存的运行目录或工作目录（PDB-15 第四场景）。"""
    import os
    import subprocess
    import sys
    from jit_baseline.artifacts import verify_run
    expected = verify_run(external_copy)["runId"]
    elsewhere = tmp_path / "a-clean-checkout" / "delivered"
    shutil.copytree(external_copy, elsewhere)
    completed = subprocess.run(
        [sys.executable, "-m", "jit_baseline.cli", "verify", "--run", str(elsewhere)],
        cwd=elsewhere.parent, capture_output=True, text=True, encoding="utf-8",
        env={**os.environ, "PYTHONPATH": str(BACKEND), "PYTHONIOENCODING": "utf-8"})
    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout)
    assert result["runId"] == expected and result["origin"] == "external" and result["passed"] is True


def test_a_device_neutral_stand_in_model_is_actually_loaded_and_run(copied_run):
    """设备中立的替身产物被**实际加载**并推理，不以声明代替加载（PDB-17）。"""
    from jit_baseline.artifacts import Snapshot, verify_run
    _install_stand_in_model(copied_run)
    assert verify_run(copied_run)["runId"]
    snapshot = Snapshot.load(copied_run)
    assert isinstance(snapshot.model.named_steps["model"], StandInEstimator)
    records = snapshot.batch()["records"]
    assert len(records) == len(snapshot.records)
    assert all(0.0 <= record["risk"] <= 1.0 for record in records)


def test_a_model_that_only_loads_on_an_accelerator_is_rejected_with_a_located_code(external_copy, monkeypatch):
    """在加速设备上序列化的形态在本机不可加载：以明确错误码拒绝，不抛未归类异常（PDB-17）。"""
    import joblib
    from jit_baseline.artifacts import Snapshot
    from jit_baseline.data import BaselineError

    def cuda_only(path):
        raise RuntimeError("Attempting to deserialize object on a CUDA device "
                           "but torch.cuda.is_available() is False")

    monkeypatch.setattr(joblib, "load", cuda_only)
    with pytest.raises(BaselineError) as info:
        Snapshot.load(external_copy)
    assert info.value.code == "MODEL_INVALID"


def test_a_complete_declaration_does_not_redeem_an_unloadable_model(external_copy):
    """声明声称依赖齐备、校验值自洽，但模型在本机实际加载失败时仍判为不可用（PDB-17）。"""
    from jit_baseline.artifacts import Snapshot
    from jit_baseline.data import BaselineError
    (external_copy / "model.joblib").write_bytes(b"not a serialized pipeline")
    _resync(external_copy, ("model.joblib",))
    # 产方声明的依赖（含本机没有的 torch）原样保留，清单也自洽——仍然必须拒绝。
    assert json.loads((external_copy / "manifest.json").read_text(encoding="utf-8"))["config"][
        "trainingEnvironment"]["packages"]["torch"] == "2.1.0+cu121"
    with pytest.raises(BaselineError) as info:
        Snapshot.load(external_copy)
    assert info.value.code == "MODEL_INVALID"


def test_verification_uses_the_methods_declared_tolerance(copied_run, monkeypatch):
    """按该运行声明的方法所声明的复现口径比较，不套用统一容差（PDB-18）。"""
    from jit_baseline.algorithms import ALGORITHMS, DEFAULT_ALGORITHM
    from jit_baseline.artifacts import declared_reproducibility, verify_run
    from jit_baseline.data import BaselineError
    monkeypatch.setitem(ALGORITHMS, DEFAULT_ALGORITHM,
                        {**ALGORITHMS[DEFAULT_ALGORITHM],
                         "reproducibility": {"mode": "tolerance", "atol": 1e-3, "rtol": 0.0}})
    manifest = json.loads((copied_run / "manifest.json").read_text(encoding="utf-8"))
    assert declared_reproducibility(manifest)[1] == {"mode": "tolerance", "atol": 1e-3, "rtol": 0.0}
    # 落在该运行声明的口径之内：通过。
    _perturb_reference(copied_run, 5e-4)
    assert verify_run(copied_run)["runId"]
    # 超出该运行声明的口径：判为不可用，并指出所用口径。
    _perturb_reference(copied_run, 5e-3)
    with pytest.raises(BaselineError) as info:
        verify_run(copied_run)
    assert info.value.code == "ARTIFACT_INVALID" and "容差" in str(info.value)


def test_a_non_numeric_caliber_is_not_verified_under_a_uniform_tolerance(copied_run, monkeypatch):
    """声明了非数值容差口径的方法：本机不套用统一容差，也不静默接受（PDB-18、D7）。"""
    from jit_baseline.algorithms import ALGORITHMS, DEFAULT_ALGORITHM
    from jit_baseline.artifacts import verify_run
    from jit_baseline.data import BaselineError
    monkeypatch.setitem(ALGORITHMS, DEFAULT_ALGORITHM,
                        {**ALGORITHMS[DEFAULT_ALGORITHM],
                         "reproducibility": {"mode": "independent-protocol", "atol": None, "rtol": None}})
    with pytest.raises(BaselineError) as info:
        verify_run(copied_run)
    assert info.value.code == "REPRODUCTION_FAILED"
    assert "independent-protocol" in str(info.value) and DEFAULT_ALGORITHM in str(info.value)


@pytest.fixture(scope="session")
def declared_dependency_run(tmp_path_factory):
    """一个 `requires` 非空的方法产生的真实运行（PDB-11）。"""
    from jit_baseline.artifacts import build_run
    target = tmp_path_factory.mktemp("declared-dependency") / "run"
    build_run(BACKEND / "data/openstack", target, algorithm="random-forest-v1")
    return target


def test_a_method_declaring_a_dependency_produces_a_verifiable_run(declared_dependency_run):
    """方法声明的依赖进入运行记录，且该运行按自身声明通过校验（PDB-11）。"""
    from jit_baseline.algorithms import get_algorithm
    from jit_baseline.artifacts import verify_run
    requires = get_algorithm("random-forest-v1")["requires"]
    manifest = json.loads((declared_dependency_run / "manifest.json").read_text(encoding="utf-8"))
    assert requires and set(requires) <= set(manifest["config"]["trainingEnvironment"]["packages"])
    assert manifest["config"]["algorithmVersion"] == "random-forest-v1"
    assert verify_run(declared_dependency_run)["runId"]


def test_missing_declared_dependency_is_a_located_error():
    """声明了本机未安装的依赖时给出可定位错误，而不是未归类异常（PDB-16）。"""
    from jit_baseline.artifacts import environment
    from jit_baseline.data import BaselineError
    with pytest.raises(BaselineError) as info:
        environment(("no-such-declared-package-xyz",))
    assert info.value.code == "ARTIFACT_INVALID" and "no-such-declared-package-xyz" in str(info.value)


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


def _drop_trend_key(run):
    """移除摘要中的聚合键并同步清单哈希：模拟未声明聚合的既有运行。"""
    from jit_baseline.artifacts import read_json, write_json
    from jit_baseline.data import sha256
    summary = read_json(run / "summary.json")
    summary.pop("trendBuckets", None)
    write_json(run / "summary.json", summary)
    manifest = read_json(run / "manifest.json")
    manifest["files"]["summary.json"] = sha256((run / "summary.json").read_bytes())
    write_json(run / "manifest.json", manifest)


def test_run_writes_trend_buckets_consistent_with_partitions(real_run):
    """聚合只含计数与风险分布：合计等于纳入行数与观测正例数，且不含提交身份或标签。"""
    from jit_baseline.artifacts import read_json
    summary = read_json(real_run / "summary.json")
    trend = summary["trendBuckets"]
    assert trend["grain"] == "month" and trend["timezone"] == "UTC+08:00" and trend["minSample"] >= 1
    buckets = trend["buckets"]
    assert len(buckets) >= 27
    assert sum(bucket["commits"] for bucket in buckets) == summary["source"]["quality"]["includedRows"]
    assert sum(bucket["positives"] for bucket in buckets) == summary["source"]["quality"]["positiveLabels"]
    for name, stat in summary["split"].items():
        assert sum(b["byPartition"][name]["commits"] for b in buckets) == stat["count"]
        assert sum(b["byPartition"][name]["positives"] for b in buckets) == stat["positiveCount"]
    text = json.dumps(buckets, ensure_ascii=False)
    assert '"label"' not in text and '"id"' not in text and '"features"' not in text
    assert any(b["observedRate"]["value"] is None and b["observedRate"]["reason"] for b in buckets)
    assert any(b["risk"] is not None for b in buckets)


def test_verify_rejects_tampered_trend_bucket(copied_run):
    """按声明重算测试分区的桶：被改动的桶必须判为不可用（PDB-21）。"""
    from jit_baseline.artifacts import read_json, verify_run, write_json
    from jit_baseline.data import BaselineError
    summary = read_json(copied_run / "summary.json")
    bucket = next(b for b in summary["trendBuckets"]["buckets"] if b["byPartition"]["test"]["positives"] > 0)
    bucket["byPartition"]["test"]["positives"] -= 1
    bucket["positives"] -= 1
    write_json(copied_run / "summary.json", summary)
    _resync(copied_run, ("summary.json",))
    with pytest.raises(BaselineError) as info:
        verify_run(copied_run)
    assert info.value.code == "ARTIFACT_INVALID" and "重算" in str(info.value)


def test_verify_rejects_trend_conservation_break(copied_run):
    """守恒核对：各桶合计与纳入行数不一致时必须失败（PDB-21）。"""
    from jit_baseline.artifacts import read_json, verify_run, write_json
    from jit_baseline.data import BaselineError
    summary = read_json(copied_run / "summary.json")
    summary["trendBuckets"]["buckets"][0]["commits"] += 1
    summary["trendBuckets"]["buckets"][0]["byPartition"]["train"]["commits"] += 1
    write_json(copied_run / "summary.json", summary)
    _resync(copied_run, ("summary.json",))
    with pytest.raises(BaselineError) as info:
        verify_run(copied_run)
    assert info.value.code == "ARTIFACT_INVALID" and "合计" in str(info.value)


def test_run_without_trend_key_still_verifies(copied_run):
    """未声明聚合的既有运行仍按自身声明通过校验，且产物不被改写（PDB-21）。"""
    from jit_baseline.artifacts import read_json, verify_run
    from jit_baseline.data import sha256
    _drop_trend_key(copied_run)
    before = sha256((copied_run / "summary.json").read_bytes())
    manifest = verify_run(copied_run)
    assert manifest["runId"] and "trendBuckets" not in read_json(copied_run / "summary.json")
    assert sha256((copied_run / "summary.json").read_bytes()) == before
