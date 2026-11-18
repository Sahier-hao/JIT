"""Check relative Markdown links in the product and delivery documents.

Scans README.md, AGENTS.md and docs/**.md. External URLs, in-page anchors and
absolute paths are ignored. A link to a directory is valid when the directory
exists. Missing targets are reported with file and line, and the script exits 1.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import unquote

LINK = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
SKIP_PREFIXES = ("http://", "https://", "mailto:", "tel:", "data:", "#")
SKIP_DIRS = {"node_modules", ".venv", ".git", "test-results", "playwright-report"}
# 冻结证据、历史审计与汇报材料保留当时的代码路径，不作为当前文档死链处理。
HISTORICAL_DIRS = {"evidence", "汇报", "课程资料"}
HISTORICAL_AUDIT_DIRS = {"审计", "计划"}
CURRENT_PREFIX = "2026-11-19"


def documents(root: Path, include_evidence: bool = False) -> list[Path]:
    files: list[Path] = []
    for name in ("README.md", "AGENTS.md"):
        path = root / name
        if path.is_file():
            files.append(path)
    docs = root / "docs"
    if docs.is_dir():
        for path in sorted(docs.rglob("*.md")):
            parts = path.relative_to(docs).parts
            if set(parts) & SKIP_DIRS:
                continue
            if not include_evidence and set(parts) & HISTORICAL_DIRS:
                continue
            if not include_evidence and len(parts) > 1 and parts[0] in HISTORICAL_AUDIT_DIRS:
                if not path.name.startswith(CURRENT_PREFIX):
                    continue
            files.append(path)
    return files


def target_of(raw: str) -> str | None:
    value = raw.strip()
    if value.startswith("<") and value.endswith(">"):
        value = value[1:-1].strip()
    if not value or value.startswith(SKIP_PREFIXES):
        return None
    value = value.split("#", 1)[0].split("?", 1)[0]
    if not value or value.startswith("/") or re.match(r"^[A-Za-z]:[\\/]", value):
        return None
    return unquote(value)


def check(root: Path, include_evidence: bool = False) -> list[str]:
    problems: list[str] = []
    for path in documents(root, include_evidence):
        text = path.read_text(encoding="utf-8", errors="replace")
        for number, line in enumerate(text.splitlines(), start=1):
            for match in LINK.finditer(line):
                target = target_of(match.group(1))
                if target is None:
                    continue
                resolved = (path.parent / target).resolve()
                try:
                    resolved.relative_to(root.resolve())
                except ValueError:
                    problems.append(f"{path.relative_to(root)}:{number}: 链接越出仓库：{target}")
                    continue
                if not resolved.exists():
                    problems.append(f"{path.relative_to(root)}:{number}: 目标不存在：{target}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="检查文档相对链接")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--include-evidence", action="store_true", help="同时检查冻结证据与汇报材料")
    options = parser.parse_args()
    problems = check(options.root, options.include_evidence)
    if problems:
        print(f"文档链接检查未通过（{len(problems)} 项）：")
        for problem in problems:
            print(f"- {problem}")
        return 1
    print("文档链接检查通过：README、AGENTS 与 docs 的相对链接均可解析。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
