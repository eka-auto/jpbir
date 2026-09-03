# VivoBook Dashboard Tools

Device management scripts for ASUS VivoBook laptop.

## Quick Start

### Freeze Device (Prevent Stale Alerts)

```powershell
# From Windows PowerShell
cd C:\Users\abcom\jpbir\Dashboard\Vivobook\tools
.\freeze_device.ps1 -Action freeze

# Or directly from tools directory
python C:\Users\abcom\jpbir\tools\freeze_device.py --device jayti-asus-vivobook --action freeze
```

### Unfreeze Device (Re-enable Monitoring)

```powershell
.\freeze_device.ps1 -Action unfreeze
```

### Check Device Status

```powershell
python C:\Users\abcom\jpbir\tools\query_firestore.py
```

## What Gets Frozen

When you freeze a device:
- `staleAlert.state` is set to `"frozen"`
- No stale alert emails will be sent
- Device continues to send heartbeats normally
- Dashboard still shows device as online

## When to Freeze

- Laptop is temporarily offline (travel, maintenance)
- Testing without triggering alerts
- Device is decommissioned but data should be preserved

## When to Unfreeze

- Laptop is back online
- You want to re-enable stale monitoring
- Ready to receive alerts again

## Files

- `freeze_device.ps1` - PowerShell wrapper for freeze/unfreeze operations
- `DASHBOARD.md` - Device configuration and data flow

## Related

- **Shared tools:** `../../tools/freeze_device.py`, `../../tools/query_firestore.py`
- **Sandbox:** `../../Sandbox/Vivobook/` - Agent installation scripts
- **Firestore doc:** `devices/jayti-asus-vivobook` in `eka-agent` database
