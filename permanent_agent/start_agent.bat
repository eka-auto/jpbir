@echo off
echo ========================================
echo JAYTI BIRTHDAY PERMANENT AGENT STARTUP
echo ========================================
echo.

echo Starting Jayti Birthday Domain Agent...
echo Domain: jaytibirthday.in
echo Port: 5000
echo Agent Type: Standalone (No dependencies)
echo.

echo Checking Python...
python --version
if errorlevel 1 (
    echo ❌ Python not found. Please install Python 3.6+.
    pause
    exit /b 1
)

echo.
echo Creating directories...
mkdir generated_letters 2>nul
mkdir agent_data 2>nul

echo.
echo 🚀 Starting Permanent Agent...
echo.
echo 📡 Agent will be available at:
echo    http://localhost:5000
echo.
echo 📊 Check status at:
echo    http://localhost:5000/health
echo.
echo 📝 Generate letters at:
echo    http://localhost:5000/generate/birthday?recipient=Jayti
echo.
echo 💡 Press Ctrl+C to stop the agent
echo.

cd /d "%~dp0"
python standalone_agent.py

echo.
echo Agent stopped.
echo Logs saved to: generated_letters\ and agent_logs.json
pause
