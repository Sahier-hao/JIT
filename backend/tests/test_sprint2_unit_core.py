"""Sprint2 快速单元层：后端核心纯逻辑的正常、边界与异常场景。

本文件只使用合成输入。它不连接网络、正式数据库、模型包或私有数据。
"""
# === AI 辅助说明 ===
# 本文件共 144 条测试用例
# [AI生成]：144 条（核心断言待负责人逐条复核）
# [AI生成-人工修改]：0 条
# [手写]：0 条
# 使用工具：OpenAI Codex
# 提示词见：docs/test-delivery/sprint2-unit-test/prompts/backend-sprint2-unit-core.md
import csv
import hashlib
import io

import numpy as np
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
from jit_baseline.api_errors import RequestError
from jit_baseline.catalog_input import prediction_input
from jit_baseline.data import BaselineError, integer, parse_source, sha256, verified_bytes
from jit_baseline.metrics import classification, evaluate, get_metric_set
from jit_baseline.ml.model import (
    ExpertStandardScaler,
    Log1pColumns,
    apply_class_policy,
    build_estimator,
    feature_matrix,
    fit_model,
    predict_risks,
)
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


class _ProbabilityPipeline:
    """只实现 predict_risks 依赖的两个属性，隔离真实模型。"""

    def __init__(self, classes, rows=None, error=None):
        self.classes_ = np.asarray(classes)
        self.rows = rows
        self.error = error
        self.matrix = None

    def predict_proba(self, matrix):
        self.matrix = matrix
        if self.error is not None:
            raise self.error
        return np.asarray(self.rows, dtype=np.float64)


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
def test_evaluate_boundary_includes_commit_when_budget_is_exactly_reached():
    result = evaluate(
        _metric_records(costs=(1, 1, 1, 2), labels=(1, 0, 0, 0)),
        [0.9, 0.8, 0.7, 0.6],
    )
    assert result["effort"]["budgetLoc"] == pytest.approx(1.0)
    assert result["effort"]["usedLoc"] == 1
    assert result["effort"]["selectedCount"] == 1
    assert result["recall20Loc"]["value"] == pytest.approx(1.0)


# [AI生成]
def test_evaluate_boundary_ties_use_time_then_identity_and_stop_at_exact_budget():
    records = _metric_records(costs=(2, 1, 1, 1), labels=(1, 0, 1, 0))
    result = evaluate(records, [0.5, 0.5, 0.5, 0.5])
    assert result["effort"]["selectedCount"] == 1
    assert result["effort"]["usedLoc"] == 1
    assert result["recall20Loc"]["value"] == pytest.approx(0.0)


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
def test_split_records_normal_assigns_exact_commits_to_hand_computed_partitions():
    records = [
        {"id": f"{index:040x}", "epoch": 100 + index * 100,
         "time": f"2020-01-{index + 1:02d}T00:00:00Z", "label": index % 2}
        for index in range(10)
    ]
    split, boundaries, _ = split_records(records, "temporal-60-20-20")
    assert [[record["id"] for record in split[name]]
            for name in ("train", "validation", "test")] == [
        [f"{index:040x}" for index in range(6)],
        [f"{index:040x}" for index in range(6, 8)],
        [f"{index:040x}" for index in range(8, 10)],
    ]
    assert boundaries == [700, 900]


