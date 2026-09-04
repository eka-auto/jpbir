#!/usr/bin/env python3
"""Check that a merged corpus on disk matches the report that describes it.

This exists because on 2026-08-21 a merge report was accurate and the file it
described was not. Two merge_chunks.py processes wrote runs/jt_agent/chunks.jsonl
at once: one had been wrongly declared dead (its size was static for the eight
seconds it was sampled, because it was skipping excluded records and emitting
nothing), the other truncated the file and started again from offset zero. The
result was valid JSON at both ends and a 3.12 GiB run of NUL in the middle. The
report said 1,851,957 chunks. The file held 1,123,109 lines. Nothing in the
pipeline noticed.

A merge report is a record of what a process INTENDED to write. This checks
what is actually there. Run it after every merge, before training or scanning.

Checks, cheapest first:
  1. line count == report's chunks_written
  2. no line longer than MAX_LINE (a chunk is a few KB; more means damage)
  3. no NUL bytes (they cannot occur in JSON-escaped text)
  4. every line parses as JSON and carries chunk_id / text / source_file
  5. summed token_count == report's total_tokens

Exits 0 if the corpus is trustworthy, 1 if it is not.

Usage:
    python tools/verify_corpus.py runs/jt_agent/chunks.jsonl
    python tools/verify_corpus.py runs/jt_agent/chunks.jsonl \
        --report runs/jt_agent/merge_report.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Dict, List, Optional

MAX_LINE = 16 << 20
_BLOCK = 8 << 20

# The byte this tool hunts for, written as an escape on purpose. An earlier
# revision of this file put a literal one inside a comment and Python refused
# to import the module at all: "source code cannot contain null bytes".
NUL = b"\x00"


def verify(path: str, report_path: Optional[str], deep: bool) -> Dict[str, object]:
    report: Dict[str, object] = {}
    if report_path and os.path.isfile(report_path):
        with open(report_path, "r", encoding="utf-8") as handle:
            report = json.load(handle)

    size = os.path.getsize(path)
    lines = 0
    longest = 0
    longest_at = 0
    oversized: List[int] = []
    nul_blocks = 0

    # Pass one works on raw bytes, so a damaged file cannot be decoded into
    # something that looks fine. NUL is the tell: json.dumps escapes it to the
    # six characters backslash-u-0-0-0-0, so a literal NUL byte never appears
    # in a well-formed corpus.
    cur = 0
    pos = 0
    with open(path, "rb") as handle:
        while True:
            buf = handle.read(_BLOCK)
            if not buf:
                break
            if NUL in buf:
                nul_blocks += 1
            start = 0
            while True:
                i = buf.find(b"\n", start)
                if i < 0:
                    cur += len(buf) - start
                    break
                cur += i - start
                lines += 1
                if cur > longest:
                    longest, longest_at = cur, pos
                if cur > MAX_LINE:
                    oversized.append(pos)
                start = i + 1
                pos += cur + 1
                cur = 0
    if cur:
        lines += 1
        if cur > longest:
            longest, longest_at = cur, pos

    result: Dict[str, object] = {
        "corpus": path,
        "bytes": size,
        "lines": lines,
        "longest_line": longest,
        "longest_line_at": longest_at,
        "oversized_lines": len(oversized),
        "blocks_containing_nul": nul_blocks,
        "failures": [],
    }
    fail = result["failures"]
    assert isinstance(fail, list)

    if oversized:
        fail.append("%d line(s) exceed %d bytes -- longest %d at offset %d; "
                    "this is a truncated or double-written merge"
                    % (len(oversized), MAX_LINE, longest, longest_at))
    if nul_blocks:
        fail.append("%d block(s) contain NUL bytes; JSON escapes NUL, so these "
                    "are not records" % nul_blocks)

    expected = report.get("chunks_written")
    if expected is not None:
        result["report_chunks_written"] = expected
        if expected != lines:
            fail.append("report says %s chunks, file has %s lines (%s missing)"
                        % (format(expected, ","), format(lines, ","),
                           format(expected - lines, ",")))

    if deep and not fail:
        bad = 0
        tokens = 0
        missing_fields = 0
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except ValueError:
                    bad += 1
                    continue
                if not (record.get("chunk_id") and record.get("source_file")
                        and record.get("text") is not None):
                    missing_fields += 1
                tokens += int(record.get("token_count") or 0)
        result["unparseable_lines"] = bad
        result["records_missing_fields"] = missing_fields
        result["total_tokens"] = tokens
        if bad:
            fail.append("%d line(s) are not valid JSON" % bad)
        if missing_fields:
            fail.append("%d record(s) lack chunk_id/source_file/text"
                        % missing_fields)
        want = report.get("total_tokens")
        if want is not None and want != tokens:
            fail.append("report says %s tokens, file sums to %s"
                        % (format(want, ","), format(tokens, ",")))

    result["ok"] = not fail
    return result


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus")
    parser.add_argument("--report", help="merge_report.json to check against.")
    parser.add_argument("--quick", action="store_true",
                        help="Skip the JSON-parse pass (bytes and line counts "
                             "only). The structural checks catch the "
                             "double-write failure on their own.")
    parser.add_argument("--json", action="store_true",
                        help="Emit the result as JSON instead of human text.")
    args = parser.parse_args(argv)

    if not os.path.isfile(args.corpus):
        print("no such file: %s" % args.corpus, file=sys.stderr)
        return 2

    r = verify(args.corpus, args.report, deep=not args.quick)

    if args.json:
        print(json.dumps(r, ensure_ascii=False))
        return 0 if r.get("ok") else 1

    print("corpus:             %s" % r["corpus"])
    print("bytes:              %s (%.2f GiB)"
          % (format(r["bytes"], ","), r["bytes"] / 2 ** 30))
    print("lines:              %s" % format(r["lines"], ","))
    if "report_chunks_written" in r:
        print("report says:        %s chunks"
              % format(r["report_chunks_written"], ","))
    print("longest line:       %s bytes" % format(r["longest_line"], ","))
    print("NUL-bearing blocks: %s" % format(r["blocks_containing_nul"], ","))
    if "total_tokens" in r:
        print("tokens summed:      %s" % format(r["total_tokens"], ","))
    if "unparseable_lines" in r:
        print("unparseable lines:  %s" % format(r["unparseable_lines"], ","))

    failures = r["failures"]
    assert isinstance(failures, list)
    if failures:
        print("\nCORPUS IS NOT TRUSTWORTHY:")
        for f in failures:
            print("  - %s" % f)
        print("\nDo not train on or scan this file. Rebuild it, with exactly "
              "one merge process writing.")
        return 1

    print("\nOK -- file matches its report and contains no structural damage.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
