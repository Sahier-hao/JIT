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
    requested = kwargs.get("maturity_policy", "mature-only")
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
        "metricsByPartition": {
            "train": {"counts": {"records": 3}},
            "validation": {"counts": {"records": 2}},
            "test": {"counts": {"records": 1}},
        },
        "split": {"train": {"count": 3}, "validation": {"count": 2}, "test": {"count": 1}},
        "splitRule": "UTC distinct timestamps, floor(0.70G), floor(0.85G)",
        "dataScale": {"records": 6, "featureWidth": 6},
        "trainingPerformance": {"durationSeconds": 0.01, "trainingRecords": 3},
        "trainingSeconds": 0.01,
        "splitPolicy": {
            "id": kwargs.get("split_preset", "temporal-70-15-15"),
            "ratios": {"train": 70, "validation": 15, "test": 15},
            "timezone": "UTC",
            "boundaries": [],
            "partitionCounts": {},
            "memberSha256": "c" * 64,
        },
        "maturity": {
            "requestedPolicy": requested,
            "effectivePolicy": "mature-only",
            "releaseEligible": True,
            "inputRecords": 6,
            "excludedImmature": 0,
            "statusCounts": {"positive": 3, "unobserved": 3, "immature": 0, "unrecorded": 0},
            "observedThroughEpoch": 1700000000,
            "maturityDays": 90,
        },
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


def test_split_preset_is_part_of_active_reuse_identity(service):
    release = threading.Event()
    service._executor.submit(release.wait)
    try:
        first, first_created = service.create(
            dict(payload(), splitPreset="temporal-70-15-15"), created_by="admin")
        second, second_created = service.create(
            dict(payload(), splitPreset="temporal-80-10-10"), created_by="admin")
        assert first_created and second_created
        assert first["taskId"] != second["taskId"]
    finally:
        release.set()


def test_maturity_policy_is_preserved_and_part_of_active_reuse_identity(service):
    release = threading.Event()
    service._executor.submit(release.wait)
    try:
        first, first_created = service.create(payload(), created_by="admin")
        sensitivity, sensitivity_created = service.create(
            dict(payload(), maturityPolicy="include-immature"), created_by="admin")
        assert first_created and sensitivity_created
        assert first["taskId"] != sensitivity["taskId"]
        assert first["maturityPolicy"] == "mature-only"
        assert sensitivity["maturityPolicy"] == "include-immature"
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
    assert completed["metricsByPartition"]["train"]["counts"]["records"] == 3
    assert completed["splitRule"].startswith("UTC distinct timestamps")
    assert completed["splitPreset"] == "temporal-70-15-15"
    assert completed["splitPolicy"]["id"] == "temporal-70-15-15"
    assert completed["dataScale"]["records"] == 6
    assert completed["trainingPerformance"]["trainingRecords"] == 3
    assert completed["maturity"]["effectivePolicy"] == "mature-only"
    assert completed["error"] is None


def test_failure_is_recorded_and_retry_creates_parented_task(tmp_path, storage):
    seen = []

    def failing(*args, **kwargs):
        seen.append(kwargs.get("split_preset"))
        raise BaselineError("MODEL_NOT_CONVERGED", "注入训练失败")

    service = TrainingTaskService(
        storage, artifact_root=tmp_path / "artifacts", timeout=10, runner=failing)
    try:
        first, _ = service.create(
            dict(payload(), splitPreset="temporal-60-20-20"), created_by="admin")
        failed = wait_for(lambda: (lambda item: item if item["status"] == "failed" else None)(
            service.get(first["taskId"])))
        assert failed["error"] == {"code": "MODEL_NOT_CONVERGED", "message": "注入训练失败"}
        assert failed["metrics"] is None and failed["runId"] is None
        retried, created = service.retry(first["taskId"], created_by="admin")
        assert created and retried["taskId"] != first["taskId"]
        assert retried["parentTaskId"] == first["taskId"]
        assert retried["datasetVersion"] == first["datasetVersion"]
        assert retried["method"] == first["method"]
        assert retried["splitPreset"] == "temporal-60-20-20"
        wait_for(lambda: len(seen) == 2)
        assert seen == ["temporal-60-20-20", "temporal-60-20-20"]
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


