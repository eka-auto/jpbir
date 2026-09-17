#!/usr/bin/env python3
"""Device agent for the channel sandbox."""
from __future__ import annotations

import argparse
import atexit
import hashlib
import json
import logging
import os
import platform
import re
import signal
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import psutil

from broker_client import BrokerAuthError, BrokerClient, BrokerError
from signer import make_signer
from single_instance import GuardHeldError, acquire_guard, release_guard

log = logging.getLogger("channel_sandbox.agent")

_SW = {'creationflags': 0x08000000} if platform.system() == 'Windows' else {}


def collect_hardware_identity():
    """Collect hardware identity for enrollment verification."""
    identity = {
        "hostname": socket.gethostname(),
        "os": platform.system(),
    }
    if platform.system() == "Windows":
        try:
            out = subprocess.run(
                ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
                 '$c=Get-CimInstance Win32_ComputerSystem | Select-Object -First 1 Manufacturer,Model; '
                 '$p=Get-CimInstance Win32_ComputerSystemProduct | Select-Object -First 1 UUID; '
                 '[pscustomobject]@{Manufacturer=$c.Manufacturer;Model=$c.Model;UUID=$p.UUID} | ConvertTo-Json -Compress'],
                capture_output=True, text=True, timeout=10, encoding='utf-8', errors='replace', **_SW
            )
            if out.returncode == 0 and out.stdout.strip():
                data = json.loads(out.stdout)
                identity["manufacturer"] = data.get("Manufacturer", "")
                identity["model"] = data.get("Model", "")
                stable_id = str(data.get("UUID", "")).strip()
                if stable_id:
                    identity["serialHash"] = hashlib.sha256(stable_id.encode("utf-8")).hexdigest()
        except Exception as e:
            log.warning("hardware identity collection failed: %s", e)
    else:
        try:
            for prop, field in (
                ("ro.product.manufacturer", "manufacturer"),
                ("ro.product.model", "model"),
            ):
                out = subprocess.run(['getprop', prop], capture_output=True, text=True, timeout=5, **_SW)
                identity[field] = out.stdout.strip()
            for prop in ("ro.boot.serialno", "ro.serialno"):
                out = subprocess.run(['getprop', prop], capture_output=True, text=True, timeout=5, **_SW)
                stable_id = out.stdout.strip()
                if stable_id:
                    identity["serialHash"] = hashlib.sha256(stable_id.encode("utf-8")).hexdigest()
                    break
        except Exception:
            pass
    return identity


