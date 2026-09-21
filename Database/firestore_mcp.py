#!/usr/bin/env python3
"""
S24 Firestore-relay MCP server.

Lets Claude read from and write to the Firestore docs that the S24 Termux
daemon (s24_phone_direct_cloud.py) polls every cycle.  No ADB, no USB, no
local network required -- works over public HTTPS as long as the S24 has any
internet connection (Wi-Fi or mobile data).

Register once:
    claude mcp add s24-cloud -- python C:/Users/abcom/jpbir/tools/mcp/firestore_mcp.py

Tools exposed:
    s24_status          -- current state of both S24 Firestore docs
    s24_sync_now        -- write forceSync=true (daemon picks up next poll)
    s24_wakeup          -- write forceWakeup=true + CRITICAL priority
    s24_queue_command   -- append an item to commandQueue
    s24_clear_queue     -- remove all pending commandQueue items
    s24_enable_ssh      -- compatibility tool; refuses the forbidden SSH action
    s24_read_calls      -- return call logs stored in Firestore
    s24_read_sms        -- return SMS messages stored in Firestore
    s24_read_location   -- return last known location
"""
from __future__ import annotations

import json
import os
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
from pathlib import Path

from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PROJECT_ID = "intrepid-stage-495117-q1"
PRIMARY_DOC  = "samsung-s24-ultra"
KEY_FILE = Path(r"C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json")
# Target database. Was hardcoded to eka-agent; now overridable so this server
# can be pointed at the isolated eka-runner database without a code change.
FIRESTORE_DB = os.environ.get("EKA_FIRESTORE_DB", "eka-agent")
FS_BASE  = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/{FIRESTORE_DB}/documents"

_token_cache: dict = {"token": None, "expires_at": 0.0}

mcp = FastMCP("s24-cloud")

# Exact mirror of Devices/S24/runtime_contract.json. This legacy MCP predates
# the runtime contract and once accepted arbitrary actions plus arbitrary
# top-level command fields. Keep the trust boundary at the queue writer: an MCP
# credential may request only a contract action and cannot forge command state
# or pass credentials consumed by historical dangerous handlers.
SAFE_DEVICE_ACTIONS = frozenset({
    "status-only", "ping", "echo", "wa-push", "wa-media-push", "sync-now",
})
RESERVED_COMMAND_PARAMS = frozenset({
    "action", "status", "priority", "requestedAt", "requestedBy", "source",
    "completedAt", "ackAt", "claimedAt", "processedAt", "result",
    "wipeToken", "newPassword",
})


def _normalize_action(action: str) -> str:
    normalized = str(action or "").strip().lower().replace("_", "-")
    aliases = {
        "sync": "sync-now",
        "direct-cloud-sync": "sync-now",
        "collect-history": "sync-now",
        "history": "sync-now",
        "status": "status-only",
    }
    return aliases.get(normalized, normalized)


def _action_gate(action: str) -> str | None:
    canonical = _normalize_action(action)
    if canonical in SAFE_DEVICE_ACTIONS:
        return None
    return (
        f"action {action!r} is refused: it resolves to {canonical or 'unknown'!r}, "
        f"outside the runtime contract {sorted(SAFE_DEVICE_ACTIONS)}"
    )

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _get_token() -> str:
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["token"]

    key = json.loads(KEY_FILE.read_text())
    import base64, hashlib, hmac, struct, math

    # Build JWT manually (no extra deps)
    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "RS256", "typ": "JWT"}).encode()
    ).rstrip(b"=").decode()

    iat = int(now)
    exp = iat + 3600
    payload = base64.urlsafe_b64encode(
        json.dumps({
            "iss": key["client_email"],
            "scope": "https://www.googleapis.com/auth/datastore",
            "aud": "https://oauth2.googleapis.com/token",
            "iat": iat,
            "exp": exp,
        }).encode()
    ).rstrip(b"=").decode()

    # Sign with RSA private key using cryptography lib
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    pem = key["private_key"].encode()
    private_key = serialization.load_pem_private_key(pem, password=None)
    signing_input = f"{header}.{payload}".encode()
    sig = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    signature = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    jwt = f"{header}.{payload}.{signature}"

    data = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": jwt,
    }).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        resp = json.loads(r.read())
    _token_cache["token"] = resp["access_token"]
    _token_cache["expires_at"] = now + resp.get("expires_in", 3600)
    return _token_cache["token"]


