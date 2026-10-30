"""Administrator training task storage, execution, lifecycle and API."""
import json
import sqlite3
import sys
import threading
import time
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from jit_baseline.catalog_storage import CatalogStorage, MIGRATIONS, utc_now
from jit_baseline.config import BACKEND
from jit_baseline.data import BaselineError
from jit_baseline.datasets import load_manifest
from jit_baseline.training_tasks import TrainingTaskService

OPENSTACK_MANIFEST = (
    BACKEND / "data/datasets/openstack-six-v1/openstack-six-v1-2011-11-29_2014-02-28.json"
)
DATASET_VERSION = load_manifest(OPENSTACK_MANIFEST)["version"]


def wait_for(test, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = test()
        if value:
            return value
        time.sleep(0.02)
    raise AssertionError("training state transition timed out")


def successful_runner(manifest, algorithm, metric_set, **kwargs):
    return {
        "artifactKey": kwargs["output_key"],
        "artifactRunId": "a" * 64,
        "runId": str(uuid4()),
        "modelId": str(uuid4()),
        "datasetVersion": DATASET_VERSION,
        "manifestSha256": "b" * 64,
        "featureSchemaVersion": "openstack-six-v1",
        "metricSet": metric_set,
        "metrics": {"averagePrecision": {"value": 0.42, "reason": None}},
        "trainingSeconds": 0.01,
    }


@pytest.fixture
def storage(tmp_path):
    value = CatalogStorage(tmp_path / "catalog.sqlite3")
    value.initialize()
    return value


@pytest.fixture
def service(storage, tmp_path):
    value = TrainingTaskService(
        storage, artifact_root=tmp_path / "artifacts", timeout=10,
        runner=successful_runner,
    )
    yield value
    value.close()


def payload(method="logistic-regression-l2-v1"):
    return {"datasetVersion": DATASET_VERSION, "method": method, "metricSet": "metric-set-v2"}


def test_create_validates_dataset_method_and_metric_set(service):
    with pytest.raises(BaselineError) as info:
        service.create({"datasetVersion": "missing", "method": "logistic-regression-l2-v1"},
                       created_by="admin")
    assert info.value.code == "DATASET_INVALID"
    with pytest.raises(BaselineError) as info:
        service.create({"datasetVersion": DATASET_VERSION, "method": "missing"},
                       created_by="admin")
    assert info.value.code == "ALGORITHM_UNKNOWN"
    with pytest.raises(BaselineError):
        service.create(dict(payload(), metricSet="missing"), created_by="admin")
    assert service.pages()["total"] == 0


def test_duplicate_active_task_is_reused(service):
    release = threading.Event()
    service._executor.submit(release.wait)
    try:
        first, created = service.create(payload(), created_by="admin")
        again, created_again = service.create(payload(), created_by="admin")
        assert created and not created_again
        assert first["taskId"] == again["taskId"]
        assert service.pages()["total"] == 1
    finally:
        release.set()


def test_success_returns_real_metrics_and_lineage(service):
    task, created = service.create(payload(), created_by="admin")
    assert created
    completed = wait_for(lambda: (lambda item: item if item["status"] == "succeeded" else None)(
        service.get(task["taskId"])))
    assert completed["artifactRunId"] == "a" * 64
    assert completed["runId"] and completed["modelId"]
    assert completed["featureSchemaVersion"] == "openstack-six-v1"
    assert completed["metrics"]["averagePrecision"]["value"] == 0.42
    assert completed["error"] is None


def test_failure_is_recorded_and_retry_creates_parented_task(tmp_path, storage):
    def failing(*args, **kwargs):
        raise BaselineError("MODEL_NOT_CONVERGED", "注入训练失败")

    service = TrainingTaskService(
        storage, artifact_root=tmp_path / "artifacts", timeout=10, runner=failing)
    try:
        first, _ = service.create(payload(), created_by="admin")
        failed = wait_for(lambda: (lambda item: item if item["status"] == "failed" else None)(
            service.get(first["taskId"])))
        assert failed["error"] == {"code": "MODEL_NOT_CONVERGED", "message": "注入训练失败"}
        assert failed["metrics"] is None and failed["runId"] is None
        retried, created = service.retry(first["taskId"], created_by="admin")
        assert created and retried["taskId"] != first["taskId"]
        assert retried["parentTaskId"] == first["taskId"]
        assert retried["datasetVersion"] == first["datasetVersion"]
        assert retried["method"] == first["method"]
    finally:
        service.close()


def test_successful_or_active_task_cannot_retry(service):
    task, _ = service.create(payload(), created_by="admin")
    wait_for(lambda: service.get(task["taskId"])["status"] == "succeeded")
    with pytest.raises(BaselineError) as info:
        service.retry(task["taskId"], created_by="admin")
    assert info.value.code == "TASK_NOT_RETRYABLE"


def test_queue_cancel_is_idempotent_and_marks_terminal(service):
    release = threading.Event()
    service._executor.submit(release.wait)
    try:
        task, _ = service.create(payload(), created_by="admin")
        cancelled = service.cancel(task["taskId"])
        assert cancelled["status"] == "cancelled"
        assert cancelled["cancelRequestedAt"] and cancelled["completedAt"]
        assert service.cancel(task["taskId"])["status"] == "cancelled"
        with pytest.raises(BaselineError) as info:
            service.cancel("missing")
        assert info.value.code == "NOT_FOUND"
    finally:
        release.set()


def test_running_cancel_stops_owned_process_tree(monkeypatch, tmp_path, storage):
    import jit_baseline.training_tasks as tasks
    pidfile = tmp_path / "pid.json"
    script = (
        'import json,os,sys,time,subprocess; json.load(sys.stdin); '
        'child=subprocess.Popen([sys.executable,"-c","import time; time.sleep(120)"]); '
        f'open({str(pidfile)!r},"w").write(json.dumps([os.getpid(),child.pid])); '
        'time.sleep(120)'
    )
    monkeypatch.setattr(tasks, "worker_command", lambda: [sys.executable, "-c", script])
    service = TrainingTaskService(storage, artifact_root=tmp_path / "artifacts", timeout=10)
    try:
        task, _ = service.create(payload(), created_by="admin")

        def pids():
            try:
                value = json.loads(pidfile.read_text())
            except (OSError, json.JSONDecodeError):
                return None
            return value if isinstance(value, list) and len(value) == 2 else None

        running_pids = wait_for(pids)
        service.cancel(task["taskId"])
        wait_for(lambda: service.get(task["taskId"])["status"] == "cancelled")
        from jit_baseline.task_process import process_alive
        assert all(not process_alive(pid) for pid in running_pids)
    finally:
        service.close()


def test_recover_marks_active_tasks_interrupted(storage, tmp_path):
    now = utc_now()
    service = TrainingTaskService(
        storage, artifact_root=tmp_path / "artifacts", timeout=10, runner=successful_runner)
    try:
        service.tasks.create({
            "id": "stale", "dataset_version": DATASET_VERSION,
            "dataset_manifest": str(OPENSTACK_MANIFEST), "manifest_sha256": "0" * 64,
            "algorithm": "logistic-regression-l2-v1", "metric_set": "metric-set-v2",
            "status": "running", "stage": "training", "created_by": "admin",
            "artifact_key": "training-task-stale", "created_at": now, "updated_at": now,
        })
        assert service.recover() == 1
        item = service.get("stale")
        assert item["status"] == "interrupted"
        assert item["error"]["code"] == "TRAINING_INTERRUPTED"
        assert item["completedAt"]
    finally:
        service.close()


def test_admin_training_api_requires_auth_and_returns_task(service, tmp_path):
    from jit_baseline.api import create_app
    app = create_app(tmp_path / "missing-run", database=service.storage.path,
                     artifact_root=tmp_path / "artifacts", training_service=service)
    with TestClient(app) as client:
        assert client.get("/api/v1/training-tasks").status_code == 401
        assert client.post("/api/v1/training-tasks", json=payload()).status_code == 401
        credentials = {"username": "admin", "password": "training-task-password"}
        assert client.post("/api/admin/setup", json=credentials).status_code == 201
        cross_site = client.post("/api/v1/training-tasks", headers={"Origin": "https://evil.example"},
                                 json=payload())
        assert cross_site.status_code == 403
        response = client.post("/api/v1/training-tasks", json=payload())
        assert response.status_code == 202
        task_id = response.json()["taskId"]
        completed = wait_for(lambda: (lambda body: body if body["status"] == "succeeded" else None)(
            client.get(f"/api/v1/training-tasks/{task_id}").json()))
        assert completed["metrics"]["averagePrecision"]["value"] == 0.42
        listed = client.get("/api/v1/training-tasks").json()
        assert listed["total"] == 1 and listed["tasks"][0]["taskId"] == task_id


def test_admin_api_cancel_and_retry(monkeypatch, tmp_path, storage):
    from jit_baseline.api import create_app

    def failing(*args, **kwargs):
        raise BaselineError("MODEL_NOT_CONVERGED", "注入训练失败")

    retry_service = TrainingTaskService(
        storage, artifact_root=tmp_path / "retry-artifacts", timeout=10, runner=failing)
    app = create_app(tmp_path / "missing-run", database=storage.path,
                     artifact_root=tmp_path / "retry-artifacts",
                     training_service=retry_service)
    try:
        with TestClient(app) as client:
            assert client.post("/api/admin/setup", json={
                "username": "admin", "password": "training-api-password"}).status_code == 201
            task = client.post("/api/v1/training-tasks", json=payload()).json()
            failed = wait_for(lambda: (lambda body: body if body["status"] == "failed" else None)(
                client.get(f"/api/v1/training-tasks/{task['taskId']}").json()))
            assert failed["error"]["code"] == "MODEL_NOT_CONVERGED"
            retried = client.post(f"/api/v1/training-tasks/{task['taskId']}/retry")
            assert retried.status_code == 202
            assert retried.json()["parentTaskId"] == task["taskId"]
            wait_for(lambda: client.get(
                f"/api/v1/training-tasks/{retried.json()['taskId']}").json()["status"] == "failed")

        blocking = TrainingTaskService(
            storage, artifact_root=tmp_path / "cancel-artifacts", timeout=10,
            runner=successful_runner)
        release = threading.Event()
        blocking._executor.submit(release.wait)
        app = create_app(tmp_path / "missing-run", database=storage.path,
                         artifact_root=tmp_path / "cancel-artifacts",
                         training_service=blocking)
        try:
            with TestClient(app) as client:
                assert client.post("/api/admin/login", json={
                    "username": "admin", "password": "training-api-password"}).status_code == 200
                task = client.post("/api/v1/training-tasks", json=payload()).json()
                cancelled = client.post(f"/api/v1/training-tasks/{task['taskId']}/cancel")
                assert cancelled.status_code == 200
                assert cancelled.json()["status"] == "cancelled"
        finally:
            release.set()
            blocking.close()
    finally:
        retry_service.close()


def test_training_task_migration_preserves_old_rows_and_is_idempotent(tmp_path):
    database = tmp_path / "old-v17.sqlite3"
    with sqlite3.connect(database) as db:
        for number, path in MIGRATIONS:
            if number <= 17:
                db.executescript(path.read_text(encoding="utf-8"))
        db.execute("INSERT INTO schema_migration VALUES (17, 'fixture')")
        db.execute(
            "INSERT INTO repository_sync(id,repository_url,branch,requested_strategy,status,stage,"
            "created_at,updated_at) VALUES ('old','https://example.com/repo','main','auto',"
            "'completed','completed','fixture','fixture')")
    before = sqlite3.connect(database).execute("SELECT * FROM repository_sync").fetchone()
    storage = CatalogStorage(database)
    storage.initialize()
    storage.initialize()
    with storage.connection() as db:
        assert tuple(db.execute("SELECT * FROM repository_sync").fetchone()) == before
        assert db.execute("SELECT COUNT(*) FROM training_task").fetchone()[0] == 0
        assert db.execute("SELECT version FROM schema_migration").fetchone()[0] == MIGRATIONS[-1][0]
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []


def test_real_training_executor_verifies_and_registers(tmp_path):
    from jit_baseline.catalog import ModelCatalog
    from jit_baseline.training import TrainingExecutor

    storage = CatalogStorage(tmp_path / "catalog.sqlite3")
    storage.initialize()
    root = tmp_path / "artifacts"
    executor = TrainingExecutor(ModelCatalog(storage, root), root)
    result = executor.run(
        OPENSTACK_MANIFEST, "logistic-regression-l2-v1", "metric-set-v2",
        output_key="training-task-real-test", channel="training-task", request_id="request")
    assert result["runId"] and result["modelId"] and result["artifactRunId"]
    assert result["metrics"]["averagePrecision"]["value"] is not None
    assert (root / "training-task-real-test" / "manifest.json").is_file()


def test_isolated_worker_completes_a_real_task(tmp_path):
    storage = CatalogStorage(tmp_path / "catalog.sqlite3")
    storage.initialize()
    service = TrainingTaskService(
        storage, artifact_root=tmp_path / "artifacts", timeout=60)
    try:
        task, _ = service.create(
            {"datasetVersion": DATASET_VERSION, "method": "logistic-regression-l2-v1",
             "metricSet": "metric-set-v2"},
            created_by="admin", request_id="isolated-worker")
        completed = wait_for(
            lambda: (lambda item: item if item["status"] in (
                "succeeded", "failed", "interrupted") else None)(service.get(task["taskId"])),
            timeout=30,
        )
        assert completed["status"] == "succeeded", completed
        assert completed["runId"] and completed["artifactRunId"] and completed["modelId"]
        assert completed["metrics"]["averagePrecision"]["value"] is not None
    finally:
        service.close()
