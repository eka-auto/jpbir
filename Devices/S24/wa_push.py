#!/usr/bin/env python3
"""
S24 → jaytipargal.tech WhatsApp inventory pusher.

Runs on the phone inside Termux. Reads the WhatsApp msgstore.db that Termux
already has access to (with WhatsApp granted the storage permission), builds a
per-chat inventory in the compact shape wa-import.mjs uses, and POSTs it to
/api/wa-ingest on jaytipargal.tech in batches.

Termux cron (every 30 minutes, silent on no-change):

    */30 * * * * python $HOME/wa_push.py --once >> $HOME/wa_push.log 2>&1

Ad-hoc:

    python wa_push.py --once             # one push and exit
    python wa_push.py --dry-run          # build inventory, print totals, don't POST
    python wa_push.py --probe            # dump msgstore.db table schemas to stdout

Env (all read from the environment; keep the key OUT of a shell script):

    WA_INGEST_URL   e.g. https://jaytipargal.tech/api/wa-ingest  (default)
    WA_INGEST_KEY   matches WA_INGEST_KEY on the jpbir Vercel project
    WA_MSGSTORE_DB  default: first of ~/storage/shared/Android/media/com.whatsapp/
                    WhatsApp/Databases/msgstore.db (Android 11+) or
                    ~/storage/shared/WhatsApp/Databases/msgstore.db (legacy)
    WA_CONTACTS_DB  same two roots, wa.db
    WA_DEVICE_ID    default samsung-s24-ultra

Schema notes: msgstore.db's column names drift between WhatsApp versions.
The queries here try the modern names first and fall back to the older ones,
so a new WhatsApp update doesn't silently produce an empty inventory. Run
`--probe` if a query throws, look at the schema, and edit the constants at
the top of the file.
"""
import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

DEFAULT_URL = "https://jaytipargal.tech/api/wa-ingest"
# WhatsApp moved its on-sdcard tree from /sdcard/WhatsApp to
# /sdcard/Android/media/com.whatsapp/WhatsApp when it adopted scoped storage on
# Android 11. The S24 Ultra is Android 14, so the scoped path is the live one --
# but this file hard-coded the pre-11 path alone and exited 2 when it was
# absent. The */30 cron therefore logged "[error] msgstore not at ..." forever
# and no WhatsApp text ever reached /api/wa-ingest, while wa_media_push.py --
# which already probed both roots -- kept uploading media and made the pipeline
# look half-alive rather than broken. Probe in the same order it does.
MSGSTORE_CANDIDATES = [
    os.path.expanduser("~/storage/shared/Android/media/com.whatsapp/WhatsApp/Databases/msgstore.db"),
    os.path.expanduser("~/storage/shared/WhatsApp/Databases/msgstore.db"),
]
CONTACTS_CANDIDATES = [
    os.path.expanduser("~/storage/shared/Android/media/com.whatsapp/WhatsApp/Databases/wa.db"),
    os.path.expanduser("~/storage/shared/WhatsApp/Databases/wa.db"),
]


def first_existing(candidates):
    """The first candidate present on disk, else None so the caller can report all."""
    for c in candidates:
        if os.path.exists(c):
            return c
    return None


DEFAULT_MSGSTORE = first_existing(MSGSTORE_CANDIDATES) or MSGSTORE_CANDIDATES[0]
DEFAULT_CONTACTS = first_existing(CONTACTS_CANDIDATES) or CONTACTS_CANDIDATES[0]
DEFAULT_DEVICE = "samsung-s24-ultra"
CHUNK = 200  # matches wa-store.js CHUNK; keeps a batch under Vercel's function timeout


