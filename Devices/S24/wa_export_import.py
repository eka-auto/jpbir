#!/usr/bin/env python3
"""
S24 → jaytipargal.tech WhatsApp chat-export importer (path 2/3).

Parses the .txt files WhatsApp produces when you tap "Export chat" and
posts the message bodies to /api/wa-ingest as `messages: [...]`. Bodies
land in wa_messages.body; the dashboard drill-down flips
`bodies.available` true once the first chat has ≥1 imported body and
grows a scrollable message list (added in Frontend/index.html here).

Where the txt files come from:
  WhatsApp app → open a chat → menu (⋮) → More → Export chat
  → "Without Media" → save into ~/wa-exports/ on the phone (via Termux
  storage, Files app, or Share to Termux). The filename is up to you.

Two ways to tell the script which WhatsApp chat a file belongs to:

  A) One-off:  python wa_export_import.py --file family.txt \
                    --chat-id 120363047062981104@g.us

  B) Folder + mapping.json (recommended for cron):
     ~/wa-exports/mapping.json
         {
           "WhatsApp Chat with John Doe.txt": "919254228280@c.us",
           "family.txt": "120363047062981104@g.us"
         }
     python wa_export_import.py --dir ~/wa-exports

Env (in addition to the WA_INGEST_* the other scripts use):

  WA_INGEST_URL   default https://jaytipargal.tech/api/wa-ingest
  WA_INGEST_KEY   matches WA_INGEST_KEY on the jpbir Vercel project
  WA_EXPORT_DIR   default ~/wa-exports
  WA_ME_NAME      your own display name as it appears in exports, so
                  from_me can be set correctly. Multiple aliases comma-separated.

Cron slot (every 30 minutes, same as the sister scripts):

  */30 * * * * python $HOME/wa_export_import.py --dir $HOME/wa-exports \
                  --once >> $HOME/wa_export_import.log 2>&1

Idempotent: msg_id is `<chat_id>:exp:<line-hash>` so a re-run of the
same file writes the same rows and any new lines append cleanly. A
processed file is not deleted — it stays in the folder as an archive.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

DEFAULT_INGEST = "https://jaytipargal.tech/api/wa-ingest"
DEFAULT_DIR = os.path.expanduser("~/wa-exports")
CHUNK = 400  # matches CHUNK * 2 in wa-store.js so we stay under 10s server timeout

# WhatsApp exports come in two shapes seen in the wild. The first is what
# modern WhatsApp writes; the second is a fallback for older exports.
#   [16/06/24, 3:45:12 PM] John Doe: Hello
#   16/06/24, 3:45 PM - John Doe: Hello
_LINE_MODERN = re.compile(
    r"^\[?(?P<date>\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}),\s*"
    r"(?P<time>\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\]?\s*[-–]?\s*"
    r"(?P<sender>[^:]{1,120}?):\s*(?P<body>.*)$"
)

# In-body markers that WhatsApp writes for non-text messages when you
# export "Without Media". Map them to wa_messages.kind.
_KIND_MARKERS = [
    (re.compile(r"<Media omitted>", re.I), "media"),
    (re.compile(r"image omitted", re.I), "media"),
    (re.compile(r"video omitted", re.I), "media"),
    (re.compile(r"GIF omitted", re.I), "media"),
    (re.compile(r"sticker omitted", re.I), "media"),
    (re.compile(r"document omitted", re.I), "media"),
    (re.compile(r"audio omitted", re.I), "audio"),
    (re.compile(r"voice message omitted", re.I), "audio"),
    (re.compile(r"missed voice call", re.I), "call"),
    (re.compile(r"missed video call", re.I), "call"),
    (re.compile(r"video call", re.I), "call"),
    (re.compile(r"voice call", re.I), "call"),
]


def parse_date_time(date_s, time_s):
    """Return an ISO 8601 UTC string, or None if the date/time can't be parsed."""
    date_s = date_s.strip().replace("-", "/")
    time_s = time_s.strip().replace(" ", " ")
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", date_s)
    if not m:
        return None
    d, mo, y = (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    if y < 100:
        y += 2000
    # WhatsApp uses locale-specific date order; the S24 in India writes DD/MM/YY,
    # so d = day, mo = month. If a US-locale export lands here we misread by a
    # month for ambiguous days — a follow-up flag can override.
    tm = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$", time_s)
    if not tm:
        return None
    hr, mi, se, ap = (int(tm.group(1)), int(tm.group(2)), int(tm.group(3) or 0), tm.group(4))
    if ap:
        ap = ap.upper()
        if ap == "PM" and hr != 12:
            hr += 12
        elif ap == "AM" and hr == 12:
            hr = 0
    try:
        dt = datetime(y, mo, d, hr, mi, se, tzinfo=timezone.utc)
    except ValueError:
        return None
    return dt.isoformat()


def guess_kind(body):
    for pat, kind in _KIND_MARKERS:
        if pat.search(body or ""):
            return kind
    return "text"


def parse_export(path, me_aliases):
    """
    Yield {key, sent_at, sender, from_me, kind, body} for each message.
    Continuation lines (no timestamp at the start) attach to the previous
    message's body; that is how WhatsApp writes multi-line messages.
    """
    current = None
    line_no = 0
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for raw in f:
            line_no += 1
            line = raw.rstrip("\n").lstrip("﻿")
            m = _LINE_MODERN.match(line)
            if m:
                if current is not None:
                    yield current
                sent_at = parse_date_time(m.group("date"), m.group("time"))
                sender = m.group("sender").strip()
                body = m.group("body")
                kind = guess_kind(body)
                key = "exp:" + hashlib.sha1(f"{path}:{line_no}".encode("utf-8")).hexdigest()[:16]
                current = {
                    "key": key,
                    "sent_at": sent_at,
                    "sender": sender,
                    "from_me": sender in me_aliases if me_aliases else None,
                    "kind": kind,
                    "body": body,
                }
            else:
                if current is not None and line.strip():
                    current["body"] = (current["body"] + "\n" + line).strip()
    if current is not None:
        yield current


def post_messages(url, key, device, run_id, chat_id, messages, done=False):
    """Push a batch of parsed messages under one chat_id."""
    body = {
        "device": device,
        "run_id": run_id,
        "chat_id": chat_id,
        "messages": messages,
        "done": done,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={"content-type": "application/json", "x-wa-ingest-key": key},
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        j = json.loads(resp.read().decode("utf-8"))
    if not j.get("ok"):
        raise RuntimeError(f"messages ingest failed: {j}")
    return j


def import_file(path, chat_id, me_aliases, url, key, device, run_id, dry_run=False):
    messages = list(parse_export(path, me_aliases))
    print(f"[wa_export_import] {os.path.basename(path)}: {len(messages)} messages for {chat_id}")
    if dry_run or not messages:
        return len(messages), 0
    stored = 0
    for i in range(0, len(messages), CHUNK):
        batch = messages[i:i + CHUNK]
        done = i + CHUNK >= len(messages)
        j = post_messages(url, key, device, run_id, chat_id, batch, done=done)
        stored += (j.get("messages") or {}).get("upserted", 0)
        print(f"  batch {i // CHUNK + 1}/{(len(messages) + CHUNK - 1) // CHUNK}: stored {(j.get('messages') or {}).get('upserted', 0)}")
    return len(messages), stored


def main():
    ap = argparse.ArgumentParser(description="Import WhatsApp Chat Export .txt files into wa_messages.body")
    ap.add_argument("--file", help="one export to import (needs --chat-id)")
    ap.add_argument("--chat-id", help="jid the file belongs to (with --file)")
    ap.add_argument("--dir", default=os.environ.get("WA_EXPORT_DIR", DEFAULT_DIR),
                    help="folder of exports; needs a mapping.json alongside")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--ingest-url", default=os.environ.get("WA_INGEST_URL", DEFAULT_INGEST))
    ap.add_argument("--device", default=os.environ.get("WA_DEVICE_ID", "samsung-s24-ultra"))
    ap.add_argument("--me", default=os.environ.get("WA_ME_NAME", ""),
                    help="your display name(s) in exports, comma-separated, so from_me is set")
    args = ap.parse_args()

    key = os.environ.get("WA_INGEST_KEY", "")
    if not args.dry_run and not key:
        print("[error] WA_INGEST_KEY not set", file=sys.stderr)
        return 2

    me_aliases = {n.strip() for n in (args.me or "").split(",") if n.strip()}
    run_id = f"export_{int(time.time())}"

    if args.file:
        if not args.chat_id:
            print("[error] --file needs --chat-id", file=sys.stderr)
            return 2
        _, stored = import_file(args.file, args.chat_id, me_aliases, args.ingest_url, key, args.device, run_id, args.dry_run)
        print(f"[wa_export_import] run {run_id}: stored {stored} messages")
        return 0

    if not os.path.isdir(args.dir):
        print(f"[error] no exports directory at {args.dir}", file=sys.stderr)
        return 2
    mapping_path = os.path.join(args.dir, "mapping.json")
    if not os.path.exists(mapping_path):
        print(f"[error] {mapping_path} missing — create it with {{ \"exports.txt\": \"jid\" }} pairs", file=sys.stderr)
        return 2
    with open(mapping_path, "r", encoding="utf-8") as f:
        mapping = json.load(f)
    if not isinstance(mapping, dict) or not mapping:
        print("[error] mapping.json must be a non-empty object of { filename: chat_id }", file=sys.stderr)
        return 2

    total_msgs = 0
    total_stored = 0
    for fname, chat_id in mapping.items():
        path = os.path.join(args.dir, fname)
        if not os.path.exists(path):
            print(f"[skip] {fname}: not found in {args.dir}")
            continue
        n, stored = import_file(path, chat_id, me_aliases, args.ingest_url, key, args.device, run_id, args.dry_run)
        total_msgs += n
        total_stored += stored
    print(f"[wa_export_import] run {run_id}: parsed {total_msgs}, stored {total_stored}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
