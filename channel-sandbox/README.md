# Channel Sandbox

Isolated dev scaffold for a device-to-dashboard channel. It uses the local Firestore emulator by default and refuses real-mode access to the production `devices` collection.

## What is in here
- devices.json                 config for the two sandbox devices
- firestore_client.py          REST+JWT client (same pattern as production daemons)
- device_agent.py              parameterized agent loop: heartbeat + command poll
- dashboard_api.py             Flask API: list devices, send commands, read status
- run_agent.bat               per-device launch script (single-instance guard)
- start_dashboard.bat         dashboard launcher
- e2e_engineering_sandbox_test.py    live emulator end-to-end verification

## What is NOT in here

- No real device IDs, no real device data
- No production secrets inlined
- No production collection writes

## How to run

  1. Install dependencies with `C:\Users\abcom\AppData\Local\Programs\Python\Python312\python.exe -m pip install -r requirements.txt`.
  2. Start the Firestore emulator on `127.0.0.1:8080`.
  3. Start the dashboard: start_dashboard.bat
  4. Start each device agent (one terminal per device):
       run_agent.bat devices.json test-scaffold-1
       run_agent.bat devices.json test-scaffold-2
  5. Run the end-to-end test:
       C:\Users\abcom\AppData\Local\Programs\Python\Python312\python.exe e2e_engineering_sandbox_test.py

## Cleanup
The end-to-end test removes its emulator documents on exit. For manual cleanup, run from this folder:
       C:\Users\abcom\AppData\Local\Programs\Python\Python312\python.exe _cleanup_test_docs.py
