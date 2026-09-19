#!/usr/bin/env python3
"""
s24-connect â€” a standalone MCP server that connects to devices through the
global-device registry in Firestore. The Samsung Galaxy S24 Ultra is reached as
one entry in that registry (it is the default target), not as a special case.

Written from zero: it does not import or depend on any other server on this
machine. It carries its own Google service-account auth (manual RS256 JWT ->
OAuth token) and its own Firestore REST client.

Global-device model
--------------------
Every device is a document in one Firestore collection:

    project : intrepid-stage-495117-q1
    database: eka-agent
    path    : devices/<device_id>          e.g. devices/samsung-s24-ultra

Each device runs a daemon that polls its own document once per cycle. To
"connect" to a device is to read its document (device -> us) and to append
items to its `commandQueue` map (us -> device); the daemon runs queued commands
and writes results back into the same map, which we then read.

Because it is registry-based, every tool takes a `device_id` and defaults to
`samsung-s24-ultra`, so the S24 is the zero-argument case while any other
registered global device (laptops, other phones, runners) works too.

Everything is env-overridable so the server can be pointed elsewhere without
editing code.

Tools
-----
    list_devices     every registered global device + online/last-seen
    device_ping      link health for one device (default: the S24)
    device_info      compact snapshot of a device document
    device_wake      write a wakeup + forceSync signal to a device
    device_send      queue a command for a device; returns a command id
    device_result    read back the status/result of a queued command
    device_queue     list a device's command queue and each item's status
    device_clear     cancel a device's pending command-queue items
    device_watch     watch a device doc and alert when its daemon checks in
    register_device  add a new device to the global registry

Register from a repository checkout:
    claude mcp add s24-connect -- python <repo>/Integrations/s24-connect-mcp/server.py
"""
from __future__ import annotations

import base64
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Configuration (env-overridable, sane defaults)
# ---------------------------------------------------------------------------
PROJECT_ID = os.environ.get("S24_PROJECT_ID", "intrepid-stage-495117-q1")
DATABASE = os.environ.get("S24_FIRESTORE_DB", "eka-agent")
CANONICAL_S24_DEVICE_ID = "samsung-s24-ultra"

# Legacy Firestore document devices/Samsung-S24 was deleted 2026-09-17.
# No alias mapping is supported; noncanonical IDs are rejected at the tool boundary.
_S24_REJECTED_ALIASES: frozenset[str] = frozenset({
    "samsung-s24",
    "s24-ultra",
    "s24ultra",
})


def _canonicalize_device_id(device_id: Any) -> Any:
    """Normalize case/whitespace; reject known legacy aliases with a clear error string."""
    if not isinstance(device_id, str):
        return device_id
    normalized = device_id.strip().lower()
    return normalized


def _reject_if_alias(device_id: str) -> str | None:
    """Return an error message if device_id is a known rejected alias, else None."""
    normalized = device_id.strip().lower()
    if normalized in _S24_REJECTED_ALIASES:
        return (
            f"'{device_id}' is a retired alias. "
            f"Use the canonical device_id '{CANONICAL_S24_DEVICE_ID}' directly. "
            "The legacy documents have been removed."
        )
    return None


def _is_s24_device_id(device_id: Any) -> bool:
    return isinstance(device_id, str) and device_id.strip().lower() == CANONICAL_S24_DEVICE_ID


DEFAULT_DEVICE = CANONICAL_S24_DEVICE_ID
KEY_FILE       = Path(os.environ.get(
    "S24_SERVICE_ACCOUNT_KEY",
    r"C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json",
))

_FS_BASE = (
    f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}"
    f"/databases/{DATABASE}/documents"
)
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_SCOPE = "https://www.googleapis.com/auth/datastore"
_REQUESTED_BY = "s24-connect-mcp"
_HTTP_TIMEOUT = 20
S24_HEARTBEAT_FRESHNESS_SECONDS = 300
S24_BOOT_GRACE_SECONDS = 600  # allow fresh heartbeat without ack during boot
S24_PHONE_AGENT_PREFIX = "s24-termux-"
S24_PHONE_CONNECTION_METHODS = frozenset({"termux-direct-cloud", "direct-daemon"})
S24_PHONE_SYNC_SOURCES = frozenset({"live_termux", "live_daemon"})

# device_id convention: lowercase, hyphen-separated (e.g. samsung-s24-ultra)
_DEVICE_ID_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")

