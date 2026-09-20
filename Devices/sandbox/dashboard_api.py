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
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

from flask import Flask, jsonify, request, send_from_directory
import requests

from firestore_client import FirestoreClient, decode_fields

log = logging.getLogger("channel_sandbox.dashboard")

app = Flask("channel_sandbox_dashboard")

# Routes that answer before config and auth are resolved. Keeping the health
# check and the diagnostic endpoint open is what makes a deployment verifiable
# without handing out the key.
PUBLIC_ENDPOINTS = {"api_status", "api_diag"}


class ConfigError(RuntimeError):
    """Raised when the sandbox config cannot be resolved at request time."""


@app.errorhandler(ConfigError)
def config_error_response(exc):
    # Without this a ConfigError raised inside a route escapes as an unhandled
    # exception and Flask renders an HTML 500 - indistinguishable from a crash,
    # and unreadable by the JS dashboard that consumes these routes. The
    # bootstrap guard already answers "this deployment is not configured" with
    # this exact JSON shape, so every path now says it the same way.
    return jsonify({"error": "server not configured", "detail": str(exc)}), 503


def configured_devices(cfg):
    """The device roster, or a ConfigError naming what is missing.

    A lambda has no ``devices.json`` (see ``load_config_from_env``), so the
    roster travels inside ``SANDBOX_CONFIG_JSON``. Every route that touches
    devices must come through here: reading ``cfg["devices"]`` directly raises
    a bare KeyError when the roster is absent, which is a deployment
    misconfiguration being reported as a server crash.
    """
    devices = cfg.get("devices") or []
    if not devices:
        raise ConfigError(
            "SANDBOX_CONFIG_JSON has no non-empty 'devices' roster"
        )
    return devices


def parse_bool(value, default=True):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return default


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
        # Must be forwarded explicitly. FirestoreClient defaults it to False, so
        # leaving it out made SANDBOX_CONFIG_JSON's allow_production_devices dead
        # config on the HTTP path: the real-mode/"devices" guard fired no matter
        # what the environment said, and the deployed dashboard could never reach
        # Firestore. device_agent.py forwards the same key - the two paths have to
        # agree, or the agent and the API disagree about what is permitted.
        allow_production_devices=cfg.get("allow_production_devices", False),
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
    """Constant-time compare of ``?key=`` / ``X-Stats-Key`` against ``STATS_KEY``.

    Both sides are SHA-256-digested before ``hmac.compare_digest`` so a non-ASCII
    character in either value (which would make the raw-string comparison raise
    ``TypeError``) and a length mismatch (which would short-circuit) can never
    reach the comparator. Same pattern as ``Backend/verify-db.js``.
    """
    import hashlib

    expected = os.environ.get("STATS_KEY") or ""
    if not expected:
        return False
    presented = request.args.get("key") or request.headers.get("X-Stats-Key") or ""
    a = hashlib.sha256(presented.encode("utf-8")).digest()
    b = hashlib.sha256(expected.encode("utf-8")).digest()
    return hmac.compare_digest(a, b)


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


@app.get("/")
def index():
    """Serve the dashboard page — for LOCAL runs only.

    On Vercel this route is never reached: vercel.json sends `/(.*)` to the
    @vercel/static build of dashboard/index.html and only `/api/(.*)` here, so
    Flask never sees a page request. Locally there is no such router, which
    meant `./start_dashboard.sh` came up serving the API while the dashboard
    itself 404'd — you had to know to open the HTML off disk. A local bring-up
    that cannot show you the dashboard is not a working sandbox.
    """
    return send_from_directory(os.path.join(os.path.dirname(os.path.abspath(__file__)), "dashboard"), "index.html")


