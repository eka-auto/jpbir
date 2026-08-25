"""Extract structured data from SQLite databases and hidden system stores.

Normal corpus builders find text files. But a personal device holds structured
data in SQLite databases (browser history, bookmarks, contacts, calendar,
messaging apps, notes) that matter for a "what did I do" agent. This tool:

  1. Scans --root paths (including AppData) for every SQLite database it can reach
  2. Has schema-aware extractors for Chrome, Firefox, Sticky Notes, Windows Timeline
  3. Falls back to generic column extraction for any unknown SQLite database
  4. Handles locked databases (Chrome History while browser is open) via WAL-aware
     temp-copy fallback
  5. Also extracts Chrome Bookmarks (JSON format)
  6. Emits the same JSONL format as build_jt_chunks.py
  7. Runs classify_secrets() before writing any chunk

Usage:
    python tools/build_db_chunks.py \\
        --root "C:\\Users\\abcom\\AppData\\Local" \\
        --root "C:\\Users\\abcom\\AppData\\Roaming" \\
        --out runs/jt_agent/parts/databases.jsonl

    python tools/build_db_chunks.py --scan-only \\
        --root "C:\\Users\\abcom\\AppData\\Local" \\
        --report runs/jt_agent/reports/db_scan.json
"""

from __future__ import annotations

import argparse
import collections
import datetime
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from typing import Dict, Iterable, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.scrub_secrets import classify as classify_secrets

# Directories that never contain meaningful personal data
PRUNE_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "__pycache__", ".pytest_cache",
    "Windows", "Program Files", "Program Files (x86)", "ProgramData",
    "$RECYCLE.BIN", "$Recycle.Bin", "System Volume Information",
    "build", "dist", "obj", "target",
    "models", "checkpoints", "adapter", "lora",
    # Browser noise — these are caches, not history
    "Cache", "cache", "GPUCache", "Code Cache", "CacheStorage",
    "DawnCache", "ShaderCache", "BlobStorage", "FileSystem",
    # Chromium blob storage
    "IndexedDB", "Local Storage", "Session Storage",
}

# SQLite journal/temp files — not databases themselves
SKIP_EXTENSIONS = {".wal", ".shm", ".tmp", ".bak", ".preScrub"}

MAX_CHUNK_CHARS = 3200
WEBKIT_EPOCH = 11644473600  # seconds from 1601-01-01 to 1970-01-01


# ── Timestamp helpers ────────────────────────────────────────────────────────

def _dt(ts, divisor=1, offset=0):
    """Convert a numeric timestamp to 'YYYY-MM-DD HH:MM' or None."""
    try:
        return datetime.datetime.utcfromtimestamp(
            float(ts) / divisor - offset
        ).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return None


def webkit_ts(ts):
    """WebKit timestamp (microseconds since 1601-01-01) → ISO string."""
    return _dt(ts, divisor=1e6, offset=WEBKIT_EPOCH)


def unix_us_ts(ts):
    """Unix timestamp in microseconds → ISO string."""
    return _dt(ts, divisor=1e6)


def unix_s_ts(ts):
    """Unix timestamp in seconds → ISO string."""
    return _dt(ts)


# ── SQLite helpers ───────────────────────────────────────────────────────────

def is_sqlite(path: str) -> bool:
    """Check the file header without opening the database."""
    try:
        with open(path, "rb") as f:
            return f.read(16) == b"SQLite format 3\x00"
    except OSError:
        return False


def safe_connect(path: str) -> Optional[sqlite3.Connection]:
    """Open a SQLite database read-only.

    If the database is locked (e.g. Chrome is running), copy it — along with
    any WAL/SHM sidecar files — to a temp directory and open the copy.
    """
    # Fast path: URI read-only mode
    try:
        uri = "file:" + path.replace("\\", "/") + "?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=2)
        conn.execute("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1")
        return conn
    except Exception:
        pass

    # Locked path: temp-directory copy
    tmpdir = tempfile.mkdtemp(prefix="jt_db_")
    try:
        dst = os.path.join(tmpdir, os.path.basename(path))
        shutil.copy2(path, dst)
        for suffix in ("-wal", "-shm"):
            src = path + suffix
            if os.path.exists(src):
                shutil.copy2(src, dst + suffix)
        conn = sqlite3.connect(dst, timeout=2)
        conn.execute("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1")
        conn._tmpdir = tmpdir  # type: ignore[attr-defined]
        return conn
    except Exception:
        shutil.rmtree(tmpdir, ignore_errors=True)
        return None