# [AI生成]
def test_split_records_boundary_keeps_same_timestamp_group_in_one_partition():
    records = [
        {"id": "a" * 40, "epoch": 100, "time": "2020-01-01T00:00:00Z", "label": 1},
        {"id": "b" * 40, "epoch": 200, "time": "2020-01-02T00:00:00Z", "label": 0},
        {"id": "c" * 40, "epoch": 300, "time": "2020-01-03T00:00:00Z", "label": 1},
        {"id": "d" * 40, "epoch": 300, "time": "2020-01-03T00:00:00Z", "label": 0},
        {"id": "e" * 40, "epoch": 400, "time": "2020-01-04T00:00:00Z", "label": 0},
        {"id": "f" * 40, "epoch": 500, "time": "2020-01-05T00:00:00Z", "label": 1},
        {"id": "g" * 40, "epoch": 500, "time": "2020-01-05T00:00:00Z", "label": 0},
    ]
    split, boundaries, _ = split_records(records, "temporal-60-20-20")
    assert [[record["id"] for record in split[name]]
            for name in ("train", "validation", "test")] == [
        ["a" * 40, "b" * 40, "c" * 40, "d" * 40],
        ["e" * 40],
        ["f" * 40, "g" * 40],
    ]
    assert boundaries == [400, 500]


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
def test_get_algorithm_boundary_resolves_first_and_last_registry_entries():
    first = get_algorithm("logistic-regression-l2-v1")
    last = get_algorithm("wide-deep-v1")
    assert first["estimator"] == "logistic-regression"
    assert last["estimator"] == "torch-wide-deep"
    assert first is not last


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


# [AI生成]
def test_feature_matrix_normal_organizes_openstack_columns_in_schema_order():
    records = [
        {"features": [1, 2, 3, 0.5, 4, 5]},
        {"features": [6, 7, 8, 0.25, 9, 10]},
    ]
    matrix = feature_matrix(records, "openstack-six-v1")
    assert matrix.shape == (2, 6)
    assert matrix.tolist() == [
        [1.0, 2.0, 3.0, 0.5, 4.0, 5.0],
        [6.0, 7.0, 8.0, 0.25, 9.0, 10.0],
    ]


# [AI生成]
def test_feature_matrix_normal_preserves_kamei14_git_v2_column_order():
    vector = list(range(1, 15))
    matrix = feature_matrix([{"features": vector}], "kamei14-git-v2")
    assert matrix.tolist() == [vector]


# [AI生成]
def test_feature_matrix_normal_appends_semantic_vectors_after_experts():
    vector = list(range(1, 15))
    semantic = [0.5] * 768
    matrix = feature_matrix(
        [{"features": vector, "semantic": semantic}],
        "kamei14-semantic-codebert-v1",
    )
    assert matrix.shape == (1, 782)
    assert matrix[0, :14].tolist() == vector
    assert matrix[0, 14:].tolist() == semantic


# [AI生成]
def test_feature_matrix_boundary_accepts_semantic_only_schema():
    semantic = [index / 10 for index in range(768)]
    matrix = feature_matrix(
        [{"features": list(range(1, 15)), "semantic": semantic}],
        "code-semantic-codebert-v1",
    )
    assert matrix.shape == (1, 768)
    assert matrix[0].tolist() == semantic


# [AI生成]
def test_feature_matrix_boundary_accepts_all_zero_values():
    matrix = feature_matrix([{"features": [0, 0, 0, 0, 0, 0]}])
    assert matrix.tolist() == [[0.0, 0.0, 0.0, 0.0, 0.0, 0.0]]


# [AI生成]
@pytest.mark.parametrize("records", [
    [],
    [{"features": [1, 2, 3, 0.5, 4]}],
    [{"features": [1, 2, 3, 0.5, 4, 5, 6]}],
    [{"features": [1, 2, 3, float("nan"), 4, 5]}],
    [{"features": [1, 2, 3, float("inf"), 4, 5]}],
    [{"features": [1, 2, 3, 0.5, -1, 5]}],
    [{"metrics": {"ns": 1}}],
])
def test_feature_matrix_error_rejects_empty_width_nonfinite_and_negative(records):
    with pytest.raises(BaselineError) as error:
        feature_matrix(records)
    assert error.value.code == "FEATURES_INVALID"


