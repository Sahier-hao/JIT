"""Explicit regression scopes for CI and local equivalent runs.

The lists are reviewed when capabilities change; an empty or missing file makes
the run fail instead of silently collecting zero tests.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
EXTENSION = ROOT / "vscode-extension"

KEY_BACKEND = (
    "tests/test_model_packages.py",
    "tests/test_artifacts.py",
    "tests/test_schemas.py",
    "tests/test_splits.py",
    "tests/test_datasets.py",
    "tests/test_admission.py",
    "tests/test_training_tasks.py",
    "tests/test_user_workspace.py",
    "tests/test_catalog_api.py",
    "tests/test_project_datasets.py",
    "tests/test_repository_sync.py",
    "tests/test_repository_updates.py",
    "tests/test_pr_review.py",
    "tests/test_pr_updates.py",
    "tests/test_api.py",
    "tests/test_openapi.py",
)
FULL_BACKEND_EXTRA = ("tests",)
BROWSER_CONFIGS = (
    ("playwright.model-package.config.ts", "e2e/model-package-recovery.spec.ts"),
    ("playwright.regression-pr.config.ts", "e2e/pr-account-continuation.spec.ts"),
)
DESELECT_KEY = (
    # 依赖开发机真实目录库快照；不是 CI 必需夹具，缺省时显式排除而不是把 skip 计为通过。
    "tests/test_catalog_api.py::test_real_dataset_commits_page_stays_bounded",
)


def _existing(base: Path, names: tuple[str, ...]) -> list[str]:
    found, missing = [], []
    for name in names:
        path = base / name
        if path.exists():
            found.append(name)
        else:
            missing.append(name)
    return found, missing


def manifest(layer: str) -> dict:
    if layer not in ("key", "full"):
        raise SystemExit(f"未知层：{layer}")
    backend_names = KEY_BACKEND if layer == "key" else FULL_BACKEND_EXTRA
    backend, missing_backend = _existing(BACKEND, backend_names)
    browser, missing_browser = [], []
    for config, spec in BROWSER_CONFIGS:
        if (FRONTEND / config).exists() and (FRONTEND / spec).exists():
            browser.append({"config": config, "spec": spec})
        else:
            missing_browser.append(spec)
    if not backend:
        raise SystemExit("后端检查清单为空")
    if missing_backend:
        raise SystemExit("后端检查文件不存在：" + "、".join(missing_backend))
    if layer == "full" and missing_browser:
        raise SystemExit("浏览器检查文件不存在：" + "、".join(missing_browser))
    return {
        "layer": layer,
        "backend": backend,
        "backendCount": len(backend),
        "frontend": {
            "commands": ["npm ci", "npm run typecheck", "npm test", "npm run build"],
        },
        "extension": {"commands": ["npm ci", "npm test"]},
        "browser": browser,
        "deselected": list(DESELECT_KEY) if layer == "key" else [],
        "python": sys.version.split()[0],
        "missing": {"backend": missing_backend, "browser": missing_browser},
    }


def run_pytest(layer: str, junit: Path) -> int:
    scope = manifest(layer)
    args = [sys.executable, "-m", "pytest", *scope["backend"], "-q", "--basetemp",
            str(junit.parent / "pytest-basetemp"), f"--junitxml={junit}"]
    for name in scope["deselected"]:
        args.extend(["--deselect", name])
    print(" ".join(args), flush=True)
    return subprocess.call(args, cwd=BACKEND)


def main() -> None:
    parser = argparse.ArgumentParser(description="回归检查清单")
    parser.add_argument("--layer", choices=("key", "full"), required=True)
    parser.add_argument("--pytest-junit", type=Path, default=None)
    options = parser.parse_args()
    if options.pytest_junit is not None:
        raise SystemExit(run_pytest(options.layer, options.pytest_junit))
    print(json.dumps(manifest(options.layer), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
