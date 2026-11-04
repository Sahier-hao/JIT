import json
import shutil
import threading
import zipfile
from pathlib import Path

import pytest

from jit_baseline.algorithms import ALGORITHMS
from test_artifacts import _resync, real_run, rewrite_manifest  # noqa: F401


def _catalog(tmp_path, name):
    from jit_baseline.catalog import ModelCatalog
    from jit_baseline.catalog_storage import CatalogStorage
    root = tmp_path / name / "artifacts"
    root.mkdir(parents=True)
    store = CatalogStorage(tmp_path / name / "catalog.sqlite3")
    store.initialize()
    return ModelCatalog(store, root)


def _add_run(real_run, root, method):
    from jit_baseline.catalog import ModelCatalog
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
    return ModelCatalog._candidate_id(method), target


def _package(tmp_path, real_run, count=1):
    from jit_baseline.model_packages import export_model_package
    catalog = _catalog(tmp_path, "source")
    methods = list(ALGORITHMS)[:count]
    registered = []
    for method in methods:
        candidate_id, _ = _add_run(real_run, catalog.root, method)
        registered.append(catalog.register_key(method)["model"])
    output = tmp_path / "release" / "models.zip"
    exported = export_model_package(
        catalog,
        [item["modelId"] for item in registered],
        output,
    )
    return catalog, exported, output, registered


def _rewrite_zip(source, target, replacements):
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(target, "w") as changed:
        for info in original.infolist():
            changed.writestr(info, replacements.get(info.filename, original.read(info.filename)))


def _manifest(archive):
    with zipfile.ZipFile(archive) as bundle:
        return json.loads(bundle.read("model-package.json"))


def test_package_format_is_stable_and_unknown_version_is_rejected(tmp_path, real_run):
    from jit_baseline.model_packages import inspect_model_package
    _, exported, archive, registered = _package(tmp_path, real_run)
    inspected = inspect_model_package(archive)
    assert inspected["packageVersion"] == 1
    assert inspected["modelCount"] == 1
    assert inspected["fileCount"] == 9
    assert inspected["uncompressedBytes"] == exported["uncompressedBytes"]
    assert exported["checksumPath"] == str(archive.with_name(archive.name + ".sha256"))
    manifest = _manifest(archive)
    assert set(manifest) == {"kind", "packageVersion", "createdUtc", "models"}
    item = manifest["models"][0]
    assert set(item) == {
        "sourceModelId", "sourceRunId", "artifactRunId", "artifactKey", "method",
        "schema", "datasetVersion", "model", "metricSet", "compatibility",
        "compatibilityReason", "dependencies", "manifestSha256", "packagePath", "files",
    }
    assert item["sourceModelId"] == registered[0]["modelId"]
    assert item["artifactRunId"] == registered[0]["artifactRunId"]

    manifest["packageVersion"] = 99
    changed = tmp_path / "future.zip"
    with zipfile.ZipFile(archive) as original, zipfile.ZipFile(changed, "w") as target:
        for info in original.infolist():
            data = (json.dumps(manifest).encode("utf-8")
                    if info.filename == "model-package.json" else original.read(info.filename))
            target.writestr(info, data)
    from jit_baseline.errors import BaselineError
    with pytest.raises(BaselineError) as error:
        inspect_model_package(changed)
    assert error.value.code == "PACKAGE_VERSION_UNSUPPORTED"


def test_exports_only_selected_registered_models_and_records_checksum(tmp_path, real_run):
    from jit_baseline.model_packages import inspect_model_package
    catalog, exported, archive, registered = _package(
        tmp_path, real_run, count=len(ALGORITHMS),
    )
    inspected = inspect_model_package(archive)
    assert inspected["modelCount"] == 9
    assert inspected["packageName"] == "models.zip"
    assert exported["modelCount"] == 9
    assert exported["packageBytes"] == archive.stat().st_size
    assert archive.with_name(archive.name + ".sha256").read_text(encoding="ascii").split()[0] == exported["packageSha256"]
    manifest = _manifest(archive)
    assert [item["method"] for item in manifest["models"]] == list(ALGORITHMS)
    assert [item["sourceModelId"] for item in manifest["models"]] == [
        item["modelId"] for item in registered
    ]
    serialized = json.dumps(manifest)
    assert "catalog.sqlite3" not in serialized
    assert '"enabled"' not in serialized
    assert '"isDefault"' not in serialized
    assert catalog.default_model_id() == registered[0]["modelId"]


