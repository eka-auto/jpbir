#!/usr/bin/env python3
"""Scan a chunk corpus for credential material that scrub_secrets missed.

This exists because ``scrub_secrets.classify()`` demonstrably has gaps: the
GitHub Actions runner files ``.credentials`` and ``.credentials_rsaparams``
reached the corpus having passed it. Rather than trust the scrubber, scan the
finished artifact before anything is trained on it.

Reports COUNTS and SOURCE PATHS only -- never the matched value, never
surrounding text. A report you cannot paste into a chat safely is a report
nobody will run.

Usage:
    python tools/scan_secrets.py runs/jt_agent/chunks.jsonl
    python tools/scan_secrets.py runs/jt_agent/chunks.jsonl --report out.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from typing import Dict, List, Optional

# Each pattern is high-confidence by construction: a fixed vendor prefix plus a
# length-constrained body. Generic entropy heuristics are deliberately avoided --
# on a corpus containing source code and logs they drown real hits in noise.
PATTERNS = [
    ("aws_access_key",      re.compile(rb"AKIA[0-9A-Z]{16}")),
    ("aws_session_token",   re.compile(rb"ASIA[0-9A-Z]{16}")),
    ("private_key_block",   re.compile(rb"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----")),
    ("google_api_key",      re.compile(rb"AIza[0-9A-Za-z_\-]{35}")),
    ("gcp_service_account", re.compile(rb'"type"\s*:\s*"service_account"')),
    ("github_token",        re.compile(rb"gh[pousr]_[A-Za-z0-9]{36,}")),
    ("slack_token",         re.compile(rb"xox[baprs]-[0-9A-Za-z\-]{10,}")),
    ("stripe_live_key",     re.compile(rb"sk_live_[0-9a-zA-Z]{24,}")),
    ("anthropic_key",       re.compile(rb"sk-ant-[A-Za-z0-9_\-]{20,}")),
    ("openai_key",          re.compile(rb"sk-[A-Za-z0-9]{40,}")),
    ("bearer_token",        re.compile(rb"[Aa]uthorization\s*:\s*[Bb]earer\s+[A-Za-z0-9._\-]{20,}")),
    ("jwt",                 re.compile(rb"eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.")),
    ("firebase_priv_key_id", re.compile(rb'"private_key_id"\s*:\s*"[0-9a-f]{40}"')),
]


# One chunk is a few KB. Anything past this is not a record, it is damage --
# a merge that was truncated, or two processes writing one file and leaving a
# run of NUL between their offsets. Plain `for line in handle` buffers such a
# span whole and dies with MemoryError; a 3.12 GiB "line" is what exposed this.
MAX_LINE = 16 << 20
_BLOCK = 8 << 20
# Long enough that no pattern above can straddle a slice boundary unseen.
_OVERLAP = 4096


def iter_lines(path: str):
    """Yield (line, oversized) without ever buffering more than MAX_LINE.

    An oversized span is still scanned -- in overlapping slices, so a secret
    sitting on a boundary is not missed -- but is reported separately, because
    its presence means the corpus is damaged and the counts cannot be trusted.
    """
    with open(path, "rb") as handle:
        buf = bytearray()
        while True:
            data = handle.read(_BLOCK)
            if not data:
                break
            buf.extend(data)
            start = 0
            while True:
                i = buf.find(b"\n", start)
                if i < 0:
                    break
                yield bytes(buf[start:i]), False
                start = i + 1
            del buf[:start]
            if len(buf) > MAX_LINE:
                yield bytes(buf[:-_OVERLAP]), True
                del buf[:-_OVERLAP]
        if buf:
            yield bytes(buf), False


def scan(path: str, max_paths: int = 12) -> Dict[str, object]:
    total = 0
    flagged = 0
    oversized = 0
    oversized_bytes = 0
    by_kind: Counter = Counter()
    paths_by_kind: Dict[str, Counter] = defaultdict(Counter)
    src_pat = re.compile(rb'"source_file":\s*"(.*?)"')

    for line, is_oversized in iter_lines(path):
        if is_oversized:
            oversized += 1
            oversized_bytes += len(line)
        else:
            total += 1
        hits = [name for name, rx in PATTERNS if rx.search(line)]
        if not hits:
            continue
        flagged += 1
        m = src_pat.search(line)
        src = m.group(1).decode("utf-8", "replace") if m else "(unknown)"
        src = src.replace("\\\\", "/").replace("\\", "/")
        for name in hits:
            by_kind[name] += 1
            paths_by_kind[name][src] += 1

    return {
        "corpus": path,
        "chunks_scanned": total,
        "chunks_flagged": flagged,
        "oversized_slices": oversized,
        "oversized_bytes": oversized_bytes,
        "by_kind": dict(by_kind.most_common()),
        "top_paths": {
            kind: [{"source_file": p, "chunks": n}
                   for p, n in counter.most_common(max_paths)]
            for kind, counter in paths_by_kind.items()
        },
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", help="Path to the .jsonl corpus to scan.")
    parser.add_argument("--report", help="Write the JSON summary here as well.")
    parser.add_argument("--max-paths", type=int, default=12,
                        help="Distinct source paths to list per finding kind.")
    args = parser.parse_args(argv)

    if not os.path.isfile(args.corpus):
        print("no such file: %s" % args.corpus, file=sys.stderr)
        return 2

    summary = scan(args.corpus, args.max_paths)

    print("corpus:          %s" % summary["corpus"])
    print("chunks scanned:  %s" % format(summary["chunks_scanned"], ","))
    print("chunks flagged:  %s" % format(summary["chunks_flagged"], ","))
    if summary["oversized_slices"]:
        print("\n!! CORPUS DAMAGED: %s oversized span(s), %s bytes with no "
              "newline.\n   A chunk is a few KB; this is a truncated or "
              "double-written merge.\n   Rebuild the corpus -- the counts "
              "above describe a corrupt file."
              % (format(summary["oversized_slices"], ","),
                 format(summary["oversized_bytes"], ",")))
    if not summary["by_kind"]:
        print("\nno credential patterns matched.")
    else:
        print("\n-- findings by kind --")
        for kind, n in summary["by_kind"].items():
            print("  %-22s %8s" % (kind, format(n, ",")))
        print("\n-- source files (values never printed) --")
        for kind, entries in summary["top_paths"].items():
            print("  %s:" % kind)
            for e in entries:
                print("    %6s  %s" % (format(e["chunks"], ","), e["source_file"][:110]))

    if args.report:
        os.makedirs(os.path.dirname(os.path.abspath(args.report)) or ".", exist_ok=True)
        with open(args.report, "w", encoding="utf-8") as handle:
            json.dump(summary, handle, indent=2, ensure_ascii=False)
        print("\nreport -> %s" % args.report)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
