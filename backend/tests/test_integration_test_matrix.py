"""Matrix contract tests. [AI生成]"""
from pathlib import Path

from scripts import integration_test_matrix as matrix

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = {
    "kind": "test",
    "level": "runtime",
    "status": "passed",
    "tests": ["backend/tests/test_sync_control.py::test_queue_cancel_is_idempotent_and_updates_positions"],
}
CONTRACT_NORMAL = {
    "kind": "test",
    "level": "contract",
    "status": "passed",
    "tests": ["backend/tests/test_openapi.py"],
}
CONTRACT_ERROR = {
    "kind": "test",
    "level": "contract",
    "status": "passed",
    "tests": ["backend/tests/test_api_route_coverage.py::test_every_v1_route_uses_the_shared_error_envelope"],
}
NOT_APPLICABLE = {
    "kind": "not-applicable",
    "reason": "只读接口，无共享可变写入。",
    "reviewedBy": "reviewer",
    "reviewedOn": "2026-11-25",
}


def _inventory():
    return {
        "operations": [
            {
                "key": "POST /api/v1/repository-syncs",
                "method": "POST",
                "path": "/api/v1/repository-syncs",
                "operationId": "createRepositorySync",
                "riskDomain": "sync-control",
                "riskTier": "high",
            },
            {
                "key": "GET /api/v1/repositories",
                "method": "GET",
                "path": "/api/v1/repositories",
                "operationId": "listRepositories",
                "riskDomain": "repository-read",
                "riskTier": "low",
            },
        ]
    }


def _mapping():
    return {
        "change": "fixture",
        "domainDefaults": {
            "sync-control": {
                "normal": RUNTIME,
                "boundary": RUNTIME,
                "error": RUNTIME,
                "concurrency": RUNTIME,
            },
        },
        "contractDefaults": {"normal": CONTRACT_NORMAL, "error": CONTRACT_ERROR},
        "notApplicable": {"boundary": NOT_APPLICABLE, "concurrency": NOT_APPLICABLE},
    }


def _valid():
    return matrix.build_matrix(_inventory(), _mapping())


# [AI生成]
def test_valid_matrix_passes():
    assert matrix.validate(_valid(), _inventory(), ROOT) == []


# [AI生成]
def test_missing_cell_fails():
    data = _valid()
    del data["operations"][0]["cells"]["concurrency"]
    assert any("缺少场景：concurrency" in problem for problem in matrix.validate(data, _inventory(), ROOT, expected_count=2))


# [AI生成]
def test_high_risk_not_applicable_fails():
    data = _valid()
    data["operations"][0]["cells"]["boundary"] = NOT_APPLICABLE
    assert any("高风险接口不得标记不适用" in problem for problem in matrix.validate(data, _inventory(), ROOT, expected_count=2))


# [AI生成]
def test_normal_not_applicable_fails():
    data = _valid()
    data["operations"][1]["cells"]["normal"] = NOT_APPLICABLE
    assert any("正常与异常场景不得标记不适用" in problem for problem in matrix.validate(data, _inventory(), ROOT, expected_count=2))


# [AI生成]
def test_stale_test_node_fails():
    data = _valid()
    data["operations"][0]["cells"]["normal"]["tests"] = [
        "backend/tests/test_sync_control.py::test_does_not_exist",
    ]
    assert any("缺少测试节点" in problem for problem in matrix.validate(data, _inventory(), ROOT, expected_count=2))


# [AI生成]
def test_failed_status_fails():
    data = _valid()
    data["operations"][0]["cells"]["normal"]["status"] = "failed"
    assert any("状态不是 passed" in problem for problem in matrix.validate(data, _inventory(), ROOT, expected_count=2))


# [AI生成]
def test_pending_human_review_fails():
    data = _valid()
    pending = dict(NOT_APPLICABLE, reviewedBy="待人工复核")
    data["operations"][1]["cells"]["boundary"] = pending
    assert any("尚未完成人工复核" in problem for problem in matrix.validate(data, _inventory(), ROOT, expected_count=2))
