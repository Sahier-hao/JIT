"""Assemble Sprint2 unit-test evidence in the ignored run workspace."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/test-delivery/sprint2-unit-test"
CACHE = ROOT / ".cache/sprint2-unit"
DEST = ROOT / "docs/evidence/_run/sprint2-unit-test-delivery"


def _sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def main():
    if DEST.exists():
        shutil.rmtree(DEST)
    DEST.mkdir(parents=True)
    for path in SOURCE.rglob("*"):
        if path.is_file():
            _copy(path, DEST / "delivery" / path.relative_to(SOURCE))
    for side in ("backend", "frontend"):
        source = CACHE / f"{side}-coverage"
        if not source.is_dir():
            raise SystemExit(f"缺少 {side} HTML 覆盖率：{source}")
        shutil.copytree(source, DEST / "coverage" / f"{side}-html")
    raw = {
        "backend-coverage.json": CACHE / "backend-coverage.json",
        "backend-junit.xml": CACHE / "backend-junit.xml",
        "frontend-results.json": CACHE / "frontend-results.json",
        "frontend-coverage-final.json": CACHE / "frontend-coverage/coverage-final.json",
        "run-meta.json": CACHE / "run-meta.json",
    }
    for name, source in raw.items():
        if not source.is_file():
            raise SystemExit(f"缺少原始运行结果：{source}")
        _copy(source, DEST / "raw" / name)
    source_files = [
        ROOT / "backend/pytest.sprint2.ini",
        ROOT / "backend/requirements.txt",
        ROOT / "backend/scripts/run_sprint2_unit.py",
        ROOT / "backend/scripts/sprint2_unit_report.py",
        ROOT / "backend/scripts/validate_sprint2_unit_inventory.py",
        ROOT / "backend/scripts/run_sprint2_clean_checkout.py",
        ROOT / "backend/scripts/package_sprint2_unit_evidence.py",
        ROOT / "backend/tests/test_sprint2_unit_core.py",
        ROOT / "backend/tests/test_sprint2_unit_report.py",
        ROOT / "frontend/package.json",
        ROOT / "frontend/package-lock.json",
        ROOT / "frontend/vitest.sprint2.config.ts",
        ROOT / "frontend/src/lib/sprint2Core.test.ts",
    ]
    for path in source_files:
        _copy(path, DEST / "source" / path.relative_to(ROOT))
    entries = []
    for path in sorted(DEST.rglob("*")):
        if path.is_file():
            entries.append({
                "path": path.relative_to(DEST).as_posix(),
                "sha256": _sha256(path),
            })
    summary = {
        "kind": "sprint2-unit-test-package",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "workspace": DEST.relative_to(ROOT).as_posix(),
        "fileCount": len(entries),
        "files": entries,
    }
    summary_path = DEST / "package.json"
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "workspace": str(DEST),
        "fileCount": len(entries) + 1,
        "summary": str(summary_path),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
