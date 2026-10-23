import json

import numpy as np
import pytest
from admin_support import AdminTestClient as TestClient

from test_artifacts import copied_run, real_run  # noqa: F401
from test_catalog_api import settings  # noqa: F401


@pytest.fixture(autouse=True)
def isolated_catalog(tmp_path, monkeypatch):
    from jit_baseline.catalog_storage import CatalogStorage
    path = tmp_path / 'api-catalog.sqlite3'
    CatalogStorage(path).initialize()
    monkeypatch.setenv('JIT_CATALOG_DATABASE', str(path))


def test_actual_readonly_request_full_batch_and_unknown_operations(real_run):
    from jit_baseline.api import create_app
    before = {p.name: p.read_bytes() for p in real_run.iterdir()}
    with TestClient(create_app(real_run)) as client:
        response = client.get("/api/review-batch")
        assert response.status_code == 200
        payload = response.json()
        assert payload["mode"] == "historical" and len(payload["records"]) == 1853
        assert payload["summary"]["split"]["train"]["count"] == 8669
        assert client.post("/api/review-batch").status_code == 405
        assert client.post("/api/train").status_code == 404
    assert before == {p.name: p.read_bytes() for p in real_run.iterdir()}


def test_missing_model_service_error_then_restart_and_retry(copied_run):
    from jit_baseline.api import create_app
    path = copied_run / "model.joblib"
    saved = path.read_bytes()
    path.unlink()
    with TestClient(create_app(copied_run)) as client:
        response = client.get("/api/review-batch")
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "ARTIFACT_UNAVAILABLE"
        assert "records" not in response.json()
    path.write_bytes(saved)
    with TestClient(create_app(copied_run)) as client:
        assert client.get("/api/review-batch").status_code == 200


def test_corrupt_model_error_type(copied_run):
    from jit_baseline.api import create_app
    (copied_run / "model.joblib").write_bytes(b"broken")
    with TestClient(create_app(copied_run)) as client:
        response = client.get("/api/review-batch")
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "INTEGRITY_ERROR"


@pytest.mark.parametrize("bad", ["exception", "nan", "count", "range"])
def test_inference_failure_returns_500_without_old_or_partial_batch(real_run, monkeypatch, bad):
    from jit_baseline.api import create_app
    app = create_app(real_run)
    assert app.state.snapshot is not None
    def failure(matrix):
        if bad == "exception":
            raise RuntimeError("internal details must not leak")
        count = len(matrix) - 1 if bad == "count" else len(matrix)
        return np.tile([.5, float('nan') if bad == "nan" else 2 if bad == "range" else .5], (count, 1))
    monkeypatch.setattr(app.state.snapshot.model, "predict_proba", failure)
    with TestClient(app) as client:
        response = client.get("/api/review-batch")
        assert response.status_code == 500
        assert response.json()["error"]["code"] == "INFERENCE_ERROR"
        assert "records" not in response.json() and "internal" not in response.text


def test_supplied_run_directory_from_environment_without_fallback(real_run, tmp_path, monkeypatch):
    """JIT_RUN_DIR 选择所供给的运行；未通过校验的目录被拒，不退回首行固定运行（PDB-08）。"""
    from jit_baseline.api import create_app
    monkeypatch.setenv("JIT_RUN_DIR", str(real_run))
    with TestClient(create_app()) as client:
        payload = client.get("/api/review-batch").json()
    run_id = json.loads((real_run / "manifest.json").read_text(encoding="utf-8"))["runId"]
    assert payload["runId"] == payload["summary"]["runId"] == run_id
    assert "trendBuckets" in payload["summary"]
    assert all("label" not in r and "title" not in r and "explanation" not in r for r in payload["records"])

    monkeypatch.setenv("JIT_RUN_DIR", str(tmp_path / "missing-run"))
    with TestClient(create_app()) as client:
        response = client.get("/api/review-batch")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ARTIFACT_UNAVAILABLE"
    assert "records" not in response.json()


def _error_only(response):
    """错误响应只允许 code/message/requestId，不含任何资源内容。"""
    body = response.json()
    assert set(body) == {"error"}
    error = body["error"]
    assert set(error) == {"code", "message", "requestId"}
    return error


def test_missing_resources_share_one_404_shape(settings):  # noqa: F811
    """6.2：不可见资源与非存在资源的 404 完全同形，不暴露存在性。"""
    from test_catalog_api import HEADERS
    from jit_baseline.api import create_app

    app = create_app(**settings)
    uuid_a = "00000000-0000-4000-8000-00000000000a"
    uuid_b = "00000000-0000-4000-8000-00000000000b"
    with TestClient(app) as client:
        bodies = []
        for batch_id in (uuid_a, uuid_b):
            response = client.get("/api/v1/prediction-batches/" + batch_id, headers=HEADERS)
            assert response.status_code == 404
            error = _error_only(response)
            assert error["code"] == "NOT_FOUND"
            bodies.append({key: value for key, value in error.items() if key != "requestId"})
        assert bodies[0] == bodies[1]
        commit_404 = client.get("/api/v1/commits", headers=HEADERS,
                                params={"version": "no-such-dataset"})
        assert commit_404.status_code == 404
        assert _error_only(commit_404)["code"] == "NOT_FOUND"
        assert "records" not in commit_404.text and "risk" not in commit_404.text


def test_startup_requires_dataset_registry(tmp_path, monkeypatch):
    """描述文件是登记事实：目录缺失即拒绝启动，不退回空目录（DSR-06）。"""
    import jit_baseline.api as api_module
    import jit_baseline.datasets as datasets_module
    from jit_baseline.errors import BaselineError

    monkeypatch.setattr(datasets_module, "DATASETS", tmp_path / "empty")
    with pytest.raises(BaselineError) as error:
        api_module.create_app(database=tmp_path / "catalog.sqlite3")
    assert error.value.code == "DATASET_REGISTRY_EMPTY"
