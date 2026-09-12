# S24 Connection & Daemon Start Runbook

AUTHORITATIVE process for connecting the Samsung S24 Ultra and starting its daemon.
Follow this exactly every time. Do not improvise.

Project: `intrepid-stage-495117-q1` · Database: `eka-agent` · Device doc: `devices/samsung-s24-ultra`

---

## Golden rules

1. The daemon **only runs on the phone** (Termux). It has a hardware identity gate
   (Samsung + `SM-S928*` model) that blocks laptop runs.
2. Laptop writers are **fail-closed**: they must NEVER write `online: True` for the S24.
   Only the phone daemon writes `online: True`.
3. The dashboard green light = fresh `lastSeen` (age < 3×45s = 135s). A one-off connect
   shows green for ~2 min; sustained green requires the phone daemon heartbeating.
4. All admin scripts target the **`eka-agent`** named database, NOT `(default)`.

---

## Step 0 — Preflight (always, before any start)

```powershell
# 1. Is the phone reachable over ADB?
adb devices

# 2. Current Firestore state (prior state, writers)
python Dashboard\S24\tools\freeze_device.py --list
```

- If `adb devices` shows the phone → use **Method A (USB)** or **B (wireless)**.
- If no device → use **Method C (manual Termux)**.

---

## Method A — USB ADB (phone plugged in)

```powershell
adb push "C:\Users\abcom\Go4Garage\Eka Runner\s24_phone_direct_cloud.py" `
    /data/data/com.termux/files/home/eka-runner/s24_phone_direct_cloud.py
adb shell "cd ~/eka-runner && nohup python s24_phone_direct_cloud.py >/dev/null 2>&1 &"
```

## Method B — Wireless ADB

```powershell
adb connect <PHONE_IP>:5555     # IP from Settings > Developer options > Wireless debugging
# then same commands as Method A
```

## Method C — Manual Termux (no ADB)

On the phone, open Termux and paste:

```bash
pkg install -y git python termux-api openssh
pip install --quiet google-auth requests

# Get the daemon
git clone --depth 1 https://github.com/jaytipargal/eka-runner.git ~/eka-runner 2>/dev/null \
  || git -C ~/eka-runner pull --ff-only

# Provide the service-account key (bootstrap doc is 404, so set it explicitly).
# On the laptop, generate the base64 first:
#   certutil -encode "C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json" key.b64
# then paste the base64 content into EKA_SERVICE_ACCOUNT_KEY_B64 below.
export EKA_SERVICE_ACCOUNT_KEY_B64="<PASTE_BASE64>"

bash ~/eka-runner/termux/install_s24_direct_cloud.sh
```

---

## Verify the daemon is live

```powershell
python Dashboard\S24\tools\freeze_device.py --list
```

Look for `samsung-s24-ultra` with:
- `Online: True`
- `Last Seen:` within the last ~2 minutes (keeps refreshing while daemon runs)

Dashboard: open the S24 page — the status light blinks **green** while heartbeats are fresh,
**red** with a diagnostic reason when offline.

---

## Admin scripts (all in Dashboard/S24/tools/)

| Command | Purpose |
|---------|---------|
| `python freeze_device.py --list` | Show all devices + state |
| `python freeze_device.py --device samsung-s24-ultra --action freeze` | Suppress stale alerts |
| `python freeze_device.py --device samsung-s24-ultra --action unfreeze` | Re-enable alerts |
| `python connect_and_freeze.py --device samsung-s24-ultra --display "Samsung S24 Ultra"` | One-off connect (green ~2 min) |
| `python query_firestore.py` | Raw query of eka-agent devices |

Env var for credentials (must match GitHub secret name exactly):
`FIREBASE_SERVICE_ACCOUNT_JSON`
