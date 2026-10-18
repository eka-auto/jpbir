@echo off
rem HOD scheduled audit (decision D-5). Durable paths only: the previous runner
rem lived in a Temp worktree that was pruned, which silently failed the audit
rem (LastTaskResult 1 on 2026-10-18). Keep this file committed to the run branch.
set "REPO=C:\Users\abcom\jpbir"
set "STATE=C:\Users\abcom\jpbir-project-state"
set "PY=C:\Users\abcom\AppData\Local\Python\bin\python.exe"
set "LOG=%STATE%\hod-audit-last.log"
echo === hod-audit %DATE% %TIME% === > "%LOG%"
"%PY%" "%REPO%\project\audit\tracker.py" selftest >> "%LOG%" 2>&1
if errorlevel 1 (echo selftest FAILED >> "%LOG%" & exit /b 1)
"%PY%" "%REPO%\project\audit\tracker.py" audit --project "%REPO%\project" --state "%STATE%\project" --repo-root "%REPO%" >> "%LOG%" 2>&1
if errorlevel 1 (echo audit FAILED >> "%LOG%" & exit /b 1)
echo PASS >> "%LOG%"
exit /b 0