def close_conn(conn: sqlite3.Connection) -> None:
    tmpdir = getattr(conn, "_tmpdir", None)
    try:
        conn.close()
    except Exception:
        pass
    if tmpdir:
        shutil.rmtree(tmpdir, ignore_errors=True)


def list_tables(conn: sqlite3.Connection) -> List[str]:
    try:
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        return [r[0] for r in cur if not r[0].startswith("sqlite_")]
    except Exception:
        return []


# ── Record builder ───────────────────────────────────────────────────────────

def _rec(text: str, source: str, idx: int, kind: str,
         chunk_id: str, date: Optional[str]) -> Dict:
    return {
        "text": text[:MAX_CHUNK_CHARS],
        "source_file": source,
        "chunk_index": idx,
        "byte_offset": 0,
        "token_count": max(1, len(text) // 4),
        "chunk_id": chunk_id,
        "metadata": {
            "corpus_label": "databases",
            "kind": kind,
            **({"date": date} if date else {}),
        },
    }


# ── Schema-aware extractors ──────────────────────────────────────────────────

def extract_chrome_history(conn: sqlite3.Connection, source: str) -> Iterable[Dict]:
    # URLs grouped by day
    try:
        cur = conn.execute(
            "SELECT url, title, last_visit_time, visit_count "
            "FROM urls "
            "WHERE url NOT LIKE 'data:%' AND url NOT LIKE 'blob:%' "
            "  AND url NOT LIKE 'chrome%' "
            "ORDER BY last_visit_time DESC LIMIT 30000"
        )
        rows = cur.fetchall()
    except Exception:
        return

    by_day: Dict[str, List[str]] = collections.defaultdict(list)
    for url, title, ts, count in rows:
        day = (webkit_ts(ts) or "?")[:10]
        by_day[day].append("- %s  %s  (x%d)" % (url[:100], (title or "")[:60], count))

    for idx, day in enumerate(sorted(by_day, reverse=True)):
        lines = ["# Chrome browsing history — %s" % day, ""]
        lines += by_day[day][:100]
        text = "\n".join(lines) + "\n"
        yield _rec(text, source, idx, "chrome_history",
                   "chrome://history/%s" % day, day)

    # Downloads
    try:
        cur = conn.execute(
            "SELECT target_path, start_time, total_bytes "
            "FROM downloads ORDER BY start_time DESC LIMIT 2000"
        )
        dl = cur.fetchall()
    except Exception:
        dl = []
    if dl:
        lines = ["# Chrome downloads", ""]
        for path, ts, size in dl:
            lines.append("- [%s] %s (%s B)" % (webkit_ts(ts) or "?", path[:120], size))
        text = "\n".join(lines) + "\n"
        yield _rec(text, source, 99990, "chrome_downloads",
                   "chrome://downloads", None)

    # Search terms
    try:
        cur = conn.execute(
            "SELECT lower_term, url_count FROM keyword_search_terms "
            "ORDER BY url_count DESC LIMIT 500"
        )
        terms = cur.fetchall()
    except Exception:
        terms = []
    if terms:
        lines = ["# Chrome search terms (most frequent)", ""]
        for term, count in terms:
            lines.append("- %s (x%d)" % (term, count))
        text = "\n".join(lines) + "\n"
        yield _rec(text, source, 99991, "chrome_search_terms",
                   "chrome://search_terms", None)


def extract_firefox_history(conn: sqlite3.Connection, source: str) -> Iterable[Dict]:
    try:
        cur = conn.execute(
            "SELECT p.url, p.title, h.visit_date, p.visit_count "
            "FROM moz_places p JOIN moz_historyvisits h ON p.id = h.place_id "
            "WHERE p.url NOT LIKE 'data:%' "
            "ORDER BY h.visit_date DESC LIMIT 30000"
        )
        rows = cur.fetchall()
    except Exception:
        return

    by_day: Dict[str, List[str]] = collections.defaultdict(list)
    for url, title, ts, count in rows:
        day = (unix_us_ts(ts) or "?")[:10]
        by_day[day].append("- %s  %s  (x%d)" % (url[:100], (title or "")[:60], count))

    for idx, day in enumerate(sorted(by_day, reverse=True)):
        lines = ["# Firefox browsing history — %s" % day, ""]
        lines += by_day[day][:100]
        text = "\n".join(lines) + "\n"
        yield _rec(text, source, idx, "firefox_history",
                   "firefox://history/%s" % day, day)

    # Bookmarks
    try:
        cur = conn.execute(
            "SELECT p.url, p.title, b.dateAdded "
            "FROM moz_bookmarks b JOIN moz_places p ON b.fk = p.id "
            "WHERE b.type = 1 ORDER BY b.dateAdded DESC LIMIT 2000"
        )
        bm = cur.fetchall()
    except Exception:
        bm = []
    if bm:
        lines = ["# Firefox bookmarks", ""]
        for url, title, ts in bm:
            lines.append("- [%s] %s  %s" % (unix_us_ts(ts) or "?", (title or "")[:60], url[:100]))
        text = "\n".join(lines) + "\n"
        yield _rec(text, source, 99990, "firefox_bookmarks",
                   "firefox://bookmarks", None)


def extract_sticky_notes(conn: sqlite3.Connection, source: str) -> Iterable[Dict]:
    try:
        cur = conn.execute(
            "SELECT NoteId, Text, CreatedAt, UpdatedAt FROM Note "
            "WHERE DeletedAt IS NULL AND Text IS NOT NULL"
        )
        rows = cur.fetchall()
    except Exception:
        return

    for i, (nid, text, created, updated) in enumerate(rows):
        if not text or not text.strip():
            continue
        body = "# Sticky Note\nCreated: %s  Updated: %s\n\n%s\n" % (
            created or "?", updated or "?", text.strip()
        )
        yield _rec(body, source, i, "sticky_note",
                   "sticky://%s" % (nid or i), None)


def extract_windows_activity(conn: sqlite3.Connection, source: str) -> Iterable[Dict]:
    try:
        cur = conn.execute(
            "SELECT SourceApplication, ContentInfo, StartTime, EndTime "
            "FROM Activity ORDER BY StartTime DESC LIMIT 15000"
        )
        rows = cur.fetchall()
    except Exception:
        return

    by_day: Dict[str, List[str]] = collections.defaultdict(list)
    for app, content, start, end in rows:
        try:
            day = datetime.datetime.utcfromtimestamp(float(start)).strftime("%Y-%m-%d")
            t = datetime.datetime.utcfromtimestamp(float(start)).strftime("%H:%M")
        except Exception:
            continue
        info = ""
        if content:
            try:
                obj = json.loads(content)
                info = obj.get("displayText") or obj.get("contentUri") or ""
            except Exception:
                info = str(content)[:80]
        by_day[day].append("[%s] %s — %s" % (t, (app or "?")[:50], str(info)[:80]))

    for idx, day in enumerate(sorted(by_day, reverse=True)):
        lines = ["# Windows Timeline — %s" % day, ""]
        lines += ["- " + e for e in by_day[day]]
        text = "\n".join(lines) + "\n"
        yield _rec(text, source, idx, "windows_timeline",
                   "windows://activity/%s" % day, day)


def extract_vscode_state(conn: sqlite3.Connection, source: str) -> Iterable[Dict]:
    """VS Code global state database (ItemTable key-value store)."""
    try:
        cur = conn.execute("SELECT key, value FROM ItemTable WHERE key LIKE '%recent%'")
        rows = cur.fetchall()
    except Exception:
        return

    lines = ["# VS Code recent workspace/file history", ""]
    for key, value in rows:
        try:
            obj = json.loads(value)
            if isinstance(obj, dict):
                entries = obj.get("entries") or obj.get("workspaces") or []
                for e in entries[:30]:
                    uri = e.get("folderUri") or e.get("fileUri") or e.get("uri") or str(e)
                    lines.append("- %s: %s" % (key, str(uri)[:120]))
            elif isinstance(obj, list):
                for e in obj[:30]:
                    lines.append("- %s: %s" % (key, str(e)[:120]))
        except Exception:
            lines.append("- %s: %s" % (key, str(value)[:120]))

    if len(lines) > 2:
        text = "\n".join(lines) + "\n"
        yield _rec(text, source, 0, "vscode_history",
                   "vscode://history", None)


def extract_generic(conn: sqlite3.Connection, source: str, db_name: str) -> Iterable[Dict]:
    """Fall-back: find text-like columns in every table and dump sample rows."""
    SKIP_TABLE_PATTERNS = {"migration", "schema", "version", "sqlite_", "fts_", "_fts",
                           "config", "setting", "pragma", "lock", "queue", "log"}

    for table in list_tables(conn):
        if any(p in table.lower() for p in SKIP_TABLE_PATTERNS):
            continue
        try:
            cur = conn.execute('PRAGMA table_info("%s")' % table)
            cols = [(r[1], r[2].upper()) for r in cur]
        except Exception:
            continue

        text_cols = [
            c for c, t in cols
            if any(k in t for k in ("TEXT", "CHAR", "CLOB", "JSON"))
            and c.lower() not in ("id", "uuid", "hash", "checksum")
        ]
        if not text_cols:
            continue

        try:
            col_sql = ", ".join('"%s"' % c for c in text_cols[:6])
            cur = conn.execute('SELECT %s FROM "%s" LIMIT 400' % (col_sql, table))
            rows = cur.fetchall()
        except Exception:
            continue

        if len(rows) < 3:
            continue

        lines = [
            "# Database: %s — Table: %s" % (db_name, table),
            "Columns: %s" % ", ".join(text_cols[:6]),
            "",
        ]
        for row in rows:
            parts = [str(v)[:150] for v in row if v is not None and str(v).strip()]
            if parts:
                lines.append(" | ".join(parts))

        text = "\n".join(lines) + "\n"
        if len(text.strip()) < 80:
            continue
        yield _rec(text, source, 0, "db_generic_table",
                   "db://%s/%s" % (db_name, table), None)


def extract_chrome_bookmarks(path: str) -> Iterable[Dict]:
    """Chrome Bookmarks is JSON, not SQLite."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            data = json.load(f)
    except Exception:
        return

    entries: List[str] = []

    def walk(node):
        if node.get("type") == "url":
            entries.append("%s  %s" % (node.get("url", "")[:100], node.get("name", "")[:60]))
        for child in node.get("children", []):
            walk(child)

    for key in ("bookmark_bar", "other", "synced"):
        walk(data.get("roots", {}).get(key, {}))

    for batch_idx in range(0, max(1, len(entries)), 60):
        batch = entries[batch_idx:batch_idx + 60]
        lines = ["# Chrome Bookmarks (part %d)" % (batch_idx // 60 + 1), ""]
        lines += ["- " + e for e in batch]
        text = "\n".join(lines) + "\n"
        yield _rec(text, path, batch_idx // 60, "chrome_bookmarks",
                   "chrome://bookmarks/%d" % (batch_idx // 60), None)


# ── Dispatcher ───────────────────────────────────────────────────────────────

def process(path: str) -> Tuple[str, List[Dict]]:
    name = os.path.basename(path)

    if name == "Bookmarks":
        return "json", list(extract_chrome_bookmarks(path))

    if not is_sqlite(path):
        return "not_sqlite", []

    conn = safe_connect(path)
    if conn is None:
        return "locked", []

    try:
        if name == "History":
            chunks = list(extract_chrome_history(conn, path))
        elif name == "places.sqlite":
            chunks = list(extract_firefox_history(conn, path))
        elif name == "plum.sqlite":
            chunks = list(extract_sticky_notes(conn, path))
        elif name == "ActivitiesCache.db":
            chunks = list(extract_windows_activity(conn, path))
        elif name == "state.vscdb":
            chunks = list(extract_vscode_state(conn, path))
        else:
            chunks = list(extract_generic(conn, path, name))
    except Exception as exc:
        close_conn(conn)
        return "error:%s" % type(exc).__name__, []
    else:
        close_conn(conn)
        return "ok", chunks


# ── Discovery ────────────────────────────────────────────────────────────────

def find_databases(roots: List[str]) -> List[str]:
    db_exts = {".db", ".sqlite", ".sqlite3", ".db3", ".s3db", ".sl3"}
    found: List[str] = []

    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
            dirnames[:] = sorted(
                d for d in dirnames
                if d not in PRUNE_DIRS and not d.startswith("$")
            )
            for name in filenames:
                path = os.path.join(dirpath, name)
                ext = os.path.splitext(name)[1].lower()
                if ext in SKIP_EXTENSIONS:
                    continue
                # Known JSON stores
                if name == "Bookmarks" and "Chrome" in dirpath:
                    found.append(path)
                    continue
                if ext in db_exts:
                    found.append(path)
                    continue
                # Extension-less files that might be SQLite (Chrome History, Cookies, etc.)
                if not ext:
                    try:
                        size = os.path.getsize(path)
                    except OSError:
                        continue
                    if size >= 4096:
                        found.append(path)

    return sorted(set(found))


# ── Entry point ──────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", action="append", dest="roots", required=True,
                        help="Directory to scan. Repeatable.")
    parser.add_argument("--out",
                        help="Output .jsonl path (required unless --scan-only).")
    parser.add_argument("--scan-only", action="store_true",
                        help="Report what databases exist; do not write chunks.")
    parser.add_argument("--report",
                        help="Write the JSON summary to this file as well.")
    args = parser.parse_args(argv)

    if not args.scan_only and not args.out:
        parser.error("--out is required unless --scan-only is given")

    dbs = find_databases(args.roots)
    print("Found %d candidate files" % len(dbs), flush=True)

    written = 0
    secrets_skipped = 0
    locked_count = 0
    not_sqlite_count = 0
    per_db = []

    handle = None
    if not args.scan_only:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
        handle = open(args.out, "w", encoding="utf-8")

    try:
        for path in dbs:
            kind, chunks = process(path)
            if kind == "locked":
                locked_count += 1
            elif kind == "not_sqlite":
                not_sqlite_count += 1

            db_written = 0
            db_skipped = 0
            for chunk in chunks:
                if classify_secrets(str(chunk.get("text", ""))):
                    secrets_skipped += 1
                    db_skipped += 1
                    continue
                if handle is not None:
                    handle.write(json.dumps(chunk, ensure_ascii=False) + "\n")
                written += 1
                db_written += 1

            if db_written or db_skipped:
                print("  [%s] %d chunks  %s" % (
                    kind, db_written, path[-75:]), flush=True)
                per_db.append({
                    "path": path,
                    "kind": kind,
                    "chunks": db_written,
                    "secrets_skipped": db_skipped,
                })
    finally:
        if handle is not None:
            handle.close()

    summary = {
        "roots": args.roots,
        "candidates_found": len(dbs),
        "locked": locked_count,
        "not_sqlite": not_sqlite_count,
        "chunks_written": written,
        "secrets_skipped": secrets_skipped,
        "out": args.out if not args.scan_only else None,
        "databases": per_db,
    }
    rendered = json.dumps(summary, indent=2, ensure_ascii=False)
    print(rendered)
    if args.report:
        os.makedirs(os.path.dirname(os.path.abspath(args.report)) or ".", exist_ok=True)
        with open(args.report, "w", encoding="utf-8") as rpt:
            rpt.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
