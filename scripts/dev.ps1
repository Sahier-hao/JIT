# 前台启动 JIT 本机前后端；输出显示在当前窗口，并写入 temp/dev。
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$python = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
  $python = 'python'
}
& $python (Join-Path $PSScriptRoot 'dev.py') @args
exit $LASTEXITCODE
