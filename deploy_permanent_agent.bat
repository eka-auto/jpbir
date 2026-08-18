@echo off
echo ========================================
echo PERMANENT DEPLOYMENT: jaytibirthday.in Agent
echo ========================================
echo.

echo 1. Checking system requirements...
python --version
echo.

echo 2. Creating deployment directories...
if not exist "C:\Users\abcom\jpbir\permanent_agent" mkdir "C:\Users\abcom\jpbir\permanent_agent"
if not exist "C:\Users\abcom\jpbir\permanent_agent\trained_models" mkdir "C:\Users\abcom\jpbir\permanent_agent\trained_models"
if not exist "C:\Users\abcom\jpbir\permanent_agent\training_data" mkdir "C:\Users\abcom\jpbir\permanent_agent\training_data"
if not exist "C:\Users\abcom\jpbir\permanent_agent\deployed" mkdir "C:\Users\abcom\jpbir\permanent_agent\deployed"
if not exist "C:\Users\abcom\jpbir\permanent_agent\logs" mkdir "C:\Users\abcom\jpbir\permanent_agent\logs"
echo.

echo 3. Starting training data collection...
python -c "from permanent_deployment import PermanentAgentDeployment; agent = PermanentAgentDeployment('jaytibirthday.in'); agent.collect_training_data()"
echo.

echo 4. Processing training data...
python -c "from permanent_deployment import PermanentAgentDeployment; agent = PermanentAgentDeployment('jaytibirthday.in'); agent.process_training_data()"
echo.

echo 5. Training agent model...
python -c "from permanent_deployment import PermanentAgentDeployment; agent = PermanentAgentDeployment('jaytibirthday.in'); agent.train_agent_model()"
echo.

echo 6. Deploying agent as API service...
python -c "from permanent_deployment import PermanentAgentDeployment; agent = PermanentAgentDeployment('jaytibirthday.in'); agent.deploy_agent('api')"
echo.

echo 7. Creating startup configuration...
echo [Windows Task Scheduler Configuration] > "C:\Users\abcom\jpbir\permanent_agent\deployed\task_scheduler.txt"
echo Run: "C:\Users\abcom\jpbir\permanent_agent\deployed\start_agent.bat" >> "C:\Users\abcom\jpbir\permanent_agent\deployed\task_scheduler.txt"
echo Logs: "C:\Users\abcom\jpbir\permanent_agent\logs" >> "C:\Users\abcom\jpbir\permanent_agent\deployed\task_scheduler.txt"
echo.

echo ========================================
echo DEPLOYMENT COMPLETE!
echo ========================================
echo.
echo Agent deployed to: C:\Users\abcom\jpbir\permanent_agent
echo API will run on: http://localhost:5000
echo Logs directory: C:\Users\abcom\jpbir\permanent_agent\logs
echo.
echo To start the agent manually:
echo   cd "C:\Users\abcom\jpbir\permanent_agent\deployed\api"
echo   python app.py
echo.
pause
