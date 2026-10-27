"""命令行参数装配：默认仍是六字段逻辑回归，显式指定时按参数传递。"""
import sys
from pathlib import Path

from jit_baseline.config import BACKEND


def run_cli(monkeypatch, argv):
    from jit_baseline import cli
    calls = []
    monkeypatch.setattr(cli, "build_run",
                        lambda *args, **kwargs: calls.append(args) or {"runId": "fixture"})
    monkeypatch.setattr(sys, "argv", ["jit_baseline.cli", *argv])
    cli.main()
    return calls


def test_run_defaults_leave_schema_and_algorithm_unset(monkeypatch):
    calls = run_cli(monkeypatch, ["run", "--output", "out"])
    assert calls == [(BACKEND / "data/openstack", Path("out"), None, None)]


def test_run_passes_schema_and_algorithm_through(monkeypatch):
    calls = run_cli(monkeypatch, ["run", "--output", "out", "--schema", "kamei14-v1",
                                  "--algorithm", "decision-tree-v1"])
    assert calls == [(BACKEND / "data/openstack", Path("out"), "kamei14-v1", "decision-tree-v1")]


def test_run_help_lists_the_algorithm_option(monkeypatch, capsys):
    import pytest
    from jit_baseline import cli
    monkeypatch.setattr(sys, "argv", ["jit_baseline.cli", "run", "--help"])
    with pytest.raises(SystemExit):
        cli.main()
    assert "--algorithm" in capsys.readouterr().out


def test_run_passes_metric_set_and_defaults_to_none(monkeypatch):
    from jit_baseline import cli
    calls = []
    monkeypatch.setattr(cli, "build_run",
                        lambda *args, **kwargs: calls.append((args, kwargs)) or {"runId": "fixture"})
    monkeypatch.setattr(sys, "argv", ["jit_baseline.cli", "run", "--output", "out"])
    cli.main()
    assert calls[0][1]["metric_set"] is None
    monkeypatch.setattr(sys, "argv", ["jit_baseline.cli", "run", "--output", "out",
                                      "--metric-set", "metric-set-v2"])
    cli.main()
    assert calls[1][1]["metric_set"] == "metric-set-v2"


def test_run_suite_and_compare_projects_are_wired(monkeypatch):
    from jit_baseline import cli
    suite_calls = []
    monkeypatch.setattr(cli, "run_suite",
                        lambda *args, **kwargs: suite_calls.append((args, kwargs)) or {"kind": "suite"})
    monkeypatch.setattr(sys, "argv", ["jit_baseline.cli", "run-suite",
                                      "--dataset-manifest", "m.json", "--output", "out"])
    cli.main()
    assert suite_calls[0][0][:2] == (Path("m.json"), Path("out"))
    reports = []
    monkeypatch.setattr(cli, "compare_projects", lambda suites: {"kind": "report"})
    monkeypatch.setattr(cli, "write_json", lambda path, obj: reports.append((path, obj)))
    monkeypatch.setattr(sys, "argv", ["jit_baseline.cli", "compare-projects", "a", "b",
                                      "--report", "r.json"])
    cli.main()
    assert reports[0][0] == Path("r.json")


def test_verify_records_this_machines_verification_environment(monkeypatch, capsys):
    """校验记录本机验证环境与本次判定，与运行声明的产方训练环境分开（PDB-16、PDB-19）。"""
    import json
    from jit_baseline import cli

    class FakeSnapshot:
        @staticmethod
        def load(run):
            return FakeSnapshot()

        def batch(self):
            return {"records": [1, 2, 3]}

    producer = {"python": "3.11.9", "platform": "Linux-x86_64", "packages": {"numpy": "2.5.3"}}
    monkeypatch.setattr(cli, "verify_run",
                        lambda run: {"runId": "fixture", "config": {"trainingEnvironment": producer}})
    monkeypatch.setattr(cli, "Snapshot", FakeSnapshot)
    monkeypatch.setattr(sys, "argv", ["jit_baseline.cli", "verify", "--run", "somewhere"])
    cli.main()
    result = json.loads(capsys.readouterr().out)
    assert result["passed"] is True and result["runId"] == "fixture" and result["records"] == 3
    assert result["origin"] == "external"
    assert result["trainingEnvironment"] == producer
    assert set(result["verificationEnvironment"]) == {"python", "platform", "packages"}
    assert result["verificationEnvironment"]["packages"]
    assert result["reproducibility"]["mode"] == "tolerance"  # 记录本次比较所用的口径（PDB-18）
