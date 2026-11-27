"""从本地提交范围执行真实采集、推理和报告的测试。"""
import json
import subprocess
from types import SimpleNamespace

import pytest

from jit_baseline import commit_analysis
from jit_baseline.errors import BaselineError
from jit_baseline.model import fit_model
from jit_baseline.schemas import resolve


def git(repo, *args):
    result = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, check=True)
    return result.stdout.strip()


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.email", "test@example.com")
    git(repo, "config", "user.name", "Test")
    (repo / "app.py").write_text("def handler(items=None):\n    return items\n", encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "initial")
    base = git(repo, "rev-parse", "HEAD")
    (repo / "app.py").write_text(
        "def handler(items=None):\n    try:\n        return eval(items)\n    except:\n        return []\n",
        encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "fix: unsafe handler")
    head = git(repo, "rev-parse", "HEAD")
    return repo, base, head


def make_snapshot():
    schema = resolve("kamei14-git-v2")
    rows = [{"features": [float((index * 7 + offset) % 5) for offset in range(14)],
             "label": index % 2} for index in range(40)]
    pipeline = fit_model(rows, schema="kamei14-git-v2", algorithm="logistic-regression-l2-v1")
    return SimpleNamespace(
        schema=schema, model=pipeline,
        summary={"model": {"name": "测试模型", "id": "model-x"}, "modelSha256": "a" * 64},
        manifest={"runId": "b" * 64, "config": {
            "algorithmVersion": "logistic-regression-l2-v1", "model": {"C": 1.0},
        }},
    )


class StubCatalog:
    def __init__(self):
        self.snapshot = make_snapshot()

    def load_model(self, model_id):
        return self.snapshot, {"modelId": model_id, "name": "测试模型"}


def test_scores_a_real_commit_range_with_live_features(tmp_path):
    repo, base, head = make_repo(tmp_path)
    report = commit_analysis.analyze(repo, base, head, StubCatalog(), "model-1")
    assert report["format"] == "jit-commit-analysis-v1"
    assert report["repository"]["baseSha"] == base
    assert report["repository"]["headSha"] == head
    assert report["coverage"]["commitsTotal"] == 1
    assert report["coverage"]["commitsScored"] == 1
    commit = report["commits"][0]
    assert commit["commitId"] == head and 0 <= commit["risk"] <= 1
    assert commit["files"] == 1
    assert commit["explanation"]["status"] == "supported"
    assert commit["explanation"]["method"] == "occlusion-mean-v1"
    assert isinstance(commit["explanation"]["items"], list)
    assert commit["explanation"]["summary"]
    rules = {item["ruleId"] for item in report["candidates"]}
    assert {"py-eval-exec", "py-bare-except"} <= rules
    assert all(item["suggestion"] for item in report["candidates"])


def test_analysis_content_hash_is_idempotent(tmp_path):
    repo, base, head = make_repo(tmp_path)
    catalog = StubCatalog()
    first = commit_analysis.analyze(repo, base, head, catalog, "model-1")
    second = commit_analysis.analyze(repo, base, head, catalog, "model-1")
    assert first["analysisId"] == second["analysisId"]
    assert first["contentSha256"] == second["contentSha256"]


def test_no_changes_and_non_ancestor_are_clear_errors(tmp_path):
    repo, base, head = make_repo(tmp_path)
    with pytest.raises(commit_analysis.CommitAnalysisError) as info:
        commit_analysis.analyze(repo, head, head, StubCatalog(), "model-1")
    assert info.value.code == "NO_CHANGES" and info.value.exit_code == 2
    with pytest.raises(commit_analysis.CommitAnalysisError) as info:
        commit_analysis.analyze(repo, head, base, StubCatalog(), "model-1")
    assert info.value.code == "IDENTITY_MISMATCH" and info.value.exit_code == 3
    with pytest.raises(BaselineError):
        commit_analysis.analyze(tmp_path, base, head, StubCatalog(), "model-1")


def test_load_model_failure_is_analysis_incomplete(tmp_path):
    repo, base, head = make_repo(tmp_path)

    class Missing:
        def load_model(self, model_id):
            raise BaselineError("NOT_FOUND", "模型不存在")

    with pytest.raises(commit_analysis.CommitAnalysisError) as info:
        commit_analysis.analyze(repo, base, head, Missing(), "missing")
    assert info.value.exit_code == 2


def test_explanation_failure_does_not_change_the_saved_score(tmp_path, monkeypatch):
    repo, base, head = make_repo(tmp_path)

    def fail(*_args, **_kwargs):
        raise RuntimeError("attribution failed")

    monkeypatch.setattr(commit_analysis.attribution, "explain", fail)
    report = commit_analysis.analyze(repo, base, head, StubCatalog(), "model-1")
    commit = report["commits"][0]
    assert 0 <= commit["risk"] <= 1
    assert commit["explanation"] == {
        "status": "not-supported", "method": None, "items": [],
        "summary": "本次归因计算不可用。 提交级预测分数仍然有效。",
    }


def test_compatible_models_only_lists_enabled_commit_schema_models():
    schema = resolve("kamei14-git-v2")
    unsupported = SimpleNamespace(
        schema=resolve("openstack-six-v1"), model=object(),
        summary={"modelSha256": "c" * 64},
        manifest={"runId": "d" * 64, "config": {"algorithmVersion": "method-u"}},
    )
    offline = SimpleNamespace(
        schema=resolve("kamei14-2013-v1"), model=object(),
        summary={"modelSha256": "e" * 64},
        manifest={"runId": "f" * 64, "config": {"algorithmVersion": "method-o"}},
    )
    good = make_snapshot()

    class Catalog:
        def registered_models(self, state=None):
            assert state == "ready"
            return [
                {"modelId": "good", "enabled": True, "isDefault": False},
                {"modelId": "disabled", "enabled": False, "isDefault": False},
                {"modelId": "unsupported", "enabled": True, "isDefault": False},
                {"modelId": "offline", "enabled": True, "isDefault": False},
            ]

        def load_model(self, model_id):
            if model_id == "unsupported":
                return unsupported, {"name": "六字段模型"}
            if model_id == "offline":
                return offline, {"name": "离线模型"}
            if model_id == "disabled":
                raise AssertionError("禁用模型不应被加载")
            return good, {
                "name": "可用模型", "artifactRunId": "run-good",
                "method": "logistic-regression-l2-v1",
            }

    models = commit_analysis.compatible_models(Catalog())
    assert models == [{
        "modelId": "good", "name": "可用模型",
        "method": "logistic-regression-l2-v1",
        "featureSchema": schema.name, "isDefault": False, "runId": "run-good",
    }]