def test_building_app_waits_for_lifespan_before_recovering_training(service, tmp_path):
    from jit_baseline.api import create_app

    release = threading.Event()
    service._executor.submit(release.wait)
    try:
        task, _ = service.create(payload(), created_by="admin")
        app = create_app(tmp_path / "missing-run", database=service.storage.path,
                         artifact_root=tmp_path / "artifacts", training_service=service)
        assert service.get(task["taskId"])["status"] == "queued"
        with TestClient(app) as client:
            assert client.get("/api/health").is_success
            assert service.get(task["taskId"])["status"] == "interrupted"
    finally:
        release.set()


def test_experiment_shows_retry_and_reuses_it_when_an_old_task_is_submitted(service):
    release = threading.Event()
    service._executor.submit(release.wait)
    try:
        view, _ = service.create_experiment({
            "datasetVersion": DATASET_VERSION,
            "methods": [{"method": "logistic-regression-l2-v1"}, {"method": "decision-tree-v1"}],
        }, created_by="admin")
        original, second = view["tasks"]
        service.tasks.finish(original["taskId"], "interrupted", "TRAINING_INTERRUPTED", "interrupted")
        retry, created = service.retry(original["taskId"], created_by="admin")
        assert created and retry["parentTaskId"] == original["taskId"]
        refreshed = service.get_experiment(view["experimentId"])
        assert [task["taskId"] for task in refreshed["tasks"]] == [retry["taskId"], second["taskId"]]
        assert service.get(original["taskId"])["status"] == "interrupted"

        # 重放旧按钮的请求时继续使用已成功的重试。
        service.tasks.finish(retry["taskId"], "succeeded", stage="completed")
        again, created = service.retry(original["taskId"], created_by="admin")
        assert not created and again["taskId"] == retry["taskId"]
        assert service.pages()["total"] == 3
    finally:
        release.set()


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
        assert tuple(db.execute("SELECT * FROM repository_sync").fetchone()) == before + (
            None, 'logistic-regression-l2-v1', None, None, None, 'mature-only', None)
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
    assert result["maturity"]["effectivePolicy"] == "publisher-labels-v1"
    assert result["maturity"]["releaseEligible"] is False
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
        assert completed["releaseStatus"] == "unqualified"
        assert completed["releaseReportId"]
        assert any(gate["id"] == "maturity-policy"
                   for gate in completed["release"]["assessment"]["gates"])
    finally:
        service.close()


def test_real_training_with_class_policy_records_summary(tmp_path):
    storage = CatalogStorage(tmp_path / "catalog.sqlite3")
    storage.initialize()
    service = TrainingTaskService(storage, artifact_root=tmp_path / "artifacts", timeout=60)
    try:
        task, _ = service.create(
            {"datasetVersion": DATASET_VERSION, "method": "logistic-regression-l2-v1",
             "metricSet": "metric-set-v2",
             "classPolicy": {"kind": "weights", "positiveWeight": 2}},
            created_by="admin", request_id="class-policy")
        completed = wait_for(
            lambda: (lambda item: item if item["status"] in (
                "succeeded", "failed", "interrupted") else None)(service.get(task["taskId"])),
            timeout=45,
        )
        assert completed["status"] == "succeeded", completed
        assert completed["classPolicy"] == {"kind": "weights", "positiveWeight": 2}
        assert completed["classPolicySummary"]["before"]["records"] > 0
        assert completed["classPolicySummary"]["after"] == completed["classPolicySummary"]["before"]
    finally:
        service.close()


