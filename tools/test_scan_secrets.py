#!/usr/bin/env python3
"""Tests for tools/scan_secrets.py.

Two things need proving before the scanner's verdict means anything:

  1. It finds planted credentials of each supported kind, does not fire on
     ordinary prose (English or Hindi), and never copies a matched value into
     its own report -- a report that leaks is worse than no report.

  2. It survives a damaged corpus. A merge that is truncated, or written by
     two processes at once, leaves a multi-gigabyte run of NUL with no
     newline in it. Plain ``for line in handle`` buffers that whole span and
     dies with MemoryError -- which is exactly how the 3.12 GiB corruption in
     runs/jt_agent/chunks.jsonl was found on 2026-08-21. The scanner must
     instead report the damage AND still find secrets buried inside it.

The planted values are obvious fakes (repeated characters), long enough to
satisfy the length constraints in PATTERNS and nothing more.

Usage:
    python tools/test_scan_secrets.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scan_secrets as ss  # noqa: E402


CLEAN = {"chunk_id": "a:0", "source_file": "C:/JP/notes.txt",
         "text": "ordinary prose, nothing here"}
HINDI = {"chunk_id": "e:0", "source_file": "C:/JP/hindi.txt",
         "text": "नमस्ते, कोई रहस्य नहीं"}


def test_finds_planted_and_leaks_nothing(tmp: str) -> None:
    path = os.path.join(tmp, "normal.jsonl")
    recs = [
        CLEAN,
        {"chunk_id": "b:0", "source_file": "C:/JP/aws.txt",
         "text": "key=AKIA" + "A" * 16},
        {"chunk_id": "c:0", "source_file": "C:/JP/gh.txt",
         "text": "ghp_" + "b" * 36},
        {"chunk_id": "d:0", "source_file": "C:/JP/k.pem",
         "text": "-----BEGIN RSA PRIVATE KEY-----"},
        HINDI,
    ]
    with open(path, "w", encoding="utf-8") as handle:
        for r in recs:
            handle.write(json.dumps(r, ensure_ascii=False) + "\n")

    s = ss.scan(path)
    print("normal:   %d scanned, %d flagged, %d oversized"
          % (s["chunks_scanned"], s["chunks_flagged"], s["oversized_slices"]))
    print("  kinds:  %s" % s["by_kind"])

    assert s["chunks_scanned"] == 5, s["chunks_scanned"]
    assert s["chunks_flagged"] == 3, s["chunks_flagged"]
    assert set(s["by_kind"]) == {
        "aws_access_key", "github_token", "private_key_block"}, s["by_kind"]
    assert s["oversized_slices"] == 0
    # Prose in either script must not trip a pattern.
    flagged_paths = {e["source_file"]
                     for entries in s["top_paths"].values() for e in entries}
    assert "C:/JP/notes.txt" not in flagged_paths
    assert "C:/JP/hindi.txt" not in flagged_paths
    # The report must name files, never values.
    rendered = json.dumps(s)
    assert "AKIA" not in rendered, "scanner leaked a secret value"
    assert "ghp_" not in rendered, "scanner leaked a secret value"


def test_survives_and_reports_corruption(tmp: str) -> None:
    """80 MiB of NUL with a token buried in the middle and no newline."""
    path = os.path.join(tmp, "corrupt.jsonl")
    with open(path, "wb") as handle:
        handle.write(json.dumps(CLEAN).encode() + b"\n")
        handle.write(b"\x00" * (40 << 20))
        handle.write(b"ghp_" + b"c" * 36)
        handle.write(b"\x00" * (40 << 20))
        handle.write(b"\n")
        handle.write(json.dumps(HINDI, ensure_ascii=False).encode("utf-8") + b"\n")

    s = ss.scan(path)
    print("corrupt:  %d scanned, %d flagged, %d oversized span(s), %s bytes"
          % (s["chunks_scanned"], s["chunks_flagged"],
             s["oversized_slices"], format(s["oversized_bytes"], ",")))
    print("  kinds:  %s" % s["by_kind"])

    assert s["oversized_slices"] > 0, "failed to notice the damage"
    assert s["oversized_bytes"] > (32 << 20), s["oversized_bytes"]
    assert "github_token" in s["by_kind"], "missed a secret inside the damage"


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        test_finds_planted_and_leaks_nothing(tmp)
        print()
        test_survives_and_reports_corruption(tmp)
    print("\nALL ASSERTIONS PASSED "
          "(no MemoryError, damage reported, buried secret found)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
