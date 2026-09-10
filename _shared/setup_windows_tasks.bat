@echo off
REM EKA Agent — Windows Scheduled Tasks Setup
REM Run this once to set up daily push + pull tasks

echo Setting up EKA Agent scheduled tasks...
set "SCRIPT_DIR=%~dp0"
set "PYTHON_CMD=py -3"
if exist "C:\Users\abcom\AppData\Local\Programs\Python\Python312\python.exe" (
    set "PYTHON_CMD=\"C:\Users\abcom\AppData\Local\Programs\Python\Python312\python.exe\""
)

REM Daily PUSH task — runs at 00:00, collects new files and pushes to VPS
schtasks /create /tn "EkaAgentPush" /tr "%PYTHON_CMD% \"%SCRIPT_DIR%eka_agent_push.py\" --device windows_pc_abcom" /sc daily /st 00:00 /rl HIGHEST /f

REM Daily PULL+PROCESS task — runs at 01:00, pulls from VPS and creates training chunks
schtasks /create /tn "EkaAgentPull" /tr "%PYTHON_CMD% \"%SCRIPT_DIR%eka_agent_pull.py\"" /sc daily /st 01:00 /rl HIGHEST /f

echo.
echo Verifying tasks...
schtasks /query /tn "EkaAgentPush" | findstr "TaskName Status"
schtasks /query /tn "EkaAgentPull" | findstr "TaskName Status"

echo.
echo Done. Tasks created:
echo   EkaAgentPush — daily at 00:00 (collects delta, pushes to VPS)
echo   EkaAgentPull — daily at 01:00 (pulls from VPS, creates training chunks)
pause