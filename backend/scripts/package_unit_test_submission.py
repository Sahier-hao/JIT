"""Build the exam-ready `unit_test/` copy from the current repository evidence."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / "docs/test-delivery/sprint2-unit-test"
CACHE = ROOT / ".cache/sprint2-unit"
DEST = ROOT / "unit_test"


def _sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _copy(source, destination):
    source = Path(source)
    if not source.is_file():
        raise SystemExit(f"缺少交付文件：{source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def _copy_tree(source, destination):
    source = Path(source)
    if not source.is_dir():
        raise SystemExit(f"缺少交付目录：{source}")
    shutil.copytree(source, destination)


def _manifest():
    entries = []
    for path in sorted(DEST.rglob("*")):
        if path.is_file() and path.name != "MANIFEST.json":
            entries.append({
                "path": path.relative_to(DEST).as_posix(),
                "sha256": _sha256(path),
                "bytes": path.stat().st_size,
            })
    payload = {
        "kind": "unit-test-submission",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "sourceCommit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "sourceRoot": str(ROOT),
        "files": entries,
    }
    (DEST / "MANIFEST.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return payload


def main():
    if DEST.exists():
        resolved = DEST.resolve()
        if resolved.parent != ROOT.resolve() or resolved.name != "unit_test":
            raise SystemExit(f"拒绝清理非预期目录：{resolved}")
        shutil.rmtree(DEST)
    DEST.mkdir(parents=True)

    _copy(DELIVERY / "README.md", DEST / "README.md")
    readme = DEST / "README.md"
    readme.write_text(
        readme.read_text(encoding="utf-8")
        .replace("](core-tests.json)", "](tests/core-tests.json)")
        .replace("](manual-review-checklist.md)", "](tests/manual-review-checklist.md)")
        .replace("](mutation-checks.md)", "](tests/mutation-checks.md)")
        .replace("generated/report-zh.pdf", "coverage_report/report-zh.pdf")
        .replace("generated/report-zh.html", "coverage_report/report-zh.html")
        .replace("generated/report-zh.png", "coverage_report/report-zh.png")
        .replace("generated/report.md", "coverage_report/report.md"),
        encoding="utf-8",
    )
    _copy(DELIVERY / "core-tests.json", DEST / "tests/core-tests.json")
    _copy(DELIVERY / "manual-review.json", DEST / "tests/manual-review.json")
    _copy(DELIVERY / "manual-review-checklist.md", DEST / "tests/manual-review-checklist.md")
    _copy(DELIVERY / "mutation-checks.md", DEST / "tests/mutation-checks.md")
    _copy(ROOT / "backend/tests/test_sprint2_unit_core.py",
          DEST / "tests/backend/test_sprint2_unit_core.py")
    _copy(ROOT / "frontend/src/lib/sprint2Core.test.ts",
          DEST / "tests/frontend/sprint2Core.test.ts")

    _copy_tree(CACHE / "backend-coverage", DEST / "coverage_report/backend-coverage.html")
    _copy_tree(CACHE / "frontend-coverage", DEST / "coverage_report/frontend-coverage.html")
    for name, source in {
        "backend-coverage.json": CACHE / "backend-coverage.json",
        "backend-junit.xml": CACHE / "backend-junit.xml",
        "frontend-coverage-final.json": CACHE / "frontend-coverage/coverage-final.json",
        "frontend-results.json": CACHE / "frontend-results.json",
        "run-meta.json": CACHE / "run-meta.json",
    }.items():
        _copy(source, DEST / "coverage_report" / name)
    for name in (
        "backend-coverage.pdf",
        "backend-coverage.png",
        "frontend-coverage.pdf",
        "frontend-coverage.png",
        "report-zh.html",
        "report-zh.pdf",
        "report-zh.png",
        "report.json",
        "report.md",
        "clean-checkout.json",
        "clean-checkout-report.json",
        "clean-checkout-report.md",
    ):
        source = DELIVERY / "generated" / name
        if source.is_file():
            _copy(source, DEST / "coverage_report" / name)

    _copy_tree(DELIVERY / "prompts", DEST / "prompts")
    (DEST / "coverage_report/README.md").write_text(
        "# 覆盖率与运行证据\n\n"
        "- `backend-coverage.html/`、`frontend-coverage.html/`：coverage.py 与 Vitest 生成的交互式 HTML。\n"
        "- `backend-coverage.pdf`、`frontend-coverage.pdf`：coverage.py 原始英文界面快照，仅作底稿。\n"
        "- `backend-junit.xml`、`frontend-results.json`：原始测试结果。\n"
        "- `backend-coverage.json`、`frontend-coverage-final.json`：机器可读覆盖率。\n"
        "- `report-zh.html`、`report-zh.pdf`、`report-zh.png`：中文提交版报告。\n"
        "- `report.md`、`report.json`：中文 Markdown 报告与机器可读报告；人工复核未完成时状态为未通过。\n"
        "- `clean-checkout.json`、`clean-checkout-report.*`：隔离副本运行证据。\n",
        encoding="utf-8",
    )
    summary = _manifest()
    print(json.dumps({
        "destination": str(DEST),
        "sourceCommit": summary["sourceCommit"],
        "fileCount": len(summary["files"]),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
