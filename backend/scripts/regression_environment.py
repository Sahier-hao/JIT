"""Prepare a clean-checkout regression environment without personal data.

Downloads the pinned public OpenStack sources when absent, builds the small
baseline run only when missing, verifies bundled model package hashes and creates
an isolated run root. Missing required inputs fail; nothing is skipped silently.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from jit_baseline.config import SOURCES  # noqa: E402
from jit_baseline.data import fetch_sources  # noqa: E402


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8192), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _prepare_sources() -> dict:
    target = BACKEND / "data" / "openstack"
    missing = [name for name in SOURCES if not (target / name).is_file()]
    if missing:
        print(f"下载固定公开数据：{', '.join(missing)}", flush=True)
        verified = fetch_sources(target)
        return {"downloaded": missing, "verified": verified}
    for name, entry in SOURCES.items():
        if _sha256(target / name) != entry["sha256"]:
            raise SystemExit(f"固定数据哈希不匹配：{name}")
    return {"downloaded": [], "verified": {name: "local-verified" for name in SOURCES}}


def _prepare_baseline(run_root: Path) -> dict:
    run = BACKEND / "artifacts" / "baseline"
    isolated = run_root / "artifacts" / "baseline"
    reproduction = BACKEND / "artifacts" / "reproduction"
    result = {}
    for label, target in (("backend", run), ("runRoot", isolated), ("reproduction", reproduction)):
        if (target / "manifest.json").is_file():
            result[label] = "present"
            continue
        from jit_baseline.artifacts import build_run
        print(f"生成固定基线运行 {target}", flush=True)
        build_run(BACKEND / "data" / "openstack", target)
        result[label] = "built"
    return result


def _verify_packages() -> list[dict]:
    result = []
    for package in sorted((BACKEND / "model-packages").glob("*.zip")):
        checksum = package.with_name(package.name + ".sha256")
        if not checksum.is_file():
            raise SystemExit(f"模型包缺少校验文件：{package.name}")
        expected = checksum.read_text(encoding="utf-8").split()[0].strip()
        actual = _sha256(package)
        if actual != expected:
            raise SystemExit(f"模型包校验失败：{package.name}")
        result.append({"name": package.name, "sha256": actual, "bytes": package.stat().st_size})
    if not result:
        raise SystemExit("没有可校验的模型包")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="准备干净回归环境")
    parser.add_argument("--root", type=Path, default=None)
    options = parser.parse_args()
    run_root = Path(options.root or os.environ.get("JIT_REGRESSION_ROOT")
                    or Path(os.environ.get("RUNNER_TEMP", ".")) / "jit-regression").resolve()
    for name in ("databases", "artifacts", "output", "logs", "pytest-basetemp"):
        (run_root / name).mkdir(parents=True, exist_ok=True)
    summary = {
        "runRoot": str(run_root),
        "sources": _prepare_sources(),
        "baseline": _prepare_baseline(run_root),
        "modelPackages": _verify_packages(),
        "datasets": str(BACKEND / "data" / "datasets"),
        "python": sys.version.split()[0],
        "git": shutil.which("git"),
    }
    (run_root / "environment.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
