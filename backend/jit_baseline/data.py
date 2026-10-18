"""Verified publisher bytes and auditable conversion; no fabricated metrics."""
import csv
import hashlib
import io
import math
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from .config import BASE_URL, COHORT, SOURCES
from .errors import BaselineError
from .schemas import BLANK_ERROR, BLANK_EXCLUDE, BLANK_ZERO, DEFAULT_SCHEMA, resolve

__all__ = ["BaselineError", "fetch_sources", "parse_source", "sha256", "verified_bytes"]


def sha256(blob):
    return hashlib.sha256(blob).hexdigest()


def verified_bytes(path, expected):
    try:
        blob = Path(path).read_bytes()
    except OSError as exc:
        raise BaselineError("SOURCE_UNAVAILABLE", f"来源不可用：{Path(path).name}") from exc
    if sha256(blob) != expected:
        raise BaselineError("INTEGRITY_ERROR", f"来源校验不匹配：{Path(path).name}")
    return blob


def fetch_sources(directory, opener=urllib.request.urlopen):
    directory = Path(directory)
    verified = {}
    for filename, entry in SOURCES.items():
        relative, expected = entry["path"], entry["sha256"]
        path = directory / filename
        if path.exists():
            verified[filename] = verified_bytes(path, expected)
            continue
        try:
            with opener(BASE_URL + relative, timeout=30) as response:
                blob = response.read(6_000_001)
        except OSError as exc:
            raise BaselineError("SOURCE_UNAVAILABLE", f"来源不可用：{filename}") from exc
        if len(blob) > 6_000_000 or sha256(blob) != expected:
            raise BaselineError("INTEGRITY_ERROR", f"来源校验不匹配：{filename}")
        verified[filename] = blob
    # Nothing is written until all three publisher files pass verification.
    directory.mkdir(parents=True, exist_ok=True)
    for filename, blob in verified.items():
        path = directory / filename
        if not path.exists():
            path.write_bytes(blob)
    return {name: {"url": BASE_URL + SOURCES[name]["path"], "sha256": sha256(blob), "bytes": len(blob)}
            for name, blob in verified.items()}


def integer(value, field, line):
    if not isinstance(value, str) or not re.fullmatch(r"\d+", value):
        raise BaselineError("DATA_INVALID", f"第 {line} 行：{field} 须为非负整数")
    return int(value)


def parse_source(blob, schema=None, cohort=None):
    """按具名 schema 解析来源。

    缺失不填补：`BLANK_EXCLUDE` 字段缺失的行显式排除并计数，`BLANK_ERROR` 字段缺失即数据无效；
    只有发布者规则（如 `fix := fixcount > 0`）的 `BLANK_ZERO` 字段把空值取 0。
    纳入窗口由 `cohort` 给出；省略时用 OpenStack 固定窗口，仓库采集传入自己的范围。
    """
    schema = resolve(schema if schema is not None else DEFAULT_SCHEMA)
    cohort = COHORT if cohort is None else cohort
    in_model = schema.in_model_fields()
    try:
        reader = csv.DictReader(io.StringIO(blob.decode("utf-8-sig")), strict=True)
        required = {"commit_id", "author_date", "bugcount", "la", "ld", "nf"}
        required |= {field.source for field in in_model if field.source}
        if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames) or not required <= set(reader.fieldnames):
            raise BaselineError("DATA_INVALID", "来源字段定义无效或不完整")
        seen, records = set(), []
        quality = {"rawRows": 0, "includedRows": 0, "positiveLabels": 0, "blankLabels": 0,
                   "featureMissing": {field.name: 0 for field in in_model},
                   "excluded": dict.fromkeys(
                       ["outsideWindow", "noAddedLines", "tooMuchChurn", "tooManyFiles", "missingRequiredField"], 0)}
        for line, raw in enumerate(reader, start=2):
            quality["rawRows"] += 1
            if None in raw or any(raw.get(key) is None for key in required):
                raise BaselineError("DATA_INVALID", f"第 {line} 行：列数量无效")
            identity = raw["commit_id"]
            if not re.fullmatch(r"[0-9a-f]{40}", identity):
                raise BaselineError("DATA_INVALID", f"第 {line} 行：提交标识无效")
            if identity in seen:
                raise BaselineError("DATA_INVALID", f"第 {line} 行：提交标识重复")
            seen.add(identity)
            epoch = integer(raw["author_date"], "author_date", line)
            try:
                time = datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
            except (OverflowError, OSError, ValueError) as exc:
                raise BaselineError("DATA_INVALID", f"第 {line} 行：提交时间无效") from exc
            # 必需数值即使对将被排除的行也先校验；排除规则不会隐藏坏数据。
            metrics, missing = {}, []
            for field in in_model:
                text = (raw.get(field.source) or "").strip() if field.source else ""
                if text == "":
                    if field.blank == BLANK_ZERO:
                        metrics[field.name] = 0
                    elif field.blank == BLANK_EXCLUDE:
                        missing.append(field.name)
                    else:
                        raise BaselineError("DATA_INVALID", f"第 {line} 行：{field.name} 缺失或无效")
                    continue
                try:
                    value = float(text)
                except ValueError as exc:
                    raise BaselineError("DATA_INVALID", f"第 {line} 行：{field.name} 缺失或无效") from exc
                if not math.isfinite(value) or value < 0 or (field.integer and not value.is_integer()):
                    raise BaselineError("DATA_INVALID", f"第 {line} 行：{field.name} 数值无效")
                metrics[field.name] = int(value > 0) if field.binary else int(value) if field.integer else value

            def number(name):
                text = (raw.get(name) or "").strip()
                return float(text) if text else None

            la, ld, nf = number("la"), number("ld"), number("nf")
            reason = ("outsideWindow" if not cohort["startEpochInclusive"] <= epoch < cohort["endEpochExclusive"] else
                      "noAddedLines" if la is not None and la <= 0 else
                      "tooMuchChurn" if la is not None and ld is not None and la + ld > cohort["maxChurnInclusive"] else
                      "tooManyFiles" if nf is not None and nf > cohort["maxFilesInclusive"] else
                      "missingRequiredField" if missing else None)
            if reason:
                quality["excluded"][reason] += 1
                if reason == "missingRequiredField":
                    for name in missing:
                        quality["featureMissing"][name] += 1
                continue
            count = 0 if raw["bugcount"] == "" else integer(raw["bugcount"], "bugcount", line)
            label = int(count > 0)
            records.append({"id": identity, "time": time, "epoch": epoch, "sourceRow": line,
                            "metrics": metrics, "features": [metrics[field.name] for field in in_model], "label": label})
            quality["positiveLabels"] += label
            quality["blankLabels"] += int(raw["bugcount"] == "")
        quality["includedRows"] = len(records)
        return sorted(records, key=lambda r: (r["epoch"], r["id"])), quality
    except (UnicodeDecodeError, csv.Error) as exc:
        raise BaselineError("DATA_INVALID", "来源 CSV 编码或结构无效") from exc
