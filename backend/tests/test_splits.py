"""Registered split presets, previews and run-lineage identity."""
import csv
import io

import pytest

from jit_baseline import datasets
from jit_baseline.config import BACKEND
from jit_baseline.data import BaselineError
from jit_baseline.splits import PRESETS, preset_view, resolve_split, split_records


def records(count=100, groups=None):
    groups = groups or count
    return [
        {
            "id": f"{index:040x}",
            "epoch": 1_350_000_000 + index * 3600,
            "time": f"2020-01-01T00:{index % 60:02d}:00Z",
            "label": index % 2,
        }
        for index in range(count)
    ]


def _csv_bytes(count=100, labels=None):
    stream = io.StringIO()
    fields = ["commit_id", "author_date", "bugcount", "fixcount", "ns", "nd", "nf",
              "ent", "la", "ld", "rexp"]
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    for index, record in enumerate(records(count)):
        label = labels[index] if labels is not None else record["label"]
        writer.writerow({
            "commit_id": record["id"], "author_date": str(record["epoch"]),
            "bugcount": str(label), "fixcount": "0", "ns": "1", "nd": "1",
            "nf": "1", "ent": "0.5", "la": str(index + 1), "ld": "1",
            "rexp": str(index + 1),
        })
    return stream.getvalue().encode()


@pytest.mark.parametrize("preset", PRESETS)
def test_presets_keep_timestamp_groups_intact(preset):
    values = records()
    values[70]["epoch"] = values[69]["epoch"]
    split, boundaries, policy = split_records(values, preset)
    times = [set(record["epoch"] for record in split[name])
             for name in ("train", "validation", "test")]
    assert all(not times[left] & times[right]
               for left in range(3) for right in range(left + 1, 3))
    assert max(times[0]) < min(times[1]) < max(times[1]) < min(times[2])
    assert policy["id"] == preset
    assert policy["timezone"] == "UTC"
    assert policy["boundaries"][0]["epoch"] == boundaries[0]
    assert sum(part["records"] for part in policy["partitionCounts"].values()) == 100


def test_omitted_split_is_the_existing_default_and_switching_changes_identity():
    values = records()
    default_split, _, default = split_records(values)
    explicit_split, _, explicit = split_records(values, "temporal-70-15-15")
    alternate_split, _, alternate = split_records(values, "temporal-80-10-10")
    assert [[record["id"] for record in default_split[name]] for name in default_split] == [
        [record["id"] for record in explicit_split[name]] for name in explicit_split]
    assert default == explicit
    assert alternate["memberSha256"] != default["memberSha256"]
    assert alternate["boundaries"] != default["boundaries"]


def test_custom_integer_ratios_are_canonical_and_keep_time_groups_intact():
    values = records()
    values[70]["epoch"] = values[69]["epoch"]
    split_id = resolve_split(ratios={"train": 65, "validation": 20, "test": 15})
    split, _, policy = split_records(values, split_id)
    assert split_id == "temporal-custom-65-20-15"
    assert preset_view(split_id)["kind"] == "custom"
    assert policy["ratios"] == {"train": 65, "validation": 20, "test": 15}
    times = [set(record["epoch"] for record in split[name])
             for name in ("train", "validation", "test")]
    assert all(not times[left] & times[right]
               for left in range(3) for right in range(left + 1, 3))
    assert sum(part["records"] for part in policy["partitionCounts"].values()) == 100


@pytest.mark.parametrize("ratios", [
    {"train": 70, "validation": 20, "test": 20},
    {"train": 70.5, "validation": 14.5, "test": 15},
    {"train": 100, "validation": 0, "test": 0},
    {"train": 70, "validation": 15},
])
def test_custom_ratios_reject_invalid_values(ratios):
    with pytest.raises(BaselineError) as error:
        resolve_split(ratios=ratios)
    assert error.value.code == "SPLIT_POLICY_INVALID"


def test_conflicting_preset_and_ratio_policy_is_rejected():
    with pytest.raises(BaselineError) as error:
        resolve_split("temporal-70-15-15", {"train": 70, "validation": 15, "test": 15})
    assert error.value.code == "SPLIT_POLICY_INVALID"


@pytest.mark.parametrize("value", ["random", {"start": "2020-01-01"}, "temporal-33-33-34"])
def test_unregistered_split_rules_are_rejected(value):
    with pytest.raises(BaselineError) as error:
        split_records(records(), value)
    assert error.value.code == "SPLIT_POLICY_INVALID"


def test_split_diagnostics_can_explain_single_class_partitions():
    values = records()
    for index, record in enumerate(values):
        record["label"] = 1 if index >= 80 else 0
    split, _, _ = split_records(values, "temporal-70-15-15", require_classes=False)
    assert {record["label"] for record in split["train"]} == {0}
    assert {record["label"] for record in split["test"]} == {1}
    with pytest.raises(BaselineError) as error:
        split_records(values, "temporal-70-15-15")
    assert error.value.code == "SPLIT_INVALID"