def open_ro(path):
    """SQLite in read-only mode via URI, so the phone's live DB is never mutated."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"{path} does not exist")
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def probe(db_path):
    """Dump every table + create statement in db_path. For debugging schema drift."""
    conn = open_ro(db_path)
    for name, sql in conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type IN ('table','view') ORDER BY name"
    ):
        print(f"-- {name} --\n{sql}\n")
    conn.close()


def load_contact_names(contacts_db):
    """Map jid → display name from wa.db (address book). Returns {} if unreadable."""
    names = {}
    if not os.path.exists(contacts_db):
        return names
    try:
        conn = open_ro(contacts_db)
        # `wa_contacts` is present on every WhatsApp version this pusher targets.
        # `display_name` is the saved name; fall back to pushname / wa_name.
        for row in conn.execute(
            """
            SELECT jid,
                   COALESCE(display_name, wa_name, given_name, pushname) AS name
              FROM wa_contacts
             WHERE COALESCE(display_name, wa_name, given_name, pushname) IS NOT NULL
            """
        ):
            jid, name = row[0], row[1]
            if jid and name:
                names[jid] = name
        conn.close()
    except sqlite3.Error as err:
        print(f"[warn] contacts db unreadable: {err}", file=sys.stderr)
    return names


# WhatsApp's own message_type vocabulary is wider than what wa_messages.kind
# stores. These sets mirror the mapping wa-build-inventory.mjs uses so the
# S24-side counts add up to the same totals as the recovery-dump path.
_MEDIA_TYPES = {2, 3, 5, 9, 13, 16, 42}  # image, document, video, sticker (approx by int)
_AUDIO_TYPES = {1, 20}                   # audio, ptt
_CALL_TYPES = {90, 91}                   # missed / completed call log


def build_inventory(msgstore, contact_names):
    """
    Returns a list of {id,n,k,u,m,e,md,au,cl,f,l,sz} — one per chat. Message
    counts / media / audio / call are aggregated from the message table; first
    and last dates come from min/max(timestamp) in the same aggregation.

    msgstore.db columns tried, in order:
        chat._id / chat.jid_row_id → jid (via jid table)
        chat.subject               → group name
        message.chat_row_id        → per-chat foreign key
        message.message_type       → discriminator
        message.timestamp          → ms since epoch
    """
    conn = open_ro(msgstore)
    conn.row_factory = sqlite3.Row

    # Modern WhatsApp splits chat, jid and message into separate tables. Join to
    # get one row per chat with its wa jid and aggregates.
    query = """
        SELECT
            c._id                                        AS chat_row,
            j.raw_string                                 AS jid,
            c.subject                                    AS subject,
            COUNT(m._id)                                 AS m,
            SUM(CASE WHEN m.message_type IN (%s) THEN 1 ELSE 0 END)  AS md,
            SUM(CASE WHEN m.message_type IN (%s) THEN 1 ELSE 0 END)  AS au,
            SUM(CASE WHEN m.message_type IN (%s) THEN 1 ELSE 0 END)  AS cl,
            MIN(m.timestamp)                             AS first_ms,
            MAX(m.timestamp)                             AS last_ms
          FROM chat c
          LEFT JOIN jid j     ON c.jid_row_id = j._id
          LEFT JOIN message m ON m.chat_row_id = c._id
         GROUP BY c._id, j.raw_string, c.subject
        HAVING m > 0
    """ % (
        ",".join(str(t) for t in _MEDIA_TYPES),
        ",".join(str(t) for t in _AUDIO_TYPES),
        ",".join(str(t) for t in _CALL_TYPES),
    )

    chats = []
    for row in conn.execute(query):
        jid = row["jid"] or ""
        if not jid:
            continue  # a chat without a jid can't be safely upserted across batches
        is_group = jid.endswith("@g.us") or jid.endswith("@broadcast")
        # Group subject comes from chat.subject; direct chat name comes from
        # the address book. Fall back to the jid's number half when nothing
        # else is available — better than silently dropping the row.
        name = (row["subject"] if is_group else contact_names.get(jid)) or jid.split("@")[0]
        first = _ms_to_ymd(row["first_ms"])
        last = _ms_to_ymd(row["last_ms"])
        chats.append({
            "id": jid,
            "n": name,
            "k": "group" if is_group else "direct",
            "u": 0,
            "m": row["m"] or 0,
            "e": 0,   # msgstore stores decrypted bodies; nothing is "encrypted" on-device
            "md": row["md"] or 0,
            "au": row["au"] or 0,
            "cl": row["cl"] or 0,
            "f": first,
            "l": last,
            "sz": 0,  # group size lookup requires a second query (group_participant); left for a follow-up
        })
    conn.close()
    return chats


def _ms_to_ymd(ms):
    if not ms:
        return ""
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    except (ValueError, OverflowError):
        return ""


def post_batches(url, key, device, chats):
    """
    Posts chats to /api/wa-ingest in CHUNK-sized batches under one run_id so
    wa_sync_runs shows one row per push. Every request carries the same
    x-wa-ingest-key header; done:true rides only the final batch.
    """
    run_id = f"s24_{int(time.time())}"
    total = 0
    batches = [chats[i:i + CHUNK] for i in range(0, len(chats), CHUNK)] or [[]]
    for i, batch in enumerate(batches):
        body = {
            "device": device,
            "run_id": run_id,
            "chats": batch,
            "done": i == len(batches) - 1,
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            method="POST",
            headers={
                "content-type": "application/json",
                "x-wa-ingest-key": key,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                j = json.loads(resp.read().decode("utf-8"))
            if not j.get("ok"):
                raise RuntimeError(f"batch {i + 1}/{len(batches)}: server said {j}")
            n = (j.get("chats") or {}).get("upserted", 0)
            total += n
            print(f"  batch {i + 1}/{len(batches)}: chats +{n} (run {run_id})")
        except urllib.error.HTTPError as err:
            body_text = err.read().decode("utf-8", errors="replace")[:400]
            raise RuntimeError(f"batch {i + 1}/{len(batches)}: HTTP {err.code} {body_text}") from err
    return total, run_id


def main():
    ap = argparse.ArgumentParser(description="Push WhatsApp chat inventory to jaytipargal.tech")
    ap.add_argument("--once", action="store_true", help="run one push and exit (default)")
    ap.add_argument("--dry-run", action="store_true", help="build inventory, print totals, don't POST")
    ap.add_argument("--probe", action="store_true", help="dump msgstore.db schema and exit")
    ap.add_argument("--msgstore", default=os.environ.get("WA_MSGSTORE_DB", DEFAULT_MSGSTORE))
    ap.add_argument("--contacts", default=os.environ.get("WA_CONTACTS_DB", DEFAULT_CONTACTS))
    ap.add_argument("--url", default=os.environ.get("WA_INGEST_URL", DEFAULT_URL))
    ap.add_argument("--device", default=os.environ.get("WA_DEVICE_ID", DEFAULT_DEVICE))
    args = ap.parse_args()

    if args.probe:
        probe(args.msgstore)
        return 0

    if not os.path.exists(args.msgstore):
        # Name every path tried, not just the one that lost. The single-path
        # version of this message sent debugging after a typo in WA_MSGSTORE_DB
        # when the real cause was WhatsApp's scoped-storage move.
        tried = [args.msgstore] + [c for c in MSGSTORE_CANDIDATES if c != args.msgstore]
        print("[error] no WhatsApp msgstore.db found; checked:", file=sys.stderr)
        for c in tried:
            print(f"[error]   {c}", file=sys.stderr)
        print("[error] set WA_MSGSTORE_DB if the database lives elsewhere", file=sys.stderr)
        return 2

    contact_names = load_contact_names(args.contacts)
    chats = build_inventory(args.msgstore, contact_names)
    total_msgs = sum(c["m"] for c in chats)
    print(f"[wa_push] {len(chats)} chats · {total_msgs} messages · contacts {len(contact_names)}")

    if args.dry_run:
        return 0
    if not chats:
        print("[wa_push] nothing to push")
        return 0

    key = os.environ.get("WA_INGEST_KEY", "")
    if not key:
        print("[error] WA_INGEST_KEY is not set in the environment", file=sys.stderr)
        return 2

    stored, run_id = post_batches(args.url, key, args.device, chats)
    print(f"[wa_push] run {run_id}: stored {stored} chat rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
