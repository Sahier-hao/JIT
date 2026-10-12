"""Small synthetic contract tests, not published-data model results."""
import csv
import io

import pytest


def csv_bytes(rows):
    stream = io.StringIO()
    fields = ["commit_id", "author_date", "bugcount", "fixcount", "ns", "nd", "nf", "ent", "la", "ld", "rexp"]
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode()


def row(**overrides):
    return {"commit_id": "a" * 40, "author_date": "1350000000", "bugcount": "",
            "fixcount": "9", "ns": "1", "nd": "2", "nf": "3", "ent": "0.7",
            "la": "4", "ld": "5", "rexp": "999", **overrides}


def test_published_blank_label_is_not_observed_and_features_are_allowlisted():
    from jit_baseline.data import parse_source
    records, quality = parse_source(csv_bytes([row()]))
    assert records[0]["features"] == [1, 2, 3, 0.7, 4, 5]
    assert records[0]["label"] == 0
    assert records[0]["sourceRow"] == 2
    assert records[0]["time"].endswith("Z")
    assert "fixcount" not in records[0]["metrics"]
    assert quality["blankLabels"] == 1


@pytest.mark.parametrize("label,expected", [("0", 0), ("1", 1), ("29", 1)])
def test_label_counts_are_binary_observations(label, expected):
    from jit_baseline.data import parse_source
    records, _ = parse_source(csv_bytes([row(bugcount=label)]))
    assert records[0]["label"] == expected


@pytest.mark.parametrize("patch", [
    {"commit_id": ""}, {"commit_id": "not-a-sha"}, {"author_date": "invalid"},
    {"author_date": "1350000000.5"}, {"la": ""}, {"la": "nan"},
    {"ent": "inf"}, {"ld": "-1"}, {"nf": "1.5"}, {"bugcount": "-1"},
    {"bugcount": "unexpected"}, {"bugcount": "1.5"},
])
def test_invalid_required_data_fails_without_dropping_a_row(patch):
    from jit_baseline.data import parse_source
    with pytest.raises(ValueError, match="行"):
        parse_source(csv_bytes([row(**patch)]))


def test_duplicate_identity_is_rejected_even_outside_the_cohort():
    from jit_baseline.data import parse_source
    with pytest.raises(ValueError, match="重复"):
        parse_source(csv_bytes([row(), row(author_date="1")]))


@pytest.mark.parametrize("patch,reason", [
    ({"author_date": "1322599383"}, "outsideWindow"),
    ({"author_date": "1393590700"}, "outsideWindow"),
    ({"la": "0"}, "noAddedLines"),
    ({"la": "9996", "ld": "5"}, "tooMuchChurn"),
    ({"nf": "101"}, "tooManyFiles"),
])
def test_fixed_cohort_exclusions_are_counted(patch, reason):
    from jit_baseline.data import parse_source
    records, quality = parse_source(csv_bytes([row(**patch)]))
    assert records == []
    assert quality["excluded"][reason] == 1
    assert quality["rawRows"] == 1


def test_inclusive_start_and_churn_file_limits():
    from jit_baseline.data import parse_source
    records, _ = parse_source(csv_bytes([row(author_date="1322599384", la="9995", ld="5", nf="100")]))
    assert len(records) == 1


def test_verified_read_rejects_hash_mismatch(tmp_path):
    from jit_baseline.data import verified_bytes
    path = tmp_path / "source.csv"
    path.write_bytes(b"changed")
    with pytest.raises(ValueError, match="校验"):
        verified_bytes(path, "0" * 64)


def test_missing_source_is_a_specific_failure(tmp_path):
    from jit_baseline.data import verified_bytes
    with pytest.raises(ValueError, match="不可用"):
        verified_bytes(tmp_path / "missing.csv", "0" * 64)


def test_download_failure_cannot_create_a_source(tmp_path):
    from jit_baseline.data import fetch_sources
    def unavailable(*args, **kwargs):
        raise OSError("offline")
    with pytest.raises(ValueError, match="来源不可用"):
        fetch_sources(tmp_path, opener=unavailable)
    assert not list(tmp_path.glob("*.csv"))
