import json
import shutil

import pytest
from admin_support import AdminTestClient as TestClient

from jit_baseline.algorithms import ALGORITHMS
from test_artifacts import _resync, real_run, rewrite_manifest  # noqa: F401


def _run_in_suite(real_run, root, method):
    target = root / method
    shutil.copytree(real_run, target)
    rewrite_manifest(
        target,
        lambda config: config.update(
            algorithmVersion=method,
            model=ALGORITHMS[method]["params"],
        ),
    )
    _resync(target, ())
    return target


def _register(catalog, key):
    from jit_baseline.catalog import ModelCatalog
    return catalog.register_key(key) if "/" not in key else catalog.register(
        ModelCatalog._candidate_id(key),
        catalog._manifest_hash(catalog._nested_directory(key)),
    )


@pytest.fixture
def mixed_coverage(tmp_path, real_run):
    from jit_baseline.catalog import ModelCatalog
    from jit_baseline.catalog_storage import CatalogStorage

    root = tmp_path / "artifacts"
    suite = root / "suites" / "matrix"
    suite.mkdir(parents=True)
    methods = list(ALGORITHMS)
    ready_method, disabled_method, corrupt_method, failed_method = methods[:4]
    runs = {
        method: _run_in_suite(real_run, suite, method)
        for method in (ready_method, disabled_method, corrupt_method)
    }
    store = CatalogStorage(tmp_path / "catalog.sqlite3")
    store.initialize()
    catalog = ModelCatalog(store, root)
    ready = _register(catalog, f"suites/matrix/{ready_method}")["model"]
    disabled = _register(catalog, f"suites/matrix/{disabled_method}")["model"]
    catalog.update_policy(disabled["modelId"], {"enabled": False})
    (runs[corrupt_method] / "model.joblib").write_bytes(b"corrupt")
    entries = [
        {
            "method": ready_method,
            "status": "succeeded",
            "runId": json.loads((runs[ready_method] / "manifest.json").read_text(encoding="utf-8"))["runId"],
            "artifactKey": f"suites/matrix/{ready_method}",
        },
        {
            "method": disabled_method,
            "status": "succeeded",
            "runId": json.loads((runs[disabled_method] / "manifest.json").read_text(encoding="utf-8"))["runId"],
            "artifactKey": f"suites/matrix/{disabled_method}",
        },
        {
            "method": corrupt_method,
            "status": "succeeded",
            "runId": json.loads((runs[corrupt_method] / "manifest.json").read_text(encoding="utf-8"))["runId"],
            "artifactKey": f"suites/matrix/{corrupt_method}",
        },
        {
            "method": failed_method,
            "status": "failed",
            "code": "MODEL_NOT_CONVERGED",
            "message": "注入的训练失败",
        },
    ]
    (suite / "suite.json").write_text(json.dumps({
        "kind": "multi-dataset-suite",
        "dataset": "matrix-publisher",
        "version": "matrix-v1",
        "schemaName": "openstack-six-v1",
        "metricSet": "metric-set-v2",
        "status": "partial",
        "methods": entries,
    }), encoding="utf-8")
    return {
        "database": store.path,
        "artifact_root": root,
        "directory": real_run,
        "catalog": catalog,
        "methods": methods,
        "ready": ready,
        "disabled": disabled,
    }


def test_coverage_projects_mixed_states_without_promoting(tmp_path, mixed_coverage):
    from jit_baseline.api import create_app

    options = {key: mixed_coverage[key] for key in ("database", "artifact_root", "directory")}
    with TestClient(create_app(**options)) as client:
        response = client.get("/api/v1/models/coverage", params={"datasetVersion": "matrix-v1"})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["total"] == 1
        dataset = body["datasets"][0]
        cells = {cell["method"]: cell for cell in dataset["methods"]}
        methods = mixed_coverage["methods"]
        assert cells[methods[0]]["state"] == "registered-ready"
        assert cells[methods[0]]["modelId"] == mixed_coverage["ready"]["modelId"]
        assert cells[methods[1]]["state"] == "registered-unavailable"
        assert "停用" in cells[methods[1]]["reason"]
        assert cells[methods[2]]["state"] == "invalid"
        assert cells[methods[3]]["state"] == "failed"
        assert cells[methods[3]]["reason"] == "注入的训练失败"
        assert all(cells[method]["state"] == "missing" for method in methods[4:])
        assert len(cells) == 9
        assert dataset["counts"]["registered-ready"] == 1
        assert dataset["counts"]["complete-unregistered"] == 0
        assert body["latestImport"] is None
        current_models = mixed_coverage["catalog"].models()
        assert next(model for model in current_models
                    if model["modelId"] == mixed_coverage["ready"]["modelId"])["isDefault"] is True
        assert sum(model["isDefault"] for model in current_models) == 1


