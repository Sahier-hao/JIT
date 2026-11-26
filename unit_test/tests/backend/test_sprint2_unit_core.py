"""Sprint2 快速单元层：后端核心纯逻辑的正常、边界与异常场景。

本文件只使用合成输入，不连接网络、正式数据库、模型包或私有数据。

阅读方式：
1. 测试名遵循 `test_<被测函数>_<normal|boundary|error>_<预期>`。
2. `normal` 验证主流程；`boundary` 验证闭区间、空值、同值等临界条件；
   `error` 验证非法输入必须给出明确错误码，而不是静默算出结果。
3. 每组前的注释说明该组防的是什么业务错误；复杂用例另有 docstring。
4. 如果断言失败，先看错误码和测试名中的预期，再对照被测函数的生产规则，
   不要把测试改成迁就当前实现。

测试分组：
- 数据完整性、CSV 解析与来源下载；
- 分类指标、评价指标与审查预算；
- 时间切分、预设与分区成员校验；
- 算法注册、参数覆盖与依赖检查；
- 特征矩阵、预测列选择与预测输入契约；
- 模型构建、类别策略、训练与预处理。
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
    """把字典行写成测试用 CSV；字段顺序固定，避免测试受字典序影响。"""
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
    """生成一条合法 Kamei/OpenStack 风格记录，再用 overrides 制造边界。"""
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
    """生成按时间递增、标签交替的合成提交，供切分测试使用。"""
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
    """生成带 LOC 成本与标签的提交，供评价指标和预算测试使用。"""
    return [
        {"id": f"{index:040x}", "epoch": index, "label": label,
         "metrics": {"la": cost, "ld": 0}}
        for index, (cost, label) in enumerate(zip(costs, labels, strict=True))
    ]


def _partitioned_records():
    """生成已经分好区的提交，用于验证分区策略而不是重新切分。"""
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
    """模拟 urllib 的上下文管理器响应，隔离真实网络。"""
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self, _limit):
            return blob

    return Response()


class _ProbabilityPipeline:
    """只实现 predict_risks 依赖的两个属性，隔离真实模型。

    `classes_` 模拟 sklearn 的类别顺序，`predict_proba` 返回固定概率。
    这样可以单独验证“风险必须取 label=1 的列”，而不是碰巧取第一列。
    """

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


# ---------------------------------------------------------------------------
# 数据完整性、CSV 解析与来源下载
# 目标：内容哈希必须稳定；坏编码、坏表头、缺字段、重复提交必须被拒绝；
# 已校验的本地文件不能重复下载，下载失败不能留下半成品。
# ---------------------------------------------------------------------------
# [AI生成]
def test_sha256_normal_returns_lowercase_digest():
    """正常路径：固定字节必须得到标准 SHA-256 小写摘要，用于内容身份校验。"""
    assert sha256(b"abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


# [AI生成]
def test_sha256_boundary_hashes_empty_bytes():
    """边界路径：空文件也要得到标准空字节摘要，不能返回空字符串或报错。"""
    assert sha256(b"") == hashlib.sha256(b"").hexdigest()


# [AI生成]
def test_sha256_error_rejects_text_input():
    """异常路径：摘要函数只接受字节；传入文本应直接报错，避免编码歧义。"""
    with pytest.raises(TypeError):
        sha256("abc")


# [AI生成]
def test_integer_normal_parses_decimal_text():
    """正常路径：CSV 中的十进制文本应转成整数。"""
    assert integer("42", "la", 2) == 42


# [AI生成]
def test_integer_boundary_accepts_zero():
    """边界路径：0 是合法计数，不能被当成缺失值。"""
    assert integer("0", "la", 2) == 0


# [AI生成]
def test_integer_error_rejects_signed_or_fractional_values():
    """异常路径：负数或小数必须报 DATA_INVALID，不能截断成整数。"""
    with pytest.raises(BaselineError) as error:
        integer("-1", "la", 2)
    assert error.value.code == "DATA_INVALID"


# [AI生成]
def test_parse_source_normal_returns_allowlisted_features_and_label():
    """正常路径：CSV 只提取允许入模的字段，并按 schema 顺序组成特征向量。"""
    records, quality = parse_source(_csv_bytes([_row()]))
    assert records[0]["features"] == [1, 2, 3, 0.7, 4, 5]
    assert records[0]["label"] == 0
    assert quality["blankLabels"] == 1


# [AI生成]
def test_parse_source_boundary_uses_inclusive_cohort_limits():
    """边界路径：窗口起点、LOC 上限和文件数上限都按包含处理，不能被误排除。"""
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
    """异常路径：提交 ID 不是完整 SHA 时必须拒绝，避免后续证据无法对应。"""
    with pytest.raises(BaselineError) as error:
        parse_source(_csv_bytes([_row(commit_id="not-a-sha")]))
    assert error.value.code == "DATA_INVALID"


# [AI生成]
def test_verified_bytes_normal_returns_verified_payload(tmp_path):
    """正常路径：文件内容与声明哈希一致时返回原始字节。"""
    blob = b"verified"
    path = tmp_path / "source.csv"
    path.write_bytes(blob)
    assert verified_bytes(path, sha256(blob)) == blob


# [AI生成]
def test_verified_bytes_boundary_accepts_empty_file(tmp_path):
    """边界路径：空文件也有合法哈希，不能被误判为读取失败。"""
    path = tmp_path / "empty.csv"
    path.write_bytes(b"")
    assert verified_bytes(path, sha256(b"")) == b""


# [AI生成]
def test_verified_bytes_error_rejects_tampered_payload(tmp_path):
    """异常路径：文件内容被改动后必须报 INTEGRITY_ERROR，不能继续使用。"""
    path = tmp_path / "source.csv"
    path.write_bytes(b"changed")
    with pytest.raises(BaselineError) as error:
        verified_bytes(path, "0" * 64)
    assert error.value.code == "INTEGRITY_ERROR"


# [AI生成]
def test_verified_bytes_error_reports_missing_file(tmp_path):
    """异常路径：文件缺失应报 SOURCE_UNAVAILABLE，区分“没下载”与“内容损坏”。"""
    with pytest.raises(BaselineError) as error:
        verified_bytes(tmp_path / "missing.csv", "0" * 64)
    assert error.value.code == "SOURCE_UNAVAILABLE"


# [AI生成]
def test_fetch_sources_normal_downloads_only_verified_files(monkeypatch, tmp_path):
    """正常路径：下载地址和超时固定，下载后还要按声明哈希校验。"""
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
    """边界路径：本地文件哈希已匹配时不应联网，保证离线复现。"""
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
    """异常路径：超过 6 MB 的下载必须报错，并且不能留下半写文件。"""
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
    """异常路径：网络不可用时应报 SOURCE_UNAVAILABLE，而不是抛出裸 OSError。"""
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
    """异常路径：缺少必需列时整份 CSV 拒绝导入，避免按错误列序解析。"""
    with pytest.raises(BaselineError) as error:
        parse_source(b"commit_id,author_date\n" + b"a" * 40 + b",1350000000\n")
    assert error.value.code == "DATA_INVALID"


# [AI生成]
def test_parse_source_error_requires_all_label_maturity_columns():
    """异常路径：成熟相关列必须成套出现，缺一列就不能声称标签可复算。"""
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
    """异常路径：重复提交要在时间窗过滤前就拒绝，否则过滤会掩盖重复。"""
    with pytest.raises(BaselineError, match="重复"):
        parse_source(_csv_bytes([_row(), _row(author_date="1")]))


# [AI生成]
def test_parse_source_error_rejects_unrepresentable_timestamp():
    """异常路径：无法表示的时间必须报“提交时间无效”，不能溢出成错误日期。"""
    with pytest.raises(BaselineError, match="提交时间无效"):
        parse_source(_csv_bytes([_row(author_date="999999999999999999999")]))


# [AI生成]
def test_parse_source_error_rejects_blank_required_feature():
    """异常路径：必需特征为空时指出具体字段，不能默认为 0。"""
    with pytest.raises(BaselineError, match="la 缺失或无效"):
        parse_source(_csv_bytes([_row(la="")]))


# [AI生成]
def test_parse_source_error_rejects_non_numeric_feature():
    """异常路径：非数字特征必须拒绝，不能把文本静默转成 0。"""
    with pytest.raises(BaselineError, match="ent 缺失或无效"):
        parse_source(_csv_bytes([_row(ent="abc")]))


# [AI生成]
def test_parse_source_error_rejects_negative_feature():
    """异常路径：计数类特征为负时拒绝，避免模型输入超出语义范围。"""
    with pytest.raises(BaselineError, match="ld 数值无效"):
        parse_source(_csv_bytes([_row(ld="-1")]))


# [AI生成]
def test_parse_source_error_rejects_invalid_unicode():
    """异常路径：非 UTF-8 内容必须报编码错误，不能按平台默认编码猜。"""
    with pytest.raises(BaselineError, match="编码或结构无效"):
        parse_source(b"\xff")


# [AI生成]
def test_parse_source_boundary_materializes_blank_kamei_binary_feature():
    """边界路径：Kamei 二元字段为空时按规则补 0，而不是当成缺失特征。"""
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
    """边界路径：成熟状态要能从观察截止时间和成熟天数重算，不能只存一个标签。"""
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


# ---------------------------------------------------------------------------
# 分类指标、评价指标与审查预算
# 目标：混淆矩阵、AUC/AP/Recall@20%LOC 与 LOC 预算边界必须可手算复核；
# 单类标签只能返回“不可计算原因”，不能伪造 0 或 1。
# ---------------------------------------------------------------------------
# [AI生成]
def test_classification_normal_returns_hand_computed_confusion_and_scores():
    """正常路径：混淆矩阵、precision、recall、F1 必须和手算结果一致。"""
    result = classification([1, 0, 1, 0], [True, True, False, False])
    assert result["confusion"] == {"tp": 1, "fp": 1, "tn": 1, "fn": 1}
    assert result["precision"]["value"] == pytest.approx(0.5)
    assert result["recall"]["value"] == pytest.approx(0.5)
    assert result["f1"]["value"] == pytest.approx(0.5)


# [AI生成]
def test_classification_boundary_returns_reasons_without_positive_samples():
    """边界路径：没有正例时指标不可计算，必须返回原因而不是 0。"""
    result = classification([], [])
    assert result["confusion"] == {"tp": 0, "fp": 0, "tn": 0, "fn": 0}
    assert result["precision"]["value"] is None
    assert result["precision"]["reason"]
    assert result["recall"]["value"] is None


# [AI生成]
def test_classification_error_rejects_mismatched_lengths():
    """异常路径：标签和预测数量不一致时必须报错，不能按较短一方截断。"""
    with pytest.raises(ValueError):
        classification([1], [False, False])


# [AI生成]
def test_evaluate_normal_returns_declared_metrics():
    """正常路径：AUC、AP 和 Recall@20%LOC 按固定样本手算得到声明值。"""
    result = evaluate(_metric_records(), [0.9, 0.8, 0.2, 0.1])
    assert result["rocAuc"]["value"] == pytest.approx(0.75)
    assert result["averagePrecision"]["value"] == pytest.approx(5 / 6)
    assert result["recall20Loc"]["value"] == pytest.approx(0.5)


# [AI生成]
def test_evaluate_boundary_reports_undefined_auc_for_single_class():
    """边界路径：单类标签下 AUC/AP 无定义，必须给出原因而不是伪造 0.5。"""
    result = evaluate(_metric_records(labels=(0, 0, 0, 0)), [0.9, 0.8, 0.2, 0.1])
    assert result["rocAuc"]["value"] is None
    assert result["averagePrecision"]["value"] is None
    assert result["rocAuc"]["reason"]


# [AI生成]
def test_evaluate_error_rejects_out_of_range_risk():
    """异常路径：风险分超出 0–1 时拒绝评价，避免把坏分数算进指标。"""
    with pytest.raises(BaselineError) as error:
        evaluate(_metric_records(), [0.9, 0.8, 0.2, 1.1])
    assert error.value.code == "EVALUATION_INVALID"


# [AI生成]
def test_evaluate_boundary_includes_commit_when_budget_is_exactly_reached():
    """边界路径：预算刚好用满时必须纳入当前提交，否则会少选一个正例。"""
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
    """边界路径：同分时按时间、再按标识稳定排序，且不能超预算凑选。"""
    records = _metric_records(costs=(2, 1, 1, 1), labels=(1, 0, 1, 0))
    result = evaluate(records, [0.5, 0.5, 0.5, 0.5])
    assert result["effort"]["selectedCount"] == 1
    assert result["effort"]["usedLoc"] == 1
    assert result["recall20Loc"]["value"] == pytest.approx(0.0)


# [AI生成]
def test_get_metric_set_normal_returns_registered_metrics():
    """正常路径：metric-set-v2 必须包含当前声明的 ROC-AUC 指标。"""
    assert "rocAuc" in get_metric_set("metric-set-v2")


# [AI生成]
def test_get_metric_set_boundary_returns_frozen_first_set():
    """边界路径：旧 metric-set-v1 保持冻结，不因新版本加入 Popt 而悄悄变化。"""
    assert "popt" not in get_metric_set("metric-set-v1")


# [AI生成]
def test_get_metric_set_error_rejects_unknown_name():
    """异常路径：未知指标集名称必须报 METRIC_SET_UNKNOWN。"""
    with pytest.raises(BaselineError) as error:
        get_metric_set("metric-set-v9")
    assert error.value.code == "METRIC_SET_UNKNOWN"


# ---------------------------------------------------------------------------
# 时间切分、预设与分区成员校验
# 目标：同一时间戳必须整组进入同一分区；切分边界与成员数必须和手算一致；
# 空输入、非整数时间、单一类别和重复成员必须明确失败。
# ---------------------------------------------------------------------------
# [AI生成]
def test_split_records_normal_keeps_timestamp_groups_and_preserves_members():
    """正常路径：三个分区不共享时间戳，成员总数不变，默认预设固定。"""
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
    """边界路径：不传预设时应与显式传默认预设得到完全相同的结果。"""
    implicit = split_records(_records())
    explicit = split_records(_records(), "temporal-70-15-15")
    assert implicit[2] == explicit[2]


# [AI生成]
def test_split_records_normal_assigns_exact_commits_to_hand_computed_partitions():
    """正常路径：10 条提交按 60/20/20 手算的成员和边界必须逐条一致。"""
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
    """边界路径：同一时间戳的多条提交必须整组进入同一分区，避免数据泄漏。"""
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
    """异常路径：未知切分预设必须报 SPLIT_POLICY_INVALID。"""
    with pytest.raises(BaselineError) as error:
        split_records(_records(), "random")
    assert error.value.code == "SPLIT_POLICY_INVALID"


# [AI生成]
def test_split_records_error_rejects_empty_input():
    """异常路径：空提交集合不能切分，必须报 SPLIT_INVALID。"""
    with pytest.raises(BaselineError) as error:
        split_records([])
    assert error.value.code == "SPLIT_INVALID"


# [AI生成]
def test_split_records_error_rejects_non_integer_epoch():
    """异常路径：时间戳不是整数时拒绝切分，不能按字符串排序。"""
    records = _records()
    records[0]["epoch"] = "not-an-epoch"
    with pytest.raises(BaselineError) as error:
        split_records(records)
    assert error.value.code == "SPLIT_INVALID"


# [AI生成]
def test_split_records_error_rejects_too_few_timestamp_groups():
    """异常路径：所有提交同一时间戳时无法形成三个分区，必须拒绝。"""
    records = _records(3)
    for index, record in enumerate(records):
        record["epoch"] = 1_350_000_000
        record["label"] = index % 2
    with pytest.raises(BaselineError) as error:
        split_records(records)
    assert error.value.code == "SPLIT_INVALID"


# [AI生成]
def test_split_records_error_rejects_single_class_partition():
    """异常路径：分区内只有单一类别时不能用于训练/评价，必须报错。"""
    records = _records()
    for record in records:
        record["label"] = 0
    with pytest.raises(BaselineError) as error:
        split_records(records)
    assert error.value.code == "SPLIT_INVALID"


# [AI生成]
def test_resolve_preset_normal_returns_registered_name():
    """正常路径：已登记预设名称原样返回，不做别名替换。"""
    assert resolve_preset("temporal-60-20-20") == "temporal-60-20-20"


# [AI生成]
def test_resolve_preset_boundary_uses_legacy_default():
    """边界路径：未指定预设时沿用冻结的 70/15/15 默认值。"""
    assert resolve_preset() == "temporal-70-15-15"


# [AI生成]
def test_resolve_preset_error_rejects_aliases():
    """异常路径：`70/15/15` 这类别名不被接受，避免同一预设出现多种身份。"""
    with pytest.raises(BaselineError) as error:
        resolve_preset("70/15/15")
    assert error.value.code == "SPLIT_POLICY_INVALID"


# [AI生成]
def test_preset_view_normal_returns_frozen_ratios():
    """正常路径：预设视图必须返回固定比例、时区和稳定标识。"""
    assert preset_view("temporal-80-10-10") == {
        "id": "temporal-80-10-10",
        "ratios": {"train": 80, "validation": 10, "test": 10},
        "timezone": "UTC",
    }


# [AI生成]
def test_preset_view_boundary_default_is_independent_copy():
    """边界路径：两次读取默认预设应得到独立副本，修改一个不能污染另一个。"""
    first = preset_view()
    second = preset_view()
    first["ratios"]["train"] = 1
    assert second["ratios"]["train"] == 70


# [AI生成]
def test_preset_view_error_rejects_unknown_preset():
    """异常路径：未知预设查询必须报 SPLIT_POLICY_INVALID。"""
    with pytest.raises(BaselineError) as error:
        preset_view("random")
    assert error.value.code == "SPLIT_POLICY_INVALID"


# [AI生成]
def test_policy_for_partitions_normal_reports_project_local_members():
    """正常路径：已分区数据应报告项目内成员数和 project-local 边界模式。"""
    policy = policy_for_partitions(_partitioned_records(), "temporal-80-10-10")
    assert policy["boundaryMode"] == "project-local"
    assert policy["boundaries"] == []
    assert sum(item["records"] for item in policy["partitionCounts"].values()) == 6


# [AI生成]
def test_policy_for_partitions_boundary_requires_both_labels():
    """边界路径：测试分区只有单一类别时必须拒绝，不能生成不可评价策略。"""
    partitions = _partitioned_records()
    partitions["test"][1]["label"] = 0
    with pytest.raises(BaselineError) as error:
        policy_for_partitions(partitions)
    assert error.value.code == "SPLIT_INVALID"


# [AI生成]
def test_policy_for_partitions_error_rejects_duplicate_members():
    """异常路径：同一提交出现在两个分区必须报重复，避免训练/测试泄漏。"""
    partitions = _partitioned_records()
    partitions["test"][1]["id"] = partitions["train"][0]["id"]
    with pytest.raises(BaselineError, match="重复"):
        policy_for_partitions(partitions)


# [AI生成]
def test_rule_text_normal_describes_selected_preset():
    """正常路径：规则文本必须写出所选预设的边界公式，方便人工核对。"""
    assert "floor(0.80G)" in rule_text("temporal-80-10-10")


# [AI生成]
def test_rule_text_boundary_uses_default_preset():
    """边界路径：未指定预设时规则文本使用默认的 70/85 边界。"""
    assert "floor(0.70G), floor(0.85G)" in rule_text()


# [AI生成]
def test_rule_text_error_rejects_unknown_preset():
    """异常路径：未知预设不能生成规则文本，必须报 SPLIT_POLICY_INVALID。"""
    with pytest.raises(BaselineError) as error:
        rule_text("random")
    assert error.value.code == "SPLIT_POLICY_INVALID"


# ---------------------------------------------------------------------------
# 算法注册、参数覆盖与依赖检查
# 目标：方法身份、默认参数、显式覆盖、schema 兼容性和缺失依赖必须一致；
# 未知方法或越界参数不能静默回退到其他算法。
# ---------------------------------------------------------------------------
# [AI生成]
def test_resolve_params_normal_returns_declared_override():
    """正常路径：显式参数覆盖生效，并标记为发生过修改。"""
    params, changed = resolve_params("logistic-regression-l2-v1", {"C": 0.5})
    assert params["C"] == 0.5
    assert changed is True


# [AI生成]
def test_resolve_params_boundary_returns_frozen_defaults():
    """边界路径：未覆盖时返回算法登记表里的冻结默认值。"""
    params, changed = resolve_params("decision-tree-v1")
    assert params == get_algorithm("decision-tree-v1")["params"]
    assert changed is False


# [AI生成]
def test_resolve_params_error_rejects_out_of_range_value():
    """异常路径：参数超出声明范围时必须报 INPUT_INVALID，不能静默夹到边界。"""
    with pytest.raises(BaselineError) as error:
        resolve_params("logistic-regression-l2-v1", {"C": 0})
    assert error.value.code == "INPUT_INVALID"


# [AI生成]
def test_param_specs_normal_returns_controlled_parameter_declarations():
    """正常路径：决策树只暴露声明过的可调参数。"""
    assert set(param_specs("decision-tree-v1")) == {"max_depth", "min_samples_leaf"}


# [AI生成]
def test_param_specs_boundary_returns_empty_for_fixed_method():
    """边界路径：固定参数方法不返回可调项，避免 UI 生成无效控件。"""
    assert param_specs("gaussian-naive-bayes-v1") == {}


# [AI生成]
def test_param_specs_error_rejects_unknown_method():
    """异常路径：未知方法查询参数时必须报 ALGORITHM_UNKNOWN。"""
    with pytest.raises(BaselineError) as error:
        param_specs("missing-v1")
    assert error.value.code == "ALGORITHM_UNKNOWN"


# [AI生成]
def test_validate_declared_params_normal_accepts_frozen_declaration():
    """正常路径：算法登记表中的完整参数声明应通过校验。"""
    params = get_algorithm("decision-tree-v1")["params"]
    assert validate_declared_params("decision-tree-v1", params) is True


# [AI生成]
def test_validate_declared_params_boundary_accepts_declared_override():
    """边界路径：只修改声明过的参数值应通过，不能要求与默认值完全相同。"""
    params = dict(get_algorithm("decision-tree-v1")["params"], max_depth=12)
    assert validate_declared_params("decision-tree-v1", params) is True


# [AI生成]
def test_validate_declared_params_error_rejects_missing_keys():
    """异常路径：缺少必需参数键时报 ARTIFACT_INVALID，不能补默认值蒙混过关。"""
    params = dict(get_algorithm("decision-tree-v1")["params"])
    del params["max_depth"]
    with pytest.raises(BaselineError) as error:
        validate_declared_params("decision-tree-v1", params)
    assert error.value.code == "ARTIFACT_INVALID"


# [AI生成]
def test_params_display_normal_lists_only_changed_values():
    """正常路径：参数展示只列与默认值不同的项，避免页面重复噪音。"""
    params = dict(get_algorithm("decision-tree-v1")["params"], max_depth=12)
    assert params_display(params, "decision-tree-v1") == "max_depth=12"


# [AI生成]
def test_params_display_boundary_returns_empty_for_frozen_values():
    """边界路径：全部使用默认值时展示为空，表示“没有覆盖”。"""
    assert params_display(get_algorithm("decision-tree-v1")["params"], "decision-tree-v1") == ""


# [AI生成]
def test_params_display_error_rejects_unknown_method():
    """异常路径：未知方法无法解释参数展示，必须报 ALGORITHM_UNKNOWN。"""
    with pytest.raises(BaselineError) as error:
        params_display({}, "missing-v1")
    assert error.value.code == "ALGORITHM_UNKNOWN"


# [AI生成]
def test_get_algorithm_normal_returns_registered_entry():
    """正常路径：已登记方法返回正确的 estimator 标识。"""
    assert get_algorithm("logistic-regression-l2-v1")["estimator"] == "logistic-regression"


# [AI生成]
def test_get_algorithm_boundary_resolves_first_and_last_registry_entries():
    """边界路径：登记表首尾方法都能解析，且不同方法返回不同对象。"""
    first = get_algorithm("logistic-regression-l2-v1")
    last = get_algorithm("wide-deep-v1")
    assert first["estimator"] == "logistic-regression"
    assert last["estimator"] == "torch-wide-deep"
    assert first is not last


# [AI生成]
def test_get_algorithm_error_rejects_unregistered_name():
    """异常路径：未登记的方法名必须报 ALGORITHM_UNKNOWN，不能回退到默认方法。"""
    with pytest.raises(BaselineError) as error:
        get_algorithm("logistic-regression-v9")
    assert error.value.code == "ALGORITHM_UNKNOWN"


# [AI生成]
def test_resolve_algorithm_normal_returns_explicit_method():
    """正常路径：显式方法名应返回登记表中的同一对象。"""
    assert resolve_algorithm("decision-tree-v1") is get_algorithm("decision-tree-v1")


# [AI生成]
def test_resolve_algorithm_boundary_uses_frozen_default():
    """边界路径：未指定方法时使用冻结的默认逻辑回归。"""
    assert resolve_algorithm(None) is get_algorithm("logistic-regression-l2-v1")


# [AI生成]
def test_resolve_algorithm_error_rejects_unknown_method():
    """异常路径：未知方法必须报 ALGORITHM_UNKNOWN。"""
    with pytest.raises(BaselineError) as error:
        resolve_algorithm("missing-v1")
    assert error.value.code == "ALGORITHM_UNKNOWN"


# [AI生成]
def test_method_missing_dependencies_normal_returns_none_when_installed():
    """正常路径：依赖已安装时返回空列表，不阻塞方法使用。"""
    assert method_missing_dependencies("logistic-regression-l2-v1") == []


# [AI生成]
def test_method_missing_dependencies_boundary_reports_missing_package(monkeypatch):
    """边界路径：依赖探测失败时返回具体包名，便于用户安装而不是只报“不可用”。"""
    import jit_baseline.algorithms as algorithms
    monkeypatch.setattr(algorithms.importlib.util, "find_spec", lambda _name: None)
    assert method_missing_dependencies("random-forest-v1") == ["scipy"]


# [AI生成]
def test_method_missing_dependencies_error_rejects_unknown_method():
    """异常路径：未知方法不能做依赖探测，必须报 ALGORITHM_UNKNOWN。"""
    with pytest.raises(BaselineError) as error:
        method_missing_dependencies("missing-v1")
    assert error.value.code == "ALGORITHM_UNKNOWN"


# [AI生成]
def test_method_catalog_normal_marks_classic_methods_available():
    """正常路径：经典 schema 下 9 个方法都应出现在目录中，逻辑回归可用。"""
    methods = method_catalog("openstack-six-v1")
    assert len(methods) == 9
    assert next(item for item in methods if item["method"] == "logistic-regression-l2-v1")["available"] is True


# [AI生成]
def test_method_catalog_boundary_marks_semantic_only_schema_unsupported():
    """边界路径：只支持语义向量的 schema 下，经典方法应标记为 schema 不兼容。"""
    methods = method_catalog("code-semantic-codebert-v1")
    assert all(item["available"] is False for item in methods)
    assert all(item["supportedSchema"] is False for item in methods)


# [AI生成]
def test_method_catalog_error_rejects_unknown_schema():
    """异常路径：未知 schema 必须报 SCHEMA_UNKNOWN。"""
    with pytest.raises(BaselineError) as error:
        method_catalog("missing-schema")
    assert error.value.code == "SCHEMA_UNKNOWN"


# [AI生成]
def test_check_method_normal_returns_compatible_method():
    """正常路径：方法与 schema 兼容时返回方法定义。"""
    assert check_method(
        "logistic-regression-l2-v1", "openstack-six-v1"
    )["estimator"] == "logistic-regression"


# [AI生成]
def test_check_method_boundary_rejects_semantic_only_schema():
    """边界路径：经典方法配语义 schema 时必须报 METHOD_SCHEMA_MISMATCH。"""
    with pytest.raises(BaselineError) as error:
        check_method("logistic-regression-l2-v1", "code-semantic-codebert-v1")
    assert error.value.code == "METHOD_SCHEMA_MISMATCH"


# [AI生成]
def test_check_method_error_reports_missing_dependency(monkeypatch):
    """异常路径：依赖缺失时返回 METHOD_DEPENDENCY_UNAVAILABLE，而不是后续运行崩溃。"""
    import jit_baseline.algorithms as algorithms
    monkeypatch.setattr(algorithms.importlib.util, "find_spec", lambda _name: None)
    with pytest.raises(BaselineError) as error:
        check_method("random-forest-v1", "openstack-six-v1")
    assert error.value.code == "METHOD_DEPENDENCY_UNAVAILABLE"


# [AI生成]
def test_model_descriptor_normal_preserves_known_identity():
    """正常路径：已知 schema/方法组合必须保留固定模型标识和中文名称。"""
    assert model_descriptor("kamei14-v1", "logistic-regression-l2-v1") == {
        "id": "logistic-regression-kamei14-v1",
        "name": "逻辑回归 · Kamei14（12 字段入模）",
    }


# [AI生成]
def test_model_descriptor_boundary_derives_custom_identity():
    """边界路径：未预置组合要能派生稳定标识，不能返回空或随机值。"""
    descriptor = model_descriptor("openstack-six-v1", "decision-tree-v1")
    assert descriptor == {
        "id": "decision-tree@openstack-six-v1",
        "name": "决策树 · openstack-six-v1",
    }


# [AI生成]
def test_model_descriptor_error_rejects_unknown_method():
    """异常路径：未知方法不能生成模型描述，必须报 ALGORITHM_UNKNOWN。"""
    with pytest.raises(BaselineError) as error:
        model_descriptor("openstack-six-v1", "missing-v1")
    assert error.value.code == "ALGORITHM_UNKNOWN"


# ---------------------------------------------------------------------------
# 特征矩阵、预测列选择与预测输入契约
# 目标：schema 列序、语义向量拼接、非有限值拒绝、label=1 概率列选择，
# 以及客户端特征与已保存提交这两种输入来源的冲突校验。
# ---------------------------------------------------------------------------
# [AI生成]
def test_feature_matrix_normal_organizes_openstack_columns_in_schema_order():
    """正常路径：OpenStack 六列必须按 schema 顺序组成矩阵，不能按输入字典顺序。"""
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
    """正常路径：Kamei14 的 14 列顺序必须原样保留，列序错位会改变模型含义。"""
    vector = list(range(1, 15))
    matrix = feature_matrix([{"features": vector}], "kamei14-git-v2")
    assert matrix.tolist() == [vector]


# [AI生成]
def test_feature_matrix_normal_appends_semantic_vectors_after_experts():
    """正常路径：语义向量必须追加在 14 个专家特征之后，不能覆盖专家列。"""
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
    """边界路径：纯语义 schema 允许没有专家特征，矩阵只包含 768 维语义向量。"""
    semantic = [index / 10 for index in range(768)]
    matrix = feature_matrix(
        [{"features": list(range(1, 15)), "semantic": semantic}],
        "code-semantic-codebert-v1",
    )
    assert matrix.shape == (1, 768)
    assert matrix[0].tolist() == semantic


# [AI生成]
def test_feature_matrix_boundary_accepts_all_zero_values():
    """边界路径：全 0 特征是合法输入，不能被误判为缺失。"""
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
    """异常路径：空集合、列数错误、NaN/Inf、负值和缺失 features 都必须拒绝。"""
    with pytest.raises(BaselineError) as error:
        feature_matrix(records)
    assert error.value.code == "FEATURES_INVALID"


# [AI生成]
def test_predict_risks_normal_selects_label_one_column_when_classes_are_reversed():
    """正常路径：classes_ 为 [1, 0] 时必须按 label=1 的位置取第一列，不能固定取第二列。"""
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
    """正常路径：classes_ 为 [0, 1] 时应取第二列，和反转类别时形成对照。"""
    pipeline = _ProbabilityPipeline([0, 1], [[0.2, 0.8], [0.7, 0.3]])
    records = [{"features": [1, 2, 3, 0.5, 4, 5]}, {"features": [6, 7, 8, 0.25, 9, 10]}]
    assert predict_risks(pipeline, records) == [0.8, 0.3]


# [AI生成]
def test_predict_risks_boundary_accepts_zero_and_one():
    """边界路径：风险 0 和 1 都是合法输出，不能被过滤或截断。"""
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
    """异常路径：行数不符、NaN、越界、缺少正类或模型抛错都必须报 INFERENCE_ERROR。"""
    records = [
        {"features": [1, 2, 3, 0.5, 4, 5]},
        {"features": [2, 3, 4, 0.6, 5, 6]},
    ]
    with pytest.raises(BaselineError) as error:
        predict_risks(pipeline, records)
    assert error.value.code == "INFERENCE_ERROR"


# [AI生成]
def test_prediction_input_normal_accepts_client_features_and_normalizes_identity():
    """正常路径：客户端特征按 schema 排序，提交 ID 转小写，时间统一成 UTC。"""
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
    """边界路径：已保存提交可以不带客户端特征，但必须显式给出 datasetVersion。"""
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
    """异常路径：两种输入来源冲突或字段不完整时，必须精确指出出错字段。"""
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
    """异常路径：缺列、多列、小数、布尔、NaN 或负值都必须拒绝并指出字段。"""
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
    """异常路径：没有时区的时间不能猜成本地时间，必须拒绝并指出 record.time。"""
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


# ---------------------------------------------------------------------------
# 模型构建、类别策略、训练与预处理
# 目标：声明的方法必须真正进入 Pipeline；类别权重/采样必须可复现且不改原输入；
# 单类训练、不收敛模型和越界预处理必须明确失败。
# ---------------------------------------------------------------------------
# [AI生成]
def test_build_estimator_normal_uses_the_declared_method_factory():
    """正常路径：声明的方法必须真正创建对应 estimator，并使用冻结默认参数。"""
    estimator = build_estimator(get_algorithm("decision-tree-v1"))
    assert type(estimator).__name__ == "DecisionTreeClassifier"
    assert estimator.get_params()["max_depth"] == 8
    assert estimator.get_params()["min_samples_leaf"] == 50


# [AI生成]
def test_build_estimator_boundary_replaces_only_declared_override():
    """边界路径：只覆盖 max_depth 时，min_samples_leaf 必须保持默认。"""
    estimator = build_estimator(get_algorithm("decision-tree-v1"), {"max_depth": 12})
    assert estimator.get_params()["max_depth"] == 12
    assert estimator.get_params()["min_samples_leaf"] == 50


# [AI生成]
def test_build_estimator_error_rejects_unimplemented_estimator():
    """异常路径：登记了不存在的 estimator 时必须报 ALGORITHM_UNKNOWN。"""
    with pytest.raises(BaselineError) as error:
        build_estimator({"estimator": "missing-estimator", "kwargs": {}})
    assert error.value.code == "ALGORITHM_UNKNOWN"


# [AI生成]
def test_apply_class_policy_normal_returns_weights_without_reordering_records():
    """正常路径：类别权重只改变样本权重，不重排原始训练记录。"""
    records = _metric_records(costs=(1, 1, 1, 1), labels=(0, 1, 0, 1))
    result, weights, summary = apply_class_policy(
        records, {"kind": "weights", "positiveWeight": 3, "negativeWeight": 1})
    assert result is records
    assert weights.tolist() == [1.0, 3.0, 1.0, 3.0]
    assert summary["after"] == {"records": 4, "positives": 2}


# [AI生成]
def test_apply_class_policy_boundary_sample_is_seeded_and_does_not_mutate_input():
    """边界路径：采样扩增要固定种子可复现，并且只返回新列表，不能改原训练记录。"""
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
    """边界路径：正例多于负例时，采样应能扩增负例而不是只扩增正例。"""
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
    """异常路径：单类样本无法做类别采样，必须报 CLASS_POLICY_INVALID。"""
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
    """异常路径：权重为 0、负种子或未知策略都必须拒绝。"""
    with pytest.raises(BaselineError) as error:
        apply_class_policy(_metric_records(), policy)
    assert error.value.code == "CLASS_POLICY_INVALID"


# [AI生成]
def test_fit_model_normal_builds_declared_pipeline_and_predicts_all_records():
    """正常路径：训练得到 counts→model 两步流水线，并能为全部记录输出 0–1 风险。"""
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
    """边界路径：训练时允许声明的类别权重策略，且仍能对全部记录打分。"""
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
    """异常路径：单类训练或未知方法必须返回对应错误码。"""
    with pytest.raises(BaselineError) as error:
        fit_model(records, algorithm=algorithm)
    assert error.value.code == code


# [AI生成]
def test_fit_model_error_does_not_publish_a_nonconverged_estimator(monkeypatch):
    """异常路径：不收敛模型必须报 MODEL_NOT_CONVERGED，不能返回不可信 Pipeline。"""
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
    """正常路径：只对声明的列做 log1p，其他列保持原值，并返回新矩阵。"""
    matrix = np.asarray([[1.0, 2.0, 3.0], [0.0, 4.0, 8.0]])
    result = Log1pColumns((0, 2))(matrix)
    assert result.tolist() == [
        [np.log1p(1.0), 2.0, np.log1p(3.0)],
        [np.log1p(0.0), 4.0, np.log1p(8.0)],
    ]
    assert result is not matrix


# [AI生成]
def test_log1p_columns_boundary_without_columns_returns_an_independent_copy():
    """边界路径：没有声明列时应原样返回独立副本，不能直接复用输入对象。"""
    matrix = np.asarray([[1.0, 2.0]])
    result = Log1pColumns(())(matrix)
    assert result.tolist() == [[1.0, 2.0]]
    assert result is not matrix


# [AI生成]
def test_log1p_columns_error_rejects_out_of_range_column():
    """异常路径：列索引越界必须报 IndexError，不能静默跳过。"""
    with pytest.raises(IndexError):
        Log1pColumns((2,))(np.asarray([[1.0, 2.0]]))


# [AI生成]
def test_expert_standard_scaler_normal_scales_experts_and_preserves_semantic_tail():
    """正常路径：只标准化专家列，语义向量尾部必须保持原值。"""
    matrix = np.asarray([[1.0, 10.0, 0.25], [3.0, 30.0, 0.75]])
    scaler = ExpertStandardScaler(2).fit(matrix)
    transformed = scaler.transform(matrix)
    assert np.allclose(transformed[:, :2].mean(axis=0), [0.0, 0.0])
    assert np.allclose(transformed[:, 2], [0.25, 0.75])
    assert scaler.n_features_in_ == 3


# [AI生成]
def test_expert_standard_scaler_boundary_without_expert_columns_keeps_values():
    """边界路径：专家列数为 0 时保持数值不变，但仍返回新对象。"""
    matrix = np.asarray([[1.0, 2.0], [3.0, 4.0]])
    transformed = ExpertStandardScaler(0).fit_transform(matrix)
    assert np.allclose(transformed, matrix)
    assert transformed is not matrix


# [AI生成]
def test_expert_standard_scaler_error_rejects_more_experts_than_columns():
    """异常路径：声明的专家列数超过矩阵列数时必须拒绝。"""
    with pytest.raises(ValueError):
        ExpertStandardScaler(3).fit(np.asarray([[1.0, 2.0]]))
