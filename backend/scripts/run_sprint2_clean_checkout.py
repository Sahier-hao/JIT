"""Run the Sprint2 delivery checks from an isolated copy of the working tree."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time


ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"
CACHE = ROOT / ".cache"
DELIVERY = ROOT / "docs/test-delivery/sprint2-unit-test"


def _sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _link(directory, target):
    directory = Path(directory)
    if directory.exists():
        return
    directory.parent.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(directory), str(Path(target).resolve())],
            check=True, capture_output=True, text=True,
        )
    else:
        directory.symlink_to(Path(target).resolve(), target_is_directory=True)


def _copy_untracked(target):
    listed = subprocess.check_output(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
    )
    copied = []
    for raw in listed.split(b"\0"):
        if not raw:
            continue
        relative = raw.decode("utf-8").replace("\\", "/")
        source = ROOT / relative
        if not source.is_file():
            continue
        destination = Path(target) / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        copied.append(relative)
    return copied


def _copy_modified(target):
    listed = subprocess.check_output(
        ["git", "diff", "--name-only", "--diff-filter=ACMR", "HEAD"],
        cwd=ROOT, text=True,
    )
    copied = []
    for relative in listed.splitlines():
        source = ROOT / relative
        if not source.is_file():
            continue
        destination = Path(target) / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        copied.append(relative)
    return copied


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    target = Path(tempfile.mkdtemp(prefix="sprint2-clean-", dir=CACHE))
    archive = subprocess.check_output(["git", "archive", "--format=tar", "HEAD"], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as package:
        package.extractall(target, filter="data")
    modified = _copy_modified(target)
    untracked = _copy_untracked(target)
    _link(target / "backend/.venv", BACKEND / ".venv")
    _link(target / "frontend/node_modules", FRONTEND / "node_modules")
    env = os.environ.copy()
    env["GIT_DIR"] = str((ROOT / ".git").resolve())
    env["GIT_WORK_TREE"] = str(target.resolve())
    started = time.perf_counter()
    completed = subprocess.run(
        [str(target / "backend/.venv/Scripts/python.exe"), "-m", "scripts.run_sprint2_unit"],
        cwd=target / "backend", env=env,
    )
    elapsed = time.perf_counter() - started
    clean_report = target / "docs/test-delivery/sprint2-unit-test/generated/report.json"
    if not clean_report.is_file():
        raise SystemExit("干净检出没有生成 report.json")
    DELIVERY.mkdir(parents=True, exist_ok=True)
    copied_report = DELIVERY / "generated/clean-checkout-report.json"
    copied_report.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(clean_report, copied_report)
    shutil.copy2(clean_report.with_suffix(".md"), copied_report.with_suffix(".md"))
    summary = {
        "kind": "sprint2-clean-checkout-verification",
        "passed": completed.returncode == 0,
        "sourceCommit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "checkout": str(target.resolve()),
        "backendAndFrontendProcessSeconds": elapsed,
        "reportSha256": _sha256(clean_report),
        "copiedModified": modified,
        "copiedUntracked": untracked,
    }
    summary_path = DELIVERY / "generated/clean-checkout.json"
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return completed.returncode


if __name__ == "__main__":
    sys.exit(main())
