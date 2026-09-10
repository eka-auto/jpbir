#!/usr/bin/env python3
"""Extract text chunks from a ZIP whose central directory is missing.

Scans raw bytes for PK local-file headers (50 4B 03 04), decompresses each
entry, and writes text content as JSONL chunks. Binary / image files are
skipped. classify() is called before every write.

Usage:
    python tools/build_jp_backup_chunks.py
"""

from __future__ import annotations

import json
import os
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tools.scrub_secrets import classify  # noqa: E402

SRC = r"C:\JP_Backup\Desktop_Backup_20260616_182101.zip"
OUT = os.path.join(ROOT, "runs", "jt_agent", "parts", "jp_desktop_backup.jsonl")

# Skip these extensions — binary, media, executables
SKIP_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp",
    ".mp3", ".mp4", ".wav", ".ogg", ".mkv", ".avi", ".mov", ".flv",
    ".zip", ".7z", ".rar", ".gz", ".tar", ".bz2",
    ".exe", ".dll", ".so", ".dylib", ".bin", ".dat", ".db", ".sqlite",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".psd", ".ai", ".sketch", ".fig",
    ".pyc", ".pyo", ".class",
}

TEXT_EXT = {
    ".txt", ".md", ".rst", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml",
    ".toml", ".ini", ".cfg", ".conf", ".env", ".sh", ".bat", ".ps1",
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".htm", ".css",
    ".java", ".go", ".rb", ".rs", ".c", ".cpp", ".h", ".hpp",
    ".xml", ".log", ".sql", ".r", ".m", ".tf", ".hcl",
    ".ipynb", ".tex", ".bib",
}

LOCAL_SIG = b"PK\x03\x04"
CHUNK_CHARS = 4000


def try_decode(data: bytes) -> str | None:
    for enc in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return data.decode(enc)
        except Exception:
            continue
    return None


def split_text(text: str, source: str, base_idx: int, out_fh, counter: list) -> int:
    written = 0
    step = CHUNK_CHARS
    for i in range(0, len(text), step):
        chunk_text = text[i:i + step].strip()
        if len(chunk_text) < 60:
            continue
        if classify(chunk_text):
            continue
        chunk = {
            "text": chunk_text,
            "source_file": source,
            "chunk_index": base_idx + i // step,
            "byte_offset": i,
            "token_count": len(chunk_text.split()),
            "chunk_id": "%s::%d" % (source, counter[0]),
            "metadata": {
                "corpus_label": "desktop_backup",
                "archive": SRC,
            },
        }
        out_fh.write(json.dumps(chunk, ensure_ascii=False) + "\n")
        counter[0] += 1
        written += 1
    return written


def scan_zip(path: str, out_fh, counter: list) -> dict:
    stats = {"files_found": 0, "files_skipped_ext": 0, "files_skipped_binary": 0,
             "files_skipped_secret": 0, "chunks_written": 0, "errors": 0}

    with open(path, "rb") as f:
        raw = f.read()

    pos = 0
    total = len(raw)

    while pos < total - 30:
        idx = raw.find(LOCAL_SIG, pos)
        if idx == -1:
            break
        pos = idx

        # Local file header layout:
        # 4  signature
        # 2  version needed
        # 2  general purpose bit flag
        # 2  compression method
        # 2  last mod time
        # 2  last mod date
        # 4  crc-32
        # 4  compressed size
        # 4  uncompressed size
        # 2  file name length
        # 2  extra field length
        if pos + 30 > total:
            break

        try:
            (_, ver, flags, method, mod_time, mod_date,
             crc, comp_size, uncomp_size,
             fname_len, extra_len) = struct.unpack_from("<4sHHHHHIIIHH", raw, pos)
        except struct.error:
            pos += 4
            continue

        header_end = pos + 30 + fname_len + extra_len
        if header_end > total:
            pos += 4
            continue

        fname_bytes = raw[pos + 30: pos + 30 + fname_len]
        try:
            fname = fname_bytes.decode("utf-8", errors="replace")
        except Exception:
            fname = fname_bytes.decode("latin-1", errors="replace")

        data_start = header_end
        data_end = data_start + comp_size if comp_size > 0 else total

        # Advance past this entry for next search
        pos = data_end if comp_size > 0 else header_end + 4

        ext = os.path.splitext(fname)[1].lower()

        # Skip directories
        if fname.endswith("/") or fname.endswith("\\"):
            continue

        stats["files_found"] += 1

        # Skip non-text extensions
        if ext in SKIP_EXT or (ext and ext not in TEXT_EXT and len(ext) > 0):
            stats["files_skipped_ext"] += 1
            continue

        # Try to get compressed data
        if data_end > total:
            data_end = total
        comp_data = raw[data_start:data_end]
        if not comp_data:
            stats["errors"] += 1
            continue

        # Decompress
        try:
            if method == 0:  # stored
                raw_data = comp_data
            elif method == 8:  # deflate
                raw_data = zlib.decompress(comp_data, -15)
            else:
                stats["files_skipped_ext"] += 1
                continue
        except Exception:
            stats["errors"] += 1
            continue

        text = try_decode(raw_data)
        if text is None:
            stats["files_skipped_binary"] += 1
            continue

        text = text.strip()
        if not text or len(text) < 60:
            continue

        n = split_text(text, fname, 0, out_fh, counter)
        if n == 0:
            stats["files_skipped_secret"] += 1
        else:
            stats["chunks_written"] += n

    return stats


def main():
    if not os.path.isfile(SRC):
        print("ERROR: not found: %s" % SRC)
        sys.exit(1)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    counter = [0]

    print("Scanning %s ..." % SRC)
    with open(OUT, "w", encoding="utf-8") as out_fh:
        stats = scan_zip(SRC, out_fh, counter)

    print("Done.")
    print("  Files found (local headers): %(files_found)d" % stats)
    print("  Skipped (ext/binary):        %(files_skipped_ext)d / %(files_skipped_binary)d" % stats)
    print("  Skipped (secret):            %(files_skipped_secret)d" % stats)
    print("  Errors:                      %(errors)d" % stats)
    print("  Chunks written:              %(chunks_written)d" % stats)
    print("  Output: %s" % OUT)


if __name__ == "__main__":
    main()