def _fs_request(method: str, path: str, body: dict | None = None) -> dict:
    url = f"{FS_BASE}/{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={
            "Authorization": f"Bearer {_get_token()}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode()
        raise RuntimeError(
            f"Firestore {method} {url} failed with HTTP {e.code}: {detail[:1000]}"
        ) from e


def _parse_doc(doc: dict) -> dict:
    """Flatten Firestore typed value map to plain Python dict."""
    def _val(v):
        if "stringValue" in v: return v["stringValue"]
        if "integerValue" in v: return int(v["integerValue"])
        if "doubleValue" in v: return float(v["doubleValue"])
        if "booleanValue" in v: return v["booleanValue"]
        if "nullValue" in v: return None
        if "timestampValue" in v: return v["timestampValue"]
        if "mapValue" in v:
            return {k: _val(vv) for k, vv in v["mapValue"].get("fields", {}).items()}
        if "arrayValue" in v:
            return [_val(x) for x in v["arrayValue"].get("values", [])]
        return v
    fields = doc.get("fields", {})
    return {k: _val(v) for k, v in fields.items()}


def _to_fs_value(v) -> dict:
    """Convert a Python value to a Firestore typed value."""
    if v is None: return {"nullValue": None}
    if isinstance(v, bool): return {"booleanValue": v}
    if isinstance(v, int): return {"integerValue": str(v)}
    if isinstance(v, float): return {"doubleValue": v}
    if isinstance(v, str): return {"stringValue": v}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {k: _to_fs_value(vv) for k, vv in v.items()}}}
    if isinstance(v, list):
        return {"arrayValue": {"values": [_to_fs_value(x) for x in v]}}
    return {"stringValue": str(v)}


def _patch_doc(doc_path: str, fields: dict) -> dict:
    """PATCH (merge) specific fields (supporting dot notation) onto a Firestore document."""
    nested = {}
    for k, v in fields.items():
        parts = k.split('.')
        curr = nested
        for part in parts[:-1]:
            curr = curr.setdefault(part, {})
        curr[parts[-1]] = v

    fs_fields = {k: _to_fs_value(v) for k, v in nested.items()}
    field_mask = "&".join(f"updateMask.fieldPaths={k}" for k in fields)
    url = f"devices/{doc_path}?{field_mask}"
    return _fs_request("PATCH", url, body={"fields": fs_fields})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# MCP tools
# ---------------------------------------------------------------------------

@mcp.tool()
def s24_status() -> str:
    """Return current state of the S24 Firestore document."""
    primary   = _parse_doc(_fs_request("GET", f"devices/{PRIMARY_DOC}"))

    SAFE_KEYS = {
        "deviceDisplayName", "deviceId", "canonicalDeviceId", "legacyDeviceIds",
        "documentRole", "aliasFor", "lastSeen", "online", "status", "battery",
        "connectionMethod", "syncRequestedAt", "forceSync", "forceWakeup",
        "commandId", "commandPriority", "agentCommand", "wakeupSignal",
        "currentDirectCloudRuntime", "termuxInstallation", "samsungS24DirectSync",
        "commandQueue",
    }

    def _safe(d):
        return {k: v for k, v in d.items() if k in SAFE_KEYS}

    out = {
        "doc": f"devices/{PRIMARY_DOC}",
        "data": _safe(primary),
        "fetched_at": _now_iso(),
    }
    return json.dumps(out, indent=2, default=str)


@mcp.tool()
def s24_sync_now() -> str:
    """Tell the S24 Termux daemon to run a full sync on its next poll cycle."""
    at = _now_iso()
    _patch_doc(PRIMARY_DOC, {
        "forceSync": True,
        "syncRequestedAt": at,
        "agentCommand": "sync-now",
        "wakeupSignal": at,
    })
    return f"forceSync written at {at}. S24 Termux will act on next poll (if running)."


