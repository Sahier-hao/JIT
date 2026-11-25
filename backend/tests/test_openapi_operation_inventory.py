"""Inventory contract tests. [AI生成]"""
from pathlib import Path

from scripts import openapi_operation_inventory as inventory

ROOT = Path(__file__).resolve().parents[2]


# [AI生成]
def test_real_inventory_has_95_business_operations_and_four_admin_auth():
    data = inventory.build_inventory(inventory.DEFAULT_OPENAPI)
    assert data["totalOperations"] == 99
    assert data["businessOperations"] == 95
    assert {item["operationId"] for item in data["adminAuthOperations"]} == {
        "adminSetup", "adminLogin", "adminSession", "adminLogout",
    }
    assert len({item["key"] for item in data["operations"]}) == 95
    for item in data["operations"]:
        assert item["method"] and item["path"] and item["operationId"]
        assert item["riskDomain"] and item["riskTier"] in {"high", "medium", "low"}
        assert item["role"] in {"public", "user", "admin"}
        assert item["key"] == f"{item['method']} {item['path']}"


# [AI生成]
def test_high_risk_domains_are_present_and_classified_high():
    data = inventory.build_inventory(inventory.DEFAULT_OPENAPI)
    domains = {item["riskDomain"] for item in data["operations"]}
    assert set(inventory.HIGH_RISK_DOMAINS) <= domains
    assert all(
        item["riskTier"] == "high"
        for item in data["operations"]
        if item["riskDomain"] in inventory.HIGH_RISK_DOMAINS
    )


# [AI生成]
def test_drift_detection_reports_renamed_and_missing_operations():
    data = inventory.build_inventory(inventory.DEFAULT_OPENAPI)
    changed = {
        "totalOperations": data["totalOperations"],
        "businessOperations": data["businessOperations"],
        "adminAuthOperations": data["adminAuthOperations"],
        "operations": [dict(item) for item in data["operations"]],
    }
    changed["operations"][0]["operationId"] = "renamed-operation"
    changed["operations"].pop()
    problems = inventory._drift(data, changed)
    assert any("operationId 漂移" in problem for problem in problems)
    assert any("清单多出操作" in problem for problem in problems)
