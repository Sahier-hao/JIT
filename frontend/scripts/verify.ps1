$ErrorActionPreference = 'Stop'
$frontendRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $frontendRoot '..'))
$backendRoot = Join-Path $projectRoot 'backend'
$runRoot = Join-Path $projectRoot 'docs/evidence/_run'
[System.IO.Directory]::CreateDirectory($runRoot) | Out-Null
$runLog = Join-Path $runRoot 'verification.log'
$summaryPath = Join-Path $runRoot 'verification.json'
$summary = [ordered]@{ startedUtc = [DateTime]::UtcNow.ToString('o'); finishedUtc = $null; success = $false; failure = $null; node = $null; npm = $null; datasetVersion = $null; realRunId = $null; realEnvironment = $null; dependencies = $null; gitStatus = $null; sourceHashes = @(); protectedFileCount = $null; protectedFilesUnchanged = $false; protectedFilesDiff = @(); checks = @() }
[System.IO.File]::WriteAllText($runLog, '', [System.Text.UTF8Encoding]::new($false))

function Invoke-Check([string]$Name, [string]$Executable, [string[]]$Arguments) {
  $started = Get-Date
  $display = $Executable + ' ' + ($Arguments -join ' ')
  $output = & $Executable @Arguments 2>&1 | Out-String
  $code = $LASTEXITCODE
  [System.IO.File]::AppendAllText($runLog, "`n[$display]`n$output`nexit=$code`n", [System.Text.UTF8Encoding]::new($false))
  Write-Host $output
  $summary.checks += [ordered]@{ name = $Name; command = $display; exitCode = $code; elapsedSeconds = [Math]::Round(((Get-Date) - $started).TotalSeconds, 2) }
  if ($code -ne 0) { throw "$Name failed with exit $code" }
}

function Get-ProtectedHashes {
  # 归档证据、主规格、已归档 change 与静态演示数据在验证运行期间必须保持不变：运行期输出
  # 只写运行工作区，这些位置出现新增、修改或删除都说明有步骤写错了地方。比对基准取自本次
  # 运行开始时的实际状态，不读取任何需要人工维护的历史快照。
  $hashes = @{}
  $roots = @()
  $evidenceDir = Join-Path $projectRoot 'docs/evidence'
  if (Test-Path -LiteralPath $evidenceDir) {
    foreach ($dir in Get-ChildItem -LiteralPath $evidenceDir -Directory) {
      if ($dir.Name -ne '_run') { $roots += $dir.FullName }
    }
  }
  $roots += @(
    (Join-Path $projectRoot 'openspec/specs'),
    (Join-Path $projectRoot 'openspec/changes/archive'),
    (Join-Path $projectRoot 'openspec/config.yaml'),
    (Join-Path $projectRoot 'frontend/public')
  )
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -File) {
      $key = [System.IO.Path]::GetRelativePath($projectRoot, $file.FullName).Replace('\', '/')
      $hashes[$key] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  return $hashes
}

Push-Location $frontendRoot
try {
  $protectedBefore = Get-ProtectedHashes
  $summary.protectedFileCount = $protectedBefore.Count
  $summary.node = (& node --version).Trim()
  $summary.npm = (& npm --version).Trim()
  $summary.datasetVersion = (Get-Content -LiteralPath 'public/demo-dataset.json' -Raw | ConvertFrom-Json).version
  $manifest = Get-Content -LiteralPath (Join-Path $backendRoot 'artifacts/baseline/manifest.json') -Raw | ConvertFrom-Json
  $summary.realRunId = $manifest.runId
  $summary.realEnvironment = $manifest.config.environment
  $env:PYTHONIOENCODING = 'utf-8'
  Set-Location -LiteralPath $backendRoot
  Invoke-Check 'backend-tests' './.venv/Scripts/python.exe' @('-m', 'pytest', '--basetemp=.cache/final-verification')
  Invoke-Check 'real-artifact-verification' './.venv/Scripts/python.exe' @('-m', 'jit_baseline.cli', 'verify')
  Invoke-Check 'independent-reproduction-comparison' './.venv/Scripts/python.exe' @('-m', 'jit_baseline.cli', 'compare', 'artifacts/baseline', 'artifacts/reproduction', '--report', '../docs/evidence/_run/reproduction-comparison.json')
  Set-Location -LiteralPath $frontendRoot
  Invoke-Check 'clean-install' 'npm' @('ci', '--registry=https://registry.npmjs.org/', '--fetch-retries=0', '--fetch-timeout=30000')
  $summary.dependencies = (& npm ls --depth=0 --json | ConvertFrom-Json).dependencies
  $summary.gitStatus = (& git -C $projectRoot status --short | Out-String).Trim()
  $sourceFiles = @(Get-ChildItem -LiteralPath (Join-Path $frontendRoot 'src'), (Join-Path $frontendRoot 'e2e'), (Join-Path $frontendRoot 'public'), (Join-Path $frontendRoot 'scripts') -Recurse -File)
  $sourceFiles += @(Get-ChildItem -LiteralPath $frontendRoot -File | Where-Object { $_.Name -match '\.(json|ts|html|md)$' })
  $sourceFiles += @(Get-ChildItem -LiteralPath (Join-Path $backendRoot 'jit_baseline'), (Join-Path $backendRoot 'tests'), (Join-Path $backendRoot 'scripts') -Recurse -File | Where-Object { $_.Extension -ne '.pyc' })
  $sourceFiles += @(Get-ChildItem -LiteralPath $backendRoot -File)
  $summary.sourceHashes = @($sourceFiles | Sort-Object FullName | ForEach-Object { [ordered]@{ path = [System.IO.Path]::GetRelativePath($projectRoot, $_.FullName).Replace('\', '/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } })
  Invoke-Check 'typecheck' 'npm' @('run', 'typecheck')
  Invoke-Check 'behavior-tests' 'npm' @('test')
  Invoke-Check 'lint' 'npm' @('run', 'lint')
  Invoke-Check 'build' 'npm' @('run', 'build')
  Invoke-Check 'browser-tests' 'npm' @('run', 'test:e2e')
  Set-Location -LiteralPath $projectRoot
  Invoke-Check 'openspec-validation' 'openspec' @('validate', '--specs', '--strict', '--no-interactive')
  $summary.success = $true
} catch {
  $summary.failure = $_.Exception.Message
  throw
} finally {
  $protectedChanges = @()
  try {
    # A failed check must not bypass the end-of-run protection comparison.
    if ($null -ne $protectedBefore) {
      $protectedAfter = Get-ProtectedHashes
      foreach ($key in $protectedBefore.Keys) {
        if (-not $protectedAfter.ContainsKey($key)) { $protectedChanges += "missing: $key" }
        elseif ($protectedAfter[$key] -ne $protectedBefore[$key]) { $protectedChanges += "modified: $key" }
      }
      foreach ($key in $protectedAfter.Keys) {
        if (-not $protectedBefore.ContainsKey($key)) { $protectedChanges += "added: $key" }
      }
      $summary.protectedFilesUnchanged = ($protectedChanges.Count -eq 0)
      $summary.protectedFilesDiff = $protectedChanges
      if ($protectedChanges.Count -gt 0) { $summary.success = $false }
    }
  } catch {
    $summary.success = $false
    throw
  } finally {
    $summary.finishedUtc = [DateTime]::UtcNow.ToString('o')
    [System.IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))
    Pop-Location
  }
  if ($protectedChanges.Count -gt 0) { throw "Protected files changed during verification (write run output to the run workspace, or freeze an archive explicitly): $($protectedChanges -join '; ')" }
}
