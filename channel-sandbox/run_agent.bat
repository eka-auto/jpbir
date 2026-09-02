@echo off
rem Channel Sandbox Device Agent launcher
rem Usage: run_agent.bat devices.json <device_id>
set PY=C:\Users\abcom\AppData\Local\Programs\Python\Python312\python.exe
set CFG=%~1
set DID=%~2
if "%CFG%"=="" goto usage
if "%DID%"=="" goto usage
cd /d %~dp0
if not exist logs mkdir logs
"%PY%" device_agent.py "%CFG%" "%DID%" --log-file "logs\%DID%.log"
exit /b %errorlevel%
:usage
echo Usage: run_agent.bat devices.json ^<device_id^>
exit /b 2
