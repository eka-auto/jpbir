#!/usr/bin/env python3
"""Replace credential values in a corpus with typed placeholders.

The 2026-08-21 scan of runs/jt_agent/chunks.jsonl flagged 522 chunks across
nine credential kinds. Dropping those chunks would be the crude fix, but most
of them are AI coding-assistant session logs -- .codex/sessions,
.claude/projects, .gemini/antigravity-*/brain -- which are the richest
personal material in the whole corpus. Deleting a whole conversation because
one line of it echoed an API key trades the wrong thing away.

So: substitute the value, keep the context. "sk-abc...xyz" becomes
"[REDACTED-OPENAI_KEY]". A model trained on this learns that a key appeared
in the conversation without learning the key.

Operates on the raw JSON line. Placeholders are plain ASCII with no quote or
backslash, so a valid line stays valid -- verify_corpus.py re-checks that
afterwards regardless.

This does NOT make the originals safe. Any key found here is on disk in the
source file and, for the project files, probably in git history too. Redacting
the training corpus is not rotating the credential. Rotate them.

Usage:
    python tools/redact_secrets.py runs/jt_agent/chunks.jsonl \
        --out runs/jt_agent/chunks.redacted.jsonl \
        --report runs/jt_agent/redaction_report.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from typing import Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scan_secrets import PATTERNS, iter_lines  # noqa: E402

# A PEM block is detected by its header alone, but redacting only the header
# would leave the key body sitting in the corpus. Match through the footer.
# Chunks are JSON, so the newlines inside the block are literal backslash-n
# escapes rather than real newlines; [\s\S] covers both spellings.
_PEM_SPAN = re.compile(
    rb"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"
    rb"[\s\S]{0,8192}?"
    rb"-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"
)

# Order matters: the PEM span must run before the bare-header pattern, or the
# header is replaced first and the body is orphaned.
REDACTIONS = (
    [("private_key_block", _PEM_SPAN)]
    + [(name, rx) for name, rx in PATTERNS if name != "private_key_block"]
    + [(name, rx) for name, rx in PATTERNS if name == "private_key_block"]
)


def placeholder(kind: str) -> bytes:
    return ("[REDACTED-%s]" % kind.upper()).encode("ascii")


def redact(in_path: str, out_path: str) -> Dict[str, object]:
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)

    total = 0
    changed = 0
    oversized = 0
    by_kind: Counter = Counter()
    chunks_by_kind: Counter = Counter()

    with open(out_path, "wb") as out:
        for line, is_oversized in iter_lines(in_path):
            if is_oversized:
                oversized += 1
            else:
                total += 1
            original = line
            kinds_here = set()
            for kind, rx in REDACTIONS:
                line, n = rx.subn(placeholder(kind), line)
                if n:
                    by_kind[kind] += n
                    kinds_here.add(kind)
            if line != original:
                changed += 1
                for kind in kinds_here:
                    chunks_by_kind[kind] += 1
            out.write(line)
            if not is_oversized:
                out.write(b"\n")

    return {
        "input": in_path,
        "output": out_path,
        "chunks_scanned": total,
        "chunks_redacted": changed,
        "oversized_slices": oversized,
        "values_replaced": sum(by_kind.values()),
        "replacements_by_kind": dict(by_kind.most_common()),
        "chunks_affected_by_kind": dict(chunks_by_kind.most_common()),
        "output_bytes": os.path.getsize(out_path),
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus")
    parser.add_argument("--out", required=True, help="Redacted corpus path.")
    parser.add_argument("--report", help="Write the JSON summary here as well.")
    args = parser.parse_args(argv)

    if not os.path.isfile(args.corpus):
        print("no such file: %s" % args.corpus, file=sys.stderr)
        return 2
    if os.path.abspath(args.corpus) == os.path.abspath(args.out):
        print("refusing to redact in place; choose a different --out",
              file=sys.stderr)
        return 2

    s = redact(args.corpus, args.out)

    print("input:            %s" % s["input"])
    print("output:           %s" % s["output"])
    print("chunks scanned:   %s" % format(s["chunks_scanned"], ","))
    print("chunks redacted:  %s" % format(s["chunks_redacted"], ","))
    print("values replaced:  %s" % format(s["values_replaced"], ","))
    if s["oversized_slices"]:
        print("\n!! %s oversized span(s) -- input corpus may be damaged; "
              "run verify_corpus.py" % format(s["oversized_slices"], ","))
    if s["replacements_by_kind"]:
        print("\n-- replacements by kind --")
        for kind, n in s["replacements_by_kind"].items():
            print("  %-22s %8s" % (kind, format(n, ",")))

    if args.report:
        os.makedirs(os.path.dirname(os.path.abspath(args.report)) or ".",
                    exist_ok=True)
        with open(args.report, "w", encoding="utf-8") as handle:
            json.dump(s, handle, indent=2, ensure_ascii=False)
        print("\nreport -> %s" % args.report)

    print("\nRedaction is not rotation. Every key found here still exists in "
          "its source file,\nand the project-file hits are likely in git "
          "history. Rotate them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
