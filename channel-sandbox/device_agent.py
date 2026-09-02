#!/usr/bin/env python3
"""Device agent for the channel sandbox."""
from __future__ import annotations

import argparse
import atexit
import json
import logging
import os
import signal
import socket
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from firestore_client import FirestoreClient, decode_value
from single_instance import GuardHeldError, acquire_guard, release_guard

log = logging.getLogger("channel_sandbox.agent")


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
    )
    hb_interval = cfg["heartbeat_interval_seconds"]
    poll_interval = cfg["command_poll_interval_seconds"]
    allowed = cfg.get("allowed_commands", [])
    collection = cfg["collection"]

    log.info("starting device=%s hb=%ss poll=%ss", device_id, hb_interval, poll_interval)
    if single_iteration:
        send_heartbeat(client, collection, device_id, device_cfg, collect_local_status())
        process_command_queue(client, collection, device_id, allowed)
        return

    last_hb = 0.0
    while True:
        now = time.time()
        if now - last_hb >= hb_interval:
            try:
                send_heartbeat(client, collection, device_id, device_cfg, collect_local_status())
                last_hb = now
            except Exception as e:
                log.warning("heartbeat failed: %s", e)
        try:
            process_command_queue(client, collection, device_id, allowed)
        except Exception as e:
            log.warning("command poll failed: %s", e)
        time.sleep(min(poll_interval, max(1.0, hb_interval - (now - last_hb))))


def send_heartbeat(client, collection, device_id, device_cfg, local):
    fields = {
        "online": True,
        "displayName": device_cfg.get("display_name", device_id),
        "role": device_cfg.get("role", "unknown"),
        "lastSeen": datetime.now(timezone.utc).isoformat(),
        "agentVersion": "channel-sandbox-1.0",
        "local": local,
    }
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
