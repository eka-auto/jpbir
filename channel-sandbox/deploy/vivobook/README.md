# ASUS VivoBook Deploy Kit

Copy this folder to the real ASUS VivoBook and run `install_vivobook.ps1` once.

## Contents
- `devices.json` — production config (real mode, eka-agent, devices collection, explicit opt-in)
- `device_agent.py` — the daemon (heartbeat + command queue, single-instance guard)
- `firestore_client.py` — REST+JWT client with CAS-protected queue writes
- `single_instance.py` — pidfile + psutil guard
- `run_vivobook.bat` — foreground launcher
- `install_vivobook.ps1` — one-time setup: key placement + scheduled task

## One-time setup (on the VivoBook)
1. Copy this folder to `C:\eka-agent\agent\`
2. Place the VivoBook service-account key at `C:\eka-agent\agent\serviceAccountKey.json`
   (minted for `vivobook-daemon@intrepid-stage-495117-q1.iam.gserviceaccount.com`)
3. Run: `powershell -ExecutionPolicy Bypass -File install_vivobook.ps1`

## What happens
- The daemon heartbeats `devices/jayti-asus-vivobook` every 45s
- The dashboard flips it LIVE when lastSeen is fresh
- Commands queued via jp-ask are claimed, executed, and acked

## Safety
- `allow_production_devices: true` is an explicit opt-in in devices.json
- The single-instance guard refuses duplicate daemons for the same device
- No surveillance features (no mic, no screenshots, no lock)
