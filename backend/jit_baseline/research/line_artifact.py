"""可移植行级研究模型的规范化摘要；训练导出与预览校验共用。"""
from __future__ import annotations

import hashlib
import json
from typing import Any

PREVIEW_SCHEMA = "line-preview-model-v1"


def preview_digest(preview: dict[str, Any]) -> str:
    """对模型可执行部分做规范化摘要，不含生成时间等易变字段。"""
    payload = {"features": preview["features"], "intercept": preview["intercept"],
               "coefficients": preview["coefficients"]}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()
