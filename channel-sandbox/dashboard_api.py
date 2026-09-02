#!/usr/bin/env python3
"""Flask dashboard API for the channel sandbox.

This module is entered two different ways, and the difference drives its shape:

* Locally, ``start_dashboard.bat`` runs ``main()``, which reads ``devices.json``
  off disk and binds to loopback.
* On Vercel, the Flask builder imports ``dashboard_api:app`` and ``main()``
  never runs. Anything the request handlers need therefore has to be
  bootstrapped lazily on the first request, from the environment, rather than
  in ``main()``.

Because the deployed surface is reachable from the public internet, every route
except the ``/api/status`` health check is gated on ``STATS_KEY``, and the gate
fails closed: an unset ``STATS_KEY`` refuses requests instead of allowing them,
so a missing Vercel env var cannot quietly publish the command queue.
"""
from __future__ import annotations

import argparse
import hmac
import json
import logging
import os
import uuid
from datetime import datetime, timezone

from flask import Flask, jsonify, request

from firestore_client import FirestoreClient, decode_fields

log = logging.getLogger("channel_sandbox.dashboard")

app = Flask("channel_sandbox_dashboard")

# Routes that answer before config and auth are resolved. Keeping the health
# check open is what makes a deployment verifiable without handing out the key.
PUBLIC_ENDPOINTS = {"api_status"}


class ConfigError(RuntimeError):
    """Raised when the sandbox config cannot be resolved at request time."""


def make_client(cfg):
    return FirestoreClient(
        project=cfg["project"],
        database=cfg["database"],
        service_account_key=cfg.get("service_account_key"),
        service_account_info=cfg.get("service_account_info"),
        scope=cfg["firestore_scope"],
        mode=cfg.get("mode", "emulator"),
        collection=cfg["collection"],
        emulator_host=cfg.get("emulator_host"),
    )


def load_config_from_env():
    """Assemble the sandbox config from environment variables.

    A lambda has neither ``devices.json`` nor the service-account file that
    ``devices.json`` points at, so the config travels whole as JSON in
    ``SANDBOX_CONFIG_JSON`` and the credential as JSON in
    ``FIREBASE_SERVICE_ACCOUNT_JSON``.
    """
    raw = os.environ.get("SANDBOX_CONFIG_JSON")
    if not raw:
        raise ConfigError("SANDBOX_CONFIG_JSON is not set")
    try:
        cfg = json.loads(raw)
    except ValueError as exc:
        raise ConfigError(f"SANDBOX_CONFIG_JSON is not valid JSON: {exc}") from exc
    if not isinstance(cfg, dict):
        raise ConfigError("SANDBOX_CONFIG_JSON must decode to an object")

    cfg["mode"] = os.environ.get("SANDBOX_MODE") or cfg.get("mode") or "real"
    if cfg["mode"] == "real":
        sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
        if not sa_raw:
            raise ConfigError("FIREBASE_SERVICE_ACCOUNT_JSON is not set")
        try:
            cfg["service_account_info"] = json.loads(sa_raw)
        except ValueError as exc:
            raise ConfigError(
                f"FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: {exc}"
            ) from exc
    return cfg


def auth_ok():
    """Constant-time compare of ``?key=`` / ``X-Stats-Key`` against ``STATS_KEY``."""
    expected = os.environ.get("STATS_KEY") or ""
    if not expected:
        return False
    presented = request.args.get("key") or request.headers.get("X-Stats-Key") or ""
    return hmac.compare_digest(presented, expected)


@app.before_request
def guard_and_bootstrap():
    if request.endpoint in PUBLIC_ENDPOINTS:
        return None

    if not app.config.get("SANDBOX_AUTH_DISABLED") and not auth_ok():
        if not os.environ.get("STATS_KEY"):
            log.error("STATS_KEY is unset; refusing authenticated routes")
            return jsonify({"error": "server missing STATS_KEY"}), 503
        return jsonify({"error": "unauthorized"}), 401

    if "SANDBOX_CFG" not in app.config:
        try:
            app.config["SANDBOX_CFG"] = load_config_from_env()
        except ConfigError as exc:
            log.error("sandbox config unavailable: %s", exc)
            return jsonify({"error": "server not configured", "detail": str(exc)}), 503

    if "FIRESTORE" not in app.config:
        try:
            app.config["FIRESTORE"] = make_client(app.config["SANDBOX_CFG"])
        except Exception as exc:  # noqa: BLE001 - surfaced to the caller as 503
            log.exception("Firestore client initialisation failed")
            return jsonify({"error": "firestore unavailable", "detail": str(exc)}), 503

    return None


@app.get("/api/status")
def api_status():
    return jsonify({"name": "channel-sandbox-dashboard", "status": "ok", "version": "1.0"})


@app.get("/api/keys")
def api_keys():
    """Report configured SSH key fingerprints (public halves only).

    Devices present their public key when connecting; this endpoint lets the
    operator confirm which keys the sandbox knows about without ever exposing
    a private key. Private keys live only in Vercel env secrets.
    """
    import hashlib
    import base64

    def fingerprint(pubkey_line):
        parts = pubkey_line.strip().split()
        if len(parts) < 2:
            return None
        try:
            raw = base64.b64decode(parts[1])
        except Exception:  # noqa: BLE001 - malformed key is reported, not raised
            return None
        return "SHA256:" + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip("=")

    keys = []
    for name, env_name in [
        ("primary", "SSH_PUBKEY_PRIMARY"),
        ("phone", "SSH_PUBKEY_PHONE"),
        ("gce", "SSH_PUBKEY_GCE"),
    ]:
        pub = os.environ.get(env_name)
        if not pub:
            continue
        keys.append({
            "name": name,
            "fingerprint": fingerprint(pub),
            "comment": pub.strip().split()[-1] if len(pub.strip().split()) >= 3 else None,
        })
    return jsonify({"keys": keys})


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
    if not os.environ.get("STATS_KEY"):
        # Keep the loopback developer workflow key-free, but never let "no key
        # configured" mean "open" on an interface someone else can reach.
        if args.host not in {"127.0.0.1", "localhost", "::1"}:
            p.error("binding to a non-loopback host requires STATS_KEY to be set")
        app.config["SANDBOX_AUTH_DISABLED"] = True
        log.warning("STATS_KEY unset; auth disabled for loopback run")
    log.info("dashboard starting on %s:%s", args.host, args.port)
    app.run(host=args.host, port=args.port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