# [AI生成]
def test_predict_risks_normal_selects_label_one_column_when_classes_are_reversed():
    records = [
        {"features": [1, 2, 3, 0.5, 4, 5]},
        {"features": [2, 3, 4, 0.6, 5, 6]},
        {"features": [3, 4, 5, 0.7, 6, 7]},
    ]
    pipeline = _ProbabilityPipeline([1, 0], [
        [0.90, 0.10],
        [0.75, 0.25],
        [1.00, 0.00],
    ])
    assert predict_risks(pipeline, records, "openstack-six-v1") == [0.90, 0.75, 1.00]
    assert pipeline.matrix.tolist() == [
        [1.0, 2.0, 3.0, 0.5, 4.0, 5.0],
        [2.0, 3.0, 4.0, 0.6, 5.0, 6.0],
        [3.0, 4.0, 5.0, 0.7, 6.0, 7.0],
    ]


# [AI生成]
def test_predict_risks_normal_selects_label_one_column_when_classes_are_sorted():
    pipeline = _ProbabilityPipeline([0, 1], [[0.2, 0.8], [0.7, 0.3]])
    records = [{"features": [1, 2, 3, 0.5, 4, 5]}, {"features": [6, 7, 8, 0.25, 9, 10]}]
    assert predict_risks(pipeline, records) == [0.8, 0.3]


# [AI生成]
def test_predict_risks_boundary_accepts_zero_and_one():
    pipeline = _ProbabilityPipeline([1, 0], [[0.0, 1.0], [1.0, 0.0]])
    records = [{"features": [1, 2, 3, 0.5, 4, 5]}, {"features": [1, 2, 3, 0.5, 4, 5]}]
    assert predict_risks(pipeline, records) == [0.0, 1.0]


# [AI生成]
@pytest.mark.parametrize("pipeline", [
    _ProbabilityPipeline([1, 0], [[0.5, 0.5]]),
    _ProbabilityPipeline([1, 0], [[0.5, float("nan")]]),
    _ProbabilityPipeline([1, 0], [[1.01, -0.01]]),
    _ProbabilityPipeline([0], [[1.0]]),
    _ProbabilityPipeline([1, 0], error=ValueError("fixture")),
])
def test_predict_risks_error_rejects_count_nan_range_missing_positive_and_failure(pipeline):
    records = [
        {"features": [1, 2, 3, 0.5, 4, 5]},
        {"features": [2, 3, 4, 0.6, 5, 6]},
    ]
    with pytest.raises(BaselineError) as error:
        predict_risks(pipeline, records)
    assert error.value.code == "INFERENCE_ERROR"


# [AI生成]
def test_prediction_input_normal_accepts_client_features_and_normalizes_identity():
    request = {
        "modelId": "11111111-1111-4111-8111-111111111111",
        "featureSchemaVersion": "openstack-six-v1",
        "project": "  fixture-project  ",
        "record": {
            "recordId": "  input-1  ",
            "commitId": "A" * 40,
            "time": "2026-10-14T18:00:00+08:00",
            "features": {"ld": 2, "la": 10, "ent": 0.8, "nf": 3, "nd": 2, "ns": 1},
        },
    }
    data = prediction_input(request)
    assert data == {
        "modelId": "11111111-1111-4111-8111-111111111111",
        "featureSchemaVersion": "openstack-six-v1",
        "project": "fixture-project",
        "source": "client-features",
        "datasetVersion": None,
        "record": {
            "recordId": "input-1",
            "features": {"ns": 1, "nd": 2, "nf": 3, "ent": 0.8, "la": 10, "ld": 2},
            "commitId": "a" * 40,
            "time": "2026-10-14T10:00:00Z",
        },
    }


# [AI生成]
def test_prediction_input_boundary_accepts_persisted_commit_without_client_features():
    request = {
        "modelId": "11111111-1111-4111-8111-111111111111",
        "featureSchemaVersion": "openstack-six-v1",
        "project": "fixture-project",
        "datasetVersion": "openstack-six-v1-2011-11-29_2014-02-28",
        "record": {"recordId": "backend:" + "b" * 40, "commitId": "B" * 40},
    }
    data = prediction_input(request)
    assert data["source"] == "persisted-commit"
    assert data["datasetVersion"] == "openstack-six-v1-2011-11-29_2014-02-28"
    assert data["record"] == {
        "recordId": "backend:" + "b" * 40,
        "features": None,
        "commitId": "b" * 40,
        "time": None,
    }


