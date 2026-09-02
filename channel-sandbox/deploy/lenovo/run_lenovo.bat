@echo off
rem Lenovo daemon launcher — production
set PY=C:\Users\abcom\AppData\Local\Programs\Python\Python312\python.exe
cd /d %~dp0
if not exist logs mkdir logs
start /B "" cmd /c ""%PY%" device_agent.py devices.json g4g-lenovo-laptop > logs\lenovo.log 2>&1"
echo [run_lenovo] daemon started. Logs: logs\lenovo.log
