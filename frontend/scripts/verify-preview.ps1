$ErrorActionPreference = 'Stop'
$frontendRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $frontendRoot '..'))
$backendRoot = Join-Path $projectRoot 'backend'
$python = Join-Path $backendRoot '.venv/Scripts/python.exe'
$runRoot = Join-Path $projectRoot 'docs/evidence/_run/preview-browser'
[System.IO.Directory]::CreateDirectory($runRoot) | Out-Null
$backend = $null
$frontend = $null

function Test-Port([int]$Port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Wait-Url([string]$Url, [int]$Seconds, [string]$Label) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  throw "$Label did not become ready at $Url"
}

try {
  if (Test-Port 18769) { throw 'Port 18769 is already in use; refusing to stop another service' }
  if (Test-Port 18770) { throw 'Port 18770 is already in use; refusing to stop another service' }

  $oldPythonPath = $env:PYTHONPATH
  $env:PYTHONPATH = '.'
  $backend = Start-Process -FilePath $python `
    -ArgumentList @('tests/project_review_preview.py', '--port', '18769') `
    -WorkingDirectory $backendRoot -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runRoot 'backend.out.log') `
    -RedirectStandardError (Join-Path $runRoot 'backend.err.log')
  $env:PYTHONPATH = $oldPythonPath

  $oldFrontendPort = $env:JIT_FRONTEND_PORT
  $oldProxy = $env:JIT_API_PROXY_TARGET
  $env:JIT_FRONTEND_PORT = '18770'
  $env:JIT_API_PROXY_TARGET = 'http://127.0.0.1:18769'
  $frontend = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev') `
    -WorkingDirectory $frontendRoot -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runRoot 'frontend.out.log') `
    -RedirectStandardError (Join-Path $runRoot 'frontend.err.log')
  $env:JIT_FRONTEND_PORT = $oldFrontendPort
  $env:JIT_API_PROXY_TARGET = $oldProxy

  Wait-Url 'http://127.0.0.1:18769/__test/context' 180 'preview API'
  Wait-Url 'http://127.0.0.1:18770/' 180 'preview frontend'

  Push-Location $frontendRoot
  try {
    & npx.cmd playwright test --config=playwright.project-workspace.config.ts --project=desktop-1440 --project=mobile-390
    if ($LASTEXITCODE -ne 0) { throw "preview browser tests failed with exit $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
} catch {
  if (Test-Path (Join-Path $runRoot 'backend.err.log')) {
    Write-Host '--- backend stderr (tail) ---'
    Get-Content (Join-Path $runRoot 'backend.err.log') -Tail 40
  }
  if (Test-Path (Join-Path $runRoot 'frontend.err.log')) {
    Write-Host '--- frontend stderr (tail) ---'
    Get-Content (Join-Path $runRoot 'frontend.err.log') -Tail 40
  }
  throw
} finally {
  if ($frontend) { & taskkill.exe /PID $frontend.Id /T /F 2>$null | Out-Null }
  if ($backend) { Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue }
}
