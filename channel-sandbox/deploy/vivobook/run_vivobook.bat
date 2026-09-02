@echo off
rem ASUS VivoBook daemon launcher — production deploy kit
rem Usage: run_vivobook.bat
set PY=C:\Users\abcom\AppData\Local\Programs\Python\Python312\python.exe
cd /d %~dp0
if not exist logs mkdir logs
start /B "" cmd /c ""%PY%" device_agent.py devices.json jayti-asus-vivobook > logs\vivobook.log 2>&1"
echo [run_vivobook] daemon started. Logs: logs\vivobook.log
