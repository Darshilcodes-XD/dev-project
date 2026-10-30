@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-and-run.ps1"
if errorlevel 1 (
  echo.
  echo Setup or startup failed. Review the error above.
  pause
  exit /b 1
)
endlocal
