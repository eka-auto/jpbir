@echo off
setlocal
set "ROOT=C:\eka-agent\broker"
set "PY=%ROOT%\.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo Broker runtime is not installed. Run install_vivobook.ps1 first.
  exit /b 1
)
"%PY%" "%ROOT%\device_agent.py" "%ROOT%\devices.json" jayti-asus-vivobook --log-file "%ROOT%\logs\jayti-asus-vivobook.log"