@mcp.tool()
def s24_wakeup() -> str:
    """Write a CRITICAL wakeup signal to both S24 Firestore docs."""
    at = _now_iso()
    cmd_id = f"s24_wakeup_{int(time.time())}"
    _patch_doc(PRIMARY_DOC, {
        "forceWakeup": True,
        "forceSync": True,
        "commandId": cmd_id,
        "commandPriority": "CRITICAL",
        "wakeupSignal": at,
        "syncRequestedAt": at,
        "agentCommand": "wakeup",
    })
    return f"CRITICAL wakeup written (id={cmd_id}) at {at}."


@mcp.tool()
def s24_queue_command(action: str, extra: str = "{}") -> str:
    """
    Append a command to the S24 commandQueue in Firestore.

    action: one of the actions admitted by the S24 runtime contract
    extra:  JSON object string with non-reserved additional fields
    """
    gate = _action_gate(action)
    if gate is not None:
        return f"Error: {gate}"
    try:
        extra_dict = json.loads(extra)
    except json.JSONDecodeError:
        return f"Error: extra must be valid JSON, got: {extra}"
    if not isinstance(extra_dict, dict):
        return "Error: extra must be a JSON object"
    reserved = sorted(RESERVED_COMMAND_PARAMS.intersection(extra_dict))
    if reserved:
        return f"Error: extra may not set reserved command field(s): {', '.join(reserved)}"

    canonical_action = _normalize_action(action)
    qid = f"mcp_{int(time.time())}_{canonical_action.replace(' ', '_')}"
    at  = _now_iso()
    item = {
        "action": canonical_action,
        "status": "pending",
        "requestedAt": at,
        "requestedBy": "claude-mcp-s24-cloud",
        "source": "commandQueue",
        **extra_dict,
    }
    _patch_doc(PRIMARY_DOC, {
        f"commandQueue.{qid}": item,
        "forceWakeup": True,
        "wakeupSignal": at,
    })
    return f"Queued command '{canonical_action}' as {qid} at {at}."


@mcp.tool()
def s24_clear_queue() -> str:
    """Remove all pending commandQueue items from the primary S24 doc."""
    doc = _parse_doc(_fs_request("GET", f"devices/{PRIMARY_DOC}"))
    queue = doc.get("commandQueue") or {}
    cleared = []
    for qid, item in queue.items():
        if isinstance(item, dict) and item.get("status") in ("pending", "queued", "requested"):
            _patch_doc(PRIMARY_DOC, {f"commandQueue.{qid}.status": "cancelled"})
            cleared.append(qid)
    return f"Cancelled {len(cleared)} pending items: {cleared}" if cleared else "No pending items found."


@mcp.tool()
def s24_enable_ssh() -> str:
    """
    Retained for old MCP clients, but the runtime contract forbids inbound SSH.
    """
    return s24_queue_command("start-ssh")


@mcp.tool()
def s24_read_calls(limit: int = 20) -> str:
    """Return the most recent call logs stored in Firestore from the S24."""
    doc = _parse_doc(_fs_request("GET", f"devices/{PRIMARY_DOC}"))
    direct  = doc.get("samsungS24DirectSync", {}).get("callLogs", [])
    cloud   = doc.get("samsungS24CloudSync", {}).get("callLogs", [])
    top     = doc.get("callLogs", [])
    logs = direct or top or cloud
    if not isinstance(logs, list):
        return "No call logs found in Firestore."
    return json.dumps(logs[:limit], indent=2, default=str)


@mcp.tool()
def s24_read_sms(limit: int = 20) -> str:
    """Return the most recent SMS messages stored in Firestore from the S24."""
    doc = _parse_doc(_fs_request("GET", f"devices/{PRIMARY_DOC}"))
    direct  = doc.get("samsungS24DirectSync", {}).get("sms", [])
    cloud   = doc.get("samsungS24CloudSync", {}).get("sms", [])
    top     = doc.get("sms", []) or doc.get("chats", [])
    msgs = direct or top or cloud
    if not isinstance(msgs, list):
        return "No SMS found in Firestore."
    return json.dumps(msgs[:limit], indent=2, default=str)