def test_isolated_deep_worker_persists_epoch_history_before_completion(storage, tmp_path):
    service = TrainingTaskService(storage, artifact_root=tmp_path / "artifacts", timeout=90)
    try:
        task, _ = service.create(payload("wide-deep-v1"), created_by="admin")

        def first_point():
            current = service.get(task["taskId"])
            if current["status"] in ("failed", "interrupted"):
                pytest.fail(str(current.get("error")))
            return current if current["status"] == "running" and current["trainingHistory"] else None

        active = wait_for(first_point, timeout=45)
        assert active["trainingHistory"]["complete"] is False
        assert active["trainingHistory"]["entries"][0]["trainLoss"] > 0
        assert active["trainingHistory"]["entries"][0]["trainEvalLoss"] > 0
        assert active["trainingHistory"]["entries"][0]["validationLoss"] > 0
        result = wait_for(
            lambda: (lambda item: item if item["status"] not in ("queued", "running") else None)(
                service.get(task["taskId"])),
            timeout=40,
        )
        assert result["status"] == "succeeded", result.get("error")
        assert result["trainingHistory"]["complete"] is True
        history = result["trainingHistory"]
        assert [entry["epoch"] for entry in history["entries"]] == list(range(1, history["epochs"] + 1))
        partitions = result["metricsByPartition"]
        validation = partitions["validation"]
        preview = validation["thresholdPreview"]
        default_tick = round(preview["defaultThreshold"] * 100)
        assert preview["truePositives"][default_tick] == validation["confusion"]["tp"]
        assert preview["falsePositives"][default_tick] == validation["confusion"]["fp"]
        assert preview["positives"] + preview["negatives"] == validation["counts"]["records"]
        assert "thresholdPreview" not in partitions["test"]
    finally:
        service.close()


def test_parameter_overrides_are_validated_and_part_of_reuse_identity(service):
    release = threading.Event()
    service._executor.submit(release.wait)
    try:
        first, first_created = service.create(
            dict(payload(), params={"C": 0.5}), created_by="admin")
        again, again_created = service.create(
            dict(payload(), params={"C": 0.5}), created_by="admin")
        other, other_created = service.create(
            dict(payload(), params={"C": 2.0}), created_by="admin")
        default, default_created = service.create(payload(), created_by="admin")
        assert first_created and not again_created and other_created and default_created
        assert first["taskId"] == again["taskId"]
        assert len({first["taskId"], other["taskId"], default["taskId"]}) == 3
        assert first["parameters"]["C"] == 0.5
        assert first["parameters"]["max_iter"] == 1000
        assert default["parameters"] is None
    finally:
        release.set()


def test_parameter_overrides_reject_unknown_and_out_of_range(service):
    for params in ({"C": 0}, {"C": "x"}, {"unknown": 1}, {"n_estimators": 100}):
        with pytest.raises(BaselineError) as info:
            service.create(dict(payload(), params=params), created_by="admin")
        assert info.value.code in ("INPUT_INVALID",)


def test_retry_keeps_parameters_and_split(tmp_path, storage):
    seen = []

    def failing(*args, **kwargs):
        seen.append((kwargs.get("params"), kwargs.get("split_preset")))
        raise BaselineError("MODEL_NOT_CONVERGED", "注入训练失败")

    service = TrainingTaskService(
        storage, artifact_root=tmp_path / "artifacts", timeout=10, runner=failing)
    try:
        first, _ = service.create(
            dict(payload(), splitPreset="temporal-80-10-10", params={"C": 0.25}),
            created_by="admin")
        wait_for(lambda: (lambda item: item if item["status"] == "failed" else None)(
            service.get(first["taskId"])))
        retried, created = service.retry(first["taskId"], created_by="admin")
        assert created
        wait_for(lambda: (lambda item: item if item["status"] == "failed" else None)(
            service.get(retried["taskId"])))
        assert retried["parameters"]["C"] == 0.25
        assert seen == [({"C": 0.25}, "temporal-80-10-10"),
                        ({"C": 0.25}, "temporal-80-10-10")]
    finally:
        service.close()


