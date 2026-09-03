# Dashboard Current - Shared Device Management

Main dashboard for managing all devices (S24, VivoBook, and future devices).

## Structure

```
Current/
├── api/          Serverless functions (Vercel)
├── frontend/     Shared UI components
├── lib/          Shared utilities (stale.js, broker.js)
├── others/       Tests and config
├── README.md     This file
└── DASHBOARD.md  Deployment guide
```

## Device Management

### Freeze/Unfreeze Devices

Use the device-specific tools in each device folder:

- **S24:** `../S24/tools/freeze_device.sh`
- **VivoBook:** `../Vivobook/tools/freeze_device.ps1`

Or use the shared Python scripts directly:

```bash
# Freeze S24
python ../../tools/freeze_device.py --device samsung-s24-ultra --action freeze

# Unfreeze VivoBook
python ../../tools/freeze_device.py --device jayti-asus-vivobook --action unfreeze

# List all devices
python ../../tools/query_firestore.py --list
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/device-heartbeat` | POST | Device heartbeat updates |
| `/api/device-enroll` | POST | Enroll new device |
| `/api/device-commands-poll` | GET | Poll for queued commands |
| `/api/check-stale` | GET | Check and alert on stale devices |
| `/api/jp-devices` | GET | List all devices with status |
| `/api/jp-device` | GET | Get single device details |

## Data Flow

```
Device (S24/VivoBook)
    ↓ (heartbeat)
Firestore (eka-agent/devices/{deviceId})
    ↓ (Vercel Cron → /api/check-stale)
Email Alerts (if staleAlert.state == 'healthy' and lastSeen > threshold)
    ↓
Dashboard UI (jaytipargal.tech)
```

## Stale Alert Logic

The `staleAlert.state` field controls email alerts:

- `"healthy"` - Normal monitoring, alerts enabled
- `"alerted"` - Device is stale, alert already sent
- `"frozen"` - Monitoring paused, no alerts sent

Transition logic is in `lib/stale.js` (edge-triggered, only emails on state changes).

## Related

- **S24 Dashboard:** `../S24/` - Device-specific config and tools
- **VivoBook Dashboard:** `../Vivobook/` - Device-specific config and tools
- **Sandbox:** `../../Sandbox/` - Agent installation scripts
- **Tools:** `../../tools/` - Shared device management scripts
