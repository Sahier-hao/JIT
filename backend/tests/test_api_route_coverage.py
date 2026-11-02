"""PR 分析路由的错误信封覆盖（FPR-01）。

既检查所有 `/api/v1` 路由都进入统一错误处理，也检查 PR 分析 / 批次接口
在非法参数、项目不存在和模型不可用时返回结构化错误。
"""
import re

from fastapi.testclient import TestClient

from jit_baseline.api import create_app
from jit_baseline.api_errors import managed_path
from jit_baseline.catalog import ModelCatalog
from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.errors import BaselineError
from jit_baseline.sync import SyncService


def _app(tmp_path):
    storage = CatalogStorage(tmp_path / "routes.sqlite3")
    storage.initialize()
    root = tmp_path / "artifacts"
    root.mkdir()
    catalog = ModelCatalog(storage, root)
    service = SyncService(storage, catalog, dataset_root=tmp_path / "datasets",
                          artifact_root=root, allow_local=True,
                          collect_fn=lambda *args, **kwargs: None)
    return create_app(database=storage.path, artifact_root=root, sync_service=service), service


def test_every_v1_route_uses_the_shared_error_envelope(tmp_path):
    app, service = _app(tmp_path)
    try:
        for route in app.routes:
            path = getattr(route, "path", "")
            if not path.startswith("/api/v1/"):
                continue
            sample = re.sub(r"\{[^}]+\}", lambda match: "1" if match.group(0) == "{number}" else "x", path)
            assert managed_path(sample), f"路由未进入统一错误处理：{path}"
    finally:
        service.close()


def _assert_error(client, method, url, *, status, code, **kwargs):
    response = getattr(client, method)(url, **kwargs)
    assert response.status_code == status, response.text
    body = response.json()["error"]
    assert body["code"] == code
    assert body["requestId"] and body["requestId"] == response.headers["X-Request-Id"]
    assert "Traceback" not in response.text and "sqlite" not in response.text.lower()
    return body


def test_pr_analysis_routes_return_structured_errors(tmp_path, monkeypatch):
    app, service = _app(tmp_path)
    repository = service.create_repository({"repositoryUrl": "https://github.com/example/demo"})[0]
    try:
        with TestClient(app) as client:
            _assert_error(client, "get", "/api/v1/repositories/missing/pull-request-batches/latest",
                          status=404, code="REPOSITORY_UNKNOWN")
            _assert_error(client, "get", "/api/v1/repositories/missing/pull-request-batches/x",
                          status=404, code="REPOSITORY_UNKNOWN")
            _assert_error(client, "post", "/api/v1/repositories/missing/pull-requests/analyze",
                          status=422, code="INPUT_INVALID", json={"modelId": 1})
            _assert_error(client, "post", "/api/v1/repositories/missing/pull-requests/analyze",
                          status=422, code="INPUT_INVALID", json={"modelId": "  "})
            _assert_error(client, "post", "/api/v1/repositories/missing/pull-requests/1/analyze",
                          status=422, code="INPUT_INVALID", json={"notes": "not public"})
            _assert_error(client, "get",
                          f"/api/v1/repositories/{repository['repositoryId']}/pull-request-batches/missing",
                          status=404, code="NOT_FOUND")

            def disabled(model_id):
                raise BaselineError("MODEL_DISABLED", "所选模型已停用，请重新选择")

            monkeypatch.setattr(service, "_generic_model", disabled)
            body = _assert_error(client, "post",
                                 f"/api/v1/repositories/{repository['repositoryId']}/pull-requests/analyze",
                                 status=409, code="MODEL_DISABLED", json={"modelId": "gone"})
            assert body["message"] == "所选模型已停用，请刷新模型列表并重新选择；历史结果仍可查看"
    finally:
        service.close()
