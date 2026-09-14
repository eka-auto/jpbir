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
            raw = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    # A state file holding a list, a string or null is not a state file, and
    # taking it at face value would fail on .items() below — after uploads had
    # already happened and their URLs had nowhere to be recorded.
    if not isinstance(raw, dict):
        return {}
    # Entries used to be a bare blob_url string. Keep those readable, with no
    # identity recorded, so an upgrade does not re-upload the whole library.
    out = {}
    for path_key, value in raw.items():
        if isinstance(value, str):
            out[path_key] = {"url": value, "size": None, "mtime": None}
        elif isinstance(value, dict):
            out[path_key] = value
    return out


def file_identity(path):
    """Size and mtime, so a file replaced or completed in place is noticed."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    return {"size": st.st_size, "mtime": int(st.st_mtime)}


def already_uploaded(state, path):
    """True only when this exact content was uploaded before.

    Keying on the pathname alone meant a file that was replaced or finished
    downloading after its first sighting kept pointing at stale or partial
    Blob content, forever.
    """
    entry = state.get(path)
    if not entry or not entry.get("url"):
        return False
    # Uploaded to Blob but never confirmed stored by the ingest — usually a
    # chat that had not synced yet, so the row was filtered. These have to be
    # retried. Checking identity first would have sent them down the
    # "size is None" path below and skipped them for good, which is the very
    # bug the two-stage state was added to fix.
    if entry.get("synced") is False:
        return False
    ident = file_identity(path)
    if ident is None:
        return True                      # unreadable now; nothing to re-upload
    if entry.get("size") is None:
        # A legacy entry: a URL from before identities were recorded. Stamp the
        # current identity so any later replacement is noticed, instead of this
        # path being skipped forever. A file replaced BEFORE the upgrade cannot
        # be detected — there is nothing to compare it against.
        entry["size"], entry["mtime"] = ident["size"], ident["mtime"]
        state[path] = entry
        return True
    return entry.get("size") == ident["size"] and entry.get("mtime") == ident["mtime"]


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
    # Each upload can block for the urlopen timeout, so an unresponsive endpoint
    # could keep one run alive for hours and let the next cron tick start a
    # second uploader beside it. The run stops at this deadline instead and
    # picks up where it left off next time.
    ap.add_argument("--max-seconds", type=int, default=600)
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
    unlinked = 0
    for path, folder_kind in walk_media(root):
        if folder_kind not in kinds_wanted:
            continue
        if already_uploaded(state, path):
            continue
        meta = index.get(path) or {}
        kind = meta.get("kind") or folder_kind
        chat_id = meta.get("chat_id")
        if not chat_id:
            # wa_attachments.chat_id is NOT NULL REFERENCES wa_chats, so a file
            # we cannot link to a chat has nowhere to go — the row would be
            # rejected. Count them and say so at the end rather than dropping
            # them silently, which made a missing msgstore look like a clean
            # run that simply had nothing to do.
            unlinked += 1
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

    if unlinked:
        print(f"[warn] {unlinked} file(s) have no chat in msgstore and cannot be stored "
              f"(wa_attachments.chat_id is NOT NULL) — "
              f"{'msgstore is missing' if not index else 'no msgstore row matched'}",
              file=sys.stderr)
    print(f"[wa_media_push] {len(to_upload)} files to upload (limit {args.limit})")
    if args.dry_run or not to_upload:
        return 0

    run_id = f"media_{int(time.time())}"
    deadline = time.time() + max(30, args.max_seconds)
    attachments = []
    pending = []          # (path, identity) for the rows in `attachments`
    stored = 0
    stopped_early = False

    def flush(done=False):
        """Push a batch, and only then record its files as uploaded.

        Two separate bugs lived here. State was written the moment a Blob
        upload returned, so a file whose chat was not yet in wa_chats — the
        ingest drops those rows — was marked done forever and never retried.
        And a failed post threw the just-uploaded URL away, so the next run
        re-uploaded the same bytes under a fresh random Blob path, orphaning
        the old one. Now the URL is saved either way, and `synced` only turns
        true once the server confirms how many rows it actually stored.
        """
        nonlocal attachments, pending, stored
        if not attachments and not done:
            return True
        try:
            resp = post_attachments(args.ingest_url, key, args.device, run_id, attachments, done=done) or {}
        except Exception as err:
            print(f"[warn] ingest failed for {len(attachments)} attachment(s): {err}", file=sys.stderr)
            # Keep the Blob URLs so a retry reuses them instead of re-uploading,
            # but leave them unsynced so they are retried.
            for path_key, ident in pending:
                entry = state.get(path_key) or {}
                entry["synced"] = False
                state[path_key] = entry
            save_state(args.state, state)
            attachments, pending = [], []
            return False

        written = resp.get("attachments") or {}
        upserted = written.get("upserted")
        if upserted is None:
            upserted = len(attachments)
        # Fewer rows back than sent means the ingest filtered some — almost
        # always a chat that has not synced yet. Those stay unsynced so a later
        # run retries them once their chat exists.
        confirmed = upserted >= len(attachments)
        for path_key, ident in pending:
            entry = state.get(path_key) or {}
            entry["synced"] = bool(confirmed)
            if confirmed and ident:
                entry["size"], entry["mtime"] = ident["size"], ident["mtime"]
            state[path_key] = entry
        stored += int(upserted or 0)
        if not confirmed:
            print(f"[warn] ingest stored {upserted} of {len(attachments)} attachment(s); "
                  f"the rest will be retried once their chats sync", file=sys.stderr)
        save_state(args.state, state)
        attachments, pending = [], []
        return True

    for path, kind, chat_id, meta in to_upload:
        if time.time() >= deadline:
            stopped_early = True
            print(f"[wa_media_push] stopping at the {args.max_seconds}s budget; "
                  f"the rest run next tick", file=sys.stderr)
            break
        ident = file_identity(path)
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
        pending.append((path, ident))
        # The URL is recorded before the push so a crash cannot lose it; the
        # file is not considered done until flush() sees it confirmed.
        state[path] = {"url": up["blob_url"], "size": None, "mtime": None, "synced": False}

        if len(attachments) >= 50:
            flush()

    # A run cut short by the deadline is not finished, so it must not close the
    # sync run — the next tick continues it.
    flush(done=not stopped_early)
    save_state(args.state, state)
    print(f"[wa_media_push] {stored} attachment(s) stored (run {run_id})"
          + (" [partial]" if stopped_early else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
