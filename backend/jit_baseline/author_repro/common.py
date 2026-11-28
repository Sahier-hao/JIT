"""Shared deterministic helpers for author reproduction runs."""
from __future__ import annotations

import hashlib
import json
import math
import os
import platform
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest_bytes(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def digest_json(value) -> str:
    return digest_bytes(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                   separators=(",", ":")).encode("utf-8"))


def file_sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def write_json(path: Path, value) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8")


def write_jsonl(path: Path, rows) -> int:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
            count += 1
    return count


def environment() -> dict:
    packages = {}
    for name, module in (("torch", "torch"), ("transformers", "transformers"),
                         ("numpy", "numpy"), ("pandas", "pandas"),
                         ("scikit-learn", "sklearn")):
        try:
            packages[name] = __import__(module).__version__
        except Exception:
            packages[name] = None
    return {
        "python": platform.python_version(),
        "executable": sys.executable,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "packages": packages,
        "cudaAvailable": bool(_cuda_available()),
        "env": {key: os.environ[key] for key in
                ("CUDA_VISIBLE_DEVICES", "OMP_NUM_THREADS", "PYTHONHASHSEED")
                if key in os.environ},
    }


def _cuda_available() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)
    try:
        import torch
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
    except Exception:
        pass


def finite_probability(value) -> float:
    number = float(value)
    if not math.isfinite(number) or not 0.0 <= number <= 1.0:
        raise ValueError(f"预测分数不是 [0,1] 内有限值：{value!r}")
    return number


def safe_relative(path: Path, base: Path) -> str:
    try:
        return Path(path).resolve().relative_to(Path(base).resolve()).as_posix()
    except ValueError:
        return Path(path).name
