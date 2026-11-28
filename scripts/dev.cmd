@echo off
setlocal
set "ROOT=%~dp0.."
if exist "%ROOT%\backend\.venv\Scripts\python.exe" (
  set "PYTHON=%ROOT%\backend\.venv\Scripts\python.exe"
) else (
  set "PYTHON=python"
)
"%PYTHON%" "%ROOT%\scripts\dev.py" %*
exit /b %ERRORLEVEL%
