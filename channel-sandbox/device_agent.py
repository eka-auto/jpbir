#!/usr/bin/env python3
"""Device agent for the channel sandbox."""
from __future__ import annotations

import argparse
import atexit
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

from firestore_client import FirestoreClient, decode_value
from single_instance import GuardHeldError, acquire_guard, release_guard

log = logging.getLogger("channel_sandbox.agent")

_SW = {'creationflags': 0x08000000} if platform.system() == 'Windows' else {}


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


def handle_command(action, payload):
    started = datetime.now(timezone.utc).isoformat()
    try:
        if action == "status-only":
            return {"status": "ok", "result": {"echo": "ok", "ts": started}, "completed_at": started}
        if action == "ping":
            return {"status": "ok", "result": {"pong": True, "ts": started}, "completed_at": started}
        if action == "echo":
            return {"status": "ok", "result": {"echoed": payload or {}, "ts": started}, "completed_at": started}
        return {"status": "rejected", "result": {"error": f"unknown action: {action}"}, "completed_at": started}
    except Exception as e:
        return {"status": "error", "result": {"error": str(e)}, "completed_at": started}

def run(config_path, device_id, single_iteration=False):
    with open(config_path, encoding="utf-8") as f:
        cfg = json.load(f)
    device_cfg = next((d for d in cfg["devices"] if d["id"] == device_id), None)
    if device_cfg is None:
        raise SystemExit(f"device id not found in config: {device_id}")

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

    here = Path(__file__).resolve().parent
    pidfile = here / "logs" / f"{args.device_id}.pid"

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
