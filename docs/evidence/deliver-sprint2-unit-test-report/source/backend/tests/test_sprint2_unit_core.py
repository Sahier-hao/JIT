"""Sprint2 快速单元层：后端核心纯逻辑的正常、边界与异常场景。

本文件只使用合成输入。它不连接网络、正式数据库、模型包或私有数据。
"""
import csv
import hashlib
import io

import pytest

import jit_baseline.data as data_module
from jit_baseline.algorithms import (
    check_method,
    get_algorithm,
    method_catalog,
    method_missing_dependencies,
    model_descriptor,
    param_specs,
    params_display,
    resolve_algorithm,
    resolve_params,
    validate_declared_params,
)
from jit_baseline.data import BaselineError, integer, parse_source, sha256, verified_bytes
from jit_baseline.metrics import classification, evaluate, get_metric_set
from jit_baseline.splits import (
    policy_for_partitions,
    preset_view,
    resolve_preset,
    rule_text,
    split_records,
)


def _csv_bytes(rows):
    fields = [
        "commit_id", "author_date", "bugcount", "fixcount", "ns", "nd", "nf",
        "ent", "la", "ld", "rexp",
    ]
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode()


def _row(**overrides):
    return {
        "commit_id": "a" * 40,
        "author_date": "1350000000",
        "bugcount": "",
        "fixcount": "9",
        "ns": "1",
        "nd": "2",
        "nf": "3",
        "ent": "0.7",
        "la": "4",
        "ld": "5",
        "rexp": "999",
        **overrides,
    }


def _records(count=100):
    return [
        {
            "id": f"{index:040x}",
            "epoch": 1_350_000_000 + index * 3600,
            "time": f"2020-01-01T00:{index % 60:02d}:00Z",
            "label": index % 2,
            "metrics": {"la": 1, "ld": 0},
        }
        for index in range(count)
    ]


def _metric_records(costs=(1, 1, 4, 4), labels=(1, 0, 1, 0)):
    return [
        {"id": f"{index:040x}", "epoch": index, "label": label,
         "metrics": {"la": cost, "ld": 0}}
        for index, (cost, label) in enumerate(zip(costs, labels, strict=True))
    ]


def _partitioned_records():
    result = {}
    for offset, name in enumerate(("train", "validation", "test")):
        result[name] = [
            {
                "id": f"{offset * 2 + index:040x}",
                "epoch": 1_350_000_000 + offset * 2 + index,
                "time": f"2020-01-0{offset + 1}T00:00:0{index}Z",
                "label": index,
            }
            for index in range(2)
        ]
    return result


def _response(blob):
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self, _limit):
            return blob

    return Response()


