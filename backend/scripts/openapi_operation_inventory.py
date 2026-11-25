"""Generate and check the 95-operation business API inventory.

The curated OpenAPI contract is the single source of truth. The four admin
authentication operations are listed separately and excluded from the business
inventory; every other operation gets a stable key, risk domain, risk tier and
role boundary for the integration test matrix.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OPENAPI = ROOT / "docs" / "api" / "openapi.yaml"
METHODS = ("get", "post", "put", "patch", "delete")
ADMIN_AUTH = {
    "adminSetup": "管理员初始化不属于业务 API，由独立账户流程验证。",
    "adminLogin": "管理员登录不属于业务 API，由独立账户流程验证。",
    "adminSession": "管理员会话查询不属于业务 API，由独立账户流程验证。",
    "adminLogout": "管理员登出不属于业务 API，由独立账户流程验证。",
}
HIGH_RISK_DOMAINS = (
    "auth-permissions",
    "sync-control",
    "training",
    "model-registry",
    "pr-analysis-report",
    "dataset-import",
    "explanation",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _risk_domain(method: str, path: str, operation_id: str) -> str:
    if "explanation" in path:
        return "explanation"
    if "/repository-syncs" in path or "/refresh" in path or "/updates" in path:
        return "sync-control"
    if any(token in path for token in (
        "/training-tasks", "/training-methods", "/training-experiments", "/experiment-runs", "/experiments",
        "/comparison/thresholds",
    )):
        return "training"
    if any(token in path for token in (
        "/models", "/model-candidates", "/model-cards", "/repository-models", "/model-coverage",
    )):
        return "model-registry"
    if any(token in path for token in (
        "/pull-request", "/pr-tracking", "/pr-snapshots", "/review-sources", "/pr-sources",
    )):
        return "pr-analysis-report"
    if any(token in path for token in (
        "/datasets", "/feature-schemas", "/dataset-builds",
    )):
        return "dataset-import"
    if path.startswith("/api/admin") or "/user/" in path:
        return "auth-permissions"
    if "/predictions" in path or "/prediction-batches" in path:
        return "prediction"
    if any(token in path for token in ("/trends", "/trend-views", "/trend-groups", "/comparison")):
        return "trend-comparison"
    if "/project-events" in path or "/events" in path:
        return "project-events"
    if "/review-batch" in path:
        return "historical"
    if path.startswith("/api/admin"):
        return "admin-maintenance"
    return "repository-read"


def _risk_tier(method: str, path: str, domain: str) -> str:
    if domain in HIGH_RISK_DOMAINS:
        return "high"
    if method in ("post", "put", "patch", "delete") or path.startswith("/api/admin"):
        return "medium"
    return "low"


def _role(path: str) -> str:
    if path.startswith("/api/admin"):
        return "admin"
    if "/user/" in path:
        return "user"
    return "public"


def _load_openapi(path: Path) -> dict:
    try:
        import yaml
    except ImportError as exc:
        raise SystemExit("需要 PyYAML：pip install -r backend/scripts/requirements-contract.txt") from exc
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or not isinstance(document.get("paths"), dict):
        raise SystemExit(f"OpenAPI 契约无效：{path}")
    return document


def build_inventory(openapi: Path) -> dict:
    document = _load_openapi(openapi)
    all_operations = []
    admin_auth = []
    business = []
    for path, item in document["paths"].items():
        if not isinstance(item, dict):
            continue
        for method in METHODS:
            operation = item.get(method)
            if not isinstance(operation, dict):
                continue
            operation_id = operation.get("operationId")
            if not isinstance(operation_id, str) or not operation_id:
                raise SystemExit(f"缺少 operationId：{method.upper()} {path}")
            entry = {
                "method": method.upper(),
                "path": path,
                "operationId": operation_id,
                "key": f"{method.upper()} {path}",
                "summary": operation.get("summary") or "",
                "tags": list(operation.get("tags") or []),
                "security": operation.get("security", []),
                "role": _role(path),
                "riskDomain": _risk_domain(method, path, operation_id),
            }
            entry["riskTier"] = _risk_tier(method, path, entry["riskDomain"])
            all_operations.append(entry)
            if operation_id in ADMIN_AUTH:
                admin_auth.append({**entry, "exclusionReason": ADMIN_AUTH[operation_id]})
            else:
                business.append(entry)
    all_operations.sort(key=lambda value: value["key"])
    admin_auth.sort(key=lambda value: value["key"])
    business.sort(key=lambda value: value["key"])
    return {
        "kind": "openapi-operation-inventory",
        "source": openapi.relative_to(ROOT).as_posix() if openapi.is_relative_to(ROOT) else str(openapi),
        "sourceSha256": _sha256(openapi),
        "generatedAt": _now(),
        "totalOperations": len(all_operations),
        "adminAuthOperations": admin_auth,
        "businessOperations": len(business),
        "operations": business,
    }


def _drift(expected: dict, actual: dict) -> list[str]:
    problems = []
    before = {item["key"]: item["operationId"] for item in expected.get("operations", [])}
    after = {item["key"]: item["operationId"] for item in actual.get("operations", [])}
    for key in sorted(set(before) - set(after)):
        problems.append(f"清单多出操作：{key}")
    for key in sorted(set(after) - set(before)):
        problems.append(f"清单缺少操作：{key}")
    for key in sorted(set(before) & set(after)):
        if before[key] != after[key]:
            problems.append(f"operationId 漂移：{key} {before[key]} -> {after[key]}")
    if actual.get("totalOperations") != 99:
        problems.append(f"OpenAPI 操作总数应为 99，实际 {actual.get('totalOperations')}")
    if actual.get("businessOperations") != 95:
        problems.append(f"业务操作应为 95，实际 {actual.get('businessOperations')}")
    if len(actual.get("adminAuthOperations", [])) != 4:
        problems.append("admin 认证排除项应恰好为 4")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="生成或校验 95 项业务 API 清单")
    parser.add_argument("--openapi", type=Path, default=DEFAULT_OPENAPI)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--check", action="store_true", help="与 output 中已有清单比较并报告漂移")
    options = parser.parse_args()
    inventory = build_inventory(options.openapi.resolve())
    if options.output is not None:
        options.output.parent.mkdir(parents=True, exist_ok=True)
        options.output.write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf-8")
    if options.check:
        if options.output is None or not options.output.is_file():
            print("需要 --output 指向已保存清单以执行 --check", file=sys.stderr)
            return 2
        previous = json.loads(options.output.read_text(encoding="utf-8"))
        problems = _drift(previous, inventory)
        if problems:
            for problem in problems:
                print(problem)
            return 1
        print(f"清单校验通过：{inventory['businessOperations']} 项业务操作，4 项 admin 认证单独列出。")
        return 0
    print(json.dumps({
        "totalOperations": inventory["totalOperations"],
        "businessOperations": inventory["businessOperations"],
        "adminAuthOperations": len(inventory["adminAuthOperations"]),
        "highRisk": sum(1 for item in inventory["operations"] if item["riskTier"] == "high"),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