# The Firestore half of /api/diag is cached. /api/diag is deliberately public
# (an operator must be able to see what is misconfigured without holding the
# key), but the probe underneath it is one get_doc plus one list_docs PER
# CONFIGURED DEVICE PER SUBCOLLECTION -- currently 2 devices x 4 subcollections
# plus 2 doc reads, so 10 Firestore round-trips for one unauthenticated GET.
# That is a read-amplification lever pointed at a billed API by anyone who
# knows the URL. The answer changes on the order of hours, so a short TTL
# removes the lever without touching the auth story or the diagnostic value.
_DIAG_PROBE_TTL_SECONDS = 60
# Wall-clock ceiling for the whole probe. FirestoreClient uses a 15s per-request
# timeout, and the probe makes one get_doc plus one list_docs per subcollection
# per device -- 10 requests today. Against an unreachable Firestore that is
# 10 x 15s of an UNAUTHENTICATED request holding a worker. Measured at 30s
# locally against a stopped emulator before this budget existed.
#
# A partial answer delivered quickly is worth more here than a complete one
# nobody waits for: the first probe already tells an operator whether Firestore
# is reachable at all. What is skipped is reported, never silently dropped.
_DIAG_PROBE_BUDGET_SECONDS = 5.0
_diag_probe_cache = {"at": 0.0, "value": None}


