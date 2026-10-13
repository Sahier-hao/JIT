"""具名特征 schema 注册表：字段顺序、来源列、核验状态、入模标记与变换。

见 align-feature-and-model-definitions 的 design D2/D3 与规格 FSV-01..FSV-03：
schema 是特征集合的唯一声明来源；运行按其声明解析与校验；未知 schema 与不可得字段必须被拒绝。
"""
from dataclasses import dataclass

from .errors import BaselineError

LOG1P = "log1p"
RAW = "raw"

BLANK_ERROR = "error"      # 空值即数据无效（首轮六字段行为）
BLANK_EXCLUDE = "exclude"  # 空值即排除该行并计数
BLANK_ZERO = "zero"        # 发布者规则：空值取 0

VERIFIED = "verified"
UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class Field:
    name: str
    source: str | None
    in_model: bool = True
    transform: str = RAW
    blank: str = BLANK_EXCLUDE
    integer: bool = False
    binary: bool = False
    status: str = VERIFIED
    reason: str = ""


@dataclass(frozen=True)
class Schema:
    name: str
    fields: tuple

    def in_model_fields(self):
        return tuple(f for f in self.fields if f.in_model)

    def in_model_names(self):
        return tuple(f.name for f in self.in_model_fields())

    def unavailable(self):
        return tuple(f for f in self.fields if f.status == UNAVAILABLE)

    def by_name(self, name):
        for field in self.fields:
            if field.name == name:
                return field
        raise BaselineError("SCHEMA_FIELD_UNKNOWN", f"schema {self.name} 不含字段：{name}")

    def log1p_indices(self):
        """按入模顺序返回需要 log1p 的列索引。"""
        return tuple(index for index, field in enumerate(self.in_model_fields()) if field.transform == LOG1P)


_SIX = Schema("openstack-six-v1", (
    Field("ns", "ns", transform=LOG1P, blank=BLANK_ERROR, integer=True),
    Field("nd", "nd", transform=LOG1P, blank=BLANK_ERROR, integer=True),
    Field("nf", "nf", transform=LOG1P, blank=BLANK_ERROR, integer=True),
    Field("ent", "ent", blank=BLANK_ERROR),
    Field("la", "la", transform=LOG1P, blank=BLANK_ERROR, integer=True),
    Field("ld", "ld", transform=LOG1P, blank=BLANK_ERROR, integer=True),
))

_KAMEI14 = Schema("kamei14-v1", (
    Field("ns", "ns", transform=LOG1P, integer=True),
    Field("nd", "nd", transform=LOG1P, integer=True),
    Field("nf", "nf", transform=LOG1P, integer=True),
    Field("entropy", "ent"),
    Field("la", "la", transform=LOG1P, integer=True),
    Field("ld", "ld", transform=LOG1P, integer=True),
    Field("lt", None, in_model=False, status=UNAVAILABLE,
          reason="固定快照不含变更前文件规模（Size 家族只有 la、ld），不能用 la+ld 替代"),
    Field("fix", "fixcount", blank=BLANK_ZERO, integer=True, binary=True,
          reason="发布者规则 fix := fixcount > 0；空值表示该变更未修复缺陷"),
    Field("ndev", "ndev", transform=LOG1P, integer=True),
    Field("age", "age"),
    Field("nuc", "nuc", transform=LOG1P, integer=True),
    Field("exp", "aexp", transform=LOG1P, integer=True),
    Field("rexp", None, in_model=False, status=UNAVAILABLE,
          reason="同名列 rexp 是 Reviewer experience；候选 arexp 只给标签、无定义，无法核验"),
    Field("sexp", "asexp", transform=LOG1P, integer=True),
))

SCHEMAS = {schema.name: schema for schema in (_SIX, _KAMEI14)}
DEFAULT_SCHEMA = "openstack-six-v1"


def get_schema(name):
    """按名称取回 schema；未知名称被拒绝，不退回默认。"""
    try:
        return SCHEMAS[name]
    except (KeyError, TypeError):
        raise BaselineError("SCHEMA_UNKNOWN", f"未注册的特征 schema：{name}") from None


def resolve(schema):
    """接受 Schema 或名称，返回 Schema。"""
    return schema if isinstance(schema, Schema) else get_schema(schema)


def reject_substitution(schema, field_name, expression):
    """拒绝用同名列或推算值替代不可得字段（FSV-02）。"""
    resolved = resolve(schema)
    field = resolved.by_name(field_name)
    if field.status == UNAVAILABLE:
        raise BaselineError("SCHEMA_FIELD_UNAVAILABLE",
                            f"{field_name} 在 {resolved.name} 中不可用（{field.reason}），不接受以 {expression} 替代")
    return field
