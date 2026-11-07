"""Registered split presets, previews and run-lineage identity."""
import csv
import io

import pytest

from jit_baseline import datasets
from jit_baseline.config import BACKEND
from jit_baseline.data import BaselineError
from jit_baseline.splits import PRESETS, split_records


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


def _csv_bytes(count=100):
    stream = io.StringIO()
    fields = ["commit_id", "author_date", "bugcount", "fixcount", "ns", "nd", "nf",
              "ent", "la", "ld", "rexp"]
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    for index, record in enumerate(records(count)):
        writer.writerow({
            "commit_id": record["id"], "author_date": str(record["epoch"]),
            "bugcount": str(record["label"]), "fixcount": "0", "ns": "1", "nd": "1",
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


@pytest.mark.parametrize("value", ["random", {"start": "2020-01-01"}, "temporal-50-25-25"])
def test_unregistered_split_rules_are_rejected(value):
    with pytest.raises(BaselineError) as error:
        split_records(records(), value)
    assert error.value.code == "SPLIT_POLICY_INVALID"


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
    assert set(preview["partitions"]) == {"train", "validation", "test"}
    assert all(part["records"] > 0 for part in preview["partitions"].values())
    assert before == after


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
        rejected = client.get(
            f"/api/admin/datasets/{dataset_version}/split-preview",
            params={"preset": "random"},
        )
        assert rejected.status_code == 422
        assert rejected.json()["error"]["code"] == "SPLIT_POLICY_INVALID"
        with database.connection() as db:
            assert db.execute("SELECT COUNT(*) FROM training_task").fetchone()[0] == 0
