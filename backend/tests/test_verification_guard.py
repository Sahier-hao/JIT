"""Exercise the verification orchestrator's protection on success and failure.

External checks are replaced in a temporary project; no real archive is touched.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.parametrize("check_fails", [False, True])
def test_verification_reports_protected_changes_even_when_a_check_fails(tmp_path, check_fails):
    project = tmp_path / "project"
    for folder in ["frontend/src", "frontend/e2e", "frontend/public", "frontend/scripts",
                   "backend/jit_baseline", "backend/tests", "backend/scripts",
                   "backend/artifacts/baseline", "openspec/specs", "openspec/changes/archive",
                   "docs/evidence/frozen-fixture"]:
        (project / folder).mkdir(parents=True, exist_ok=True)
    (project / "frontend/public/demo-dataset.json").write_text('{"version":"test"}', encoding="utf-8")
    (project / "backend/artifacts/baseline/manifest.json").write_text(
        '{"runId":"fixture","config":{"environment":{}}}', encoding="utf-8")
    (project / "openspec/config.yaml").write_text("schema: spec-driven\n", encoding="utf-8")
    (project / "docs/evidence/frozen-fixture/removed.txt").write_text("keep", encoding="utf-8")
    source = (Path(__file__).resolve().parents[2] / "frontend/scripts/verify.ps1").read_text(encoding="utf-8")
    start = source.index("function Invoke-Check(")
    end = source.index("function Get-ProtectedHashes", start)
    stub = """function Invoke-Check([string]$Name, [string]$Executable, [string[]]$Arguments) {
      if ($Name -eq 'backend-tests') {
        Add-Content -LiteralPath (Join-Path $projectRoot 'openspec/config.yaml') -Value '# changed'
        Remove-Item -LiteralPath (Join-Path $projectRoot 'docs/evidence/frozen-fixture/removed.txt')
        Set-Content -LiteralPath (Join-Path $projectRoot 'frontend/public/added.txt') -Value 'new'
        FAILURE
      }
    }

""".replace("FAILURE", "throw 'fixture-check-failed'" if check_fails else "")
    source = source[:start] + stub + source[end:]
    for line, replacement in [
        ("$summary.node = (& node --version).Trim()", "$summary.node = 'fixture'"),
        ("$summary.npm = (& npm --version).Trim()", "$summary.npm = 'fixture'"),
        ("$summary.dependencies = (& npm ls --depth=0 --json | ConvertFrom-Json).dependencies", "$summary.dependencies = @{}"),
        ("$summary.gitStatus = (& git -C $projectRoot status --short | Out-String).Trim()", "$summary.gitStatus = 'fixture'"),
    ]:
        assert line in source
        source = source.replace(line, replacement)
    script = project / "frontend/scripts/verify.ps1"
    # 显式约定子进程编码，避免 Windows 区域代码页污染 PowerShell 错误流。
    bootstrap = ("[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n"
                 "$OutputEncoding = [Console]::OutputEncoding\n")
    script.write_text(bootstrap + source, encoding="utf-8")
    result = subprocess.run([shutil.which("pwsh"), "-NoLogo", "-NoProfile", "-NonInteractive", "-File", str(script)],
                            capture_output=True, timeout=30)
    # 捕获原始字节后严格解码，编码错误必须直接失败，不能在线程中变成 stderr=None。
    stderr = result.stderr.decode("utf-8")
    result.stdout.decode("utf-8")
    assert result.returncode != 0
    summary = json.loads((project / "docs/evidence/_run/verification.json").read_text(encoding="utf-8"))
    assert summary["success"] is False
    assert summary["protectedFilesUnchanged"] is False
    assert set(summary["protectedFilesDiff"]) == {
        "modified: openspec/config.yaml", "missing: docs/evidence/frozen-fixture/removed.txt",
        "added: frontend/public/added.txt",
    }
    assert "Protected files changed during verification" in stderr
    if check_fails:
        assert summary["failure"] == "fixture-check-failed"