def test_split_preview_is_read_only_and_reports_partition_details(tmp_path):
    from jit_baseline.split_preview import dataset_split_preview

    source = tmp_path / "source.csv"
    source.write_bytes(_csv_bytes())
    registry = tmp_path / "datasets"
    registered = datasets.register(
        source, schema="openstack-six-v1", dataset="preview", root=registry,
        provenance={"publisher": "fixture", "revision": "a" * 40,
                    "url": "https://github.com/example/preview"},
    )
    before = sorted(path.relative_to(registry).as_posix() for path in registry.rglob("*"))
    preview = dataset_split_preview(registry, registered["version"], "temporal-60-20-20")
    after = sorted(path.relative_to(registry).as_posix() for path in registry.rglob("*"))
    assert preview["available"] is True
    assert preview["preset"]["id"] == "temporal-60-20-20"
    assert preview["preset"]["kind"] == "preset"
    assert set(preview["partitions"]) == {"train", "validation", "test"}
    assert all(part["records"] > 0 for part in preview["partitions"].values())
    assert len(preview["policy"]["memberSha256"]) == 64
    assert before == after


def test_custom_split_preview_and_execution_share_the_same_member_digest(tmp_path):
    from jit_baseline.split_preview import dataset_split_preview
    from jit_baseline.splits import membership_digest, split_records

    source = tmp_path / "source.csv"
    source.write_bytes(_csv_bytes())
    registry = tmp_path / "datasets"
    registered = datasets.register(
        source, schema="openstack-six-v1", dataset="custom-preview", root=registry,
        provenance={"publisher": "fixture", "revision": "b" * 40,
                    "url": "https://github.com/example/custom-preview"},
    )
    ratios = {"train": 65, "validation": 20, "test": 15}
    preview = dataset_split_preview(registry, registered["version"], ratios=ratios)
    split, _, execution = split_records(records(), "temporal-custom-65-20-15")
    assert preview["available"] is True
    assert preview["preset"]["id"] == "temporal-custom-65-20-15"
    assert preview["policy"]["memberSha256"] == membership_digest({
        name: {"ids": [record["id"] for record in split[name]]}
        for name in ("train", "validation", "test")
    })


def test_split_preview_rejects_partitions_without_both_labels(tmp_path):
    from jit_baseline.split_preview import dataset_split_preview

    source = tmp_path / "single-class.csv"
    source.write_bytes(_csv_bytes(labels=[0] * 100))
    registry = tmp_path / "datasets"
    registered = datasets.register(
        source, schema="openstack-six-v1", dataset="single-class", root=registry,
        provenance={"publisher": "fixture", "revision": "c" * 40,
                    "url": "https://github.com/example/single-class"},
    )
    preview = dataset_split_preview(registry, registered["version"])
    assert preview["available"] is False
    assert preview["reason"]["code"] == "SPLIT_INVALID"
    assert set(preview["partitions"]) == {"train", "validation", "test"}


def test_split_preview_api_rejects_unknown_preset_without_creating_a_task(tmp_path):
    from fastapi.testclient import TestClient
    from jit_baseline.api import create_app
    from jit_baseline.catalog_storage import CatalogStorage

    database = CatalogStorage(tmp_path / "catalog.sqlite3")
    database.initialize()
    registry = BACKEND / "data" / "datasets"
    dataset_version = datasets.load_all(registry)[
        "openstack-six-v1-2011-11-29_2014-02-28"]["version"]
    app = create_app(database=database.path, artifact_root=tmp_path / "artifacts",
                     dataset_root=registry)
    with TestClient(app) as client:
        credentials = {"username": "admin", "password": "split-preview-password"}
        assert client.post("/api/admin/setup", json=credentials).status_code == 201
        ok = client.get(
            f"/api/admin/datasets/{dataset_version}/split-preview",
            params={"preset": "temporal-80-10-10"},
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["available"] is True
        custom = client.get(
            f"/api/admin/datasets/{dataset_version}/split-preview",
            params={"train": 65, "validation": 20, "test": 15},
        )
        assert custom.status_code == 200, custom.text
        assert custom.json()["preset"]["id"] == "temporal-custom-65-20-15"
        partial = client.get(
            f"/api/admin/datasets/{dataset_version}/split-preview",
            params={"train": 65, "validation": 20},
        )
        assert partial.status_code == 422
        assert partial.json()["error"]["code"] == "SPLIT_POLICY_INVALID"
        rejected = client.get(
            f"/api/admin/datasets/{dataset_version}/split-preview",
            params={"preset": "random"},
        )
        assert rejected.status_code == 422
        assert rejected.json()["error"]["code"] == "SPLIT_POLICY_INVALID"
        with database.connection() as db:
            assert db.execute("SELECT COUNT(*) FROM training_task").fetchone()[0] == 0
