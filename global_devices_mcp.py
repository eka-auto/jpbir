#!/usr/bin/env python3
"""
Global Device Agent MCP

Reads and controls ALL devices registered in Firestore under devices/
collection, tied to Firebase project intrepid-stage-495117-q1.

Device ID convention (match existing docs exactly):
    <owner/brand>-<product-line>-<model>
    e.g.  jayti-asus-vivobook
          samsung-s24-ultra
          jayti-asus-vivobook

Register once:
    claude mcp add global-devices -- python C:/Samsung-S24/global_devices_mcp.py

Tools:
    list_devices          — all registered devices + online/offline + lastSeen
    get_device            — full snapshot of one device
    get_all_online        — snapshot of every currently online device
    send_command          — run a command on a device and return its real output
    clear_device_queue    — cancel pending commands on a device
    register_device       — register a new device (first-time setup)
    ping_device           — prove a device is alive via nonce round-trip

Command channel:
    send_command and ping_device write to devices/{id}/commands in the
    "eka-agent" database — the only channel a running daemon polls.  Both then
    WAIT for the daemon's write-back, so a success reply means the device really
    executed something.  A timeout means nothing is consuming that device, no
    matter what its "online" flag says.

    Do not queue work into the device doc's commandQueue / bootstrapQueue /
    actionQueue map fields, or set wakeupSignal / forceWakeup / EXECUTE_NOW and
    expect a result: nothing reads them.  Those fields are why this fleet
    accumulated ~70 commands that reported "queued" and never ran.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.request
import urllib.parse
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PROJECT_ID = "intrepid-stage-495117-q1"
# The desktop default preserves the existing local MCP setup.  Docker-based
# deployments set GLOBAL_DEVICES_SERVICE_ACCOUNT_KEY to a read-only mounted
# secret instead of baking a service-account file into an image.
KEY_FILE   = Path(
    os.environ.get(
        "GLOBAL_DEVICES_SERVICE_ACCOUNT_KEY",
        os.environ.get(
            "GOOGLE_APPLICATION_CREDENTIALS",
            r"C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json",
        ),
    )
)
PRIMARY_DB = os.environ.get("EKA_FIRESTORE_DB", "(default)")
# Devices are spread across databases: the S24 daemon writes the live doc to
# "(default)", the VivoBook daemon writes to "eka-agent".  Reads enumerate all
# of them; writes target whichever DB already holds the device (primary first).
ALL_DBS    = list(dict.fromkeys([PRIMARY_DB, "(default)", "eka-agent"]))

# The ONLY channel a running daemon consumes.  eka_agent_vivobook.py polls
#     [db=eka-agent] devices/{DEVICE_ID}/commands  where status == "pending"
# and executes the "command" field via PowerShell, writing back status/output/
# error/startedAt/completedAt.  Everything else in the device doc -- the
# commandQueue / bootstrapQueue / actionQueue map fields, wakeupSignal,
# forceWakeup, EXECUTE_NOW -- is a dead channel that no daemon reads.  Commands
# MUST go here or they sit "pending" forever while reporting success.
LIVE_DB           = "eka-agent"
COMMANDS_SUBCOLL  = "commands"
FS_BASES   = {
    db: f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/{db}/documents"
    for db in ALL_DBS
}

_token_cache: dict = {"token": None, "expires_at": 0.0}

mcp = FastMCP("global-devices")

DEVICE_ID_PATTERN = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")


def _validate_device_id(device_id: str) -> str | None:
    if not isinstance(device_id, str) or not DEVICE_ID_PATTERN.fullmatch(device_id):
        return f"'{device_id}' is not a valid device_id (must be lowercase, hyphen-separated, no whitespace)."
    return None


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def _get_token() -> str:
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["token"]

    key = json.loads(KEY_FILE.read_text())

    import base64
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    header  = base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    iat     = int(now)
    payload = base64.urlsafe_b64encode(json.dumps({
        "iss":   key["client_email"],
        "scope": "https://www.googleapis.com/auth/datastore",
        "aud":   "https://oauth2.googleapis.com/token",
        "iat":   iat,
        "exp":   iat + 3600,
    }).encode()).rstrip(b"=").decode()

    pk  = serialization.load_pem_private_key(key["private_key"].encode(), password=None)
    sig = base64.urlsafe_b64encode(
        pk.sign(f"{header}.{payload}".encode(), padding.PKCS1v15(), hashes.SHA256())
    ).rstrip(b"=").decode()

    jwt_token = f"{header}.{payload}.{sig}"
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=urllib.parse.urlencode({
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion":  jwt_token,
        }).encode(),
    )
    resp = json.loads(urllib.request.urlopen(req).read())
    _token_cache["token"]      = resp["access_token"]
    _token_cache["expires_at"] = now + resp.get("expires_in", 3600)
    return _token_cache["token"]


# ---------------------------------------------------------------------------
# Firestore helpers
# ---------------------------------------------------------------------------
def _fs_request(method: str, path: str, body: dict | None = None, database: str | None = None) -> dict:
    url     = f"{FS_BASES[database or PRIMARY_DB]}/{path}"
    token   = _get_token()
    data    = json.dumps(body).encode() if body else None
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    req     = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        return json.loads(urllib.request.urlopen(req).read())
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()}


def _list_all_device_docs() -> list[dict]:
    """Return raw Firestore documents from devices/ collection, across ALL databases."""
    result = []
    for db in ALL_DBS:
        page_token = None
        while True:
            qs = "pageSize=50"
            if page_token:
                qs += f"&pageToken={urllib.parse.quote(page_token)}"
            resp = _fs_request("GET", f"devices?{qs}", database=db)
            for raw in resp.get("documents", []):
                raw = dict(raw)
                raw["database"] = db
                result.append(raw)
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
    return result


def _find_device_db(device_id: str) -> str | None:
    """Return the database that actually holds this device doc (primary first)."""
    for db in ALL_DBS:
        resp = _fs_request("GET", f"devices/{device_id}", database=db)
        if "error" not in resp:
            return db
    return None


def _parse_value(v: dict):
    """Unwrap a single Firestore value."""
    if "stringValue"    in v: return v["stringValue"]
    if "booleanValue"   in v: return v["booleanValue"]
    if "integerValue"   in v: return int(v["integerValue"])
    if "doubleValue"    in v: return v["doubleValue"]
    if "timestampValue" in v: return v["timestampValue"]
    if "nullValue"      in v: return None
    if "mapValue"       in v:
        return {k: _parse_value(vv) for k, vv in v["mapValue"].get("fields", {}).items()}
    if "arrayValue"     in v:
        return [_parse_value(i) for i in v["arrayValue"].get("values", [])]
    return v


def _parse_doc(raw: dict) -> dict:
    """Flatten a Firestore document into a plain dict."""
    if "error" in raw:
        return raw
    return {k: _parse_value(v) for k, v in raw.get("fields", {}).items()}


def _encode(value: Any) -> dict:
    """Wrap a Python value as a Firestore REST typed value (recursively)."""
    if value is None:            return {"nullValue": None}
    if isinstance(value, bool):  return {"booleanValue": value}
    if isinstance(value, int):   return {"integerValue": str(value)}
    if isinstance(value, float): return {"doubleValue": value}
    if isinstance(value, str):   return {"stringValue": value}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {k: _encode(v) for k, v in value.items()}}}
    if isinstance(value, (list, tuple)):
        return {"arrayValue": {"values": [_encode(v) for v in value]}}
    return {"stringValue": str(value)}


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
    """
    Merge-patch fields onto a device doc. Keys may use dot notation.

    The body must be NESTED and the updateMask must carry the dotted path. A
    dotted key placed straight into the body creates a top-level field whose
    literal name contains dots (e.g. "commandQueue.ssh_enable_123"), which no
    consumer iterating d["commandQueue"] will ever see.

    The write goes to whichever database holds the device (new devices land in
    the primary database).
    """
    db = _find_device_db(device_id) or PRIMARY_DB
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
        "PATCH",
        f"devices/{device_id}?{mask}",
        {"fields": fs_fields},
        database=db,
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Live command channel:  [LIVE_DB] devices/{id}/commands/{cmd_id}
# ---------------------------------------------------------------------------
TERMINAL_STATUSES = {"completed", "failed", "error", "timeout", "unknown", "cancelled"}


def _command_db(device_id: str) -> str | None:
    """
    Return the database whose daemon actually polls this device.

    A device doc can exist in several databases at once (jayti-asus-vivobook is
    in both "(default)" and "eka-agent").  _find_device_db would hand back
    "(default)" because it checks PRIMARY_DB first -- and nothing polls that.
    Commands always target LIVE_DB, so verify the doc is really there.
    """
    resp = _fs_request("GET", f"devices/{device_id}", database=LIVE_DB)
    return LIVE_DB if "error" not in resp else None


def _write_command(device_id: str, cmd_id: str, fields: dict, database: str) -> dict:
    """
    Create/merge a command document in the live subcollection.

    PATCH creates the doc when absent, so this doubles as the queue-write.  The
    field mask lists exactly the keys we set, which keeps a daemon's write-back
    (output / completedAt) intact if we ever re-patch the same id.
    """
    fs_fields = {k: _encode(v) for k, v in fields.items()}
    mask = "&".join(
        f"updateMask.fieldPaths={urllib.parse.quote(_mask_path(k), safe='')}"
        for k in fields
    )
    return _fs_request(
        "PATCH",
        f"devices/{device_id}/{COMMANDS_SUBCOLL}/{cmd_id}?{mask}",
        {"fields": fs_fields},
        database=database,
    )


def _read_command(device_id: str, cmd_id: str, database: str) -> dict | None:
    """
    Read one command doc back, flattened. None means the read itself failed.

    Transport failure must be detected on the RAW response, not the parsed doc:
    the daemon writes back its own "error" field (empty string on success), so
    `"error" in parsed` is true for every completed command and says nothing
    about whether the fetch worked.
    """
    raw = _fs_request("GET", f"devices/{device_id}/{COMMANDS_SUBCOLL}/{cmd_id}", database=database)
    if "fields" not in raw:
        return None
    return _parse_doc(raw)


def _list_commands(device_id: str, database: str) -> list[tuple[str, dict]]:
    """Return [(cmd_id, doc), ...] for every command doc on a device."""
    out: list[tuple[str, dict]] = []
    page_token = None
    while True:
        qs = "pageSize=100"
        if page_token:
            qs += f"&pageToken={urllib.parse.quote(page_token)}"
        resp = _fs_request(
            "GET", f"devices/{device_id}/{COMMANDS_SUBCOLL}?{qs}", database=database
        )
        if "error" in resp:
            break
        for raw in resp.get("documents", []):
            out.append((raw["name"].split("/")[-1], _parse_doc(raw)))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return out


def _await_command(device_id: str, cmd_id: str, database: str, timeout: int) -> dict | None:
    """
    Poll a queued command until the daemon reaches a terminal status.

    Returns the finished doc, or None if it was still pending when time ran out
    (which is the signal that no daemon is consuming this device).
    """
    deadline = time.time() + timeout
    while True:
        doc = _read_command(device_id, cmd_id, database)
        if doc is not None and doc.get("status") in TERMINAL_STATUSES:
            return doc
        if time.time() >= deadline:
            return None
        time.sleep(2)


def _format_result(device_id: str, cmd_id: str, doc: dict | None, queued_at: str, timeout: int) -> str:
    """Render a finished (or timed-out) command for the caller."""
    if doc is None:
        return (
            f"Command queued as {cmd_id} on {device_id} [{LIVE_DB}] at {queued_at}, "
            f"but it was still 'pending' after {timeout}s.\n"
            f"No daemon is consuming devices/{device_id}/{COMMANDS_SUBCOLL} — the device "
            f"is not actually reachable regardless of its 'online' flag."
        )
    lines = [
        f"Command {cmd_id} on {device_id} [{LIVE_DB}] finished: {doc.get('status')}",
        f"  queuedAt    = {queued_at}",
        f"  startedAt   = {doc.get('startedAt')}",
        f"  completedAt = {doc.get('completedAt')}",
    ]
    if doc.get("output"):
        lines.append(f"  output      = {str(doc['output'])[:4000]}")
    if doc.get("error"):
        lines.append(f"  error       = {str(doc['error'])[:2000]}")
    return "\n".join(lines)


def _summarise(doc: dict, device_id: str) -> dict:
    """Return a compact summary of a device for list views."""
    return {
        "device_id":    device_id,
        "display_name": doc.get("deviceDisplayName", device_id),
        "device_type":  doc.get("deviceType", "unknown"),
        "online":       doc.get("online", False),
        "status":       doc.get("status", "unknown"),
        "last_seen":    doc.get("lastSeen", doc.get("updatedAt", "never")),
        "schema":       doc.get("schemaVersion", "unknown"),
        "role":         doc.get("deviceRole", "unknown"),
        "database":     doc.get("_database", "?"),
    }


# ---------------------------------------------------------------------------
# MCP Tools
# ---------------------------------------------------------------------------

@mcp.tool()
def list_devices() -> str:
    """List all registered devices with online status and last-seen time."""
    docs = _list_all_device_docs()
    if not docs:
        return "No devices found in Firestore devices/ collection."

    summaries = []
    for raw in docs:
        device_id = raw["name"].split("/")[-1]
        doc       = _parse_doc(raw)
        doc["_database"] = raw.get("database")
        summaries.append(_summarise(doc, device_id))

    summaries.sort(key=lambda d: (not d["online"], d["device_id"]))

    lines = [f"{'ID':<28} {'DISPLAY':<24} {'TYPE':<12} {'STATUS':<14} {'DB':<10} {'LAST SEEN'}"]
    lines.append("-" * 110)
    for s in summaries:
        online_tag = "online" if s["online"] else "offline"
        lines.append(
            f"{s['device_id']:<28} {s['display_name']:<24} {s['device_type']:<12} "
            f"{online_tag:<14} {s.get('database','?'):<10} {s['last_seen']}"
        )
    return "\n".join(lines)


@mcp.tool()
def get_device(device_id: str) -> str:
    """
    Return a full snapshot of one device from Firestore.

    Args:
        device_id: Exact Firestore document ID (e.g. samsung-s24-ultra,
                   jayti-asus-vivobook, jayti-asus-vivobook)
    """
    db  = _find_device_db(device_id)
    raw = _fs_request("GET", f"devices/{device_id}", database=db or PRIMARY_DB)
    doc = _parse_doc(raw)
    if "error" in doc:
        return f"Error fetching {device_id} from {db or PRIMARY_DB}: {doc['error']}"
    doc["_database"] = db
    return json.dumps(doc, indent=2, default=str)


@mcp.tool()
def get_all_online() -> str:
    """Return a snapshot of every device that is currently online."""
    docs = _list_all_device_docs()
    online = []
    for raw in docs:
        device_id = raw["name"].split("/")[-1]
        doc       = _parse_doc(raw)
        doc["_database"] = raw.get("database")
        if doc.get("online") or doc.get("effectiveOnline"):
            online.append({"device_id": device_id, **doc})

    if not online:
        return "No devices are currently online."

    result = {d["device_id"]: d for d in online}
    return json.dumps(result, indent=2, default=str)


@mcp.tool()
def send_command(
    device_id: str,
    command: str,
    priority: str = "NORMAL",
    wait_seconds: int = 30,
) -> str:
    """
    Run a PowerShell command on a registered device and return its real output.

    The command is written to the live channel the daemon actually polls
    (devices/{device_id}/commands in the "eka-agent" database), then awaited.
    A result with startedAt/completedAt is proof of execution; a timeout means
    nothing is consuming that device, whatever its "online" flag claims.

    Args:
        device_id:    Firestore document ID of the target device
        command:      PowerShell command string to execute on the device
        priority:     NORMAL | HIGH | CRITICAL  (default: NORMAL)
        wait_seconds: How long to wait for the result. 0 = queue and return
                      immediately without waiting. (default: 30)
    """
    err = _validate_device_id(device_id)
    if err:
        return err

    db = _command_db(device_id)
    if not db:
        return (
            f"Error: device '{device_id}' has no document in the '{LIVE_DB}' database, "
            f"so it has no live command channel. Commands written anywhere else are "
            f"never executed."
        )

    now_iso = _now_iso()
    cmd_id  = f"mcp_cmd_{int(time.time())}"
    res = _write_command(device_id, cmd_id, {
        "command":     command,
        "type":        "shell",
        "status":      "pending",
        "priority":    priority,
        "requestedAt": now_iso,
        "requestedBy": "global-devices-mcp",
    }, database=db)
    if isinstance(res, dict) and "error" in res:
        return f"Error queueing command on {device_id}: {res['error']}"

    if wait_seconds <= 0:
        return (
            f"Command queued as {cmd_id} on {device_id} [{db}] at {now_iso} "
            f"(not awaited). Read it back at "
            f"devices/{device_id}/{COMMANDS_SUBCOLL}/{cmd_id}."
        )

    doc = _await_command(device_id, cmd_id, db, wait_seconds)
    return _format_result(device_id, cmd_id, doc, now_iso, wait_seconds)


_PENDING_STATUSES = {"pending", "queued", "requested"}


@mcp.tool()
def clear_device_queue(device_id: str) -> str:
    """
    Cancel the PENDING commands in a device's command queue.

    Entries that already ran (completed / failed / cancelled) are left alone --
    overwriting their status would destroy the execution record.

    Args:
        device_id: Firestore document ID of the target device
    """
    err = _validate_device_id(device_id)
    if err:
        return err

    now_iso = _now_iso()
    db  = _find_device_db(device_id)
    if not db:
        return f"Error: device {device_id} not found in any database."
    doc = _parse_doc(_fs_request("GET", f"devices/{device_id}", database=db))
    if "error" in doc:
        return f"Error fetching {device_id}: {doc['error']}"

    report: list[str] = []

    # 1. Live channel — the one that can still fire on a device that wakes up.
    live_db = _command_db(device_id)
    if live_db:
        live = _list_commands(device_id, live_db)
        live_pending = sorted(
            cid for cid, item in live if item.get("status") in _PENDING_STATUSES
        )
        for cid in live_pending:
            _write_command(device_id, cid, {
                "status": "cancelled",
                "cancelledAt": now_iso,
                "cancelledBy": "global-devices-mcp manual clear",
            }, database=live_db)
        report.append(
            f"live channel [{live_db}] devices/{device_id}/{COMMANDS_SUBCOLL}: "
            f"cancelled {len(live_pending)} pending"
            + (f" ({', '.join(live_pending)})" if live_pending else "")
            + f", {len(live) - len(live_pending)} already-run entries left intact"
        )
    else:
        report.append(f"live channel: device has no doc in '{LIVE_DB}' — nothing to clear")

    # 2. Legacy commandQueue map field — dead channel, but stale "pending"
    #    entries there are what make the fleet look busy. Tidy them too.
    queue = doc.get("commandQueue") or {}
    pending = sorted(
        qid for qid, item in queue.items()
        if isinstance(item, dict) and item.get("status") in _PENDING_STATUSES
    )
    kept = len(queue) - len(pending)
    if pending:
        # Single PATCH for the whole batch: _patch_doc merges the dotted paths
        # into one nested body, and the field mask keeps each command's other
        # fields.
        updates = {}
        for qid in pending:
            updates[f"commandQueue.{qid}.status"] = "cancelled"
            updates[f"commandQueue.{qid}.cancelledAt"] = now_iso
        updates["queueClearedAt"] = now_iso
        updates["queueClearedReason"] = "global-devices-mcp manual clear"
        res = _patch_doc(device_id, updates)
        if isinstance(res, dict) and "error" in res:
            report.append(f"legacy commandQueue [{db}]: ERROR — {res['error']}")
        else:
            report.append(
                f"legacy commandQueue [{db}] (dead channel): cancelled {len(pending)} "
                f"stale pending ({', '.join(pending)}), {kept} already-run left intact"
            )
    else:
        report.append(
            f"legacy commandQueue [{db}] (dead channel): no pending, "
            f"{kept} already-run entries left intact"
        )

    return f"Queue clear on {device_id}:\n  " + "\n  ".join(report)


@mcp.tool()
def ping_device(device_id: str, wait_seconds: int = 30) -> str:
    """
    Prove a device is alive by round-tripping a nonce through its daemon.

    Queues a probe on the live command channel that echoes a freshly minted
    nonce plus real hardware facts (hostname, manufacturer, model, BIOS serial,
    MachineGuid). Because the nonce cannot exist before this call, a matching
    echo is proof the daemon executed it just now — unlike the device doc's
    "online" flag, which any process can write on a device's behalf.

    Args:
        device_id:    Firestore document ID of the target device
        wait_seconds: How long to wait for the echo. (default: 30)
    """
    err = _validate_device_id(device_id)
    if err:
        return err

    db = _command_db(device_id)
    if not db:
        return (
            f"Error: device '{device_id}' has no document in the '{LIVE_DB}' database, "
            f"so there is no daemon channel to ping."
        )

    now_iso = _now_iso()
    nonce   = uuid.uuid4().hex[:12]
    cmd_id  = f"mcp_ping_{nonce}"
    probe = (
        "$cs = Get-CimInstance Win32_ComputerSystem; "
        "$bios = Get-CimInstance Win32_BIOS; "
        "$guid = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid; "
        f"$o = [ordered]@{{ nonce='{nonce}'; host=$env:COMPUTERNAME; user=$env:USERNAME; "
        "mfr=$cs.Manufacturer; model=$cs.Model; biosSerial=$bios.SerialNumber; "
        "machineGuid=$guid; ranAt=(Get-Date).ToUniversalTime().ToString('o') }; "
        "$o | ConvertTo-Json -Compress"
    )

    res = _write_command(device_id, cmd_id, {
        "command":     probe,
        "type":        "ping",
        "status":      "pending",
        "priority":    "HIGH",
        "nonce":       nonce,
        "requestedAt": now_iso,
        "requestedBy": "global-devices-mcp",
    }, database=db)
    if isinstance(res, dict) and "error" in res:
        return f"Error queueing ping on {device_id}: {res['error']}"

    doc = _await_command(device_id, cmd_id, db, wait_seconds)
    if doc is None:
        return (
            f"NO RESPONSE from {device_id} [{db}] after {wait_seconds}s (nonce {nonce}).\n"
            f"Nothing is polling devices/{device_id}/{COMMANDS_SUBCOLL} — the device is "
            f"NOT reachable. Any 'online: true' on its doc is being written by some other "
            f"process, not by this device."
        )

    out = str(doc.get("output") or "").strip()
    try:
        facts = json.loads(out)
    except Exception:
        return (
            f"{device_id} responded (status={doc.get('status')}) but the probe output "
            f"was not parseable:\n  {out[:1000]}\n  error={str(doc.get('error') or '')[:500]}"
        )

    verified = facts.get("nonce") == nonce
    lines = [
        f"{'ALIVE — nonce verified' if verified else 'NONCE MISMATCH — DO NOT TRUST'}: "
        f"{device_id} [{db}]",
        f"  queuedAt    = {now_iso}",
        f"  startedAt   = {doc.get('startedAt')}",
        f"  completedAt = {doc.get('completedAt')}",
        f"  nonce       = sent {nonce} / got {facts.get('nonce')}",
    ]
    for k in ("host", "user", "mfr", "model", "biosSerial", "machineGuid", "ranAt"):
        lines.append(f"  {k:11} = {facts.get(k)}")
    if not verified:
        lines.append(
            "  WARNING: the echoed nonce does not match. This output was not produced "
            "by the command just queued — treat the device as unverified."
        )
    return "\n".join(lines)


@mcp.tool()
def register_device(
    device_id:    str,
    display_name: str,
    device_type:  str,
    device_role:  str = "secondary",
    schema_version: str = "global-devices-v1",
) -> str:
    """
    Register a new device in Firestore following the project's naming convention.

    Device ID format: <owner/brand>-<product-line>-<model>  (all lowercase, hyphens)
    Examples: jayti-asus-vivobook, jayti-pixel-8, jayti-ipad-pro

    Args:
        device_id:      Canonical ID (lowercase-hyphen, e.g. jayti-asus-vivobook)
        display_name:   Human-readable name (e.g. "Go4Garage ASUS Laptop")
        device_type:    laptop | desktop | phone | tablet | server
        device_role:    primary | secondary | runner (default: secondary)
        schema_version: Schema tag (default: global-devices-v1)
    """
    if device_id != device_id.lower() or "_" in device_id:
        return (
            f"Invalid device_id '{device_id}'. "
            "Must be lowercase and hyphen-separated (e.g. jayti-asus-vivobook)."
        )

    now_iso = _now_iso()
    _patch_doc(device_id, {
        "deviceId":           device_id,
        "canonicalDeviceId":  device_id,
        "deviceDisplayName":  display_name,
        "deviceType":         device_type,
        "deviceRole":         device_role,
        "schemaVersion":      schema_version,
        "online":             False,
        "status":             "registered",
        "registeredAt":       now_iso,
        "updatedAt":          now_iso,
        "registeredBy":       "global-devices-mcp",
    })
    return (
        f"Device '{device_id}' registered as '{display_name}' ({device_type}/{device_role}).\n"
        f"Next: install the sync script on that device and point it to devices/{device_id}."
    )


if __name__ == "__main__":
    mcp.run()