mcp = FastMCP("s24-connect")

# ---------------------------------------------------------------------------
# Auth: mint an RS256 JWT from the service-account key, exchange for a token.
# ---------------------------------------------------------------------------
_token_cache: dict[str, Any] = {"token": None, "expires_at": 0.0}


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _get_token() -> str:
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["token"]

    key = json.loads(KEY_FILE.read_text(encoding="utf-8"))

    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    iat = int(now)
    payload = _b64url(json.dumps({
        "iss": key["client_email"],
        "scope": _SCOPE,
        "aud": _TOKEN_URL,
        "iat": iat,
        "exp": iat + 3600,
    }).encode())
    signing_input = f"{header}.{payload}".encode()

    private_key = serialization.load_pem_private_key(
        key["private_key"].encode(), password=None
    )
    signature = _b64url(
        private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    )
    assertion = f"{header}.{payload}.{signature}"

    body = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": assertion,
    }).encode()
    req = urllib.request.Request(
        _TOKEN_URL, data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
        data = json.loads(resp.read())

    _token_cache["token"] = data["access_token"]
    _token_cache["expires_at"] = now + data.get("expires_in", 3600)
    return _token_cache["token"]


# ---------------------------------------------------------------------------
# Firestore REST client
# ---------------------------------------------------------------------------
def _fs_request(method: str, path: str, body: dict | None = None) -> dict:
    url = f"{_FS_BASE}/{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={
            "Authorization": f"Bearer {_get_token()}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"__error__": {"code": e.code, "body": e.read().decode(errors="replace")}}
    except urllib.error.URLError as e:
        return {"__error__": {"code": "network", "body": str(e.reason)}}


def _decode(value: dict) -> Any:
    if "stringValue" in value:    return value["stringValue"]
    if "integerValue" in value:   return int(value["integerValue"])
    if "doubleValue" in value:    return float(value["doubleValue"])
    if "booleanValue" in value:   return value["booleanValue"]
    if "timestampValue" in value: return value["timestampValue"]
    if "nullValue" in value:      return None
    if "mapValue" in value:
        return {k: _decode(v) for k, v in value["mapValue"].get("fields", {}).items()}
    if "arrayValue" in value:
        return [_decode(v) for v in value["arrayValue"].get("values", [])]
    return value


def _encode(value: Any) -> dict:
    if value is None:               return {"nullValue": None}
    if isinstance(value, bool):     return {"booleanValue": value}
    if isinstance(value, int):      return {"integerValue": str(value)}
    if isinstance(value, float):    return {"doubleValue": value}
    if isinstance(value, str):      return {"stringValue": value}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {k: _encode(v) for k, v in value.items()}}}
    if isinstance(value, (list, tuple)):
        return {"arrayValue": {"values": [_encode(v) for v in value]}}
    return {"stringValue": str(value)}


def _parse_doc(raw: dict) -> dict:
    if "__error__" in raw:
        return raw
    return {k: _decode(v) for k, v in raw.get("fields", {}).items()}


def _err_text(doc: dict) -> str | None:
    if isinstance(doc, dict) and "__error__" in doc:
        e = doc["__error__"]
        return f"Firestore error {e.get('code')}: {str(e.get('body'))[:400]}"
    return None


def _valid_id(device_id: str) -> str | None:
    if not isinstance(device_id, str) or not _DEVICE_ID_RE.fullmatch(device_id):
        return (f"'{device_id}' is not a valid device_id "
                "(lowercase, hyphen-separated, e.g. samsung-s24-ultra).")
    return None


def _get_doc(device_id: str) -> dict:
    return _parse_doc(_fs_request("GET", f"devices/{device_id}"))


_SIMPLE_SEGMENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _mask_path(dotted: str) -> str:
    """
    Build a valid Firestore field-mask path from a dot-separated key.

    A segment that isn't a simple identifier (e.g. contains a hyphen, as in the
    legacy id 'fresh-sync-1785257428') must be backtick-quoted, or Firestore
    rejects the updateMask with INVALID_ARGUMENT.
    """
    out = []
    for seg in dotted.split("."):
        if _SIMPLE_SEGMENT_RE.fullmatch(seg):
            out.append(seg)
        else:
            esc = seg.replace("\\", "\\\\").replace("`", "\\`")
            out.append(f"`{esc}`")
    return ".".join(out)


