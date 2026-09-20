@echo off
rem Channel Sandbox Dashboard launcher (Windows).
rem
rem This file used to `cd /d %~dp0` into Server\ and run `dashboard_api.py
rem --config devices.json` from there. The restructure moved both files to
rem Devices\sandbox\, so neither path existed any more and the only documented
rem way to start the service was broken. It also hardcoded one machine's
rem interpreter path.
rem
rem The cross-platform launcher is Devices\sandbox\start_dashboard.sh; this is
rem kept as the Windows equivalent. PYTHON may be set to override the
rem interpreter; devices.emulator.json is the default config because
rem devices.json is mode=real against the production collection and
rem FirestoreClient refuses it.
setlocal
if "%PYTHON%"=="" set PYTHON=python
cd /d "%~dp0..\Devices\sandbox"
if not exist logs mkdir logs
if "%SANDBOX_CONFIG%"=="" set SANDBOX_CONFIG=devices.emulator.json
if "%PORT%"=="" set PORT=5000
"%PYTHON%" dashboard_api.py --config "%SANDBOX_CONFIG%" --host 127.0.0.1 --port %PORT% >> logs\dashboard.log 2>&1
exit /b %errorlevel%
