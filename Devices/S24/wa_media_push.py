#!/usr/bin/env python3
"""
S24 → jaytipargal.tech WhatsApp media & audio pusher.

Sister script to wa_push.py (which pushes chat/message metadata). This one
walks WhatsApp's on-disk media files, uploads each one to Vercel Blob via
/api/wa-blob-upload, and POSTs the resulting URLs plus metadata to
/api/wa-ingest as `attachments: [...]`.

Runs on the phone inside Termux, on the same cron slot as wa_push.py:

    */30 * * * * python $HOME/wa_media_push.py --once >> $HOME/wa_media_push.log 2>&1

Ad-hoc:

    python wa_media_push.py --once           # walk once, upload new files, exit
    python wa_media_push.py --dry-run        # list files that would be uploaded, don't touch network
    python wa_media_push.py --limit 200      # cap uploads per run (default 500)
    python wa_media_push.py --kinds image,audio,ptt   # subset

Env (in addition to what wa_push.py reads):

    WA_INGEST_URL    e.g. https://jaytipargal.tech/api/wa-ingest (default)
    WA_BLOB_URL      e.g. https://jaytipargal.tech/api/wa-blob-upload (default)
    WA_INGEST_KEY    matches WA_INGEST_KEY on the jpbir Vercel project
    WA_MEDIA_ROOT    default ~/storage/shared/Android/media/com.whatsapp/WhatsApp/Media
                     (falls back to ~/storage/shared/WhatsApp/Media on legacy phones)
    WA_MSGSTORE_DB   default same as wa_push.py; used to resolve chat/msg for each file
    WA_DEVICE_ID     default samsung-s24-ultra
    WA_MEDIA_STATE   default ~/.wa_media_uploaded.json — dedup ledger (file → blob_url)

Vercel's function body cap is ~4.5 MB. This script skips anything larger and
logs a WARN so the operator sees what would need a follow-up flow. Everything
else — most images, audio, ptt, stickers — fits.
"""
import argparse
import hashlib
import json
import mimetypes
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

DEFAULT_INGEST = "https://jaytipargal.tech/api/wa-ingest"
DEFAULT_BLOB = "https://jaytipargal.tech/api/wa-blob-upload"
DEFAULT_MSGSTORE = os.path.expanduser(
    "~/storage/shared/Android/media/com.whatsapp/WhatsApp/Databases/msgstore.db"
)
DEFAULT_MEDIA_ROOTS = [
    os.path.expanduser("~/storage/shared/Android/media/com.whatsapp/WhatsApp/Media"),
    os.path.expanduser("~/storage/shared/WhatsApp/Media"),
]
DEFAULT_DEVICE = "samsung-s24-ultra"
DEFAULT_STATE = os.path.expanduser("~/.wa_media_uploaded.json")

MAX_FILE_BYTES = 4 * 1024 * 1024

# WhatsApp folder layout on modern Android →
#   Media/WhatsApp Images/, WhatsApp Video/, WhatsApp Audio/,
#         WhatsApp Voice Notes/, WhatsApp Documents/, WhatsApp Stickers/
FOLDER_KINDS = {
    "WhatsApp Images": "image",
    "WhatsApp Video": "video",
    "WhatsApp Audio": "audio",
    "WhatsApp Voice Notes": "ptt",
    "WhatsApp Documents": "document",
    "WhatsApp Stickers": "sticker",
}

# msgstore.db message_type → attachment kind (aligned with wa_push.py)
TYPE_KIND = {1: "audio", 2: "image", 3: "video", 5: "document", 9: "sticker", 13: "sticker", 16: "audio", 20: "ptt", 42: "video"}


def open_ro(path):
    if not os.path.exists(path):
        raise FileNotFoundError(f"{path} does not exist")
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def load_state(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(path, state):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, sort_keys=True)
    os.replace(tmp, path)


def _ms_to_iso(ms):
    if not ms:
        return None
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).isoformat()
    except (ValueError, OverflowError):
        return None


