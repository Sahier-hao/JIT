"""Verified publisher bytes and auditable conversion; no fabricated metrics."""
import csv
import hashlib
import io
import math
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from .config import BASE_URL, COHORT, FEATURES, SOURCES


class BaselineError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


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
    for filename, (relative, expected) in SOURCES.items():
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
    return {name: {"url": BASE_URL + SOURCES[name][0], "sha256": sha256(blob), "bytes": len(blob)}
            for name, blob in verified.items()}


def integer(value, field, line):
    if not isinstance(value, str) or not re.fullmatch(r"\d+", value):
        raise BaselineError("DATA_INVALID", f"第 {line} 行：{field} 须为非负整数")
    return int(value)


def parse_source(blob):
    try:
        reader = csv.DictReader(io.StringIO(blob.decode("utf-8-sig")), strict=True)
        required = {"commit_id", "author_date", "bugcount", *FEATURES}
        if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames) or not required <= set(reader.fieldnames):
            raise BaselineError("DATA_INVALID", "来源字段定义无效或不完整")
        seen, records = set(), []
        quality = {"rawRows": 0, "includedRows": 0, "positiveLabels": 0, "blankLabels": 0,
                   "excluded": dict.fromkeys(["outsideWindow", "noAddedLines", "tooMuchChurn", "tooManyFiles"], 0)}
        for line, raw in enumerate(reader, start=2):
            quality["rawRows"] += 1
            if None in raw or any(raw[key] is None for key in required):
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
            # Required numbers are checked even for excluded rows; exclusions never hide bad data.
            metrics = {}
            for field in FEATURES:
                try:
                    value = float(raw[field])
                except ValueError as exc:
                    raise BaselineError("DATA_INVALID", f"第 {line} 行：{field} 缺失或无效") from exc
                if not math.isfinite(value) or value < 0 or (field != "ent" and not value.is_integer()):
                    raise BaselineError("DATA_INVALID", f"第 {line} 行：{field} 数值无效")
                metrics[field] = value if field == "ent" else int(value)
            count = 0 if raw["bugcount"] == "" else integer(raw["bugcount"], "bugcount", line)
            reason = ("outsideWindow" if not COHORT["startEpochInclusive"] <= epoch < COHORT["endEpochExclusive"] else
                      "noAddedLines" if metrics["la"] <= 0 else
                      "tooMuchChurn" if metrics["la"] + metrics["ld"] > COHORT["maxChurnInclusive"] else
                      "tooManyFiles" if metrics["nf"] > COHORT["maxFilesInclusive"] else None)
            if reason:
                quality["excluded"][reason] += 1
                continue
            label = int(count > 0)
            records.append({"id": identity, "time": time, "epoch": epoch, "sourceRow": line,
                            "metrics": metrics, "features": [metrics[f] for f in FEATURES], "label": label})
            quality["positiveLabels"] += label
            quality["blankLabels"] += int(raw["bugcount"] == "")
        quality["includedRows"] = len(records)
        quality["featureMissing"] = dict.fromkeys(FEATURES, 0)
        return sorted(records, key=lambda r: (r["epoch"], r["id"])), quality
    except (UnicodeDecodeError, csv.Error) as exc:
        raise BaselineError("DATA_INVALID", "来源 CSV 编码或结构无效") from exc
