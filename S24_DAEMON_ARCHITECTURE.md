# S24 Remote Access Infrastructure

## Architecture Overview

The Samsung S24 Ultra is managed through a sophisticated daemon (`s24_phone_direct_cloud.py`) that runs in Termux on the physical device.

## Three Access Layers

### 1. Firestore Command Queue (RCE)
- **Mechanism**: Daemon polls `eka-agent/devices/samsung-s24-ultra.commandQueue`
- **Execution**: Raw Python scripts injected directly into queue for local execution
- **Actions**: `sync-now`, `heartbeat`, `status-only`, `wakeup`, `collect-*`, `full-sync`, `full_extraction`, `extract_whatsapp`, `debug-calllogs`
- **Allowlist**: `PHONE_QUEUE_ACTIONS` set - non-matching actions rejected
- **Location**: `C:\Users\abcom\Go4Garage\Eka Runner\s24_phone_direct_cloud.py`

### 2. Persistent Reverse SSH Tunnel (bore)
- **Local SSH**: `sshd` running on port 8022 inside Termux
- **Tunnel Tool**: `bore` exposes local SSH to public internet via `bore.pub`
- **Public Endpoint**: Bore-assigned URL/port posted to Firestore document
- **Access**: Direct SSH from anywhere via `ssh -p <bore-port> root@bore.pub`
- **Benefit**: NAT/firewall穿透 - no port forwarding needed

### 3. ntfy Push-to-Wake
- **Android App**: `io.heckel.ntfy` (FOSS, kept alive with wake-lock)
- **Topic**: `eka-agent-s24-cmd` (configurable via `NTFY_TOPIC` env var)
- **Purpose**: Instant wake-up without waiting for command queue poll cycle
- **Trigger**: Laptop POSTs to `https://ntfy.sh/<topic>`
- **Daemon Fields**: Publishes `ntfyTopic` / `ntfyWakeUrl` to Firestore

## Daemon Lifecycle

```
Termux start → nohup daemon → wake-lock acquired
                    ↓
        ┌───────────┼───────────┐
        ↓           ↓           ↓
   Firestore    ntfy       bore
   poll (15s)   listener   tunnel
        ↓           ↓           ↓
   commandQueue  wake-up   SSH public
   execution     trigger   endpoint
```

## Key Files

| Component | Location |
|-----------|----------|
| Phone daemon | `C:\Users\abcom\Go4Garage\Eka Runner\s24_phone_direct_cloud.py` |
| Laptop export daemon | `devices/s24/wa_export_daemon.py` |
| Ntfy trigger | `trigger_s24_full_export.py::send_ntfy_wake()` |
| Tunnel inspector | `inspect_s24_tunnel.py` |

## Security Properties

- **Allowlisted actions** - No raw shell execution
- **Identity gates** - Samsung manufacturer + SM-S928* model check
- **Attestation** - `heartbeatAuth`, `agentVersion`, `liveDeviceVerified` required for `online: True`
- **Non-exportable keys** - Android Keystore P-256

## Current State (2026-09-03)

- Daemon has **never successfully started** on physical S24
- Firestore doc `devices/samsung-s24-ultra` shows `online: false`, `lastSeen: null`
- Blocked on physical access to run Termux setup
- Battery was at 0.77% on last check (needs ≥30% and charging)

## Comparison: SSH Mesh vs S24 Daemon

| Feature | SSH Mesh | S24 Daemon |
|---------|----------|------------|
| Setup | Simple SSH keys | Termux + bore + ntfy |
| Access | Direct SSH | SSH via bore + Firestore RCE |
| Wake-up | Manual connect | ntfy push + poll |
| NAT traversal | Same network only | Global via bore.pub |
| Automation | Manual SSH commands | Script injection via Firestore |
| Battery impact | Standard SSH | Wake-lock maintained |

**Decision (2026-09-03)**: Using S24 daemon architecture - more capable for automated workflows and remote access.
