"""行级特征的唯一实现：离线训练与研究预览共用，避免打分口径漂移。"""
from __future__ import annotations

from typing import Any

FEATURE_NAMES = ["ns", "nd", "nf", "entropy", "la", "ld", "lt", "fix", "ndev",
                 "age", "nuc", "exp", "rexp", "sexp"]
TEXT_PARAMS = dict(analyzer="char_wb", ngram_range=(3, 5), min_df=2, max_features=30000,
                   sublinear_tf=True)
STRUCT_KEYS = ["if", "for", "while", "return", "try", "catch", "assign", "compare",
               "call", "member", "index", "identifier", "digit"]


def structure(text: str) -> dict[str, int]:
    """按训练时的固定关键字口径统计单行结构特征。"""
    return {
        "if": text.count("if "), "for": text.count("for "), "while": text.count("while "),
        "return": text.count("return "), "try": text.count("try"), "catch": text.count("catch"),
        "assign": text.count("=") - text.count("==") - text.count("!=") - text.count(">=") - text.count("<="),
        "compare": text.count("==") + text.count("!=") + text.count(">=") + text.count("<="),
        "call": text.count("("), "member": text.count("."), "index": text.count("["),
        "identifier": sum(1 for token in text.replace("(", " ").replace(")", " ").split()
                          if token and (token[0].isalpha() or token[0] == "_")),
        "digit": sum(1 for ch in text if ch.isdigit()),
    }


def numeric_values(row: dict[str, Any], *, include_commit: bool = True,
                   position_features: bool = True) -> list[float]:
    """返回与训练完全一致的数值/结构特征向量。"""
    text = str(row.get("text") or "")
    structure_counts = structure(text)
    values = [len(text), float(row.get("indent") or 0),
              1.0 if row.get("blank") else 0.0, 1.0 if row.get("comment") else 0.0]
    if position_features:
        values.extend([float(row.get("fileLines") or 0), float(row.get("lineRatio") or 0.0)])
    values.extend(float(structure_counts[key]) for key in STRUCT_KEYS)
    if include_commit:
        features = row.get("commitFeatures") or {}
        for name in FEATURE_NAMES:
            try:
                values.append(float(features.get(name) or 0.0))
            except (TypeError, ValueError):
                values.append(0.0)
    return values


def numeric_feature_names(*, include_commit: bool = True,
                          position_features: bool = True) -> list[str]:
    """返回与 `numeric_values` 顺序一一对应的特征名。"""
    names = (["lineLength", "indent", "blank", "comment"]
             + (["fileLines", "lineRatio"] if position_features else [])
             + STRUCT_KEYS)
    if include_commit:
        names.extend(FEATURE_NAMES)
    return names