def test_admin_diagnostics_and_public_selection_use_the_same_identity(
        mixed_coverage, monkeypatch):
    from jit_baseline.api import create_app
    from fastapi.testclient import TestClient as PublicTestClient

    options = {key: mixed_coverage[key] for key in ("database", "artifact_root", "directory")}
    app = create_app(**options)
    with TestClient(app) as client:
        listing = client.get("/api/v1/models")
        assert listing.status_code == 200
        readiness = listing.json()["readiness"]
        assert readiness["registeredModels"] == 2
        assert readiness["readyModels"] == 2
        assert readiness["repositorySelectableModels"] == 1
        assert readiness["userSelectableModels"] == 1
        assert readiness["disabledModels"] == 1
        assert readiness["invalidModels"] == 0
        assert readiness["invalidArtifacts"] == 2
        assert readiness["completeArtifacts"] == 2
        assert readiness["completeUnregisteredExperiments"] == 0
        assert any(issue["code"] == "INVALID_ARTIFACTS" for issue in readiness["issues"])

        public = client.get("/api/v1/repository-models").json()["models"]
        selectable = {
            model["modelId"] for model in public if model["repositoryPredictionSupported"]
        }
        assert selectable == {
            model["modelId"] for model in listing.json()["models"]
            if model["state"] == "ready" and model["enabled"]
            and model["featureSchemaVersion"] in ("openstack-six-v1", "kamei14-git-v1")
        }

        assert client.get("/api/v1/models/coverage", params={"datasetVersion": "missing"}).status_code == 404
        assert client.get("/api/v1/models/coverage", params={"limit": 0}).status_code == 422
        assert client.get("/api/v1/models/coverage", params={"offset": -1}).status_code == 422
        assert client.get("/api/v1/models/coverage", params={"datasetVersion": " "}).status_code == 422

    with PublicTestClient(app) as public_client:
        assert public_client.get("/api/v1/models/coverage").status_code == 401
        assert public_client.get("/api/v1/models").status_code == 401


def test_dependency_failure_is_counted_separately(tmp_path, real_run, monkeypatch):
    from jit_baseline.api import create_app
    from jit_baseline.catalog import ModelCatalog
    from jit_baseline.catalog_storage import CatalogStorage

    method = list(ALGORITHMS)[0]
    root = tmp_path / "artifacts"
    target = root / method
    shutil.copytree(real_run, target)
    rewrite_manifest(
        target,
        lambda config: config.update(
            algorithmVersion=method,
            model=ALGORITHMS[method]["params"],
        ),
    )
    _resync(target, ())
    store = CatalogStorage(tmp_path / "catalog.sqlite3")
    store.initialize()
    catalog = ModelCatalog(store, root)
    catalog.register_key(method)

    def missing_dependency(*args, **kwargs):
        raise ModuleNotFoundError("No module named 'missing_model_package'")

    monkeypatch.setattr("joblib.load", missing_dependency)
    app = create_app(directory=real_run, database=store.path, artifact_root=root)
    with TestClient(app) as client:
        body = client.get("/api/v1/models").json()
        assert body["models"][0]["state"] == "invalid"
        assert body["models"][0]["error"]["code"] == "MODEL_DEPENDENCY_UNAVAILABLE"
        readiness = body["readiness"]
        assert readiness["dependencyUnavailableModels"] == 1
        assert readiness["artifactInvalidModels"] == 0
        assert readiness["invalidModels"] == 1
        assert readiness["readyModels"] == 0
        assert readiness["userSelectableModels"] == 0


@pytest.mark.parametrize("compatibility,state", [
    ("offline-only", "offline-only"),
    ("input-unsupported", "input-unsupported"),
    ("schema-incompatible", "incompatible"),
])
def test_non_service_compatibility_is_not_reported_as_registered_ready(compatibility, state):
    from jit_baseline.model_coverage import _method_cell
    cell = _method_cell("logistic-regression-l2-v1", None, {
        "artifactRunId": "a" * 64,
        "artifactState": "complete",
        "registrationState": "registered",
        "serviceCompatibility": compatibility,
        "serviceCompatibilityReason": "不可接入",
        "modelState": "ready",
        "enabled": True,
    }, None)
    assert cell["state"] == state
    assert cell["reason"] == "不可接入"
