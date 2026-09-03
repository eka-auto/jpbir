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
- v2_broker_pipeline.py       one-command v2 broker protocol pipeline

## What is NOT in here

- No real device IDs, no real device data
- No production secrets inlined
- No production collection writes

## How to run

### Broker v2 pipeline (recommended)

From this directory, run:

    py -3.12 v2_broker_pipeline.py

This imports the production Vercel handlers behind a localhost HTTP adapter,
emulates OAuth and Firestore transactions in memory, and drives the handlers
with the real Python broker client and `device_agent.py --once`. It verifies
signed enrollment, code gates, raw-body hashing, P-256 DER signatures,
sequence/requestId replay handling, polling, leases, idempotent retries, and
command completion. It does not use cloud credentials or contact Firestore.

### Legacy Firestore emulator scaffold

  1. Install dependencies with `C:\Users\abcom\AppData\Local\Programs\Python\Python312\python.exe -m pip install -r requirements.txt`.
  2. Start the Firestore emulator on `127.0.0.1:8080`.
  3. Start the dashboard: start_dashboard.bat
  4. Start each device agent (one terminal per device):
       run_agent.bat devices.json test-scaffold-1
       run_agent.bat devices.json test-scaffold-2
  5. Run the end-to-end test:
       C:\Users\abcom\AppData\Local\Programs\Python\Python312\python.exe e2e_engineering_sandbox_test.py

## Vercel deployment

`dashboard_api.py` is deployed as the Vercel project `channel-sandbox`
(root directory `channel-sandbox`, framework preset Flask), redeployed on every
push to `main`. `pyproject.toml` names the entrypoint (`dashboard_api:app`),
which the builder cannot otherwise find, and restates the lambda's three
dependencies — its presence switches the build from pip to uv, and uv rejects a
pyproject.toml with no `[project]` table.

Vercel imports `dashboard_api:app` and never calls `main()`, so `devices.json`
and the service-account file are both unavailable. Config is read from the
environment on first request instead:

| Variable | Purpose |
|---|---|
| `STATS_KEY` | Compared against `?key=` or `X-Stats-Key`. **Required** — without it every route except `/api/status` returns 503. |
| `SANDBOX_CONFIG_JSON` | The whole of `devices.json` as one JSON string, minus `service_account_key`. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Service-account key as JSON. Required when `mode` is `real`. |
| `SANDBOX_MODE` | Optional override of `mode`; defaults to `real` when deployed. |

Set them with `vercel env add <NAME> production --scope jayti`, then redeploy.

Two protections sit in front of this, and both matter because
`POST /api/devices/<id>/commands` writes to the Firestore command queue:

- The `STATS_KEY` gate **fails closed** — an unset key refuses requests rather
  than allowing them, so a missing env var cannot quietly publish the queue.
- Vercel Authentication (SSO) is enabled for all non-custom domains, so the
  `*.vercel.app` URLs are not publicly reachable at all. Attaching a custom
  domain or disabling SSO would expose the app to the key gate alone.

`/api/status` is deliberately outside the key gate so a deployment can be
verified without handing out the key.

## Cleanup
The end-to-end test removes its emulator documents on exit. For manual cleanup, run from this folder:
       C:\Users\abcom\AppData\Local\Programs\Python\Python312\python.exe _cleanup_test_docs.py
