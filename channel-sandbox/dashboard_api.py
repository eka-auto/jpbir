#!/usr/bin/env python3
"""Flask dashboard API for the channel sandbox."""
from __future__ import annotations

import argparse
import json
import logging
import uuid
from datetime import datetime, timezone

from flask import Flask, jsonify, request

from firestore_client import FirestoreClient, decode_fields

log = logging.getLogger("channel_sandbox.dashboard")

app = Flask("channel_sandbox_dashboard")


def make_client(cfg):
    return FirestoreClient(
        project=cfg["project"],
        database=cfg["database"],
        service_account_key=cfg["service_account_key"],
        scope=cfg["firestore_scope"],
        mode=cfg.get("mode", "emulator"),
        collection=cfg["collection"],
        emulator_host=cfg.get("emulator_host"),
    )


@app.get("/api/status")
def api_status():
    return jsonify({"name": "channel-sandbox-dashboard", "status": "ok", "version": "1.0"})


@app.get("/api/devices")
def api_devices():
    cfg = app.config["SANDBOX_CFG"]
    client = app.config["FIRESTORE"]
    collection = cfg["collection"]
    out = []
    for dev in cfg["devices"]:
        doc = client.get_doc(collection, dev["id"])
        status = decode_fields(doc.get("fields", {})) if doc else None
        out.append({
            "id": dev["id"],
            "displayName": dev.get("display_name", dev["id"]),
            "role": dev.get("role"),
            "status": status,
        })
    return jsonify({"devices": out})


@app.get("/api/devices/<device_id>/status")
def api_device_status(device_id):
    cfg = app.config["SANDBOX_CFG"]
    client = app.config["FIRESTORE"]
    if device_id not in {d["id"] for d in cfg["devices"]}:
        return jsonify({"error": "unknown device", "deviceId": device_id}), 404
    doc = client.get_doc(cfg["collection"], device_id)
    if doc is None:
        return jsonify({"error": "device not found", "deviceId": device_id}), 404
    fields = doc.get("fields", {})
    status = decode_fields(fields)
    return jsonify({"deviceId": device_id, "status": status})


@app.post("/api/devices/<device_id>/commands")
def api_post_command(device_id):
    cfg = app.config["SANDBOX_CFG"]
    client = app.config["FIRESTORE"]
    if device_id not in {d["id"] for d in cfg["devices"]}:
        return jsonify({"error": "unknown device", "deviceId": device_id}), 404
    body = request.get_json(silent=True) or {}
    action = body.get("action")
    if action not in cfg.get("allowed_commands", []):
        return jsonify({"error": f"action not allowed: {action}"}), 400
    payload = body.get("payload", {})
    cmd_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    client.update_command_queue(cfg["collection"], device_id, cmd_id, {
        "action": action,
        "payload": payload,
        "status": "pending",
        "queuedAt": now,
    })
    return jsonify({"deviceId": device_id, "commandId": cmd_id, "status": "queued", "queuedAt": now}), 202


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser(description="Channel-sandbox dashboard")
    p.add_argument("--config", default="devices.json")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=5000)
    args = p.parse_args()
    with open(args.config, encoding="utf-8") as f:
        cfg = json.load(f)
    app.config["SANDBOX_CFG"] = cfg
    app.config["FIRESTORE"] = make_client(cfg)
    log.info("dashboard starting on %s:%s", args.host, args.port)
    app.run(host=args.host, port=args.port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
