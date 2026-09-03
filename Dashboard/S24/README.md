# S24 Dashboard Tools

Device management scripts for Samsung S24 Ultra.

## Quick Start

### Freeze Device (Prevent Stale Alerts)

```bash
# From S24 Termux
cd ~/jpbir/Dashboard/S24/tools
./freeze_device.sh freeze

# Or directly from tools directory
python ~/jpbir/tools/freeze_device.py --device samsung-s24-ultra --action freeze
```

### Unfreeze Device (Re-enable Monitoring)

```bash
./freeze_device.sh unfreeze
```

### Check Device Status

```bash
python ~/jpbir/tools/query_firestore.py
```

## What Gets Frozen

When you freeze a device:
- `staleAlert.state` is set to `"frozen"`
- No stale alert emails will be sent
- Device continues to send heartbeats normally
- Dashboard still shows device as online

## When to Freeze

- Device is temporarily offline (travel, maintenance)
- Testing without triggering alerts
- Device is decommissioned but data should be preserved

## When to Unfreeze

- Device is back online
- You want to re-enable stale monitoring
- Ready to receive alerts again

## Files

- `freeze_device.sh` - Bash wrapper for freeze/unfreeze operations
- `DASHBOARD.md` - Device configuration and data flow

## Related

- **Shared tools:** `../../tools/freeze_device.py`, `../../tools/query_firestore.py`
- **Sandbox:** `../../Sandbox/S24/` - Agent installation scripts
- **Firestore doc:** `devices/samsung-s24-ultra` in `eka-agent` database
