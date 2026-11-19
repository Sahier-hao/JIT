"""Negative checks for the Sprint2 report identity and delivery gates."""
import json

from scripts import sprint2_unit_report as report


def _result(failed=0, skipped=0, seconds=1, line=90):
    return {
        "failed": failed,
        "skipped": skipped,
        "processSeconds": seconds,
        "coverage": {"linePercent": line},
    }


def test_report_gate_does_not_count_failures_or_skips_as_passed():
    checks = report._checks(
        {"passed": True},
        _result(failed=1),
        _result(skipped=1),
    )
    assert checks["noFailedTests"] is False
    assert checks["noUnexplainedSkips"] is False


def test_report_gate_enforces_time_and_line_coverage():
    checks = report._checks(
        {"passed": True},
        _result(seconds=61, line=79.9),
        _result(seconds=60, line=80),
    )
    assert checks["backendWithin60Seconds"] is False
    assert checks["backendLinesAtLeast80"] is False
    assert checks["frontendWithin60Seconds"] is True
    assert checks["frontendLinesAtLeast80"] is True


def test_stale_commit_cannot_pass_report_check(tmp_path):
    current = report._identity(report._read_json(report.MANIFEST))
    path = tmp_path / "report.json"
    path.write_text(json.dumps({
        "status": "passed",
        "identity": current,
        "checks": {
            "inventoryComplete": True,
            "noFailedTests": True,
            "noUnexplainedSkips": True,
            "backendWithin60Seconds": True,
            "frontendWithin60Seconds": True,
            "backendLinesAtLeast80": True,
            "frontendLinesAtLeast80": True,
        },
    }), encoding="utf-8")
    result = report._check(path, "0" * 40)
    assert result["passed"] is False
    assert "陈旧" in result["errors"][0]