@mcp.tool()
def s24_read_location() -> str:
    """Return the last known location of the S24 from Firestore."""
    doc = _parse_doc(_fs_request("GET", f"devices/{PRIMARY_DOC}"))
    direct = doc.get("samsungS24DirectSync", {}).get("location", {})
    cloud  = doc.get("samsungS24CloudSync", {}).get("location", {})
    top    = doc.get("location", {})
    loc = direct if direct else (top if top else cloud)
    if not loc:
        return "No location data found in Firestore."
    return json.dumps(loc, indent=2, default=str)


@mcp.tool()
def trigger_wa_sync() -> str:
    """
    Queue the fixed on-device WhatsApp push wrapper.

    The previous implementation placed an arbitrary multiline Python command
    in the queue. That bypassed the action gate and violated the pull-only
    runtime contract even though the script text was locally generated.
    """
    return s24_queue_command("wa-push")


@mcp.tool()
def export_to_desktop(include_calls: bool = True, include_archive: bool = False) -> str:
    """
    Pull WhatsApp chats + call logs from Firestore and save to Desktop.
    Creates one .txt file per contact in C:/Users/abcom/Desktop/WhatsApp Chats/
    and CALL_LOGS.txt.

    include_archive defaults to False so historical Desktop archives are not
    mislabeled as fresh S24 phone data.
    """
    import re
    from pathlib import Path

    OUT_DIR  = Path(r"C:\Users\abcom\Desktop\WhatsApp Chats")
    ARCHIVE  = Path(r"C:\Users\abcom\Desktop\Jayati_WhatsApp_Full_Archive")
    OUT_DIR.mkdir(exist_ok=True)

    IST_OFF = timedelta(hours=5, minutes=30)
    now_ist = datetime.now(timezone.utc).astimezone(timezone(IST_OFF)).strftime("%d/%m/%Y %H:%M IST")

    TS_PATS = [
        re.compile(r'^\[(\d{1,2}/\d{1,2}/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\]\s+(.+?):\s*(.*)'),
        re.compile(r'^(\d{1,2}/\d{1,2}/\d{2,4}),\s*(\d{1,2}:\d{2}(?:\s*[ap]m)?)\s+-\s+(.+?):\s*(.*)'),
    ]
    CALL_RE = re.compile(r'(missed voice call|missed video call|voice call|video call|missed call)', re.I)

    def safe(n): return re.sub(r'[<>:"/\\|?*]', '_', str(n))[:80]

    def parse_msgs(content):
        msgs = []
        for line in content.splitlines():
            for pat in TS_PATS:
                m = pat.match(line.strip())
                if m:
                    msgs.append((m.group(1), m.group(2), m.group(3).strip(), m.group(4).strip()))
                    break
        return msgs

    def dedup(msgs):
        seen, out = set(), []
        for row in msgs:
            k = row[2] + '|' + row[3][:100]
            if k not in seen:
                seen.add(k); out.append(row)
        return out

    def write_chat(name, msgs):
        fname = OUT_DIR / f"{safe(name)}.txt"
        lines = [f"WhatsApp Chat — {name}", f"Messages: {len(msgs)}", "="*60, ""]
        prev = None
        for date, t, sender, body in msgs:
            if date != prev: lines.append(f"\n── {date} ──"); prev = date
            lines.append(f"[{date}, {t}] {sender}:")
            lines.append(f"  {body}")
        fname.write_text('\n'.join(lines), encoding='utf-8')
        return fname

    # ── 1. Load from local archive ────────────────────────────────────────────
    all_chats: dict[str, list] = {}
    archive_rows = 0
    live_rows = 0
    if include_archive and ARCHIVE.exists():
        for contact_dir in sorted(ARCHIVE.iterdir()):
            if not contact_dir.is_dir(): continue
            name = contact_dir.name.strip()
            for txt in contact_dir.glob("*.txt"):
                try:
                    content = txt.read_text(encoding='utf-8', errors='replace')
                    for row in parse_msgs(content):
                        all_chats.setdefault(name, []).append(row)
                        archive_rows += 1
                except Exception: pass

    # ── 2. Load from Firestore (S24 sync) ────────────────────────────────────
    doc = _parse_doc(_fs_request("GET", f"devices/{PRIMARY_DOC}"))
    sync = doc.get("samsungS24DirectSync", {}) or {}
    wa_chats_raw = sync.get("whatsappChats", "")
    if isinstance(wa_chats_raw, str) and wa_chats_raw.startswith('{'):
        try:
            wa_chats_json = json.loads(wa_chats_raw)
            for name, content in wa_chats_json.items():
                for row in parse_msgs(str(content)):
                    all_chats.setdefault(name, []).append(row)
                    live_rows += 1
        except Exception: pass

    # ── 3. Write per-contact files ────────────────────────────────────────────
    wa_calls = []
    written  = 0
    for name, msgs in sorted(all_chats.items()):
        msgs = dedup(msgs)
        if not msgs: continue
        for row in msgs:
            if CALL_RE.search(row[3]):
                wa_calls.append(f"[{row[0]}, {row[1]}] [{name}] {row[2]}: {row[3]}")
        write_chat(name, msgs)
        written += 1

    summary_lines = [
        f"Exported: {written} contacts to {OUT_DIR}",
        f"Timestamp: {now_ist}",
        f"Live Firestore message rows: {live_rows}",
        f"Archive fallback enabled: {include_archive}",
        f"Archive message rows used: {archive_rows}",
    ]

    # ── 4. Call logs ──────────────────────────────────────────────────────────
    if include_calls:
        call_logs = sync.get("callLogs", [])
        if isinstance(call_logs, str):
            try: call_logs = json.loads(call_logs)
            except: call_logs = []

        cl_lines = [
            "COMPLETE CALL LOGS — Samsung S24 + WhatsApp",
            f"Exported: {now_ist}",
            "=" * 70, "",
            f"  Phone call log entries  : {len(call_logs) if isinstance(call_logs, list) else 0}",
            f"  WhatsApp call references: {len(wa_calls)}",
            "",
        ]
        if isinstance(call_logs, list) and call_logs:
            cl_lines += ["── PHONE CALL LOGS ──", ""]
            for c in call_logs:
                if not isinstance(c, dict): continue
                num  = c.get('number','?') or c.get('number','?')
                name = c.get('name','') or c.get('display_name','') or 'Unknown'
                typ  = c.get('type','?') or c.get('call_type','?')
                dur  = c.get('duration',0) or c.get('duration_seconds',0)
                date = c.get('date','') or c.get('timestamp','')
                if str(date).isdigit() and len(str(date)) >= 10:
                    try:
                        ms  = int(str(date)[:13])
                        dt  = datetime.fromtimestamp(ms/1000 if ms > 1e12 else ms, tz=timezone(IST_OFF))
                        date = dt.strftime('%d/%m/%y %H:%M')
                    except: pass
                dur_s = int(float(str(dur or 0)))
                dur_str = f"{dur_s//60}m {dur_s%60}s" if dur_s else "–"
                cl_lines.append(f"  [{date}]  {str(typ):<12}  {dur_str:<10}  {str(name):<30}  {num}")
        else:
            cl_lines += [
                "── PHONE CALL LOGS ──", "",
                "  No phone call logs in Firestore yet.",
                "  Run trigger_wa_sync() to push call logs from S24.",
                "",
            ]
        if wa_calls:
            cl_lines += ["", "── WHATSAPP CALLS ──", ""] + wa_calls[:500]

        cl_path = OUT_DIR / "CALL_LOGS.txt"
        cl_path.write_text('\n'.join(cl_lines), encoding='utf-8')
        summary_lines.append(f"Call logs: {cl_path}")

    # ── 5. Push export summary back to Firestore ──────────────────────────────
    _patch_doc(PRIMARY_DOC, {
        "lastDesktopExport": _now_iso(),
        "lastDesktopExportContacts": written,
    })

    return '\n'.join(summary_lines)


if __name__ == "__main__":
    mcp.run()