def _patch_doc(device_id: str, fields: dict) -> dict:
    """Merge-patch fields onto a device doc. Keys may use dot notation."""
    nested: dict = {}
    for dotted, val in fields.items():
        parts = dotted.split(".")
        cur = nested
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = val
    fs_fields = {k: _encode(v) for k, v in nested.items()}
    mask = "&".join(
        f"updateMask.fieldPaths={urllib.parse.quote(_mask_path(k), safe='')}"
        for k in fields
    )
    return _fs_request(
        "PATCH", f"devices/{device_id}?{mask}", {"fields": fs_fields}
    )


def _list_all_docs() -> list[dict] | dict:
    out: list[dict] = []
    page_token = None
    while True:
        qs = "pageSize=100"
        if page_token:
            qs += f"&pageToken={urllib.parse.quote(page_token)}"
        resp = _fs_request("GET", f"devices?{qs}")
        if "__error__" in resp:
            return resp  # propagate error object; caller checks
        out.extend(resp.get("documents", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return out


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _age_seconds(ts: Any) -> int | None:
    if not isinstance(ts, str):
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    return round((datetime.now(timezone.utc) - dt).total_seconds())


def _heartbeat_age(doc: dict[str, Any]) -> int | None:
    """Age of the device's own check-in, or None if it has never checked in.

    Only ``lastSeen`` counts. ``updatedAt`` moves whenever *anything* writes to
    the document -- including a wakeup this tool sends, which the device may
    never have seen. The old `lastSeen or updatedAt` fallback meant a phone that
    had never once reported in showed up as "last seen 12 hours ago", which was
    really the timestamp of a dashboard wakeup. Worse, it fed the freshness gate
    below: writing a wakeup reset the apparent age, so the one signal that is
    supposed to prove the daemon is alive could be produced by us instead of it.
    """
    return _age_seconds(doc.get("lastSeen"))


def _heartbeat_fields(doc: dict[str, Any]) -> dict[str, Any]:
    """Heartbeat and document-write time as separate, clearly-named fields."""
    last_seen = doc.get("lastSeen")
    updated_at = doc.get("updatedAt")
    return {
        "last_seen": last_seen,
        "last_seen_age_seconds": _age_seconds(last_seen),
        "ever_checked_in": last_seen is not None,
        "doc_updated_at": updated_at,
        "doc_updated_age_seconds": _age_seconds(updated_at),
    }


def _s24_phone_heartbeat_is_fresh(doc: dict[str, Any], age: int | None = None) -> bool:
    """Accept S24 online only from a fresh, authenticated Termux heartbeat."""

    age = _heartbeat_age(doc) if age is None else age
    if age is None or age < 0 or age > S24_HEARTBEAT_FRESHNESS_SECONDS:
        return False
    if doc.get("online") is not True:
        return False
    agent = str(doc.get("agentVersion") or "")
    if not agent.startswith(S24_PHONE_AGENT_PREFIX):
        return False
    if doc.get("connectionMethod") not in S24_PHONE_CONNECTION_METHODS:
        return False
    if doc.get("heartbeatAuth") != "termux-phone":
        return False
    sync = doc.get("samsungS24DirectSync") or {}
    ack_age = _age_seconds(doc.get("lastCommandAckAt"))
    ack_id = str(doc.get("lastCommandAckId") or "")
    queue = doc.get("commandQueue") or {}
    ack_item = queue.get(ack_id) if ack_id and isinstance(queue, dict) else None

    # Full check: completed ack within freshness window
    # Daemon writes completedAt to queue items, not ackAt (schema alignment 2026-09-17)
    has_fresh_ack = (
        doc.get("lastCommandAckStatus") == "completed"
        and isinstance(ack_item, dict)
        and ack_item.get("status") == "completed"
        and ack_item.get("completedAt") == doc.get("lastCommandAckAt")
        and ack_age is not None
        and 0 <= ack_age <= S24_HEARTBEAT_FRESHNESS_SECONDS
    )
    if has_fresh_ack:
        return (
            sync.get("liveDeviceVerified") is True
            and sync.get("heartbeatAuth") == "termux-phone"
            and sync.get("sourceType") in S24_PHONE_SYNC_SOURCES
        )

    # Boot grace: phone just started, no ack yet but heartbeat is authenticated
    if ack_age is None and age <= S24_BOOT_GRACE_SECONDS:
        return (
            sync.get("liveDeviceVerified") is True
            and sync.get("heartbeatAuth") == "termux-phone"
            and sync.get("sourceType") in S24_PHONE_SYNC_SOURCES
        )

    return False


def _effective_online(device_id: str, doc: dict[str, Any], age: int | None = None) -> bool:
    if _is_s24_device_id(device_id):
        return _s24_phone_heartbeat_is_fresh(doc, age)
    return bool(doc.get("online") or doc.get("effectiveOnline"))


# ---------------------------------------------------------------------------
# Tools â€” registry-wide
# ---------------------------------------------------------------------------
@mcp.tool()
def list_devices() -> str:
    """
    List every device registered in the global devices/ collection, with
    online status and how fresh each one's last check-in is.
    """
    docs = _list_all_docs()
    if isinstance(docs, dict) and "__error__" in docs:
        return _err_text(docs)
    if not docs:
        return "No devices registered in the global devices/ collection."

    rows = []
    for raw in docs:
        device_id = raw["name"].split("/")[-1]
        d = _parse_doc(raw)
        hb = _heartbeat_fields(d)
        age = hb["last_seen_age_seconds"]
        stored_online = bool(d.get("online") or d.get("effectiveOnline"))
        rows.append({
            "device_id": device_id,
            "display_name": d.get("deviceDisplayName", device_id),
            "type": d.get("deviceType", "unknown"),
            "online": _effective_online(device_id, d, age),
            "stored_online": stored_online,
            "status": d.get("status", "unknown"),
            **hb,
        })
    rows.sort(key=lambda r: (not r["online"], r["device_id"]))
    return json.dumps({"count": len(rows), "devices": rows}, indent=2, default=str)


# ---------------------------------------------------------------------------
# Tools â€” per-device (default: the S24)
# ---------------------------------------------------------------------------
@mcp.tool()
def device_ping(device_id: str = DEFAULT_DEVICE) -> str:
    """
    Link-health check for one global device (defaults to the S24).

    Confirms we can authenticate and read the device's registry document, then
    reports whether the device itself is online and how stale its last check-in
    is. A large last_seen_age_seconds means the flag is stale and the device's
    daemon is not actually polling.
    """
    device_id = _canonicalize_device_id(device_id)
    alias_err = _reject_if_alias(device_id)
    if alias_err:
        return alias_err
    err = _valid_id(device_id)
    if err:
        return err
    doc = _get_doc(device_id)
    e = _err_text(doc)
    if e:
        return json.dumps({"connected": False, "reason": e}, indent=2)
    if not doc:
        return json.dumps({"connected": True, "device_found": False,
                           "reason": f"devices/{device_id} is empty or missing"},
                          indent=2)
    hb = _heartbeat_fields(doc)
    age = hb["last_seen_age_seconds"]
    stored_online = bool(doc.get("online") or doc.get("effectiveOnline"))
    effective_online = _effective_online(device_id, doc, age)
    return json.dumps({
        "connected": True,
        "device_id": device_id,
        "project": PROJECT_ID,
        "database": DATABASE,
        "device_online": effective_online,
        "stored_online": stored_online,
        "heartbeat_authenticated": (
            _s24_phone_heartbeat_is_fresh(doc, age)
            if _is_s24_device_id(device_id)
            else None
        ),
        "last_command_ack_at": doc.get("lastCommandAckAt"),
        "last_command_ack_age_seconds": _age_seconds(doc.get("lastCommandAckAt")),
        "status": doc.get("status", "unknown"),
        "battery": doc.get("battery"),
        **hb,
        "freshness_window_seconds": (
            S24_HEARTBEAT_FRESHNESS_SECONDS
            if _is_s24_device_id(device_id)
            else None
        ),
        "checked_at": _now_iso(),
    }, indent=2, default=str)


@mcp.tool()
def device_info(device_id: str = DEFAULT_DEVICE) -> str:
    """Compact snapshot of a device's registry document (safe fields only)."""
    device_id = _canonicalize_device_id(device_id)
    alias_err = _reject_if_alias(device_id)
    if alias_err:
        return alias_err
    err = _valid_id(device_id)
    if err:
        return err
    doc = _get_doc(device_id)
    e = _err_text(doc)
    if e:
        return e
    safe_keys = {
        "deviceDisplayName", "deviceId", "canonicalDeviceId", "deviceType",
        "deviceRole", "documentRole", "schemaVersion", "online",
        "effectiveOnline", "status", "battery", "connectionMethod",
        "agentVersion", "heartbeatAuth", "liveDeviceVerified", "s24Runtime",
        "pcBridge", "remoteObserver", "lastSeen", "updatedAt", "syncRequestedAt", "forceSync",
        "lastCommandAckAt", "lastCommandAckId", "lastCommandAckStatus",
        "forceWakeup", "wakeupSignal", "commandId", "commandPriority",
        "agentCommand", "registeredAt",
    }
    snap = {k: v for k, v in doc.items() if k in safe_keys}
    if _is_s24_device_id(device_id):
        age = _heartbeat_age(doc)
        snap["storedOnline"] = bool(doc.get("online") or doc.get("effectiveOnline"))
        snap["online"] = _s24_phone_heartbeat_is_fresh(doc, age)
        snap["heartbeatAuthenticated"] = _s24_phone_heartbeat_is_fresh(doc, age)
        snap["lastSeenAgeSeconds"] = age
        snap["everCheckedIn"] = doc.get("lastSeen") is not None
        snap["docUpdatedAgeSeconds"] = _age_seconds(doc.get("updatedAt"))
        snap["lastCommandAckAgeSeconds"] = _age_seconds(doc.get("lastCommandAckAt"))
        snap["freshnessWindowSeconds"] = S24_HEARTBEAT_FRESHNESS_SECONDS
    q = doc.get("commandQueue") or {}
    snap["commandQueue_size"] = len(q) if isinstance(q, dict) else 0
    snap["_fetched_at"] = _now_iso()
    return json.dumps(snap, indent=2, default=str)


@mcp.tool()
def device_wake(device_id: str = DEFAULT_DEVICE) -> str:
    """
    Nudge a device to sync immediately by writing a wakeup + forceSync signal
    onto its registry document. Its daemon acts on the next poll cycle.
    """
    device_id = _canonicalize_device_id(device_id)
    alias_err = _reject_if_alias(device_id)
    if alias_err:
        return alias_err
    err = _valid_id(device_id)
    if err:
        return err
    at = _now_iso()
    res = _patch_doc(device_id, {
        "forceWakeup": True,
        "forceSync": True,
        "wakeupSignal": at,
        "syncRequestedAt": at,
        "agentCommand": "wakeup",
        "commandPriority": "HIGH",
    })
    e = _err_text(res)
    if e:
        return e
    return f"Wakeup + forceSync written to {device_id} at {at}. Device acts on next poll."


@mcp.tool()
def device_send(action: str, device_id: str = DEFAULT_DEVICE,
                params_json: str = "{}", priority: str = "NORMAL") -> str:
    """
    Queue a command for a device and wake it so it runs promptly.

    Args:
        action:      command name the device's daemon understands
                     (e.g. 'sync-now', 'collect-sms', 'collect-calls',
                     'collect-location', 'start-ssh').
        device_id:   target device (default: the S24).
        params_json: JSON object string of extra fields, e.g. '{"port": 8022}'.
        priority:    NORMAL | HIGH | CRITICAL (default NORMAL).

    Returns the generated command id; poll it with device_result(...).
    """
    device_id = _canonicalize_device_id(device_id)
    alias_err = _reject_if_alias(device_id)
    if alias_err:
        return alias_err
    err = _valid_id(device_id)
    if err:
        return err
    try:
        extra = json.loads(params_json)
        if not isinstance(extra, dict):
            return "Error: params_json must be a JSON object, e.g. '{\"port\": 8022}'."
    except json.JSONDecodeError as ex:
        return f"Error: params_json is not valid JSON ({ex})."
    priority = priority.upper()
    if priority not in {"NORMAL", "HIGH", "CRITICAL"}:
        return "Error: priority must be NORMAL, HIGH or CRITICAL."

    at = _now_iso()
    # Keep the id to [A-Za-z0-9_] so it is a valid Firestore field-path segment
    # (hyphens/spaces in an action like 'sync-now' would break the updateMask).
    action_slug = re.sub(r"[^A-Za-z0-9]+", "_", action).strip("_") or "cmd"
    cmd_id = f"connect_{int(time.time()*1000)}_{action_slug}"
    item = {
        "action": action,
        "status": "pending",
        "priority": priority,
        "requestedAt": at,
        "requestedBy": _REQUESTED_BY,
        "source": "commandQueue",
        **extra,
    }
    res = _patch_doc(device_id, {
        f"commandQueue.{cmd_id}": item,
        "forceWakeup": True,
        "wakeupSignal": at,
        "commandId": cmd_id,
        "commandPriority": priority,
    })
    e = _err_text(res)
    if e:
        return e
    return json.dumps({"queued": True, "device_id": device_id,
                       "command_id": cmd_id, "action": action,
                       "priority": priority, "at": at,
                       "next": "poll with device_result(command_id=..., device_id=...)"},
                      indent=2)


@mcp.tool()
def device_result(command_id: str, device_id: str = DEFAULT_DEVICE) -> str:
    """Read back the status/result of a command previously queued with device_send."""
    device_id = _canonicalize_device_id(device_id)
    alias_err = _reject_if_alias(device_id)
    if alias_err:
        return alias_err
    err = _valid_id(device_id)
    if err:
        return err
    doc = _get_doc(device_id)
    e = _err_text(doc)
    if e:
        return e
    q = doc.get("commandQueue") or {}
    if command_id not in q:
        return json.dumps({"found": False, "device_id": device_id,
                           "command_id": command_id,
                           "hint": "id not in commandQueue; may have been cleared"},
                          indent=2)
    return json.dumps({"found": True, "device_id": device_id,
                       "command_id": command_id, "item": q[command_id]},
                      indent=2, default=str)


@mcp.tool()
def device_queue(device_id: str = DEFAULT_DEVICE) -> str:
    """List every command-queue item on a device with its current status."""
    device_id = _canonicalize_device_id(device_id)
    alias_err = _reject_if_alias(device_id)
    if alias_err:
        return alias_err
    err = _valid_id(device_id)
    if err:
        return err
    doc = _get_doc(device_id)
    e = _err_text(doc)
    if e:
        return e
    q = doc.get("commandQueue") or {}
    if not isinstance(q, dict) or not q:
        return f"Command queue for {device_id} is empty."
    rows = []
    for qid, item in q.items():
        item = item if isinstance(item, dict) else {}
        rows.append({
            "command_id": qid,
            "action": item.get("action"),
            "status": item.get("status"),
            "priority": item.get("priority"),
            "requestedAt": item.get("requestedAt"),
        })
    rows.sort(key=lambda r: str(r.get("requestedAt")), reverse=True)
    return json.dumps({"device_id": device_id, "items": rows}, indent=2, default=str)


@mcp.tool()
def device_clear(device_id: str = DEFAULT_DEVICE) -> str:
    """Cancel all pending (not-yet-run) command-queue items on a device."""
    device_id = _canonicalize_device_id(device_id)
    alias_err = _reject_if_alias(device_id)
    if alias_err:
        return alias_err
    err = _valid_id(device_id)
    if err:
        return err
    doc = _get_doc(device_id)
    e = _err_text(doc)
    if e:
        return e
    q = doc.get("commandQueue") or {}
    pending = [qid for qid, item in q.items()
               if isinstance(item, dict)
               and item.get("status") in {"pending", "queued", "requested"}]
    if not pending:
        return f"No pending items to cancel on {device_id}."
    fs_fields = {f"commandQueue.{qid}.status": "cancelled" for qid in pending}
    fs_fields["queueClearedAt"] = _now_iso()
    fs_fields["queueClearedReason"] = f"{_REQUESTED_BY} manual clear"
    _patch_doc(device_id, fs_fields)
    return f"Cancelled {len(pending)} pending item(s) on {device_id}: {pending}"


@mcp.tool()
def device_watch(device_id: str = DEFAULT_DEVICE, timeout_seconds: int = 300,
                 interval_seconds: int = 30, exit_on_ack: bool = False) -> str:
    """
    Watch a device doc and report the moment its daemon checks in.

    Polls read-only every interval_seconds, snapshots the daemon-activity
    fields (online/storedOnline/heartbeatAuthenticated/lastSeen, the
    lastCommandAck* trio, agentCommand, each commandQueue entry's status,
    and the tunnel* publish fields) and returns as soon as any of them
    changes. Use it after queueing commands or writing a wakeup signal when
    the daemon is offline, to catch the exact poll instant instead of
    re-checking manually. Returns early with the change set when exit_on_ack
    is true and lastCommandAckAt advances (daemon executed a queued command);
    otherwise returns after timeout_seconds with a no-activity summary. Never
    writes; safe to run alongside queue repairs.

    Args:
        device_id:        target device (default: the S24).
        timeout_seconds:  max seconds to watch before returning (10..3600).
        interval_seconds: poll interval in seconds (5..300).
        exit_on_ack:      return immediately when lastCommandAckAt advances.
    """
    device_id = _canonicalize_device_id(device_id)
    alias_err = _reject_if_alias(device_id)
    if alias_err:
        return alias_err
    err = _valid_id(device_id)
    if err:
        return err
    try:
        timeout_seconds = max(10, min(3600, int(timeout_seconds)))
        interval_seconds = max(5, min(300, int(interval_seconds)))
    except (TypeError, ValueError):
        return "Error: timeout_seconds and interval_seconds must be integers."

    watch_fields = [
        "online", "storedOnline", "heartbeatAuthenticated", "lastSeen",
        "lastCommandAckAt", "lastCommandAckId", "lastCommandAckStatus",
        "agentCommand", "commandQueue",
        "tunnelPort", "tunnelHost", "tunnelSshCmd", "tunnelUpdatedAt",
    ]
    mask = "&".join("mask.fieldPaths=" + f for f in watch_fields)

    def snapshot() -> dict:
        raw = _fs_request("GET", f"devices/{device_id}?{mask}")
        if "__error__" in raw:
            return {"__error__": raw["__error__"]}
        fields = raw.get("fields", {})
        snap = {f: _decode(fields[f]) for f in watch_fields if f in fields}
        q = snap.get("commandQueue") or {}
        snap["queueStatuses"] = {
            qid: (item or {}).get("status")
            for qid, item in q.items() if isinstance(item, dict)
        }
        snap.pop("commandQueue", None)
        return snap

    def diff(base: dict, cur: dict) -> dict:
        return {
            k: {"from": base.get(k), "to": cur.get(k)}
            for k in set(base) | set(cur)
            if base.get(k) != cur.get(k)
        }

    base = snapshot()
    if "__error__" in base:
        return _err_text(base) or "watch failed to read device doc"
    start_ack = base.get("lastCommandAckAt")
    seen_changes: list = []
    deadline = time.time() + timeout_seconds
    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            break
        time.sleep(min(interval_seconds, remaining))
        cur = snapshot()
        if "__error__" in cur:
            seen_changes.append({"at": _now_iso(), "poll_error": _err_text(cur)})
            continue
        d = diff(base, cur)
        if d:
            seen_changes.append({"at": _now_iso(), "changes": d})
            base = cur
            ack_advanced = (
                cur.get("lastCommandAckAt") is not None
                and cur.get("lastCommandAckAt") != start_ack
            )
            if exit_on_ack and ack_advanced:
                return json.dumps({
                    "device_id": device_id,
                    "outcome": "daemon_ack",
                    "message": "lastCommandAckAt advanced - daemon executed a queued command",
                    "changes": seen_changes,
                }, indent=2, default=str)
    return json.dumps({
        "device_id": device_id,
        "outcome": ("daemon_activity" if seen_changes else "no_activity"),
        "watched_seconds": timeout_seconds,
        "interval_seconds": interval_seconds,
        "changes": seen_changes,
        "final": base,
    }, indent=2, default=str)


@mcp.tool()
def register_device(device_id: str, display_name: str, device_type: str,
                    device_role: str = "secondary") -> str:
    """
    Register a new device in the global devices/ collection.

    Args:
        device_id:    canonical id, lowercase-hyphen (e.g. jayti-asus-vivobook).
        display_name: human-readable name.
        device_type:  phone | tablet | laptop | desktop | server.
        device_role:  primary | secondary | runner (default secondary).
    """
    err = _valid_id(device_id)
    if err:
        return err
    at = _now_iso()
    res = _patch_doc(device_id, {
        "deviceId": device_id,
        "canonicalDeviceId": device_id,
        "deviceDisplayName": display_name,
        "deviceType": device_type,
        "deviceRole": device_role,
        "schemaVersion": "s24-connect-v1",
        "online": False,
        "status": "registered",
        "registeredAt": at,
        "updatedAt": at,
        "registeredBy": _REQUESTED_BY,
    })
    e = _err_text(res)
    if e:
        return e
    return (f"Device '{device_id}' registered as '{display_name}' "
            f"({device_type}/{device_role}). Install its daemon and point it at "
            f"devices/{device_id}.")


if __name__ == "__main__":
    mcp.run()
