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
from .label_maturity import STATUSES
from .schemas import BLANK_ERROR, BLANK_EXCLUDE, BLANK_ZERO, DEFAULT_SCHEMA, KAMEI_2013_SCHEMA, resolve

__all__ = ["BaselineError", "fetch_sources", "parse_source", "sha256", "verified_bytes"]

KAMEI_2013_COHORT = {
    "startEpochInclusive": 0, "endEpochExclusive": 253402300800,
    "addedLinesGreaterThan": None, "maxChurnInclusive": None, "maxFilesInclusive": None,
}


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


def _published_change(raw, line):
    transaction = raw["transactionid"]
    if not re.fullmatch(r"[0-9]{1,32}", transaction):
        raise BaselineError("DATA_INVALID", f"第 {line} 行：transactionid 须为数字编号")
    # 内部索引使用 40 位标识，原始编号保留在 CSV 内。标识按数据版本区分。
    identity = sha256(f"kamei-2013:{transaction}".encode())[:40]
    try:
        calendar = datetime.strptime(raw["commitdate"], "%Y/%m/%d %H:%M")
        epoch = int(calendar.replace(tzinfo=timezone.utc).timestamp())
    except (ValueError, OverflowError, OSError) as exc:
        raise BaselineError("DATA_INVALID", f"第 {line} 行：commitdate 须为 YYYY/M/D H:MM") from exc
    if raw["bug"] not in ("0", "1") or raw["fix"] not in ("0", "1"):
        raise BaselineError("DATA_INVALID", f"第 {line} 行：bug 与 fix 须为 0 或 1")
    return identity, epoch


def published_cost_scale(metrics):
    """Kamei 发布包 predUtils.r 的 decChurn 换算系数。"""
    return (metrics["lt"] * metrics["nf"] or 1) / 2


def review_cost(record):
    """将改动量换算为审查成本，普通数据使用原始增删行数。"""
    metrics = record["metrics"]
    return (metrics["la"] + metrics["ld"]) * record.get("costScale", 1)


