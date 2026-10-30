"""具名 schema 注册表与按 schema 准入的契约测试；使用合成样例，不代表公开数据结果。"""
import csv
import io

import pytest


def test_two_schemas_are_registered_with_declared_order():
    from jit_baseline.schemas import SCHEMAS, get_schema
    assert set(SCHEMAS) == {"openstack-six-v1", "kamei14-v1", "kamei14-git-v1",
                            "kamei14-semantic-codebert-v1", "code-semantic-codebert-v1"}
    assert get_schema("openstack-six-v1").in_model_names() == ("ns", "nd", "nf", "ent", "la", "ld")
    kamei = get_schema("kamei14-v1")
    assert [field.name for field in kamei.fields] == [
        "ns", "nd", "nf", "entropy", "la", "ld", "lt", "fix", "ndev", "age", "nuc", "exp", "rexp", "sexp"]
    assert kamei.in_model_names() == (
        "ns", "nd", "nf", "entropy", "la", "ld", "fix", "ndev", "age", "nuc", "exp", "sexp")
    fused = get_schema("kamei14-semantic-codebert-v1")
    assert fused.semantic_dim() == 768 and fused.input_width() == 782
    only = get_schema("code-semantic-codebert-v1")
    assert only.semantic_only is True and only.input_width() == 768


def test_unknown_schema_is_rejected_not_defaulted():
    from jit_baseline.data import BaselineError
    from jit_baseline.schemas import get_schema
    with pytest.raises(BaselineError) as info:
        get_schema("kamei15-v9")
    assert info.value.code == "SCHEMA_UNKNOWN"


def test_unavailable_fields_are_declared_and_never_in_model():
    from jit_baseline.schemas import get_schema
    kamei = get_schema("kamei14-v1")
    unavailable = {field.name: field.reason for field in kamei.unavailable()}
    assert set(unavailable) == {"lt", "rexp"}
    assert all(unavailable.values())
    assert not {"lt", "rexp"} & set(kamei.in_model_names())


@pytest.mark.parametrize("field,expression", [("lt", "la+ld"), ("rexp", "rexp"), ("rexp", "arexp")])
def test_substitution_for_unavailable_fields_is_rejected(field, expression):
    from jit_baseline.data import BaselineError
    from jit_baseline.schemas import reject_substitution
    with pytest.raises(BaselineError) as info:
        reject_substitution("kamei14-v1", field, expression)
    assert info.value.code == "SCHEMA_FIELD_UNAVAILABLE"


def test_available_field_is_not_blocked_and_keeps_its_source_column():
    from jit_baseline.schemas import reject_substitution
    assert reject_substitution("kamei14-v1", "exp", "aexp").source == "aexp"


def test_transforms_follow_the_declaration():
    from jit_baseline.schemas import get_schema
    assert get_schema("openstack-six-v1").log1p_indices() == (0, 1, 2, 4, 5)
    assert get_schema("kamei14-v1").log1p_indices() == (0, 1, 2, 4, 5, 7, 9, 10, 11)


def kamei_csv(rows):
    fields = ["commit_id", "author_date", "bugcount", "fixcount", "ns", "nd", "nf", "ent", "la", "ld",
              "ndev", "age", "nuc", "aexp", "arexp", "asexp"]
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode()


def kamei_row(**overrides):
    return {"commit_id": "b" * 40, "author_date": "1350000000", "bugcount": "", "fixcount": "",
            "ns": "1", "nd": "2", "nf": "3", "ent": "0.5", "la": "4", "ld": "5",
            "ndev": "6", "age": "7.5", "nuc": "8", "aexp": "9", "arexp": "10", "asexp": "11", **overrides}


def test_kamei14_excludes_missing_rows_instead_of_zero_filling():
    from jit_baseline.data import parse_source
    records, quality = parse_source(kamei_csv([kamei_row(), kamei_row(commit_id="c" * 40, ndev="")]), "kamei14-v1")
    assert len(records) == 1
    assert quality["excluded"]["missingRequiredField"] == 1
    assert quality["featureMissing"]["ndev"] == 1
    assert quality["includedRows"] == 1


def test_kamei14_uses_publisher_rule_for_blank_fixcount_only():
    from jit_baseline.data import parse_source
    blank, _ = parse_source(kamei_csv([kamei_row()]), "kamei14-v1")
    assert blank[0]["metrics"]["fix"] == 0
    assert blank[0]["metrics"]["age"] == 7.5
    positive, _ = parse_source(kamei_csv([kamei_row(fixcount="3")]), "kamei14-v1")
    assert positive[0]["metrics"]["fix"] == 1


def test_six_schema_still_treats_blank_required_field_as_invalid():
    from jit_baseline.data import parse_source
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=["commit_id", "author_date", "bugcount", "ns", "nd", "nf", "ent", "la", "ld"])
    writer.writeheader()
    writer.writerow({"commit_id": "d" * 40, "author_date": "1350000000", "bugcount": "",
                     "ns": "1", "nd": "2", "nf": "3", "ent": "0.5", "la": "", "ld": "5"})
    with pytest.raises(ValueError, match="行"):
        parse_source(stream.getvalue().encode())


def test_git_schema_makes_all_fourteen_fields_available():
    from jit_baseline.schemas import get_schema
    git = get_schema("kamei14-git-v1")
    assert [field.name for field in git.fields] == [
        "ns", "nd", "nf", "entropy", "la", "ld", "lt", "fix", "ndev", "age", "nuc", "exp", "rexp", "sexp"]
    assert git.in_model_names() == tuple(field.name for field in git.fields)
    assert git.unavailable() == ()
    assert all(field.source == field.name for field in git.fields)
    assert git.log1p_indices() == (0, 1, 2, 4, 5, 6, 8, 10, 11, 12, 13)


def test_unknown_field_name_is_rejected_without_fallback():
    from jit_baseline.data import BaselineError
    from jit_baseline.schemas import get_schema
    with pytest.raises(BaselineError) as info:
        get_schema("kamei14-v1").by_name("notafield")
    assert info.value.code == "SCHEMA_FIELD_UNKNOWN"