# [AI生成]
def test_sha256_normal_returns_lowercase_digest():
    assert sha256(b"abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


# [AI生成]
def test_sha256_boundary_hashes_empty_bytes():
    assert sha256(b"") == hashlib.sha256(b"").hexdigest()


# [AI生成]
def test_sha256_error_rejects_text_input():
    with pytest.raises(TypeError):
        sha256("abc")


# [AI生成]
def test_integer_normal_parses_decimal_text():
    assert integer("42", "la", 2) == 42


# [AI生成]
def test_integer_boundary_accepts_zero():
    assert integer("0", "la", 2) == 0


# [AI生成]
def test_integer_error_rejects_signed_or_fractional_values():
    with pytest.raises(BaselineError) as error:
        integer("-1", "la", 2)
    assert error.value.code == "DATA_INVALID"


# [AI生成]
def test_parse_source_normal_returns_allowlisted_features_and_label():
    records, quality = parse_source(_csv_bytes([_row()]))
    assert records[0]["features"] == [1, 2, 3, 0.7, 4, 5]
    assert records[0]["label"] == 0
    assert quality["blankLabels"] == 1


# [AI生成]
def test_parse_source_boundary_uses_inclusive_cohort_limits():
    records, quality = parse_source(
        _csv_bytes([_row(author_date="1322599384", la="9995", ld="5", nf="100")])
    )
    assert len(records) == 1
    assert quality["excluded"] == {
        "outsideWindow": 0,
        "noAddedLines": 0,
        "tooMuchChurn": 0,
        "tooManyFiles": 0,
        "missingRequiredField": 0,
    }


# [AI生成]
def test_parse_source_error_rejects_invalid_commit_identity():
    with pytest.raises(BaselineError) as error:
        parse_source(_csv_bytes([_row(commit_id="not-a-sha")]))
    assert error.value.code == "DATA_INVALID"


# [AI生成]
def test_verified_bytes_normal_returns_verified_payload(tmp_path):
    blob = b"verified"
    path = tmp_path / "source.csv"
    path.write_bytes(blob)
    assert verified_bytes(path, sha256(blob)) == blob


# [AI生成]
def test_verified_bytes_boundary_accepts_empty_file(tmp_path):
    path = tmp_path / "empty.csv"
    path.write_bytes(b"")
    assert verified_bytes(path, sha256(b"")) == b""


# [AI生成]
def test_verified_bytes_error_rejects_tampered_payload(tmp_path):
    path = tmp_path / "source.csv"
    path.write_bytes(b"changed")
    with pytest.raises(BaselineError) as error:
        verified_bytes(path, "0" * 64)
    assert error.value.code == "INTEGRITY_ERROR"


# [AI生成]
def test_verified_bytes_error_reports_missing_file(tmp_path):
    with pytest.raises(BaselineError) as error:
        verified_bytes(tmp_path / "missing.csv", "0" * 64)
    assert error.value.code == "SOURCE_UNAVAILABLE"


# [AI生成]
def test_fetch_sources_normal_downloads_only_verified_files(monkeypatch, tmp_path):
    payload = b"publisher"
    monkeypatch.setattr(data_module, "BASE_URL", "https://example.test/")
    monkeypatch.setattr(
        data_module,
        "SOURCES",
        {"source.csv": {"path": "data/source.csv", "sha256": sha256(payload)}},
    )
    seen = []

    def opener(url, timeout):
        seen.append((url, timeout))
        return _response(payload)

    summary = data_module.fetch_sources(tmp_path, opener=opener)
    assert seen == [("https://example.test/data/source.csv", 30)]
    assert (tmp_path / "source.csv").read_bytes() == payload
    assert summary["source.csv"]["sha256"] == sha256(payload)


# [AI生成]
def test_fetch_sources_boundary_reuses_verified_local_files(monkeypatch, tmp_path):
    payload = b"local"
    monkeypatch.setattr(
        data_module,
        "SOURCES",
        {"source.csv": {"path": "data/source.csv", "sha256": sha256(payload)}},
    )
    (tmp_path / "source.csv").write_bytes(payload)

    def opener(*_args, **_kwargs):
        raise AssertionError("verified local file must not be downloaded")

    summary = data_module.fetch_sources(tmp_path, opener=opener)
    assert summary["source.csv"]["bytes"] == len(payload)


# [AI生成]
def test_fetch_sources_error_rejects_oversized_payload(monkeypatch, tmp_path):
    payload = b"x" * 6_000_001
    monkeypatch.setattr(data_module, "BASE_URL", "https://example.test/")
    monkeypatch.setattr(
        data_module,
        "SOURCES",
        {"source.csv": {"path": "data/source.csv", "sha256": sha256(payload)}},
    )
    with pytest.raises(BaselineError) as error:
        data_module.fetch_sources(tmp_path, opener=lambda *_args, **_kwargs: _response(payload))
    assert error.value.code == "INTEGRITY_ERROR"
    assert not (tmp_path / "source.csv").exists()


# [AI生成]
def test_fetch_sources_error_reports_unavailable_download(monkeypatch, tmp_path):
    monkeypatch.setattr(
        data_module,
        "SOURCES",
        {"source.csv": {"path": "data/source.csv", "sha256": "0" * 64}},
    )

    def unavailable(*_args, **_kwargs):
        raise OSError("offline")

    with pytest.raises(BaselineError) as error:
        data_module.fetch_sources(tmp_path, opener=unavailable)
    assert error.value.code == "SOURCE_UNAVAILABLE"


# [AI生成]
def test_parse_source_error_rejects_incomplete_header():
    with pytest.raises(BaselineError) as error:
        parse_source(b"commit_id,author_date\n" + b"a" * 40 + b",1350000000\n")
    assert error.value.code == "DATA_INVALID"


# [AI生成]
def test_parse_source_error_requires_all_label_maturity_columns():
    stream = io.StringIO()
    fields = [
        "commit_id", "author_date", "bugcount", "fixcount", "ns", "nd", "nf",
        "ent", "la", "ld", "rexp", "label_status",
    ]
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerow({**_row(), "label_status": "unobserved"})
    with pytest.raises(BaselineError, match="标签成熟字段必须同时提供"):
        parse_source(stream.getvalue().encode())


# [AI生成]
def test_parse_source_error_rejects_duplicate_identity_before_cohort_filter():
    with pytest.raises(BaselineError, match="重复"):
        parse_source(_csv_bytes([_row(), _row(author_date="1")]))


# [AI生成]
def test_parse_source_error_rejects_unrepresentable_timestamp():
    with pytest.raises(BaselineError, match="提交时间无效"):
        parse_source(_csv_bytes([_row(author_date="999999999999999999999")]))


# [AI生成]
def test_parse_source_error_rejects_blank_required_feature():
    with pytest.raises(BaselineError, match="la 缺失或无效"):
        parse_source(_csv_bytes([_row(la="")]))


# [AI生成]
def test_parse_source_error_rejects_non_numeric_feature():
    with pytest.raises(BaselineError, match="ent 缺失或无效"):
        parse_source(_csv_bytes([_row(ent="abc")]))


# [AI生成]
def test_parse_source_error_rejects_negative_feature():
    with pytest.raises(BaselineError, match="ld 数值无效"):
        parse_source(_csv_bytes([_row(ld="-1")]))


# [AI生成]
def test_parse_source_error_rejects_invalid_unicode():
    with pytest.raises(BaselineError, match="编码或结构无效"):
        parse_source(b"\xff")


# [AI生成]
def test_parse_source_boundary_materializes_blank_kamei_binary_feature():
    stream = io.StringIO()
    fields = [
        "commit_id", "author_date", "bugcount", "fixcount", "ns", "nd", "nf",
        "ent", "la", "ld", "rexp", "ndev", "age", "nuc", "aexp", "asexp",
    ]
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerow({
        "commit_id": "b" * 40,
        "author_date": "1350000000",
        "bugcount": "",
        "fixcount": "",
        "ns": "1", "nd": "1", "nf": "1", "ent": "0.5", "la": "4", "ld": "1",
        "rexp": "1", "ndev": "1", "age": "1", "nuc": "1", "aexp": "1", "asexp": "1",
    })
    records, _ = parse_source(stream.getvalue().encode(), schema="kamei14-v1")
    assert records[0]["metrics"]["fix"] == 0


# [AI生成]
def test_parse_source_boundary_records_recomputable_observation_status():
    stream = io.StringIO()
    fields = [
        "commit_id", "author_date", "bugcount", "fixcount", "ns", "nd", "nf",
        "ent", "la", "ld", "rexp", "label_status", "observed_through_epoch",
        "maturity_days",
    ]
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerow({
        **_row(),
        "label_status": "unobserved",
        "observed_through_epoch": str(1_350_000_000 + 90 * 86400),
        "maturity_days": "90",
    })
    records, quality = parse_source(stream.getvalue().encode())
    assert records[0]["labelStatus"] == "unobserved"
    assert quality["labelStatusCounts"]["unobserved"] == 1


# [AI生成]
def test_classification_normal_returns_hand_computed_confusion_and_scores():
    result = classification([1, 0, 1, 0], [True, True, False, False])
    assert result["confusion"] == {"tp": 1, "fp": 1, "tn": 1, "fn": 1}
    assert result["precision"]["value"] == pytest.approx(0.5)
    assert result["recall"]["value"] == pytest.approx(0.5)
    assert result["f1"]["value"] == pytest.approx(0.5)


# [AI生成]
def test_classification_boundary_returns_reasons_without_positive_samples():
    result = classification([], [])
    assert result["confusion"] == {"tp": 0, "fp": 0, "tn": 0, "fn": 0}
    assert result["precision"]["value"] is None
    assert result["precision"]["reason"]
    assert result["recall"]["value"] is None


# [AI生成]
def test_classification_error_rejects_mismatched_lengths():
    with pytest.raises(ValueError):
        classification([1], [False, False])


# [AI生成]
def test_evaluate_normal_returns_declared_metrics():
    result = evaluate(_metric_records(), [0.9, 0.8, 0.2, 0.1])
    assert result["rocAuc"]["value"] == pytest.approx(0.75)
    assert result["averagePrecision"]["value"] == pytest.approx(5 / 6)
    assert result["recall20Loc"]["value"] == pytest.approx(0.5)


# [AI生成]
def test_evaluate_boundary_reports_undefined_auc_for_single_class():
    result = evaluate(_metric_records(labels=(0, 0, 0, 0)), [0.9, 0.8, 0.2, 0.1])
    assert result["rocAuc"]["value"] is None
    assert result["averagePrecision"]["value"] is None
    assert result["rocAuc"]["reason"]


# [AI生成]
def test_evaluate_error_rejects_out_of_range_risk():
    with pytest.raises(BaselineError) as error:
        evaluate(_metric_records(), [0.9, 0.8, 0.2, 1.1])
    assert error.value.code == "EVALUATION_INVALID"


# [AI生成]
def test_get_metric_set_normal_returns_registered_metrics():
    assert "rocAuc" in get_metric_set("metric-set-v2")


# [AI生成]
def test_get_metric_set_boundary_returns_frozen_first_set():
    assert "popt" not in get_metric_set("metric-set-v1")


# [AI生成]
def test_get_metric_set_error_rejects_unknown_name():
    with pytest.raises(BaselineError) as error:
        get_metric_set("metric-set-v9")
    assert error.value.code == "METRIC_SET_UNKNOWN"


# [AI生成]
def test_split_records_normal_keeps_timestamp_groups_and_preserves_members():
    split, boundaries, policy = split_records(_records())
    times = [set(record["epoch"] for record in split[name])
             for name in ("train", "validation", "test")]
    assert all(not times[left] & times[right]
               for left in range(3) for right in range(left + 1, 3))
    assert sum(len(records) for records in split.values()) == 100
    assert len(boundaries) == 2
    assert policy["id"] == "temporal-70-15-15"


# [AI生成]
def test_split_records_boundary_omitted_preset_keeps_default_identity():
    implicit = split_records(_records())
    explicit = split_records(_records(), "temporal-70-15-15")
    assert implicit[2] == explicit[2]


# [AI生成]
def test_split_records_error_rejects_unknown_preset():
    with pytest.raises(BaselineError) as error:
        split_records(_records(), "random")
    assert error.value.code == "SPLIT_POLICY_INVALID"


# [AI生成]
def test_split_records_error_rejects_empty_input():
    with pytest.raises(BaselineError) as error:
        split_records([])
    assert error.value.code == "SPLIT_INVALID"


# [AI生成]
def test_split_records_error_rejects_non_integer_epoch():
    records = _records()
    records[0]["epoch"] = "not-an-epoch"
    with pytest.raises(BaselineError) as error:
        split_records(records)
    assert error.value.code == "SPLIT_INVALID"


# [AI生成]
def test_split_records_error_rejects_too_few_timestamp_groups():
    records = _records(3)
    for index, record in enumerate(records):
        record["epoch"] = 1_350_000_000
        record["label"] = index % 2
    with pytest.raises(BaselineError) as error:
        split_records(records)
    assert error.value.code == "SPLIT_INVALID"


# [AI生成]
def test_split_records_error_rejects_single_class_partition():
    records = _records()
    for record in records:
        record["label"] = 0
    with pytest.raises(BaselineError) as error:
        split_records(records)
    assert error.value.code == "SPLIT_INVALID"


# [AI生成]
def test_resolve_preset_normal_returns_registered_name():
    assert resolve_preset("temporal-60-20-20") == "temporal-60-20-20"


# [AI生成]
def test_resolve_preset_boundary_uses_legacy_default():
    assert resolve_preset() == "temporal-70-15-15"


# [AI生成]
def test_resolve_preset_error_rejects_aliases():
    with pytest.raises(BaselineError) as error:
        resolve_preset("70/15/15")
    assert error.value.code == "SPLIT_POLICY_INVALID"


# [AI生成]
def test_preset_view_normal_returns_frozen_ratios():
    assert preset_view("temporal-80-10-10") == {
        "id": "temporal-80-10-10",
        "ratios": {"train": 80, "validation": 10, "test": 10},
        "timezone": "UTC",
    }


# [AI生成]
def test_preset_view_boundary_default_is_independent_copy():
    first = preset_view()
    second = preset_view()
    first["ratios"]["train"] = 1
    assert second["ratios"]["train"] == 70


# [AI生成]
def test_preset_view_error_rejects_unknown_preset():
    with pytest.raises(BaselineError) as error:
        preset_view("random")
    assert error.value.code == "SPLIT_POLICY_INVALID"


# [AI生成]
def test_policy_for_partitions_normal_reports_project_local_members():
    policy = policy_for_partitions(_partitioned_records(), "temporal-80-10-10")
    assert policy["boundaryMode"] == "project-local"
    assert policy["boundaries"] == []
    assert sum(item["records"] for item in policy["partitionCounts"].values()) == 6


# [AI生成]
def test_policy_for_partitions_boundary_requires_both_labels():
    partitions = _partitioned_records()
    partitions["test"][1]["label"] = 0
    with pytest.raises(BaselineError) as error:
        policy_for_partitions(partitions)
    assert error.value.code == "SPLIT_INVALID"


# [AI生成]
def test_policy_for_partitions_error_rejects_duplicate_members():
    partitions = _partitioned_records()
    partitions["test"][1]["id"] = partitions["train"][0]["id"]
    with pytest.raises(BaselineError, match="重复"):
        policy_for_partitions(partitions)


# [AI生成]
def test_rule_text_normal_describes_selected_preset():
    assert "floor(0.80G)" in rule_text("temporal-80-10-10")


# [AI生成]
def test_rule_text_boundary_uses_default_preset():
    assert "floor(0.70G), floor(0.85G)" in rule_text()


# [AI生成]
def test_rule_text_error_rejects_unknown_preset():
    with pytest.raises(BaselineError) as error:
        rule_text("random")
    assert error.value.code == "SPLIT_POLICY_INVALID"


# [AI生成]
def test_resolve_params_normal_returns_declared_override():
    params, changed = resolve_params("logistic-regression-l2-v1", {"C": 0.5})
    assert params["C"] == 0.5
    assert changed is True


# [AI生成]
def test_resolve_params_boundary_returns_frozen_defaults():
    params, changed = resolve_params("decision-tree-v1")
    assert params == get_algorithm("decision-tree-v1")["params"]
    assert changed is False


# [AI生成]
def test_resolve_params_error_rejects_out_of_range_value():
    with pytest.raises(BaselineError) as error:
        resolve_params("logistic-regression-l2-v1", {"C": 0})
    assert error.value.code == "INPUT_INVALID"


# [AI生成]
def test_param_specs_normal_returns_controlled_parameter_declarations():
    assert set(param_specs("decision-tree-v1")) == {"max_depth", "min_samples_leaf"}


# [AI生成]
def test_param_specs_boundary_returns_empty_for_fixed_method():
    assert param_specs("gaussian-naive-bayes-v1") == {}


# [AI生成]
def test_param_specs_error_rejects_unknown_method():
    with pytest.raises(BaselineError) as error:
        param_specs("missing-v1")
    assert error.value.code == "ALGORITHM_UNKNOWN"


# [AI生成]
def test_validate_declared_params_normal_accepts_frozen_declaration():
    params = get_algorithm("decision-tree-v1")["params"]
    assert validate_declared_params("decision-tree-v1", params) is True


# [AI生成]
def test_validate_declared_params_boundary_accepts_declared_override():
    params = dict(get_algorithm("decision-tree-v1")["params"], max_depth=12)
    assert validate_declared_params("decision-tree-v1", params) is True


# [AI生成]
def test_validate_declared_params_error_rejects_missing_keys():
    params = dict(get_algorithm("decision-tree-v1")["params"])
    del params["max_depth"]
    with pytest.raises(BaselineError) as error:
        validate_declared_params("decision-tree-v1", params)
    assert error.value.code == "ARTIFACT_INVALID"


# [AI生成]
def test_params_display_normal_lists_only_changed_values():
    params = dict(get_algorithm("decision-tree-v1")["params"], max_depth=12)
    assert params_display(params, "decision-tree-v1") == "max_depth=12"


# [AI生成]
def test_params_display_boundary_returns_empty_for_frozen_values():
    assert params_display(get_algorithm("decision-tree-v1")["params"], "decision-tree-v1") == ""


# [AI生成]
def test_params_display_error_rejects_unknown_method():
    with pytest.raises(BaselineError) as error:
        params_display({}, "missing-v1")
    assert error.value.code == "ALGORITHM_UNKNOWN"


# [AI生成]
def test_get_algorithm_normal_returns_registered_entry():
    assert get_algorithm("logistic-regression-l2-v1")["estimator"] == "logistic-regression"


# [AI生成]
def test_get_algorithm_boundary_returns_last_registered_entry():
    assert get_algorithm("wide-deep-v1")["category"] == "deep"


# [AI生成]
def test_get_algorithm_error_rejects_unregistered_name():
    with pytest.raises(BaselineError) as error:
        get_algorithm("logistic-regression-v9")
    assert error.value.code == "ALGORITHM_UNKNOWN"


# [AI生成]
def test_resolve_algorithm_normal_returns_explicit_method():
    assert resolve_algorithm("decision-tree-v1") is get_algorithm("decision-tree-v1")


# [AI生成]
def test_resolve_algorithm_boundary_uses_frozen_default():
    assert resolve_algorithm(None) is get_algorithm("logistic-regression-l2-v1")


# [AI生成]
def test_resolve_algorithm_error_rejects_unknown_method():
    with pytest.raises(BaselineError) as error:
        resolve_algorithm("missing-v1")
    assert error.value.code == "ALGORITHM_UNKNOWN"


# [AI生成]
def test_method_missing_dependencies_normal_returns_none_when_installed():
    assert method_missing_dependencies("logistic-regression-l2-v1") == []


# [AI生成]
def test_method_missing_dependencies_boundary_reports_missing_package(monkeypatch):
    import jit_baseline.algorithms as algorithms
    monkeypatch.setattr(algorithms.importlib.util, "find_spec", lambda _name: None)
    assert method_missing_dependencies("random-forest-v1") == ["scipy"]


# [AI生成]
def test_method_missing_dependencies_error_rejects_unknown_method():
    with pytest.raises(BaselineError) as error:
        method_missing_dependencies("missing-v1")
    assert error.value.code == "ALGORITHM_UNKNOWN"


# [AI生成]
def test_method_catalog_normal_marks_classic_methods_available():
    methods = method_catalog("openstack-six-v1")
    assert len(methods) == 9
    assert next(item for item in methods if item["method"] == "logistic-regression-l2-v1")["available"] is True


# [AI生成]
def test_method_catalog_boundary_marks_semantic_only_schema_unsupported():
    methods = method_catalog("code-semantic-codebert-v1")
    assert all(item["available"] is False for item in methods)
    assert all(item["supportedSchema"] is False for item in methods)


# [AI生成]
def test_method_catalog_error_rejects_unknown_schema():
    with pytest.raises(BaselineError) as error:
        method_catalog("missing-schema")
    assert error.value.code == "SCHEMA_UNKNOWN"


# [AI生成]
def test_check_method_normal_returns_compatible_method():
    assert check_method(
        "logistic-regression-l2-v1", "openstack-six-v1"
    )["estimator"] == "logistic-regression"


# [AI生成]
def test_check_method_boundary_rejects_semantic_only_schema():
    with pytest.raises(BaselineError) as error:
        check_method("logistic-regression-l2-v1", "code-semantic-codebert-v1")
    assert error.value.code == "METHOD_SCHEMA_MISMATCH"


# [AI生成]
def test_check_method_error_reports_missing_dependency(monkeypatch):
    import jit_baseline.algorithms as algorithms
    monkeypatch.setattr(algorithms.importlib.util, "find_spec", lambda _name: None)
    with pytest.raises(BaselineError) as error:
        check_method("random-forest-v1", "openstack-six-v1")
    assert error.value.code == "METHOD_DEPENDENCY_UNAVAILABLE"


# [AI生成]
def test_model_descriptor_normal_preserves_known_identity():
    assert model_descriptor("kamei14-v1", "logistic-regression-l2-v1") == {
        "id": "logistic-regression-kamei14-v1",
        "name": "逻辑回归 · Kamei14（12 字段入模）",
    }


# [AI生成]
def test_model_descriptor_boundary_derives_custom_identity():
    descriptor = model_descriptor("openstack-six-v1", "decision-tree-v1")
    assert descriptor == {
        "id": "decision-tree@openstack-six-v1",
        "name": "决策树 · openstack-six-v1",
    }


# [AI生成]
def test_model_descriptor_error_rejects_unknown_method():
    with pytest.raises(BaselineError) as error:
        model_descriptor("openstack-six-v1", "missing-v1")
    assert error.value.code == "ALGORITHM_UNKNOWN"
