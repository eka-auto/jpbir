# S24 Deploy Kit

For the Samsung S24 Ultra (Termux). The phone is on a different network
(210.16.82.193) and unreachable from here — it must dial OUT to Firestore.

## What to do when you have the phone

1. Open Termux
2. Copy `install_s24.sh` to the phone (or run the one-liner below)
3. Run: `bash install_s24.sh`

## One-liner (no file copy needed)

```bash
curl -sL https://raw.githubusercontent.com/jaytipargal/eka-runner/main/termux/install_s24_direct_cloud.sh | bash
```

## What happens

- Clones `jaytipargal/eka-runner` (the S24 daemon repo)
- Fetches the service-account key from `(default)/bootstrap/s24key` (public read)
- Registers a Termux watchdog job (restarts the daemon if it dies)
- Enables ADB TCP on 5555 + sshd on 8022
- Starts the daemon → heartbeats `devices/samsung-s24-ultra` every 300s

## Verification

- Dashboard: `samsung-s24-ultra` flips LIVE within 5 minutes
- `runtime_contract.json` in this folder is the reference contract
  (deviceId, allowlisted actions, transport URLs) — the repo's copy governs