# [AI生成]
@pytest.mark.parametrize("mutate,code,field", [
    (lambda body: body["record"].__setitem__("features", {"ns": 1, "nd": 2, "nf": 3, "ent": 0.5, "la": 1, "ld": 1}),
     "INPUT_INVALID", "datasetVersion"),
    (lambda body: body.pop("record"), "INPUT_INVALID", "request"),
    (lambda body: (body["record"].pop("commitId"), body.pop("datasetVersion")),
     "INPUT_INVALID", "record.commitId"),
    (lambda body: body["record"].__setitem__("extra", 1), "INPUT_INVALID", "record"),
    (lambda body: body.__setitem__("featureSchemaVersion", "kamei14-git-v2"),
     "INPUT_SCHEMA_MISMATCH", "featureSchemaVersion"),
])
def test_prediction_input_error_rejects_conflicting_or_incomplete_source(mutate, code, field):
    request = {
        "modelId": "11111111-1111-4111-8111-111111111111",
        "featureSchemaVersion": "openstack-six-v1",
        "project": "fixture-project",
        "datasetVersion": "fixture-dataset",
        "record": {"recordId": "input-1", "commitId": "a" * 40},
    }
    mutate(request)
    with pytest.raises(RequestError) as error:
        prediction_input(request)
    assert error.value.code == code
    assert error.value.details == [{"field": field, "reason": str(error.value)}]


# [AI生成]
@pytest.mark.parametrize("features,field", [
    ({"ns": 1, "nd": 2, "nf": 3, "ent": 0.5, "la": 1}, "record.features"),
    ({"ns": 1, "nd": 2, "nf": 3, "ent": 0.5, "la": 1, "ld": 1, "extra": 2}, "record.features"),
    ({"ns": 1.5, "nd": 2, "nf": 3, "ent": 0.5, "la": 1, "ld": 1}, "record.features.ns"),
    ({"ns": True, "nd": 2, "nf": 3, "ent": 0.5, "la": 1, "ld": 1}, "record.features.ns"),
    ({"ns": 1, "nd": 2, "nf": 3, "ent": float("nan"), "la": 1, "ld": 1},
     "record.features.ent"),
    ({"ns": 1, "nd": 2, "nf": 3, "ent": 0.5, "la": -1, "ld": 1}, "record.features.la"),
])
def test_prediction_input_error_rejects_feature_contract_mismatch(features, field):
    request = {
        "modelId": "11111111-1111-4111-8111-111111111111",
        "featureSchemaVersion": "openstack-six-v1",
        "project": "fixture-project",
        "record": {"recordId": "input-1", "features": features},
    }
    with pytest.raises(RequestError) as error:
        prediction_input(request)
    assert error.value.code in {"INPUT_INVALID", "INPUT_SCHEMA_MISMATCH"}
    assert error.value.details[0]["field"] == field


# [AI生成]
def test_prediction_input_error_rejects_naive_time_without_normalizing_it():
    request = {
        "modelId": "11111111-1111-4111-8111-111111111111",
        "featureSchemaVersion": "openstack-six-v1",
        "project": "fixture-project",
        "record": {
            "recordId": "input-1",
            "time": "2026-10-14T12:00:00",
            "features": {"ns": 1, "nd": 2, "nf": 3, "ent": 0.5, "la": 1, "ld": 1},
        },
    }
    with pytest.raises(RequestError) as error:
        prediction_input(request)
    assert error.value.code == "INPUT_INVALID"
    assert error.value.details[0]["field"] == "record.time"


# [AI生成]
def test_build_estimator_normal_uses_the_declared_method_factory():
    estimator = build_estimator(get_algorithm("decision-tree-v1"))
    assert type(estimator).__name__ == "DecisionTreeClassifier"
    assert estimator.get_params()["max_depth"] == 8
    assert estimator.get_params()["min_samples_leaf"] == 50


