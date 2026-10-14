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