def test_experiment_groups_same_identity_tasks_and_reuses_active(service):
    release = threading.Event()
    service._executor.submit(release.wait)
    try:
        request = {
            "datasetVersion": DATASET_VERSION,
            "metricSet": "metric-set-v2",
            "splitPreset": "temporal-70-15-15",
            "methods": [
                {"method": "logistic-regression-l2-v1", "params": {"C": 0.5}},
                {"method": "decision-tree-v1"},
            ],
        }
        view, created = service.create_experiment(request, created_by="admin")
        again, again_created = service.create_experiment(request, created_by="admin")
        assert created and not again_created
        assert view["experimentId"] == again["experimentId"]
        assert len(view["tasks"]) == 2
        assert {task["method"] for task in view["tasks"]} == {
            "logistic-regression-l2-v1", "decision-tree-v1"}
        assert {task["datasetVersion"] for task in view["tasks"]} == {DATASET_VERSION}
        assert {task["splitPreset"] for task in view["tasks"]} == {"temporal-70-15-15"}
        assert service.pages()["total"] == 2
    finally:
        release.set()


def test_experiment_validates_shared_split_once(service, monkeypatch):
    from jit_baseline.services import training_tasks

    calls = []
    validate = training_tasks.validate_dataset_split

    def check(*args, **kwargs):
        calls.append((args, kwargs))
        return validate(*args, **kwargs)

    monkeypatch.setattr(training_tasks, "validate_dataset_split", check)
    view, _ = service.create_experiment({
        "datasetVersion": DATASET_VERSION,
        "methods": [{"method": "logistic-regression-l2-v1"}, {"method": "decision-tree-v1"}],
    }, created_by="admin")

    assert len(view["tasks"]) == 2
    assert len(calls) == 1


def test_experiment_does_not_publish_partial_tasks_on_storage_failure(service, storage):
    with storage.connection(write=True) as db:
        db.execute("""
            CREATE TRIGGER refuse_second_training_task BEFORE INSERT ON training_task
            WHEN NEW.algorithm = 'decision-tree-v1' BEGIN
                SELECT RAISE(ABORT, 'test write failure');
            END
        """)

    with pytest.raises(BaselineError):
        service.create_experiment({
            "datasetVersion": DATASET_VERSION,
            "methods": [{"method": "logistic-regression-l2-v1"}, {"method": "decision-tree-v1"}],
        }, created_by="admin")

    assert service.pages()["total"] == 0
    assert service.experiments(None)["total"] == 0


def test_experiment_rejects_duplicate_or_unknown_methods(service):
    base = {"datasetVersion": DATASET_VERSION,
            "methods": [{"method": "logistic-regression-l2-v1"},
                        {"method": "logistic-regression-l2-v1"}]}
    with pytest.raises(BaselineError) as info:
        service.create_experiment(base, created_by="admin")
    assert info.value.code == "INPUT_INVALID"
    with pytest.raises(BaselineError) as info:
        service.create_experiment(
            {"datasetVersion": DATASET_VERSION, "methods": [{"method": "missing"}]},
            created_by="admin")
    assert info.value.code == "ALGORITHM_UNKNOWN"


def test_experiment_comparison_reports_identity_and_parameters(tmp_path, storage):
    service = TrainingTaskService(
        storage, artifact_root=tmp_path / "artifacts", timeout=10,
        runner=successful_runner)
    try:
        view, _ = service.create_experiment({
            "datasetVersion": DATASET_VERSION,
            "methods": [
                {"method": "logistic-regression-l2-v1", "params": {"C": 0.5}},
                {"method": "decision-tree-v1", "params": {"max_depth": 4}},
            ],
        }, created_by="admin")
        wait_for(lambda: all(task["status"] == "succeeded"
                             for task in service.get_experiment(view["experimentId"])["tasks"]))
        comparison = service.compare_experiment(view["experimentId"])
        assert comparison["format"] == "training-experiment-comparison-v1"
        assert comparison["comparable"] is True
        assert len(comparison["methods"]) == 2
        assert {row["parameters"]["C"] if row["method"].startswith("logistic") else
                row["parameters"]["max_depth"] for row in comparison["methods"]} == {0.5, 4}
        assert all(row["metrics"]["averagePrecision"]["value"] == 0.42
                   for row in comparison["methods"])
    finally:
        service.close()


