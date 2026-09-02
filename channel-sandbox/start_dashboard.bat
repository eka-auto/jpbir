@echo off
rem Channel Sandbox Dashboard launcher
set PY=C:\Users\abcom\AppData\Local\Programs\Python\Python312\python.exe
cd /d %~dp0
if not exist logs mkdir logs
"%PY%" dashboard_api.py --config devices.json --host 127.0.0.1 --port 5000 >> logs\dashboard.log 2>&1
exit /b %errorlevel%