@app.get("/api/diag")
def api_diag():
    """Report the state of every dependency this service needs, WITHOUT leaking
    secret values. Public so an operator can figure out what to fix without
    holding the key.

    Reports for each required env var: whether it is set, whether it parses
    (for JSON ones), and — for the service-account credential — the public
    ``client_email`` and ``project_id`` that identify which credential it is.
    Then tries the two bootstrap steps ``load_config_from_env`` and
    ``make_client`` and reports what raised. Never touches Firestore itself.
    """
    def envmark(name):
        v = os.environ.get(name)
        return {"set": bool(v), "length": len(v) if v else 0}

    diag = {
        "service": "channel-sandbox-dashboard",
        "version": "1.0",
        "commit_sha": os.environ.get("VERCEL_GIT_COMMIT_SHA", "unknown")[:12],
        "region": os.environ.get("VERCEL_REGION") or os.environ.get("AWS_REGION") or "local",
        "env": {
            "STATS_KEY": envmark("STATS_KEY"),
            "SANDBOX_CONFIG_JSON": envmark("SANDBOX_CONFIG_JSON"),
            "FIREBASE_SERVICE_ACCOUNT_JSON": envmark("FIREBASE_SERVICE_ACCOUNT_JSON"),
            "DATABASE_URL": envmark("DATABASE_URL"),
            "POSTGRES_URL": envmark("POSTGRES_URL"),
            "AGENT_API_URL": envmark("AGENT_API_URL"),
            "AGENT_API_KEY": envmark("AGENT_API_KEY"),
            "SANDBOX_AUTH_DISABLED": {"set": bool(os.environ.get("SANDBOX_AUTH_DISABLED"))},
        },
        "config": {"parsed": False},
        "credential": {"parsed": False},
        "bootstrap": {"load_config": None, "make_client": None},
        "ok": False,
    }

    # SANDBOX_CONFIG_JSON — parse and report which fields are present.
    raw_cfg = os.environ.get("SANDBOX_CONFIG_JSON")
    if raw_cfg:
        try:
            parsed = json.loads(raw_cfg)
            diag["config"] = {
                "parsed": True,
                "fields_present": sorted(parsed.keys()),
                "mode": parsed.get("mode"),
                "project": parsed.get("project"),
                "database": parsed.get("database"),
                "collection": parsed.get("collection"),
            }
        except (ValueError, TypeError) as exc:
            diag["config"] = {"parsed": False, "error": f"invalid JSON: {exc}"}

    # FIREBASE_SERVICE_ACCOUNT_JSON — safe to reveal client_email/project_id
    # (both are public identifiers), never the private key material.
    raw_cred = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if raw_cred:
        try:
            cred = json.loads(raw_cred)
            diag["credential"] = {
                "parsed": True,
                "type": cred.get("type"),
                "project_id": cred.get("project_id"),
                "client_email": cred.get("client_email"),
                "has_private_key": bool(cred.get("private_key")),
                "private_key_starts_correct": bool(
                    isinstance(cred.get("private_key"), str)
                    and cred["private_key"].lstrip().startswith("-----BEGIN")
                ),
            }
        except (ValueError, TypeError) as exc:
            diag["credential"] = {"parsed": False, "error": f"invalid JSON: {exc}"}

    # Try the two bootstrap functions in isolation, catching every error so
    # this endpoint always returns 200 with a useful body.
    cfg = None
    client = None
    try:
        cfg = load_config_from_env()
        diag["bootstrap"]["load_config"] = {"ok": True}
        try:
            client = make_client(cfg)
            diag["bootstrap"]["make_client"] = {"ok": True}
            diag["ok"] = True
        except Exception as exc:  # noqa: BLE001 — surfaced to the operator
            diag["bootstrap"]["make_client"] = {"ok": False, "error": str(exc)[:400]}
    except ConfigError as exc:
        diag["bootstrap"]["load_config"] = {"ok": False, "error": str(exc)[:400]}
    except Exception as exc:  # noqa: BLE001
        diag["bootstrap"]["load_config"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"[:400]}

    # A local run loads its config from --config, not SANDBOX_CONFIG_JSON, so
    # "not set" is the expected state there and must not read as a deployment
    # fault. Applies to BOTH failure branches above, which is why it sits after
    # the try rather than inside one of them.
    if not diag["bootstrap"]["load_config"].get("ok") and app.config.get("SANDBOX_CFG"):
        diag["bootstrap"]["load_config"]["note"] = (
            "a file-based config is active for this process (--config), so "
            "SANDBOX_CONFIG_JSON is not required; this is normal for a local run"
        )
        cfg = app.config["SANDBOX_CFG"]
        client = app.config.get("FIRESTORE")

    # Firestore probe — only if bootstrap succeeded. Reports which of the
    # devices configured in SANDBOX_CONFIG_JSON already exist in the target
    # collection, and whether their subcollections have any data. Doc IDs
    # come from the same config as the rest of the service and are already
    # visible in the repo, so surfacing them here is safe.
    if client is not None and cfg is not None:
        cached = _diag_probe_cache["value"]
        if cached is not None and (time.time() - _diag_probe_cache["at"]) < _DIAG_PROBE_TTL_SECONDS:
            diag["firestore"] = dict(cached, cached=True,
                                     cache_age_seconds=round(time.time() - _diag_probe_cache["at"]))
            return jsonify(diag)
        collection = cfg.get("collection", "devices")
        subcolls = list(DATA_SUBCOLLECTIONS.values()) if 'DATA_SUBCOLLECTIONS' in globals() else [
            "whatsappMedia", "callLogs", "sms", "contacts",
        ]
        device_probes = []
        deadline = time.time() + _DIAG_PROBE_BUDGET_SECONDS
        skipped = 0
        configured = cfg.get("devices", []) or []
        for dev in configured:
            dev_id = dev.get("id")
            if time.time() >= deadline:
                skipped += 1
                continue
            probe = {"id": dev_id, "role": dev.get("role"), "doc_present": False, "subcollections": {}}
            reachable = True
            try:
                doc = client.get_doc(collection, dev_id)
                probe["doc_present"] = doc is not None
                if doc is not None:
                    probe["field_count"] = len(doc.get("fields", {}))
            except Exception as exc:  # noqa: BLE001
                probe["error"] = f"{type(exc).__name__}: {exc}"[:200]
                # If the document read could not reach Firestore, the four
                # subcollection reads behind it cannot either. Retrying them
                # only burns the budget to relearn the same fact.
                reachable = not isinstance(exc, (OSError, requests.exceptions.RequestException))
            for sub in subcolls:
                if not reachable:
                    probe["subcollections"][sub] = {"skipped": "firestore unreachable"}
                    continue
                if time.time() >= deadline:
                    probe["subcollections"][sub] = {"skipped": "probe budget exhausted"}
                    continue
                try:
                    docs = client.list_docs(collection, dev_id, sub, limit=1)
                    probe["subcollections"][sub] = {"any": len(docs) > 0}
                except Exception as exc:  # noqa: BLE001
                    probe["subcollections"][sub] = {"error": f"{type(exc).__name__}: {exc}"[:200]}
            device_probes.append(probe)
        diag["firestore"] = {
            "collection": collection,
            "devices_configured": len(cfg.get("devices", []) or []),
            "devices_present_in_firestore": sum(1 for p in device_probes if p.get("doc_present")),
            "probes": device_probes,
            "devices_skipped": skipped,
            "budget_seconds": _DIAG_PROBE_BUDGET_SECONDS,
            "truncated": skipped > 0,
        }
        _diag_probe_cache["value"] = diag["firestore"]
        _diag_probe_cache["at"] = time.time()
        diag["firestore"] = dict(diag["firestore"], cached=False, cache_age_seconds=0)

    return jsonify(diag)


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
    for dev in configured_devices(cfg):
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
    if device_id not in {d["id"] for d in configured_devices(cfg)}:
        return jsonify({"error": "unknown device", "deviceId": device_id}), 404
    doc = client.get_doc(cfg["collection"], device_id)
    if doc is None:
        return jsonify({"error": "device not found", "deviceId": device_id}), 404
    fields = doc.get("fields", {})
    status = decode_fields(fields)
    return jsonify({"deviceId": device_id, "status": status})


# Legacy Firestore subcollections the older exporters wrote under each device
# document. None of them has a live writer anymore (the phone daemon PATCHes
# rolling arrays into the device doc instead, see DIRECT_SYNC_ARRAY_FIELDS);
# the callLogs/sms names are still used as a fallback for devices that have no
# direct-sync array yet, and /api/diag probes them to report that state.
DATA_SUBCOLLECTIONS = {
    "whatsapp": "whatsappMedia",
    "calls": "callLogs",
    "sms": "sms",
    "contacts": "contacts",
}

# Rolling last-50 arrays the phone daemon PATCHes into the device document
# under the samsungS24DirectSync map on every sync cycle
# (Backend/s24_phone_direct_cloud.py). These are the always-live source for
# calls/sms; the Neon s24_calls/s24_sms archives only refresh when the laptop
# export runs, so the dashboard must not depend on them.
DIRECT_SYNC_ARRAY_FIELDS = {
    "calls": "callLogs",
    "sms": "sms",
}

# Numeric type codes in the legacy subcollection documents -> the daemon's
# normalized type strings (normalize_call_log_entry / normalize_sms_entry in
# Backend/s24_phone_direct_cloud.py).
CALL_TYPE_NAMES = {"1": "Incoming", "2": "Outgoing", "3": "Missed", "5": "Rejected"}
SMS_TYPE_NAMES = {"1": "Received", "2": "Sent"}

CONTACTS_NOT_COLLECTED_NOTE = (
    "Contacts are not collected — names come from WhatsApp chat names."
)


def neon_database_url():
    """The Neon connection string, from the same env names as the main backend."""
    return os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")


def neon_query(sql):
    """Run one read-only statement through Neon's SQL-over-HTTP endpoint.

    Chosen over psycopg so the Vercel python runtime needs no native wheels:
    stdlib urllib is enough. The endpoint takes the full connection string in
    the ``Neon-Connection-String`` header (same approach as
    @neondatabase/serverless), and it answers on the direct endpoint, so a
    pooled (``-pooler``) DATABASE_URL gets its suffix stripped first. There
    is no parameter binding — callers interpolate only values they have
    already clamped to a safe form (e.g. the int limit).
    """
    url = neon_database_url()
    if not url:
        raise ConfigError("DATABASE_URL is not set")
    host = urlparse(url).hostname or ""
    if "-pooler." in host:
        host = host.replace("-pooler.", ".", 1)
    # JSON body, not a raw SQL one. Neon's SQL-over-HTTP endpoint is the same
    # one @neondatabase/serverless drives, and it expects
    # {"query": ..., "params": [...]} with Content-Type: application/json. The
    # earlier `application/sql` form with the statement as the raw body is not
    # part of that API and never reached a deployment to prove otherwise, so it
    # is corrected here rather than shipped and discovered in production.
    body = json.dumps({"query": sql, "params": []}).encode("utf-8")
    req = urllib.request.Request(
        f"https://{host}/sql", data=body, method="POST"
    )
    req.add_header("Neon-Connection-String", url)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"neon http sql failed ({exc.code}): {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"neon http sql unreachable: {exc.reason}") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        raise RuntimeError("neon http sql returned an unexpected payload")
    return payload["rows"]


@app.get("/api/data/<kind>")
def api_data(kind):
    """Return the latest records for a device data kind.

    whatsapp — Neon Postgres: the newest ``limit`` rows of wa_messages joined
    to wa_chats for display names (the Firestore whatsappMedia subcollection
    has no writer, so it never has data). Requires DATABASE_URL.
    calls / sms — the live rolling arrays the phone daemon PATCHes into each
    device document under samsungS24DirectSync; a device with no such array
    yet falls back to its legacy subcollection read.
    contacts — nothing collects contacts anywhere (contact names live in
    wa_chats.name), so the response says so instead of faking an empty read.
    """
    if kind not in DATA_SUBCOLLECTIONS:
        return jsonify({"error": f"unknown data kind: {kind}"}), 404
    try:
        limit = int(request.args.get("limit", 50))
    except ValueError:
        return jsonify({"error": "limit must be an integer"}), 400
    limit = max(1, min(limit, 200))

    if kind == "whatsapp":
        return _api_data_whatsapp(limit)
    if kind == "contacts":
        return jsonify({
            "data": [],
            "collected": False,
            "note": CONTACTS_NOT_COLLECTED_NOTE,
        })
    return _api_data_device_records(kind, limit)


def _api_data_whatsapp(limit):
    # The body/kind filter mirrors Backend/jp-live-content.js: owner-side bulk
    # imports land rows with no body and kind 'other'/'system', and a card
    # full of blank rows reads as "broken", not "quiet".
    sql = (
        "SELECT m.msg_id, m.chat_id, m.sent_at, m.from_me, m.sender, m.kind, "
        "m.body, m.ingested_at, c.name AS chat_name, c.kind AS chat_kind "
        "FROM wa_messages m JOIN wa_chats c ON c.chat_id = m.chat_id "
        "WHERE ((m.body IS NOT NULL AND m.body <> '') "
        "OR m.kind IN ('image','video','audio','ptt','document','media','call')) "
        "ORDER BY m.sent_at DESC NULLS LAST, m.ingested_at DESC "
        f"LIMIT {limit}"
    )
    try:
        rows = neon_query(sql)
    except ConfigError:
        # Missing DATABASE_URL is a deployment misconfiguration, not an
        # outage — it must keep the "server not configured" 503 shape.
        raise
    except RuntimeError as exc:
        return jsonify({"error": "live store unavailable", "detail": str(exc)}), 502
    return jsonify({"data": rows, "limit": limit})


def _normalize_device_record(kind, device_id, rec):
    """Shape a call/sms record for the dashboard, whichever source it came from.

    Live daemon rows already carry the normalized fields (type strings,
    duration_seconds, date/timestamp ISO strings); legacy subcollection docs
    carry the older numeric codes and duration/date names, mapped here so the
    frontend only ever sees one shape.
    """
    rec = dict(rec)
    if kind == "calls":
        rec["type"] = CALL_TYPE_NAMES.get(str(rec.get("type")), rec.get("type"))
        if "duration_seconds" not in rec:
            rec["duration_seconds"] = rec.get("duration", 0)
        if not rec.get("date"):
            rec["date"] = rec.get("backed_up_at")
    else:
        rec["type"] = SMS_TYPE_NAMES.get(str(rec.get("type")), rec.get("type"))
        if not rec.get("timestamp"):
            rec["timestamp"] = rec.get("date") or rec.get("backed_up_at")
    rec["deviceId"] = device_id
    return rec


def _api_data_device_records(kind, limit):
    cfg = app.config["SANDBOX_CFG"]
    client = app.config["FIRESTORE"]
    array_field = DIRECT_SYNC_ARRAY_FIELDS[kind]
    date_key = "date" if kind == "calls" else "timestamp"
    records = []
    for dev in configured_devices(cfg):
        rows = []
        try:
            doc = client.get_doc(cfg["collection"], dev["id"])
        except Exception as exc:  # noqa: BLE001 - one device must not break the rest
            log.warning("doc read failed for %s: %s", dev["id"], exc)
            continue
        if doc:
            status = decode_fields(doc.get("fields", {}))
            sync = status.get("samsungS24DirectSync")
            if isinstance(sync, dict) and isinstance(sync.get(array_field), list):
                rows = [r for r in sync[array_field] if isinstance(r, dict)]
        if rows:
            records.extend(
                _normalize_device_record(kind, dev["id"], rec) for rec in rows
            )
            continue
        # No direct-sync array on the doc (device not yet migrated / daemon
        # never ran) — fall back to the legacy subcollection so it still
        # shows what its older exporter wrote.
        subcollection = DATA_SUBCOLLECTIONS[kind]
        try:
            docs = client.list_docs(cfg["collection"], dev["id"], subcollection, limit=limit)
        except Exception as exc:  # noqa: BLE001 - one device must not break the rest
            log.warning("data read failed for %s/%s: %s", dev["id"], subcollection, exc)
            continue
        records.extend(
            _normalize_device_record(kind, dev["id"], rec) for rec in docs
        )
    records.sort(key=lambda rec: rec.get(date_key) or "", reverse=True)
    return jsonify({"data": records[:limit], "limit": limit})


@app.post("/api/devices/<device_id>/commands")
def api_post_command(device_id):
    cfg = app.config["SANDBOX_CFG"]
    client = app.config["FIRESTORE"]
    if device_id not in {d["id"] for d in configured_devices(cfg)}:
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


@app.post("/api/agent/query")
def api_agent_query():
    """Proxy an authenticated query to the live external agent API."""
    body = request.get_json(silent=True) or {}
    query = str(body.get("query") or body.get("question") or "").strip()
    if not query:
        return jsonify({"error": "query required"}), 400

    agent_url = (os.environ.get("AGENT_API_URL") or "http://127.0.0.1:8000").rstrip("/")
    agent_key = os.environ.get("AGENT_API_KEY") or ""
    if not agent_key or agent_key == "YOUR_AGENT_API_KEY_HERE":
        return jsonify({"error": "server missing AGENT_API_KEY"}), 503

    payload = {
        "query": query,
        "top_k": int(body.get("top_k", 5)),
        "max_tokens": int(body.get("max_tokens", 512)),
        "temperature": float(body.get("temperature", 0.7)),
        "use_rag": parse_bool(body.get("use_rag"), default=True),
    }
    try:
        response = requests.post(
            f"{agent_url}/query",
            headers={"X-API-Key": agent_key, "Content-Type": "application/json"},
            json=payload,
            timeout=90,
        )
    except requests.RequestException as exc:
        return jsonify({"error": "agent unreachable", "detail": str(exc)}), 502

    if not response.ok:
        detail = response.text[:500]
        try:
            detail = response.json()
        except ValueError:
            pass
        return jsonify({
            "error": "agent upstream error",
            "status": response.status_code,
            "detail": detail,
        }), 502

    return jsonify(response.json())


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser(description="Channel-sandbox dashboard")
    # Defaults to the EMULATOR config, not devices.json. devices.json is
    # mode=real against the production `devices` collection with no
    # allow_production_devices, which FirestoreClient refuses by design
    # (firestore_client.py:34) -- so the documented local command crashed on
    # startup before it ever served a request. devices.json remains the
    # canonical public device roster; it is just not a runnable local config.
    # Production is unaffected: Vercel imports the `app` object directly and
    # never calls main(), taking its config from SANDBOX_CONFIG_JSON.
    p.add_argument("--config", default="devices.emulator.json")
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
