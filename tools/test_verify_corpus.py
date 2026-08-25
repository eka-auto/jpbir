#!/usr/bin/env python3
"""Tests for tools/verify_corpus.py.

The case that matters is the one that actually happened on 2026-08-21: two
merge processes writing runs/jt_agent/chunks.jsonl at once left valid JSON at
both ends of the file and a multi-gigabyte run of NUL in the middle. The merge
report was internally consistent and completely wrong about the file. A
verifier that only counts lines, or only parses JSON at the head, would have
called that corpus healthy.

So the corrupt fixture below reproduces the real shape -- good records, a NUL
hole with no newline in it, more good records, and a report claiming a chunk
count the file cannot possibly hold -- and asserts all three signals fire.

Usage:
    python tools/test_verify_corpus.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import verify_corpus as vc  # noqa: E402

# Deliberately bilingual: the corpus is Hindi and English, and a verifier that
# mangles non-ASCII would corrupt the thing it is meant to protect.
RECORDS = [{"chunk_id": "a:%d" % i,
            "source_file": "C:/JP/f%d.txt" % i,
            "text": "line %d नमस्ते" % i,
            "token_count": 3} for i in range(50)]


def write_report(path: str, chunks: int, tokens: int) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"chunks_written": chunks, "total_tokens": tokens}, handle)


def test_healthy_corpus_passes(tmp: str) -> None:
    corpus = os.path.join(tmp, "good.jsonl")
    report = os.path.join(tmp, "good_report.json")
    with open(corpus, "w", encoding="utf-8") as handle:
        for r in RECORDS:
            handle.write(json.dumps(r, ensure_ascii=False) + "\n")
    write_report(report, 50, 150)

    r = vc.verify(corpus, report, deep=True)
    print("healthy:   ok=%s lines=%d tokens=%s failures=%s"
          % (r["ok"], r["lines"], r["total_tokens"], r["failures"]))
    assert r["ok"], r["failures"]
    assert r["lines"] == 50, r["lines"]
    assert r["total_tokens"] == 150, r["total_tokens"]
    assert r["blocks_containing_nul"] == 0
    assert r["oversized_lines"] == 0


def test_double_write_corruption_fails(tmp: str) -> None:
    """The 2026-08-21 shape: good JSON, NUL hole, good JSON, lying report."""
    corpus = os.path.join(tmp, "bad.jsonl")
    report = os.path.join(tmp, "good_report.json")
    with open(corpus, "wb") as handle:
        for r in RECORDS[:10]:
            handle.write(json.dumps(r, ensure_ascii=False).encode("utf-8") + b"\n")
        handle.write(b"\x00" * (20 << 20))
        handle.write(b"\n")
        for r in RECORDS[10:20]:
            handle.write(json.dumps(r, ensure_ascii=False).encode("utf-8") + b"\n")

    r = vc.verify(corpus, report, deep=True)
    print("corrupt:   ok=%s lines=%d nul_blocks=%d oversized=%d"
          % (r["ok"], r["lines"], r["blocks_containing_nul"],
             r["oversized_lines"]))
    for f in r["failures"]:
        print("   - %s" % f)

    assert not r["ok"], "verifier passed a corrupt corpus"
    assert r["blocks_containing_nul"] > 0, "missed the NUL hole"
    assert r["oversized_lines"] > 0, "missed the oversized span"
    assert any("report says" in f and "chunks" in f for f in r["failures"]), \
        "missed the report/file count mismatch"


def test_truncated_corpus_fails(tmp: str) -> None:
    """A killed merge leaves a short file and a report that overcounts."""
    corpus = os.path.join(tmp, "short.jsonl")
    report = os.path.join(tmp, "good_report.json")
    with open(corpus, "w", encoding="utf-8") as handle:
        for r in RECORDS[:30]:
            handle.write(json.dumps(r, ensure_ascii=False) + "\n")

    r = vc.verify(corpus, report, deep=True)
    print("truncated: ok=%s lines=%d" % (r["ok"], r["lines"]))
    for f in r["failures"]:
        print("   - %s" % f)
    assert not r["ok"], "verifier passed a truncated corpus"
    assert any("20 missing" in f for f in r["failures"]), r["failures"]


def test_runs_without_a_report(tmp: str) -> None:
    corpus = os.path.join(tmp, "good.jsonl")
    r = vc.verify(corpus, None, deep=True)
    print("no report: ok=%s (structural checks still run)" % r["ok"])
    assert r["ok"], r["failures"]


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        test_healthy_corpus_passes(tmp)
        test_double_write_corruption_fails(tmp)
        test_truncated_corpus_fails(tmp)
        test_runs_without_a_report(tmp)
    print("\nALL ASSERTIONS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