def parse_source(blob, schema=None, cohort=None):
    """按具名 schema 解析来源。

    缺失不填补：`BLANK_EXCLUDE` 字段缺失的行显式排除并计数，`BLANK_ERROR` 字段缺失即数据无效；
    只有发布者规则（如 `fix := fixcount > 0`）的 `BLANK_ZERO` 字段把空值取 0。
    纳入窗口由 `cohort` 给出；省略时用 OpenStack 固定窗口，仓库采集传入自己的范围。
    """
    schema = resolve(schema if schema is not None else DEFAULT_SCHEMA)
    published = schema.name == KAMEI_2013_SCHEMA
    if cohort is None:
        cohort = KAMEI_2013_COHORT if published else COHORT
    in_model = schema.in_model_fields()
    try:
        reader = csv.DictReader(io.StringIO(blob.decode("utf-8-sig")), strict=True)
        label_column = "bug" if published else "bugcount"
        required = ({"transactionid", "commitdate", label_column} if published
                    else {"commit_id", "author_date", label_column, "la", "ld", "nf"})
        required |= {field.source for field in in_model if field.source}
        if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames) or not required <= set(reader.fieldnames):
            raise BaselineError("DATA_INVALID", "来源字段定义无效或不完整")
        status_columns = {"label_status", "observed_through_epoch", "maturity_days"}
        present_status_columns = status_columns & set(reader.fieldnames)
        if published and present_status_columns:
            raise BaselineError("DATA_INVALID", "Kamei 2013 CSV 使用发布者标签")
        if present_status_columns and present_status_columns != status_columns:
            raise BaselineError("DATA_INVALID", "标签成熟字段必须同时提供")
        has_label_status = present_status_columns == status_columns
        seen, records = set(), []
        quality = {"rawRows": 0, "includedRows": 0, "positiveLabels": 0, "blankLabels": 0,
                   "featureMissing": {field.name: 0 for field in in_model},
                   "excluded": dict.fromkeys(
                       ["outsideWindow", "noAddedLines", "tooMuchChurn", "tooManyFiles", "missingRequiredField"], 0)}
        if has_label_status:
            quality["labelStatusCounts"] = {name: 0 for name in STATUSES}
        for line, raw in enumerate(reader, start=2):
            quality["rawRows"] += 1
            if None in raw or any(raw.get(key) is None for key in required):
                raise BaselineError("DATA_INVALID", f"第 {line} 行：列数量无效")
            if published:
                identity, epoch = _published_change(raw, line)
            else:
                identity = raw["commit_id"]
                if not re.fullmatch(r"[0-9a-f]{40}", identity):
                    raise BaselineError("DATA_INVALID", f"第 {line} 行：提交标识无效")
                epoch = integer(raw["author_date"], "author_date", line)
            if identity in seen:
                raise BaselineError("DATA_INVALID", f"第 {line} 行：提交标识重复")
            seen.add(identity)
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
            min_added = cohort["addedLinesGreaterThan"]
            max_churn = cohort["maxChurnInclusive"]
            max_files = cohort["maxFilesInclusive"]
            reason = ("outsideWindow" if not cohort["startEpochInclusive"] <= epoch < cohort["endEpochExclusive"] else
                      "noAddedLines" if min_added is not None and la is not None and la <= min_added else
                      "tooMuchChurn" if max_churn is not None and la is not None and ld is not None and la + ld > max_churn else
                      "tooManyFiles" if max_files is not None and nf is not None and nf > max_files else
                      "missingRequiredField" if missing else None)
            if reason:
                quality["excluded"][reason] += 1
                if reason == "missingRequiredField":
                    for name in missing:
                        quality["featureMissing"][name] += 1
                continue
            count = 0 if raw[label_column] == "" else integer(raw[label_column], label_column, line)
            label = int(count > 0)
            record = {"id": identity, "time": time, "epoch": epoch, "sourceRow": line,
                      "metrics": metrics, "features": [metrics[field.name] for field in in_model],
                      "label": label, "labelStatus": "unrecorded"}
            if published:
                record["costScale"] = published_cost_scale(metrics)
            if has_label_status:
                status = (raw.get("label_status") or "").strip().lower()
                if status not in STATUSES[:-1] or status == "unrecorded":
                    raise BaselineError("DATA_INVALID", f"第 {line} 行：标签成熟状态无效")
                observed_through = integer(
                    raw["observed_through_epoch"], "observed_through_epoch", line
                )
                maturity_days = integer(raw["maturity_days"], "maturity_days", line)
                if observed_through < epoch:
                    raise BaselineError("DATA_INVALID", f"第 {line} 行：观察终点早于提交时间")
                if status == "positive" and label != 1:
                    raise BaselineError("DATA_INVALID", f"第 {line} 行：正例标签状态与标签冲突")
                if status != "positive" and label != 0:
                    raise BaselineError("DATA_INVALID", f"第 {line} 行：未成熟或未观测状态与标签冲突")
                recomputed = ("immature"
                              if observed_through - epoch < maturity_days * 86400
                              else "unobserved")
                if status != "positive" and status != recomputed:
                    raise BaselineError("DATA_INVALID", f"第 {line} 行：标签成熟状态不可重算")
                record.update(labelStatus=status, observedThroughEpoch=observed_through,
                              maturityDays=maturity_days)
                quality["labelStatusCounts"][status] += 1
            records.append(record)
            quality["positiveLabels"] += label
            quality["blankLabels"] += int(raw[label_column] == "")
        quality["includedRows"] = len(records)
        return sorted(records, key=lambda r: (r["epoch"], r["id"])), quality
    except (UnicodeDecodeError, csv.Error) as exc:
        raise BaselineError("DATA_INVALID", "来源 CSV 编码或结构无效") from exc