def test_export_failure_does_not_leave_a_publishable_package(tmp_path, real_run, monkeypatch):
    from jit_baseline.model_packages import export_model_package
    catalog = _catalog(tmp_path, "source")
    _add_run(real_run, catalog.root, list(ALGORITHMS)[0])
    model = catalog.register_key(list(ALGORITHMS)[0])["model"]
    output = tmp_path / "release" / "failed.zip"
    original_write_text = Path.write_text

    def fail_sidecar(path, data, *args, **kwargs):
        if path.name.startswith(".failed.zip.sha256."):
            raise OSError("sidecar unavailable")
        return original_write_text(path, data, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", fail_sidecar)
    with pytest.raises(OSError, match="sidecar unavailable"):
        export_model_package(catalog, [model["modelId"]], output)
    assert not output.exists()
    assert not output.with_name(output.name + ".sha256").exists()
    assert not list(output.parent.glob(".failed.zip.*.tmp"))


@pytest.mark.parametrize("unsafe", ["traversal", "hidden", "symlink", "duplicate", "encrypted"])
def test_archive_control_entries_are_rejected(tmp_path, real_run, unsafe):
    from jit_baseline.model_packages import inspect_model_package
    _, _, archive, _ = _package(tmp_path, real_run)
    changed = tmp_path / f"{unsafe}.zip"
    with zipfile.ZipFile(archive) as original, zipfile.ZipFile(changed, "w") as target:
        for info in original.infolist():
            target.writestr(info, original.read(info.filename))
        if unsafe == "traversal":
            target.writestr("models/000/../outside", b"x")
        elif unsafe == "hidden":
            target.writestr("models/000/.control", b"x")
        elif unsafe == "symlink":
            info = zipfile.ZipInfo("models/000/link")
            info.external_attr = 0o120777 << 16
            target.writestr(info, "target")
        elif unsafe == "duplicate":
            target.writestr("models/000/model.joblib", b"duplicate")
        else:
            info = zipfile.ZipInfo("models/000/encrypted")
            info.flag_bits |= 0x1
            target.writestr(info, b"encrypted")
    from jit_baseline.errors import BaselineError
    with pytest.raises(BaselineError) as error:
        inspect_model_package(changed)
    assert error.value.code == "PACKAGE_INVALID"


def test_archive_limits_and_file_tampering_are_rejected(tmp_path, real_run, monkeypatch):
    import jit_baseline.model_packages as packages
    _, _, archive, _ = _package(tmp_path, real_run)
    from jit_baseline.errors import BaselineError

    monkeypatch.setattr(packages, "MAX_FILE_BYTES", 10)
    with pytest.raises(BaselineError):
        packages.inspect_model_package(archive)
    monkeypatch.setattr(packages, "MAX_FILE_BYTES", 1024 * 1024 * 1024)
    monkeypatch.setattr(packages, "MAX_PACKAGE_ENTRIES", 2)
    with pytest.raises(BaselineError):
        packages.inspect_model_package(archive)
    monkeypatch.setattr(packages, "MAX_PACKAGE_ENTRIES", 10_000)
    monkeypatch.setattr(packages, "MAX_EXPANDED_BYTES", 20)
    with pytest.raises(BaselineError):
        packages.inspect_model_package(archive)
    monkeypatch.setattr(packages, "MAX_EXPANDED_BYTES", 4 * 1024 * 1024 * 1024)

    tampered = tmp_path / "tampered.zip"
    _rewrite_zip(archive, tampered, {"models/000/model.joblib": b"tampered"})
    with pytest.raises(BaselineError) as error:
        packages.inspect_model_package(tampered)
    assert "校验失败" in str(error.value)


def test_empty_catalog_import_is_idempotent_and_does_not_copy_policy(tmp_path, real_run):
    from jit_baseline.model_packages import import_model_package
    source, _, archive, registered = _package(tmp_path, real_run, count=2)
    second_id = registered[1]["modelId"]
    source.update_policy(second_id, {"enabled": False})

    target = _catalog(tmp_path, "target")
    first = import_model_package(target, archive)
    assert first["status"] == "completed"
    assert first["registeredCount"] == 2
    models = target.models()
    assert {item["modelId"] for item in models} == {item["modelId"] for item in registered}
    assert all(item["enabled"] for item in models)
    assert target.default_model_id() == registered[0]["modelId"]

    second = import_model_package(target, archive)
    assert second["status"] == "completed"
    assert second["alreadyRegisteredCount"] == 2
    assert {item["modelId"] for item in target.models()} == {
        item["modelId"] for item in registered
    }
    assert sum(item["isDefault"] for item in target.models()) == 1


def test_concurrent_import_has_one_model_identity_and_default(tmp_path, real_run):
    from jit_baseline.model_packages import import_model_package
    _, _, archive, registered = _package(tmp_path, real_run, count=3)
    target = _catalog(tmp_path, "target")
    barrier = threading.Barrier(2)

    def run():
        barrier.wait()
        return import_model_package(target, archive)

    results = []
    threads = [threading.Thread(target=lambda: results.append(run())) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(results) == 2
    assert {item["status"] for result in results for item in result["items"]} <= {
        "registered", "reused", "already-registered",
    }
    models = target.models()
    assert {item["modelId"] for item in models} == {item["modelId"] for item in registered}
    assert sum(item["isDefault"] for item in models) == 1


def test_bad_model_is_reported_without_blocking_other_items(tmp_path, real_run, monkeypatch):
    from jit_baseline.catalog import ModelCatalog
    from jit_baseline.errors import BaselineError
    from jit_baseline.model_packages import import_model_package
    _, _, archive, _ = _package(tmp_path, real_run, count=2)
    target = _catalog(tmp_path, "target")
    failing = ModelCatalog._candidate_id(list(ALGORITHMS)[1])
    original = target.register

    def register(candidate_id, expected_hash, **kwargs):
        if candidate_id == failing:
            raise BaselineError("MODEL_INVALID", "注入的模型加载失败")
        return original(candidate_id, expected_hash, **kwargs)

    monkeypatch.setattr(target, "register", register)
    result = import_model_package(target, archive)
    assert result["status"] == "partial"
    assert result["registeredCount"] == 1
    assert result["failedCount"] == 1
    assert [item["status"] for item in result["items"]] == ["registered", "failed"]
    assert len(target.models()) == 1


def test_missing_runtime_dependency_fails_the_package_item(tmp_path, real_run, monkeypatch):
    from jit_baseline.model_packages import import_model_package

    _, _, archive, _ = _package(tmp_path, real_run)
    target = _catalog(tmp_path, "target")

    def missing_dependency(*args, **kwargs):
        raise ModuleNotFoundError("No module named 'missing_model_package'")

    monkeypatch.setattr("joblib.load", missing_dependency)
    result = import_model_package(target, archive)
    assert result["status"] == "failed"
    assert result["items"][0]["status"] == "failed"
    assert result["items"][0]["code"] == "MODEL_DEPENDENCY_UNAVAILABLE"
    assert target.models() == []


def test_corrupt_model_item_fails_without_publishing_other_items(tmp_path, real_run):
    from jit_baseline.model_packages import import_model_package, inspect_model_package
    from jit_baseline.data import sha256
    _, _, archive, _ = _package(tmp_path, real_run, count=2)
    manifest = _manifest(archive)
    bad = manifest["models"][1]
    model_file = next(entry for entry in bad["files"] if entry["path"] == "model.joblib")
    corrupt = b"corrupt-model-bytes"
    model_file["sha256"] = sha256(corrupt)
    model_file["size"] = len(corrupt)
    changed = tmp_path / "corrupt-item.zip"
    bad_archive_path = f"{bad['packagePath']}/model.joblib"
    with zipfile.ZipFile(archive) as original, zipfile.ZipFile(changed, "w") as target:
        for info in original.infolist():
            data = (json.dumps(manifest).encode("utf-8")
                    if info.filename == "model-package.json"
                    else corrupt if info.filename == bad_archive_path
                    else original.read(info.filename))
            target.writestr(info, data)
    inspect_model_package(changed)
    target = _catalog(tmp_path, "target")
    result = import_model_package(target, changed)
    assert result["status"] == "partial"
    assert [item["status"] for item in result["items"]] == ["registered", "failed"]
    assert result["items"][1]["code"] in {"INTEGRITY_ERROR", "ARTIFACT_INVALID"}
    assert not (target.root / list(ALGORITHMS)[1]).exists()
    assert target.store.latest_model_package_import()["failedCount"] == 1


def test_existing_run_with_different_location_is_a_conflict_and_keeps_preferred_location(tmp_path, real_run):
    from jit_baseline.model_packages import import_model_package
    _, _, archive, registered = _package(tmp_path, real_run, count=2)
    target = _catalog(tmp_path, "target")
    import_model_package(target, archive)
    before = target._row(registered[0]["modelId"])["relative_key"]
    manifest = _manifest(archive)
    manifest["models"][0]["artifactKey"] = manifest["models"][1]["artifactKey"]
    changed = tmp_path / "conflict.zip"
    with zipfile.ZipFile(archive) as original, zipfile.ZipFile(changed, "w") as output:
        for info in original.infolist():
            data = (json.dumps(manifest).encode("utf-8")
                    if info.filename == "model-package.json" else original.read(info.filename))
            output.writestr(info, data)
    result = import_model_package(target, changed)
    assert result["items"][0]["status"] == "conflict"
    assert result["items"][0]["code"] == "CONTEXT_MISMATCH"
    assert target._row(registered[0]["modelId"])["relative_key"] == before


def test_package_metadata_must_match_the_embedded_manifest(tmp_path, real_run):
    from jit_baseline.model_packages import inspect_model_package
    from jit_baseline.errors import BaselineError
    _, _, archive, _ = _package(tmp_path, real_run)
    manifest = _manifest(archive)
    manifest["models"][0]["artifactRunId"] = "a" * 64
    changed = tmp_path / "confused.zip"
    with zipfile.ZipFile(archive) as original, zipfile.ZipFile(changed, "w") as target:
        for info in original.infolist():
            data = (json.dumps(manifest).encode("utf-8")
                    if info.filename == "model-package.json" else original.read(info.filename))
            target.writestr(info, data)
    with pytest.raises(BaselineError) as error:
        inspect_model_package(changed)
    assert error.value.code == "PACKAGE_INVALID"
