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
    catalog = ModelCatalog(storage, root)
    model = catalog.register_key("baseline")["model"]
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
    explained = [item for item in reopened["records"] if item["explanation"]]
    assert explained
    assert all(item["explanation"]["status"] == "supported" for item in explained)
    assert all(len(item["explanation"]["items"]) <= 5 for item in explained)
    assert reopened["explanationCoverage"]["recorded"] == 10
    assert any("不是缺陷概率" in item for item in reopened["limitations"])

    listed = service.list(ACCOUNT)
    assert listed["batches"][0]["batchId"] == batch["batchId"]
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


def test_private_model_stays_out_of_other_users_scope(prediction_fixture):
    from jit_baseline.services.user_predictions import UserPredictionService

    storage = prediction_fixture["storage"]
    model = prediction_fixture["model"]
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
    assert "/api/v1/user/prediction-batches" in paths
    assert "/api/v1/user/prediction-batches/{batch_id}" in paths
