"""Run the isolated Sprint2 unit suites, then generate their report."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
CACHE = ROOT / ".cache/sprint2-unit"


def run(command, cwd):
    started = time.perf_counter()
    completed = subprocess.run(command, cwd=cwd)
    return completed.returncode, time.perf_counter() - started


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    python = BACKEND / ".venv/Scripts/python.exe"
    if not python.is_file():
        raise SystemExit(f"后端虚拟环境不存在：{python}")
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit("未找到 npm")
    inventory = subprocess.run(
        [str(python), "-m", "scripts.validate_sprint2_unit_inventory", "--require-sources"],
        cwd=BACKEND,
    )
    backend_code, backend_seconds = run(
        [str(python), "-m", "pytest", "-c", "pytest.sprint2.ini", "tests\\test_sprint2_unit_core.py"],
        BACKEND,
    )
    frontend_code, frontend_seconds = run(
        [npm, "run", "test:unit:sprint2"],
        FRONTEND,
    )
    metadata = {
        "backendSeconds": backend_seconds,
        "frontendSeconds": frontend_seconds,
        "backendExitCode": backend_code,
        "frontendExitCode": frontend_code,
    }
    (CACHE / "run-meta.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    report = subprocess.run([str(python), "-m", "scripts.sprint2_unit_report"], cwd=BACKEND)
    return max(inventory.returncode, backend_code, frontend_code, report.returncode)


if __name__ == "__main__":
    sys.exit(main())
