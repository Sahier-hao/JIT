$ErrorActionPreference = 'Stop'
$frontendRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $frontendRoot '..'))
$backendRoot = Join-Path $projectRoot 'backend'
$evidenceRoot = Join-Path $projectRoot 'docs/evidence/connect-public-data-baseline-review'
[System.IO.Directory]::CreateDirectory($evidenceRoot) | Out-Null
$runLog = Join-Path $evidenceRoot 'verification.log'
$summaryPath = Join-Path $evidenceRoot 'verification.json'
$summary = [ordered]@{ startedUtc = [DateTime]::UtcNow.ToString('o'); finishedUtc = $null; success = $false; node = $null; npm = $null; datasetVersion = $null; realRunId = $null; realEnvironment = $null; dependencies = $null; gitStatus = $null; sourceHashes = @(); protectedFilesUnchanged = $false; checks = @() }
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

Push-Location $frontendRoot
try {
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
  Invoke-Check 'independent-reproduction-comparison' './.venv/Scripts/python.exe' @('-m', 'jit_baseline.cli', 'compare', 'artifacts/baseline', 'artifacts/reproduction', '--report', '../docs/evidence/connect-public-data-baseline-review/reproduction-comparison.json')
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
  Invoke-Check 'change-validation' 'openspec' @('validate', 'connect-public-data-baseline-review', '--strict', '--no-interactive')
  $protected = Get-Content -LiteralPath (Join-Path $evidenceRoot 'protected-files.json') -Raw | ConvertFrom-Json
  foreach ($file in $protected) {
    if ((Get-FileHash -LiteralPath $file.path -Algorithm SHA256).Hash -ne $file.sha256) { throw "Protected file changed: $($file.path)" }
  }
  $summary.protectedFilesUnchanged = $true
  $summary.success = $true
} finally {
  $summary.finishedUtc = [DateTime]::UtcNow.ToString('o')
  [System.IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))
  Pop-Location
}