def collect_network():
    """Best-effort rich network snapshot (mirrors mcp_server._collect_network)."""
    ssid = None
    wifi_signal = None
    try:
        if platform.system() == 'Windows':
            out = subprocess.run(['netsh', 'wlan', 'show', 'interfaces'], capture_output=True, text=True, timeout=5, encoding='utf-8', errors='replace', **_SW).stdout
            for line in out.split('\n'):
                if 'SSID' in line and 'BSSID' not in line:
                    ssid = line.split(':', 1)[-1].strip()
                elif 'Signal' in line:
                    match = re.search(r'(\d+)%', line)
                    if match:
                        signal_pct = int(match.group(1))
                        if ssid:
                            wifi_signal = {'ssid': ssid, 'signal_percent': signal_pct}
        else:
            r = subprocess.run(['iwgetid', '-r'], capture_output=True, text=True, timeout=5, **_SW)
            ssid = r.stdout.strip() or None
    except (subprocess.SubprocessError, FileNotFoundError, OSError) as exc:
        log.warning("WiFi SSID lookup skipped: %s", exc)

    ifaces = {}
    try:
        for name, addrs in psutil.net_if_addrs().items():
            for a in addrs:
                if a.family == 2:
                    ifaces[name] = a.address
    except (psutil.Error, OSError) as exc:
        log.warning("interface scan skipped: %s", exc)

    conns = []
    conns_with_proc = []
    try:
        for c in psutil.net_connections(kind='inet'):
            if c.status == 'ESTABLISHED' and c.raddr:
                conn_str = f"{c.raddr.ip}:{c.raddr.port}"
                conns.append(conn_str)
                proc_name = 'Unknown'
                if c.pid:
                    try:
                        proc = psutil.Process(c.pid)
                        proc_name = proc.name()
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
                conns_with_proc.append({'connection': conn_str, 'process': proc_name})
    except (psutil.AccessDenied, OSError) as exc:
        log.warning("connection scan skipped: %s", exc)

    network_per_app = {}
    for conn in conns_with_proc:
        app_name = conn.get('process', 'Unknown')
        network_per_app[app_name] = network_per_app.get(app_name, 0) + 1

    network_per_app_list = [
        {'name': name, 'connections': count}
        for name, count in sorted(network_per_app.items(), key=lambda x: x[1], reverse=True)
    ][:20]

    io = psutil.net_io_counters()
    return {
        "ssid": ssid,
        "interfaces": ifaces,
        "sent_mb": round(io.bytes_sent / (1024**2), 1),
        "recv_mb": round(io.bytes_recv / (1024**2), 1),
        "connections": list(set(conns))[:20],
        "wifiSignal": wifi_signal,
        "networkPerApp": network_per_app_list,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def collect_local_status():
    return {
        "hostname": socket.gethostname(),
        "pid": os.getpid(),
        "cwd": os.getcwd(),
        "python": sys.version.split()[0],
        "uptime_since": datetime.now(timezone.utc).isoformat(),
    }


def _run_wa_push(payload, started):
    """Run the on-device WhatsApp push wrapper once and return its outcome.

    The queued command carries NO secret: WA_INGEST_KEY lives only in the
    wrapper's env file on the phone (~/s24-agent/wa_push.env). A 'wa-push'
    command therefore just asks the device to run its already-configured push,
    which is what keeps this safe to expose over the outbound broker channel —
    the dashboard can trigger a sync but can never inject a key or a command
    line. stdout is tailed back so the dashboard sees the run_id / row count.
    """
    tick = os.path.expanduser(os.environ.get("WA_PUSH_TICK", "~/s24-agent/wa_push_tick.sh"))
    if not os.path.exists(tick):
        return {"status": "failed",
                "result": {"error": f"wa_push wrapper not found at {tick}"},
                "completed_at": datetime.now(timezone.utc).isoformat()}
    timeout = int((payload or {}).get("timeout_seconds", 180))
    try:
        proc = subprocess.run(["sh", tick], capture_output=True, text=True, timeout=timeout, **_SW)
    except subprocess.TimeoutExpired:
        return {"status": "failed",
                "result": {"error": f"wa_push timed out after {timeout}s"},
                "completed_at": datetime.now(timezone.utc).isoformat()}
    done = datetime.now(timezone.utc).isoformat()
    result = {"exit": proc.returncode, "output": (proc.stdout or "")[-1500:]}
    stderr = (proc.stderr or "")[-500:]
    if stderr:
        result["stderr"] = stderr
    return {"status": "ok" if proc.returncode == 0 else "failed", "result": result, "completed_at": done}


def handle_command(action, payload):
    started = datetime.now(timezone.utc).isoformat()
    try:
        if action == "status-only":
            return {"status": "ok", "result": {"echo": "ok", "ts": started}, "completed_at": started}
        if action == "ping":
            return {"status": "ok", "result": {"pong": True, "ts": started}, "completed_at": started}
        if action == "echo":
            return {"status": "ok", "result": {"echoed": payload or {}, "ts": started}, "completed_at": started}
        # 'wa-push' (alias 'sync-now') runs the device's own WhatsApp push wrapper.
        # No arbitrary shell: the action name maps to one fixed local script.
        if action in ("wa-push", "sync-now"):
            return _run_wa_push(payload, started)
        return {"status": "rejected", "result": {"error": f"unknown action: {action}"}, "completed_at": started}
    except Exception as e:
        return {"status": "error", "result": {"error": str(e)}, "completed_at": started}

def run(config_path, device_id, single_iteration=False):
    with open(config_path, encoding="utf-8") as f:
        cfg = json.load(f)
    device_cfg = next((d for d in cfg["devices"] if d["id"] == device_id), None)
    if device_cfg is None:
        raise SystemExit(f"device id not found in config: {device_id}")

    if cfg.get("transport", "firestore") == "broker":
        run_broker(
            cfg,
            Path(config_path).resolve().parent,
            device_id,
            device_cfg,
            single_iteration,
        )
        return

    from firestore_client import FirestoreClient

    client = FirestoreClient(
        project=cfg["project"],
        database=cfg["database"],
        service_account_key=cfg["service_account_key"],
        scope=cfg["firestore_scope"],
        mode=cfg.get("mode", "emulator"),
        collection=cfg["collection"],
        emulator_host=cfg.get("emulator_host"),
        allow_production_devices=cfg.get("allow_production_devices", False),
    )
    hb_interval = cfg["heartbeat_interval_seconds"]
    poll_interval = cfg["command_poll_interval_seconds"]
    allowed = cfg.get("allowed_commands", [])
    collection = cfg["collection"]

    log.info("starting device=%s hb=%ss poll=%ss", device_id, hb_interval, poll_interval)
    if single_iteration:
        send_heartbeat(client, collection, device_id, device_cfg, collect_local_status(), hb_interval)
        process_command_queue(client, collection, device_id, allowed)
        return

    last_hb = 0.0
    while True:
        now = time.time()
        if now - last_hb >= hb_interval:
            try:
                send_heartbeat(client, collection, device_id, device_cfg, collect_local_status(), hb_interval)
                last_hb = now
            except Exception as e:
                log.warning("heartbeat failed: %s", e)
        try:
            process_command_queue(client, collection, device_id, allowed)
        except Exception as e:
            log.warning("command poll failed: %s", e)
        time.sleep(min(poll_interval, max(1.0, hb_interval - (now - last_hb))))


def _find_enrollment_code(cfg, config_dir):
    code = os.environ.get("EKA_ENROLLMENT_CODE", "").strip()
    if code:
        return code, None
    code_file = Path(cfg.get("enrollment_code_file") or "enrollment_code.txt")
    if not code_file.is_absolute():
        code_file = config_dir / code_file
    if code_file.exists():
        return code_file.read_text(encoding="utf-8").strip(), code_file
    return None, None


def run_broker(cfg, config_dir, device_id, device_cfg, single_iteration):
    signer = make_signer(cfg)
    state_path = Path(cfg.get("broker_state_file") or f"{device_id}.broker-state.json")
    if not state_path.is_absolute():
        state_path = config_dir / state_path
    client = BrokerClient(cfg["broker_url"], signer, device_id, state_path)
    hb_interval = cfg["heartbeat_interval_seconds"]
    poll_interval = cfg["command_poll_interval_seconds"]
    allowed = cfg.get("allowed_commands", [])
    worker_session = f"{socket.gethostname()}-{os.getpid()}-{int(time.time())}"

    if not client.enrolled:
        code, code_file = _find_enrollment_code(cfg, config_dir)
        if not code:
            raise SystemExit(
                "device is not enrolled and no enrollment code was found "
                "(set EKA_ENROLLMENT_CODE or place enrollment_code.txt next to the config)"
            )
        hardware = collect_hardware_identity()
        result = client.enroll(code, hardware)
        if code_file is not None:
            try:
                code_file.unlink()
            except OSError:
                pass
        log.info("enrolled with broker: keyId=%s", result.get("keyId"))

    log.info("starting broker device=%s hb=%ss poll=%ss", device_id, hb_interval, poll_interval)

    def one_heartbeat():
        hardware = collect_hardware_identity()
        telemetry = {
            "deviceId": device_id,
            "canonicalDeviceId": device_id,
            "deviceDisplayName": device_cfg.get("display_name", device_id),
            "deviceRole": device_cfg.get("role", "unknown"),
            "deviceType": device_cfg.get("type", "laptop"),
            "connectionMethod": "channel-sandbox-broker",
            "agentVersion": "channel-sandbox-2.0",
            "heartbeatIntervalSeconds": hb_interval,
            "local": collect_local_status(),
        }
        try:
            telemetry["network"] = collect_network()
        except Exception as e:
            log.warning("network collection failed, heartbeat continues: %s", e)
        client.heartbeat(hardware, telemetry)
        log.debug("broker heartbeat sent for %s", device_id)

    def one_poll():
        polled = client.poll()
        for cmd in polled.get("commands", []):
            cmd_id = cmd["commandId"]
            action = cmd.get("action", "")
            try:
                if action not in allowed:
                    if cmd.get("state") == "lease-expired":
                        continue
                    claimed = client.claim(cmd_id, worker_session)
                    client.complete(cmd_id, claimed["claimToken"], {
                        "status": "rejected",
                        "error": f"action not allowed: {action}",
                        "ts": datetime.now(timezone.utc).isoformat(),
                    })
                    log.info("command %s rejected on %s: action not allowed", cmd_id, device_id)
                    continue
                claimed = client.claim(cmd_id, worker_session)
                outcome = handle_command(action, claimed.get("payload") or {})
                status = outcome["status"] if outcome["status"] in ("ok", "rejected", "failed", "error") else "failed"
                client.complete(cmd_id, claimed["claimToken"], {
                    "status": status,
                    **(outcome["result"] or {}),
                    "completedAt": outcome["completed_at"],
                })
                log.info("command %s executed on %s: %s", cmd_id, device_id, status)
            except BrokerError as e:
                if e.status == 409:
                    log.info("command %s skipped (conflict/lease): %s", cmd_id, e)
                else:
                    log.warning("command %s processing failed: %s", cmd_id, e)

    if single_iteration:
        one_heartbeat()
        one_poll()
        return

    last_hb = 0.0
    while True:
        try:
            now = time.time()
            if now - last_hb >= hb_interval:
                one_heartbeat()
                last_hb = now
            one_poll()
        except BrokerAuthError as e:
            log.error("broker rejected this device key (revoked, superseded, or re-enrollment required): %s", e)
            raise SystemExit(3)
        except BrokerError as e:
            log.warning("broker iteration failed: %s", e)
        except Exception as e:
            log.warning("iteration failed: %s", e)
        time.sleep(min(poll_interval, max(1.0, hb_interval - (time.time() - last_hb))))


def send_heartbeat(client, collection, device_id, device_cfg, local, hb_interval=45):
    now = datetime.now(timezone.utc).isoformat()
    fields = {
        "online": True,
        "lastSeen": now,
        "updatedAt": now,
        "deviceId": device_id,
        "canonicalDeviceId": device_id,
        "deviceDisplayName": device_cfg.get("display_name", device_id),
        "deviceRole": device_cfg.get("role", "unknown"),
        "deviceType": "laptop",
        "heartbeatIntervalSeconds": hb_interval,
        "connectionMethod": "channel-sandbox-daemon",
        "agentVersion": "channel-sandbox-1.0",
        "local": local,
    }
    try:
        fields["network"] = collect_network()
    except Exception as e:
        log.warning("network collection failed, heartbeat continues: %s", e)
    client.set_doc(collection, device_id, fields, merge=True)
    log.debug("heartbeat sent for %s", device_id)

def process_command_queue(client, collection, device_id, allowed):
    from firestore_client import decode_value

    doc = client.get_doc(collection, device_id)
    if not doc:
        return
    queue = doc.get("fields", {}).get("commandQueue", {}).get("mapValue", {}).get("fields", {})
    if not queue:
        return
    updates = {}
    for cmd_id, cmd_val in queue.items():
        cmd_map = cmd_val.get("mapValue", {}).get("fields", {})
        status_ref = cmd_map.get("status", {}).get("stringValue")
        if status_ref != "pending":
            continue
        action = cmd_map.get("action", {}).get("stringValue", "")
        if action not in allowed:
            updates[cmd_id] = {
                "status": "rejected",
                "error": f"action not allowed: {action}",
            }
            continue
        payload_raw = cmd_map.get("payload")
        payload_decoded = decode_value(payload_raw) if payload_raw else {}
        outcome = handle_command(action, payload_decoded)
        updates[cmd_id] = {
            "status": outcome["status"],
            "result": outcome["result"],
            "completedAt": outcome["completed_at"],
        }
        log.info("command %s executed on %s: %s", cmd_id, device_id, outcome["status"])
    if updates:
        client.update_command_queue_entries(collection, device_id, updates)


def guard_pidfile(config_path, device_id):
    """Use the broker-state directory so launchers share one process guard."""
    default = Path(__file__).resolve().parent / "logs" / f"{device_id}.pid"
    try:
        config_file = Path(config_path).resolve()
        cfg = json.loads(config_file.read_text(encoding="utf-8"))
        if cfg.get("transport") != "broker" or not cfg.get("broker_state_file"):
            return default
        state_path = Path(os.path.expandvars(cfg["broker_state_file"])).expanduser()
        if not state_path.is_absolute():
            state_path = config_file.parent / state_path
        return state_path.resolve().parent / "logs" / f"{device_id}.pid"
    except (OSError, ValueError, TypeError):
        return default


def main():
    p = argparse.ArgumentParser(description="Channel-sandbox device agent")
    p.add_argument("config", help="path to devices.json")
    p.add_argument("device_id", help="device id from the config")
    p.add_argument("--once", action="store_true", help="run one heartbeat+poll iteration then exit")
    p.add_argument("--log-file", help="append logs to this file in addition to stderr")
    args = p.parse_args()

    handlers = [logging.StreamHandler()]
    if args.log_file:
        log_path = Path(args.log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(log_path, mode="a", encoding="utf-8"))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        handlers=handlers,
        force=True,
    )

    pidfile = guard_pidfile(args.config, args.device_id)

    guarded = not args.once
    if guarded:
        try:
            acquire_guard(args.device_id, str(pidfile))
        except GuardHeldError as e:
            log.error("%s", e)
            sys.exit(1)
        atexit.register(release_guard, str(pidfile))

    def _shutdown(signum, frame):
        log.info("signal %s received, exiting", signum)
        if guarded:
            release_guard(str(pidfile))
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    try:
        run(args.config, args.device_id, single_iteration=args.once)
    except SystemExit:
        raise
    except Exception as e:
        log.exception("agent failed: %s", e)
        sys.exit(2)
    finally:
        if guarded:
            release_guard(str(pidfile))


if __name__ == "__main__":
    main()
