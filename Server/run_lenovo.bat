@echo off
setlocal
set "ROOT=C:\eka-agent\broker"
set "PY=%ROOT%\.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo Broker runtime is not installed. Run install_lenovo.ps1 first.
  exit /b 1
)
"%PY%" "%ROOT%\device_agent.py" "%ROOT%\devices.json" g4g-lenovo-laptop --log-file "%ROOT%\logs\g4g-lenovo-laptop.log"