# [AI生成]
def test_build_estimator_boundary_replaces_only_declared_override():
    estimator = build_estimator(get_algorithm("decision-tree-v1"), {"max_depth": 12})
    assert estimator.get_params()["max_depth"] == 12
    assert estimator.get_params()["min_samples_leaf"] == 50


# [AI生成]
def test_build_estimator_error_rejects_unimplemented_estimator():
    with pytest.raises(BaselineError) as error:
        build_estimator({"estimator": "missing-estimator", "kwargs": {}})
    assert error.value.code == "ALGORITHM_UNKNOWN"


# [AI生成]
def test_apply_class_policy_normal_returns_weights_without_reordering_records():
    records = _metric_records(costs=(1, 1, 1, 1), labels=(0, 1, 0, 1))
    result, weights, summary = apply_class_policy(
        records, {"kind": "weights", "positiveWeight": 3, "negativeWeight": 1})
    assert result is records
    assert weights.tolist() == [1.0, 3.0, 1.0, 3.0]
    assert summary["after"] == {"records": 4, "positives": 2}


# [AI生成]
def test_apply_class_policy_boundary_sample_is_seeded_and_does_not_mutate_input():
    records = [
        {"id": f"n{index}", "epoch": index, "label": 0, "metrics": {"la": 1, "ld": 0}}
        for index in range(4)
    ]
    records.append({"id": "p", "epoch": 4, "label": 1, "metrics": {"la": 1, "ld": 0}})
    before = [(record["id"], record["label"]) for record in records]
    result, weights, summary = apply_class_policy(records, {"kind": "sample", "seed": 7})
    assert weights is None
    assert len(result) == 8
    assert summary["before"] == {"records": 5, "positives": 1}
    assert summary["after"] == {"records": 8, "positives": 4}
    assert [(record["id"], record["label"]) for record in records] == before
    repeated, _, _ = apply_class_policy(records, {"kind": "sample", "seed": 7})
    assert [record["id"] for record in repeated] == [record["id"] for record in result]


# [AI生成]
def test_apply_class_policy_boundary_sample_can_expand_negatives():
    records = [
        {"id": f"p{index}", "epoch": index, "label": 1, "metrics": {"la": 1, "ld": 0}}
        for index in range(3)
    ]
    records.append({"id": "n", "epoch": 3, "label": 0, "metrics": {"la": 1, "ld": 0}})
    result, weights, summary = apply_class_policy(records, {"kind": "sample", "seed": 11})
    assert weights is None
    assert len(result) == 6
    assert summary["after"] == {"records": 6, "positives": 3}


# [AI生成]
def test_apply_class_policy_error_rejects_sample_with_single_class():
    records = [
        {"id": f"p{index}", "epoch": index, "label": 1, "metrics": {"la": 1, "ld": 0}}
        for index in range(3)
    ]
    with pytest.raises(BaselineError) as error:
        apply_class_policy(records, {"kind": "sample", "seed": 1})
    assert error.value.code == "CLASS_POLICY_INVALID"


# [AI生成]
@pytest.mark.parametrize("policy", [
    {"kind": "weights", "positiveWeight": 0},
    {"kind": "sample", "seed": -1},
    {"kind": "unknown"},
])
def test_apply_class_policy_error_rejects_invalid_policy(policy):
    with pytest.raises(BaselineError) as error:
        apply_class_policy(_metric_records(), policy)
    assert error.value.code == "CLASS_POLICY_INVALID"


# [AI生成]
def test_fit_model_normal_builds_declared_pipeline_and_predicts_all_records():
    records = [
        {"features": [index % 3, index % 4, index % 5, (index % 7) / 10, index, index % 2],
         "label": index % 2}
        for index in range(40)
    ]
    pipeline = fit_model(records, algorithm="decision-tree-v1")
    assert list(pipeline.named_steps) == ["counts", "model"]
    risks = predict_risks(pipeline, records)
    assert len(risks) == 40
    assert all(0 <= risk <= 1 for risk in risks)