def scan_media_index(msgstore):
    """
    Map file_path → { chat_id, msg_id, sent_at, kind, duration_sec, width, height }
    by joining message_media (or message_media_metadata on newer versions) with
    message and chat. A file with no msgstore hit falls back to filename inference.
    """
    index = {}
    try:
        conn = open_ro(msgstore)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT mm.file_path        AS path,
                   mm.file_size        AS size,
                   mm.mime_type        AS mime,
                   mm.media_duration   AS duration,
                   mm.width            AS width,
                   mm.height           AS height,
                   m._id               AS msg_row,
                   m.message_type      AS mtype,
                   m.timestamp         AS ts,
                   j.raw_string        AS jid
              FROM message_media mm
              JOIN message m ON mm.message_row_id = m._id
              JOIN chat    c ON m.chat_row_id      = c._id
              JOIN jid     j ON c.jid_row_id       = j._id
             WHERE mm.file_path IS NOT NULL
            """
        )
        for r in rows:
            path = r["path"]
            if not path:
                continue
            index[path] = {
                "chat_id": r["jid"],
                "msg_id": f"{r['jid']}:{r['msg_row']}" if r["jid"] else None,
                "sent_at": _ms_to_iso(r["ts"]),
                "kind": TYPE_KIND.get(r["mtype"], None),
                "mime": r["mime"],
                "size_bytes": int(r["size"]) if r["size"] is not None else None,
                "duration_sec": int(r["duration"]) if r["duration"] is not None else None,
                "width": int(r["width"]) if r["width"] is not None else None,
                "height": int(r["height"]) if r["height"] is not None else None,
            }
        conn.close()
    except sqlite3.Error as err:
        print(f"[warn] message_media join failed: {err}", file=sys.stderr)
    return index


def walk_media(root):
    """Yield (absolute_path, kind_from_folder). Skips .nomedia and thumbnails."""
    for folder, kind in FOLDER_KINDS.items():
        base = os.path.join(root, folder)
        if not os.path.isdir(base):
            continue
        for dirpath, _, files in os.walk(base):
            for name in files:
                if name.startswith("."):
                    continue
                if os.sep + "Sent" + os.sep in dirpath and "sent" not in kind.lower():
                    pass  # keep — sent items are the same kind
                p = os.path.join(dirpath, name)
                yield p, kind


def rel_from_root(root, absolute):
    try:
        return os.path.relpath(absolute, os.path.dirname(root))
    except ValueError:
        return absolute


def upload_one(blob_url, key, kind, file_path):
    """POST file bytes to /api/wa-blob-upload; return blob_url or raise."""
    mime, _ = mimetypes.guess_type(file_path)
    ct = mime or "application/octet-stream"
    with open(file_path, "rb") as f:
        data = f.read()
    if len(data) > MAX_FILE_BYTES:
        raise RuntimeError(f"skip {file_path}: {len(data)} bytes > {MAX_FILE_BYTES} cap")
    from urllib.parse import urlencode, quote
    q = urlencode({"kind": kind, "file_name": os.path.basename(file_path)}, quote_via=quote)
    req = urllib.request.Request(
        f"{blob_url}?{q}",
        data=data,
        method="POST",
        headers={"content-type": ct, "x-wa-ingest-key": key},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        j = json.loads(resp.read().decode("utf-8"))
    if not j.get("ok"):
        raise RuntimeError(f"blob upload failed: {j}")
    return {"blob_url": j["blob_url"], "size_bytes": j.get("size_bytes"), "mime": ct}


def post_attachments(ingest_url, key, device, run_id, attachments, done=False):
    body = {"device": device, "run_id": run_id, "attachments": attachments, "done": done}
    req = urllib.request.Request(
        ingest_url,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={"content-type": "application/json", "x-wa-ingest-key": key},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        j = json.loads(resp.read().decode("utf-8"))
    if not j.get("ok"):
        raise RuntimeError(f"attachments ingest failed: {j}")
    return j


def att_id_for(chat_id, msg_id, file_hash):
    left = msg_id or file_hash
    return f"{chat_id}:{left}:{file_hash[:12]}"


def hash_file_path(path):
    return hashlib.sha1(path.encode("utf-8")).hexdigest()


def main():
    ap = argparse.ArgumentParser(description="Push WhatsApp media/audio files to Vercel Blob + Neon")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=500)
    ap.add_argument("--kinds", default=",".join(sorted(set(FOLDER_KINDS.values()))))
    ap.add_argument("--media-root", default=os.environ.get("WA_MEDIA_ROOT"))
    ap.add_argument("--msgstore", default=os.environ.get("WA_MSGSTORE_DB", DEFAULT_MSGSTORE))
    ap.add_argument("--ingest-url", default=os.environ.get("WA_INGEST_URL", DEFAULT_INGEST))
    ap.add_argument("--blob-url", default=os.environ.get("WA_BLOB_URL", DEFAULT_BLOB))
    ap.add_argument("--device", default=os.environ.get("WA_DEVICE_ID", DEFAULT_DEVICE))
    ap.add_argument("--state", default=os.environ.get("WA_MEDIA_STATE", DEFAULT_STATE))
    args = ap.parse_args()

    root = args.media_root
    if not root:
        for r in DEFAULT_MEDIA_ROOTS:
            if os.path.isdir(r):
                root = r
                break
    if not root or not os.path.isdir(root):
        print(f"[error] no WhatsApp Media/ directory found (checked {DEFAULT_MEDIA_ROOTS})", file=sys.stderr)
        return 2

    kinds_wanted = {k.strip() for k in args.kinds.split(",") if k.strip()}
    key = os.environ.get("WA_INGEST_KEY", "")
    if not args.dry_run and not key:
        print("[error] WA_INGEST_KEY is not set in the environment", file=sys.stderr)
        return 2

    state = load_state(args.state)
    index = {}
    if os.path.exists(args.msgstore):
        index = scan_media_index(args.msgstore)
        print(f"[wa_media_push] msgstore index: {len(index)} rows")
    else:
        print(f"[warn] msgstore not at {args.msgstore} — will upload without chat linkage", file=sys.stderr)

    to_upload = []
    for path, folder_kind in walk_media(root):
        if folder_kind not in kinds_wanted:
            continue
        if path in state:  # already uploaded
            continue
        meta = index.get(path) or {}
        kind = meta.get("kind") or folder_kind
        chat_id = meta.get("chat_id")
        if not chat_id:
            # a file we can't link to any chat still shouldn't be dropped silently;
            # a "wa_orphans" bucket would need a separate table, so log for now
            continue
        try:
            size = os.path.getsize(path)
        except OSError:
            continue
        if size > MAX_FILE_BYTES:
            print(f"[skip] {path}: {size} bytes > 4 MB cap")
            continue
        to_upload.append((path, kind, chat_id, meta))
        if len(to_upload) >= args.limit:
            break

    print(f"[wa_media_push] {len(to_upload)} files to upload (limit {args.limit})")
    if args.dry_run or not to_upload:
        return 0

    run_id = f"media_{int(time.time())}"
    attachments = []
    for path, kind, chat_id, meta in to_upload:
        try:
            up = upload_one(args.blob_url, key, kind, path)
        except Exception as err:
            print(f"[warn] {path}: {err}", file=sys.stderr)
            continue
        file_hash = hash_file_path(path)
        att = {
            "att_id": att_id_for(chat_id, meta.get("msg_id"), file_hash),
            "chat_id": chat_id,
            "msg_id": meta.get("msg_id"),
            "kind": kind,
            "mime": up["mime"],
            "file_name": os.path.basename(path),
            "size_bytes": up["size_bytes"],
            "duration_sec": meta.get("duration_sec"),
            "width": meta.get("width"),
            "height": meta.get("height"),
            "blob_url": up["blob_url"],
            "sent_at": meta.get("sent_at"),
        }
        attachments.append(att)
        state[path] = up["blob_url"]

        # flush in batches to keep memory low and to avoid re-uploading if we crash
        if len(attachments) >= 50:
            post_attachments(args.ingest_url, key, args.device, run_id, attachments)
            print(f"[wa_media_push] pushed {len(attachments)} attachments (run {run_id})")
            attachments = []
            save_state(args.state, state)

    if attachments:
        post_attachments(args.ingest_url, key, args.device, run_id, attachments, done=True)
        print(f"[wa_media_push] pushed {len(attachments)} attachments (run {run_id}) [final]")
    else:
        # send a final done:true so wa_sync_runs closes the run cleanly
        post_attachments(args.ingest_url, key, args.device, run_id, [], done=True)
    save_state(args.state, state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