def test_experiment_evaluates_validation_thresholds_on_frozen_test(tmp_path, storage):
    service = TrainingTaskService(storage, artifact_root=tmp_path / "artifacts", timeout=60)
    try:
        view, _ = service.create_experiment({
            "datasetVersion": DATASET_VERSION,
            "methods": [{"method": "logistic-regression-l2-v1"},
                        {"method": "random-forest-v1", "params": {"n_estimators": 12}}],
        }, created_by="admin")
        identity = view["experimentId"]
        request = {"taskIds": [task["taskId"] for task in view["tasks"]], "strategy": "max-f1"}
        terminal = wait_for(
            lambda: (item if (item := service.get_experiment(identity))["status"] not in ("queued", "running") else None),
            timeout=70,
        )
        assert terminal["status"] == "succeeded", [task["error"] for task in terminal["tasks"]]
        result = service.evaluate_experiment_thresholds(identity, request)
        assert result["experimentId"] == identity
        assert result["selection"] == {"strategy": "max-f1"}
        for task, method in zip(terminal["tasks"], result["methods"], strict=True):
            assert method["artifactRunId"] == task["artifactRunId"]
            snapshot = service.artifact_root / task["artifactKey"]
            scores = json.loads((snapshot / "reference-predictions.json").read_text(encoding="utf-8"))
            labels = json.loads((snapshot / "test-labels.json").read_text(encoding="utf-8"))
            preview = task["metricsByPartition"]["validation"]["thresholdPreview"]
            tick = round(method["threshold"] * 100)
            tp, fp = preview["truePositives"][tick], preview["falsePositives"][tick]
            f1 = 2 * tp / (tp + fp + preview["positives"])
            assert f1 == max(2 * hits / (hits + errors + preview["positives"])
                             for hits, errors in zip(preview["truePositives"], preview["falsePositives"]))
            expected_hits = sum(p["risk"] >= method["threshold"] and y["label"] == 1
                                for p, y in zip(scores, labels, strict=True))
            assert method["validation"]["confusion"]["tp"] == tp
            assert method["test"]["confusion"]["tp"] == expected_hits
            assert method["defaultTest"]["confusion"] == task["metrics"]["confusion"]
        identical = service.evaluate_experiment_thresholds(identity, {
            **request, "strategy": "fixed", "threshold": .5,
        })
        assert all(row["test"] == row["defaultTest"] for row in identical["methods"])
        goal = service.evaluate_experiment_thresholds(identity, {
            **request, "strategy": "target-recall", "targetRecall": .8,
        })
        assert all(row["validation"]["recall"]["value"] >= .8 for row in goal["methods"])

        with storage.connection(write=True) as db:
            task = terminal["tasks"][0]
            changed_split = {**task["splitPolicy"], "memberSha256": "d" * 64}
            db.execute("UPDATE training_task SET split_policy_json=? WHERE id=?",
                       (json.dumps(changed_split), task["taskId"]))
        with pytest.raises(BaselineError, match="分区成员"):
            service.evaluate_experiment_thresholds(identity, request)
        with storage.connection(write=True) as db:
            db.execute("UPDATE training_task SET split_policy_json=? WHERE id=?",
                       (json.dumps(task["splitPolicy"]), task["taskId"]))
        lost = service.artifact_root / task["artifactKey"] / "reference-predictions.json"
        lost.write_text("[]", encoding="utf-8")
        with pytest.raises(BaselineError, match="产物") as error:
            service.evaluate_experiment_thresholds(identity, request)
        assert error.value.code == "INTEGRITY_ERROR"
    finally:
        service.close()


def test_experiment_status_marks_interrupted_when_no_task_finished(tmp_path, storage):
    release = threading.Event()
    service = TrainingTaskService(
        storage, artifact_root=tmp_path / "artifacts", timeout=10,
        runner=successful_runner)
    service._executor.submit(release.wait)
    try:
        view, _ = service.create_experiment({
            "datasetVersion": DATASET_VERSION,
            "methods": [{"method": "logistic-regression-l2-v1"},
                        {"method": "decision-tree-v1"}],
        }, created_by="admin")
        service.recover()
        recovered = service.get_experiment(view["experimentId"])
        assert recovered["status"] == "interrupted"
        assert recovered["statusCounts"]["interrupted"] == 2
    finally:
        release.set()
        service.close()
