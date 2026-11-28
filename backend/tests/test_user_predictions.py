"""User batch prediction keeps model/data scope, thresholds and attribution together."""
import json
import shutil

import pytest

ACCOUNT = "prediction-reader"
DATASET_VERSION = "openstack-six-v1-2011-11-29_2014-02-28"


@pytest.fixture
def prediction_fixture(tmp_path):
    """Use the frozen fixture model without rebuilding optional torch paths."""
    from jit_baseline.artifacts import environment, identity
    from jit_baseline.catalog import ModelCatalog
    from jit_baseline.catalog_storage import CatalogStorage
    from jit_baseline.config import BACKEND
    from jit_baseline.data import parse_source, sha256
    from jit_baseline.datasets import load_manifest

    source = BACKEND / "artifacts" / "baseline"
    if not source.is_dir():
        pytest.skip("仓库内冻结模型 fixture 不存在")
    root = tmp_path / "artifacts"
    shutil.copytree(source, root / "baseline")
    manifest_path = root / "baseline" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    config = manifest["config"]
    config["trainingEnvironment"] = environment(())
    config.pop("environment", None)
    manifest["runId"] = identity(config)
    summary_path = root / "baseline" / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary["runId"] = manifest["runId"]
    summary_path.write_text(json.dumps(summary), encoding="utf-8")
    manifest["files"]["summary.json"] = sha256(summary_path.read_bytes())
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    dataset_source = (
        BACKEND / "data" / "datasets" / "openstack-six-v1"
        / f"{DATASET_VERSION}.json"
    )
    dataset_manifest = load_manifest(dataset_source)
    source_csv = BACKEND / dataset_manifest["file"]["path"]
    registry = tmp_path / "datasets"
    room = registry / dataset_manifest["dataset"]
    room.mkdir(parents=True)
    copied_csv = room / source_csv.name
    shutil.copyfile(source_csv, copied_csv)
    dataset_manifest["file"]["path"] = str(copied_csv)
    registered = room / f"{DATASET_VERSION}.json"
    registered.write_text(
        json.dumps(dataset_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    records, _ = parse_source(
        copied_csv.read_bytes(),
        dataset_manifest["schemaName"],
        dataset_manifest["cohort"],
    )
    storage = CatalogStorage(tmp_path / "catalog.sqlite3")
    storage.initialize()
    with storage.connection(write=True) as db:
        db.execute(
            "INSERT INTO user_account(username,salt,password_hash,created_at,display_name) "
            "VALUES (?,?,?,?,?)",
            (ACCOUNT, "00" * 16, "test-only-password-hash", 0, None),
        )
    storage.import_dataset(dataset_manifest, records)
    with storage.connection(write=True) as db:
        db.execute(
            "UPDATE dataset_record SET observed_through=?, maturity_days=0 "
            "WHERE dataset_version=?",
            (2000000000, DATASET_VERSION),
        )
    catalog = ModelCatalog(storage, root)
    model = catalog.register_key("baseline")["model"]
    storage.set_model_share(model["modelId"], True, "admin")
    return {
        "storage": storage,
        "catalog": catalog,
        "model": model,
        "manifest": dataset_manifest,
        "dataset_root": registry,
        "artifact_root": root,
        "database": storage.path,
    }


def test_user_batch_prediction_supports_thresholds_and_reopens(prediction_fixture):
    from jit_baseline.services.user_predictions import UserPredictionService

    service = UserPredictionService(
        prediction_fixture["storage"], prediction_fixture["catalog"],
    )
    model = prediction_fixture["model"]
    available = service.models(ACCOUNT, prediction_fixture["manifest"]["schemaName"])
    assert [item["modelId"] for item in available["models"]] == [model["modelId"]]
    assert available["maxRecords"] == 20_000

    batch = service.create(
        ACCOUNT,
        DATASET_VERSION,
        prediction_fixture["manifest"],
        model["modelId"],
        0.65,
    )
    assert batch["format"] == "user-prediction-batch-v1"
    assert batch["model"]["modelId"] == model["modelId"]
    total = prediction_fixture["storage"].count_commits(DATASET_VERSION)
    assert batch["counts"]["records"] == total
    assert batch["counts"]["positives"] + batch["counts"]["negatives"] == total
    assert batch["counts"]["labeledAvailable"] == total
    assert batch["evaluationEligible"] is True
    assert batch["partition"] is None and batch["splitPreset"] is None
    assert batch["memberSha256"]
    preview = batch["thresholdPreview"]
    assert len(preview["thresholds"]) == 101
    assert len(preview["truePositives"]) == 101
    assert len(preview["falsePositives"]) == 101
    assert preview["truePositives"][0] == preview["positives"]
    assert preview["falsePositives"][0] == preview["negatives"]
    assert preview["truePositives"][-1] == 0
    assert preview["falsePositives"][-1] == 0
    assert batch["counts"]["flagged"] == (
        preview["truePositives"][65] + preview["falsePositives"][65]
    )
    reopened = service.get(ACCOUNT, batch["batchId"], limit=10, sort="risk")
    assert reopened["batchId"] == batch["batchId"]
    assert reopened["records"] and len(reopened["records"]) == 10
    risks = [item["risk"] for item in reopened["records"]]
    assert risks == sorted(risks, reverse=True)
    assert all(0 <= risk <= 1 for risk in risks)
    assert all(
        set(item["features"]) == {"ns", "nd", "nf", "ent", "la", "ld"}
        for item in reopened["records"]
    )
    assert all(item["labelAvailability"] == "available" for item in reopened["records"])
    explained = [item for item in reopened["records"] if item["explanation"]]
    assert explained
    assert all(item["explanation"]["status"] == "supported" for item in explained)
    assert all(len(item["explanation"]["items"]) <= 5 for item in explained)
    assert reopened["explanationCoverage"]["recorded"] == 10
    assert any("不是缺陷概率" in item for item in reopened["limitations"])

    listed = service.list(ACCOUNT)
    assert listed["batches"][0]["batchId"] == batch["batchId"]
    assert listed["batches"][0]["mode"] == "batch"
    evaluation = service.evaluation(ACCOUNT, batch["batchId"])
    assert evaluation["eligible"] is True
    assert evaluation["batchId"] == batch["batchId"]
    assert evaluation["confusion"]["tp"] + evaluation["confusion"]["fn"] == evaluation["counts"]["positives"]
    assert evaluation["confusion"]["tn"] + evaluation["confusion"]["fp"] == evaluation["counts"]["negatives"]
    with pytest.raises(Exception) as missing:
        service.get("prediction-other", batch["batchId"])
    assert getattr(missing.value, "code", None) == "NOT_FOUND"
    with pytest.raises(Exception) as invalid:
        service.create(
            ACCOUNT,
            DATASET_VERSION,
            prediction_fixture["manifest"],
            model["modelId"],
            2,
        )
    assert getattr(invalid.value, "code", None) == "INPUT_INVALID"


def test_prediction_evaluation_excludes_unavailable_labels():
    from jit_baseline.services.user_predictions import (
        _evaluation_state, _label_availability, _threshold_preview,
    )

    values = [
        (1, "positive"), (0, "unobserved"), (0, "immature"),
        (0, "unknown"), (0, "unrecorded"),
    ]
    prepared = []
    for index, (label, status) in enumerate(values):
        available_label, label_status, availability = _label_availability(label, status)
        if availability == "available":
            prepared.append({
                "label": available_label,
                "labelStatus": label_status,
                "labelAvailability": availability,
                "risk": [0.9, 0.2, 0.95, 0.8, 0.7][index],
            })

    preview = _threshold_preview(prepared)
    assert preview["positives"] == 1
    assert preview["negatives"] == 1
    assert preview["truePositives"][50] == 1
    assert preview["falsePositives"][50] == 0
    assert preview["truePositives"][20] == 1
    assert preview["falsePositives"][20] == 1
    assert _evaluation_state({
        "labeledAvailable": 2, "positives": 1, "negatives": 1,
    }) == (True, "包含可用真实标签，可进入评估")
    assert _evaluation_state({
        "labeledAvailable": 1, "positives": 1, "negatives": 0,
    })[0] is False


def test_old_prediction_batch_reopens_as_exploratory(prediction_fixture):
    from jit_baseline.services.user_predictions import UserPredictionService

    service = UserPredictionService(
        prediction_fixture["storage"], prediction_fixture["catalog"],
    )
    batch = service.create(
        ACCOUNT, DATASET_VERSION, prediction_fixture["manifest"],
        prediction_fixture["model"]["modelId"],
    )
    with prediction_fixture["storage"].connection(write=True) as db:
        payload = json.loads(db.execute(
            "SELECT payload_json FROM user_prediction_batch WHERE id=?",
            (batch["batchId"],),
        ).fetchone()["payload_json"])
        payload.pop("evaluation", None)
        db.execute(
            "UPDATE user_prediction_batch SET payload_json=? WHERE id=?",
            (json.dumps(payload), batch["batchId"]),
        )
    reopened = service.get(ACCOUNT, batch["batchId"])
    assert reopened["evaluationEligible"] is True
    assert reopened["labelAvailabilityCounts"]["available"] > 0


def test_private_model_stays_out_of_other_users_scope(prediction_fixture):
    from jit_baseline.services.user_predictions import UserPredictionService

    storage = prediction_fixture["storage"]
    model = prediction_fixture["model"]
    storage.set_model_share(model["modelId"], False, "admin")
    with storage.connection(write=True) as db:
        db.execute(
            "UPDATE model_version SET owner_user_id=? WHERE id=?",
            ("prediction-owner", model["modelId"]),
        )
    service = UserPredictionService(storage, prediction_fixture["catalog"])
    assert service.models(ACCOUNT, prediction_fixture["manifest"]["schemaName"])["models"] == []
    with pytest.raises(Exception) as forbidden:
        service.create(
            ACCOUNT,
            DATASET_VERSION,
            prediction_fixture["manifest"],
            model["modelId"],
        )
    assert getattr(forbidden.value, "code", None) == "MODEL_FORBIDDEN"


def test_single_batch_and_unlabeled_csv_share_inference_contract(prediction_fixture):
    from jit_baseline.services.user_predictions import UserPredictionService

    service = UserPredictionService(
        prediction_fixture["storage"], prediction_fixture["catalog"],
    )
    model = prediction_fixture["model"]
    records = prediction_fixture["storage"].commits(DATASET_VERSION)
    chosen = records[len(records) // 2]
    batch = service.create(
        ACCOUNT, DATASET_VERSION, prediction_fixture["manifest"],
        model["modelId"], 0.5,
    )
    single = service.create_single_dataset(
        ACCOUNT, DATASET_VERSION, prediction_fixture["manifest"],
        model["modelId"], chosen["commitId"], 0.5,
    )
    with prediction_fixture["storage"].connection() as db:
        batch_risk = db.execute(
            "SELECT risk FROM user_prediction_record WHERE batch_id=? AND record_id=?",
            (batch["batchId"], chosen["commitId"]),
        ).fetchone()[0]
        single_risk = db.execute(
            "SELECT risk FROM user_prediction_record WHERE batch_id=? AND record_id=?",
            (single["batchId"], chosen["commitId"]),
        ).fetchone()[0]
    assert single_risk == pytest.approx(batch_risk, abs=1e-12)
    assert single["mode"] == "single" and single["sourceKind"] == "single-dataset"
    manual = service.create_single_manual(
        ACCOUNT, model["modelId"], chosen["features"], "manual-a", 0.5,
    )
    project = service.create_single_project(
        ACCOUNT, model["modelId"],
        {"commitId": chosen["commitId"], "authorTime": chosen["authorTime"],
         "features": chosen["features"]},
        {"kind": "single-project", "label": "项目分析提交",
         "datasetName": "测试项目",
         "reference": {"repositoryId": "repo-1", "syncId": "sync-1",
                       "commitId": chosen["commitId"]}},
        0.5,
    )
    with prediction_fixture["storage"].connection() as db:
        manual_risk = db.execute(
            "SELECT risk FROM user_prediction_record WHERE batch_id=?",
            (manual["batchId"],),
        ).fetchone()[0]
        project_risk = db.execute(
            "SELECT risk FROM user_prediction_record WHERE batch_id=?",
            (project["batchId"],),
        ).fetchone()[0]
    assert manual_risk == pytest.approx(batch_risk, abs=1e-12)
    assert project_risk == pytest.approx(batch_risk, abs=1e-12)
    project_reopened = service.get(ACCOUNT, project["batchId"], limit=1)
    assert project_reopened["sourceKind"] == "single-project"
    assert project_reopened["records"][0]["label"] is None
    assert project_reopened["evaluationEligible"] is False

    header = ["recordId"] + list(manual["model"]["featureNames"])
    row = ["csv-1"] + [str(chosen["features"][name]) for name in manual["model"]["featureNames"]]
    second = ["csv-2"] + [str(chosen["features"][name]) for name in manual["model"]["featureNames"]]
    blob = (",".join(header) + "\n" + ",".join(row) + "\n" + ",".join(second) + "\n").encode()
    unlabeled = service.create_unlabeled(
        ACCOUNT, model["modelId"], blob, "unlabeled.csv", 0.5,
    )
    assert unlabeled["mode"] == "batch" and unlabeled["sourceKind"] == "unlabeled-csv"
    assert unlabeled["evaluationEligible"] is False
    reopened = service.get(ACCOUNT, unlabeled["batchId"], limit=10)
    assert reopened["labelAvailabilityCounts"] == {"available": 0, "unavailable": 2}
    assert all(item["label"] is None for item in reopened["records"])

    with pytest.raises(Exception) as missing:
        service.create_single_manual(
            ACCOUNT, model["modelId"], {"ns": 1}, "missing", 0.5,
        )
    assert getattr(missing.value, "code", None) == "FEATURES_INVALID"
    bad_blob = (",".join(header) + "\n" + "bad,NaN," + ",".join(["1"] * (len(header) - 2)) + "\n").encode()
    with pytest.raises(Exception) as bad:
        service.create_unlabeled(ACCOUNT, model["modelId"], bad_blob, "bad.csv")
    assert getattr(bad.value, "code", None) == "FEATURES_INVALID"


def test_registered_split_presets_and_model_partitions_are_frozen_into_batch(prediction_fixture):
    from jit_baseline.services.user_predictions import UserPredictionService

    service = UserPredictionService(
        prediction_fixture["storage"], prediction_fixture["catalog"],
    )
    model = prediction_fixture["model"]
    options = service.split_options(
        ACCOUNT, DATASET_VERSION, prediction_fixture["manifest"], model["modelId"],
    )
    preset = next(item for item in options["presets"] if item["available"])
    batch = service.create(
        ACCOUNT, DATASET_VERSION, prediction_fixture["manifest"], model["modelId"],
        0.5, partition="validation", split_source="preset", split_preset=preset["id"],
    )
    assert batch["partition"] == "validation"
    assert batch["splitPreset"] == preset["id"]
    assert batch["memberSha256"] == preset["memberSha256"]
    assert batch["counts"]["records"] == preset["partitions"]["validation"]["count"]
    reopened = service.get(ACCOUNT, batch["batchId"], limit=10)
    assert reopened["partition"] == "validation"
    assert reopened["splitPreset"] == preset["id"]
    assert reopened["memberSha256"] == preset["memberSha256"]
    if options["modelSplit"] is not None:
        model_partition = "test"
        frozen = service.create(
            ACCOUNT, DATASET_VERSION, prediction_fixture["manifest"], model["modelId"],
            0.5, partition=model_partition, split_source="model",
        )
        assert frozen["partition"] == model_partition
        assert frozen["memberSha256"] == options["modelSplit"]["memberSha256"]
        assert frozen["splitPreset"] == options["modelSplit"]["splitPreset"]


def test_user_prediction_routes_are_registered(prediction_fixture):
    from jit_baseline.api import create_app

    app = create_app(
        prediction_fixture["artifact_root"] / "baseline",
        database=prediction_fixture["database"],
        artifact_root=prediction_fixture["artifact_root"],
        dataset_root=prediction_fixture["dataset_root"],
    )
    paths = set(app.openapi()["paths"])
    assert "/api/v1/user/prediction-models" in paths
    assert "/api/v1/user/prediction-samples" in paths
    assert "/api/v1/user/prediction-splits" in paths
    assert "/api/v1/user/prediction-batches" in paths
    assert "/api/v1/user/prediction-batches/single" in paths
    assert "/api/v1/user/prediction-batches/unlabeled" in paths
    assert "/api/v1/user/prediction-batches/{batch_id}" in paths
    assert "/api/v1/user/prediction-batches/{batch_id}/evaluation" in paths


def test_prediction_migration_preserves_old_batches_and_marks_label_availability(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage, MIGRATIONS
    import sqlite3
    from pathlib import Path

    database = tmp_path / "upgrade.sqlite3"
    raw = sqlite3.connect(database)
    raw.execute("PRAGMA foreign_keys=ON")
    for _number, path in MIGRATIONS[:44]:
        for statement in Path(path).read_text(encoding="utf-8").split(";"):
            if statement.strip():
                raw.execute(statement)
    raw.execute("INSERT INTO schema_migration VALUES (44,'fixture')")
    raw.commit()
    payload = {
        "batchId": "old-batch", "datasetVersion": "old-data",
        "dataset": "旧数据", "threshold": .5,
        "model": {
            "modelId": "old-model", "name": "旧模型",
            "method": "logistic-regression-l2-v1", "runId": "old-run",
            "featureSchemaVersion": "kamei14-git-v2",
        },
        "counts": {"records": 2}, "labelStatusCounts": {},
        "thresholdPreview": {"thresholds": [i / 100 for i in range(101)],
                             "positives": 1, "negatives": 1,
                             "truePositives": [0] * 101, "falsePositives": [0] * 101},
        "createdAt": "2026-01-01T00:00:00Z", "limitations": [],
    }
    with raw:
        db = raw
        db.execute(
            "INSERT INTO user_account(username,salt,password_hash,created_at,display_name) "
            "VALUES (?,?,?,?,?)", (ACCOUNT, "00" * 16, "hash", 0, None),
        )
        db.execute(
            "INSERT INTO dataset_version(id,artifact_version,source_json) VALUES (?,?,?)",
            ("dataset-1", "old-data", "{}"),
        )
        db.execute(
            "INSERT INTO experiment_run(id,artifact_run_id,dataset_id,config_json,schema_json) "
            "VALUES (?,?,?,?,?)",
            ("run-1", "old-run", "dataset-1", "{}", "{}"),
        )
        db.execute(
            "INSERT INTO model_version(id,run_id,preferred_location_id,state,error_code,payload_json) "
            "VALUES (?,?,?,?,?,?)",
            ("old-model", "run-1", None, "ready", None, json.dumps(payload["model"])),
        )
        db.execute(
            "INSERT INTO user_prediction_batch VALUES (?,?,?,?,?,?)",
            ("old-batch", ACCOUNT, "old-data", "old-model",
             json.dumps(payload, ensure_ascii=False), "2026-01-01T00:00:00Z"),
        )
        db.executemany(
            "INSERT INTO user_prediction_record VALUES (?,?,?,?,?,?,?,?,?)",
            [
                ("r1", "old-batch", "commit-1", "2025-01-01T00:00:00Z", 1,
                 "positive", .8, "{}", None),
                ("r2", "old-batch", "commit-2", "2025-01-02T00:00:00Z", 0,
                 "immature", .2, "{}", None),
            ],
        )
    raw.close()
    upgraded = CatalogStorage(database)
    upgraded.initialize()
    with upgraded.connection() as db:
        batch = db.execute(
            "SELECT mode,source_kind,model_name,feature_schema_version "
            "FROM user_prediction_batch WHERE id='old-batch'"
        ).fetchone()
        records = db.execute(
            "SELECT record_id,label,label_availability FROM user_prediction_record "
            "WHERE batch_id='old-batch' ORDER BY record_id"
        ).fetchall()
    assert tuple(batch) == ("batch", "dataset", "旧模型", "kamei14-git-v2")
    assert [tuple(row) for row in records] == [
        ("commit-1", 1, "available"),
        ("commit-2", None, "unavailable"),
    ]
