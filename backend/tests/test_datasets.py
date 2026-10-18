"""数据集描述文件的登记、校验与加载（DSR-01..DSR-07）。"""
import json

import pytest

from jit_baseline import datasets
from jit_baseline.config import BACKEND, SOURCES
from jit_baseline.errors import BaselineError

CSV = BACKEND / "data/openstack/openstack.csv"


@pytest.fixture(scope="module")
def manifest():
    if not CSV.exists():
        pytest.skip("原始数据集未取得，先按 DATA.md 取得 openstack.csv")
    return datasets.build_manifest(CSV)


def test_build_manifest_records_real_source_facts(manifest):
    assert manifest["dataset"] == "openstack-six-v1"
    assert manifest["version"] == "openstack-six-v1-2011-11-29_2014-02-28"
    assert manifest["file"]["sha256"] == SOURCES["openstack.csv"]["sha256"]
    assert manifest["quality"]["includedRows"] == 12374
    assert manifest["quality"]["positiveLabels"] == 1616
    assert set(manifest["quality"]["featureMissing"]) == {"la", "ld", "nf", "nd", "ns", "ent"}
    assert datasets.validate_manifest(manifest) is manifest


def test_registered_manifest_equals_rebuilt_facts(manifest):
    path = BACKEND / SOURCES["openstack.csv"]["datasetManifest"]
    assert datasets.load_manifest(path) == manifest


def test_register_is_idempotent_and_refuses_different_content(manifest, tmp_path):
    first = datasets.register(CSV, root=tmp_path)
    assert first["created"] is True
    assert first["version"] == manifest["version"]
    again = datasets.register(CSV, root=tmp_path)
    assert again["created"] is False
    assert again["sha256"] == first["sha256"]
    target = tmp_path / manifest["dataset"] / (manifest["version"] + ".json")
    target.write_text('{"schema": 1}', encoding="utf-8")
    with pytest.raises(BaselineError) as error:
        datasets.register(CSV, root=tmp_path)
    assert error.value.code == "DATASET_EXISTS"


def test_version_name_must_match_dataset_and_range(manifest):
    with pytest.raises(BaselineError) as error:
        datasets.build_manifest(CSV, version="other-2011-11-29_2014-02-28")
    assert error.value.code == "DATASET_INVALID"
    with pytest.raises(BaselineError) as error:
        datasets.build_manifest(CSV, version=manifest["dataset"] + "-2012-01-01_2014-02-28")
    assert error.value.code == "DATASET_INVALID"


def test_validate_rejects_missing_or_inconsistent_content(manifest):
    def drop_quality(value):
        value.pop("quality")

    def unknown_schema(value):
        value["schemaName"] = "unknown-v9"

    def renamed_field(value):
        value["fields"][0]["name"] = "renamed"

    def partial_missing(value):
        value["quality"]["featureMissing"] = {"la": 0}

    def shifted_range(value):
        value["timeRange"]["start"] = "2012-01-01T00:00:00Z"

    for mutate in (drop_quality, unknown_schema, renamed_field, partial_missing, shifted_range):
        broken = json.loads(json.dumps(manifest))
        mutate(broken)
        with pytest.raises(BaselineError) as error:
            datasets.validate_manifest(broken)
        assert error.value.code == "DATASET_INVALID"


def test_load_all_requires_registry_and_rejects_duplicate_versions(manifest, tmp_path):
    with pytest.raises(BaselineError) as error:
        datasets.load_all(tmp_path)
    assert error.value.code == "DATASET_REGISTRY_EMPTY"
    first = datasets.register(CSV, root=tmp_path)
    registered = datasets.load_all(tmp_path)
    assert set(registered) == {manifest["version"]}
    assert registered[manifest["version"]]["manifestPath"] == first["path"]
    copied = tmp_path / "copy" / (manifest["version"] + ".json")
    copied.parent.mkdir(parents=True)
    copied.write_text((tmp_path / manifest["dataset"] / (manifest["version"] + ".json"))
                      .read_text(encoding="utf-8"), encoding="utf-8")
    with pytest.raises(BaselineError) as error:
        datasets.load_all(tmp_path)
    assert error.value.code == "DATASET_INVALID"