# [AI生成]
def test_fit_model_boundary_accepts_declared_class_policy_on_training_records():
    records = [
        {"features": [index % 3, index % 4, index % 5, (index % 7) / 10, index, index % 2],
         "label": index % 2}
        for index in range(40)
    ]
    pipeline = fit_model(records, algorithm="decision-tree-v1",
                         class_policy={"kind": "weights", "positiveWeight": 2})
    assert list(pipeline.named_steps) == ["counts", "model"]
    assert len(predict_risks(pipeline, records)) == 40


# [AI生成]
@pytest.mark.parametrize("records,algorithm,code", [
    ([{"features": [1, 2, 3, 0.5, 4, 5], "label": 0} for _ in range(4)], None, "MODEL_INVALID"),
    ([{"features": [1, 2, 3, 0.5, 4, 5], "label": 0},
      {"features": [1, 2, 3, 0.5, 4, 5], "label": 1}], "missing-v1", "ALGORITHM_UNKNOWN"),
])
def test_fit_model_error_rejects_single_class_or_unknown_method(records, algorithm, code):
    with pytest.raises(BaselineError) as error:
        fit_model(records, algorithm=algorithm)
    assert error.value.code == code


# [AI生成]
def test_fit_model_error_does_not_publish_a_nonconverged_estimator(monkeypatch):
    from jit_baseline.algorithms import ALGORITHMS, DEFAULT_ALGORITHM
    entry = dict(ALGORITHMS[DEFAULT_ALGORITHM],
                 kwargs={**ALGORITHMS[DEFAULT_ALGORITHM]["kwargs"], "max_iter": 1})
    monkeypatch.setitem(ALGORITHMS, "test-nonconvergent-v1", entry)
    records = [
        {"features": [index % 3, index % 4, index % 5, (index % 7) / 10, index, index % 2],
         "label": index % 2}
        for index in range(100)
    ]
    with pytest.raises(BaselineError) as error:
        fit_model(records, algorithm="test-nonconvergent-v1")
    assert error.value.code == "MODEL_NOT_CONVERGED"


# [AI生成]
def test_log1p_columns_normal_transforms_only_declared_columns():
    matrix = np.asarray([[1.0, 2.0, 3.0], [0.0, 4.0, 8.0]])
    result = Log1pColumns((0, 2))(matrix)
    assert result.tolist() == [
        [np.log1p(1.0), 2.0, np.log1p(3.0)],
        [np.log1p(0.0), 4.0, np.log1p(8.0)],
    ]
    assert result is not matrix


# [AI生成]
def test_log1p_columns_boundary_without_columns_returns_an_independent_copy():
    matrix = np.asarray([[1.0, 2.0]])
    result = Log1pColumns(())(matrix)
    assert result.tolist() == [[1.0, 2.0]]
    assert result is not matrix


# [AI生成]
def test_log1p_columns_error_rejects_out_of_range_column():
    with pytest.raises(IndexError):
        Log1pColumns((2,))(np.asarray([[1.0, 2.0]]))


# [AI生成]
def test_expert_standard_scaler_normal_scales_experts_and_preserves_semantic_tail():
    matrix = np.asarray([[1.0, 10.0, 0.25], [3.0, 30.0, 0.75]])
    scaler = ExpertStandardScaler(2).fit(matrix)
    transformed = scaler.transform(matrix)
    assert np.allclose(transformed[:, :2].mean(axis=0), [0.0, 0.0])
    assert np.allclose(transformed[:, 2], [0.25, 0.75])
    assert scaler.n_features_in_ == 3


# [AI生成]
def test_expert_standard_scaler_boundary_without_expert_columns_keeps_values():
    matrix = np.asarray([[1.0, 2.0], [3.0, 4.0]])
    transformed = ExpertStandardScaler(0).fit_transform(matrix)
    assert np.allclose(transformed, matrix)
    assert transformed is not matrix


# [AI生成]
def test_expert_standard_scaler_error_rejects_more_experts_than_columns():
    with pytest.raises(ValueError):
        ExpertStandardScaler(3).fit(np.asarray([[1.0, 2.0]]))
