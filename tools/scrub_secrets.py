"""Find, and optionally drop, chunks containing live credentials.

``build_jt_chunks.py`` filters secrets by *filename*, which is necessary but
not sufficient: ``serviceAccountKey.json`` matches none of its globs, and a
private key pasted into a markdown runbook has no filename to match at all.
This pass reads the chunk text itself.

It matters because the corpus is uploaded to a GPU host for training, and a
fine-tuned model reproduces what it was shown. A private key inside the
weights cannot be revoked by deleting a file afterwards.

Report first, then act:

    python tools/scrub_secrets.py --part "runs/jt_agent/parts/*.jsonl"
    python tools/scrub_secrets.py --part "runs/jt_agent/parts/*.jsonl" --write

``--write`` rewrites each part in place, dropping offending chunks and saving
the originals alongside as ``<name>.jsonl.preScrub``. Matched secrets are
never printed -- only counts, kinds, and source paths.
"""

from __future__ import annotations

import argparse
import collections
import glob
import json
import os
import re
import shutil
import sys
from typing import Dict, List, Optional, Tuple

# Ordered most-severe first. Patterns are deliberately narrow: a false
# positive costs one chunk, a false negative ships a live key.
PATTERNS: List[Tuple[str, "re.Pattern[str]"]] = [
    ("private_key_block", re.compile(
        r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----")),
    ("gcp_service_account", re.compile(
        r'"type"\s*:\s*"service_account"')),
    ("google_api_key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    ("github_token", re.compile(
        r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b")),
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("slack_token", re.compile(r"\bxox[abposr]-[0-9A-Za-z\-]{10,}\b")),
    ("openai_key", re.compile(r"\bsk-[A-Za-z0-9]{32,}\b")),
    ("anthropic_key", re.compile(r"\bsk-ant-[A-Za-z0-9\-_]{20,}\b")),
    ("openrouter_key", re.compile(r"\bsk-or-v1-[A-Za-z0-9]{20,}\b")),
    ("generic_api_key", re.compile(r"\b[A-Z_]{3,}API[_]KEY\s*=\s*[A-Za-z0-9\-_]{20,}\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b")),
    ("private_key_json_field", re.compile(r'"private_key"\s*:\s*"-----BEGIN')),
]

# A key block that is obviously a fill-in-the-blank example. Kept separate so
# a template does not inflate the "live secret" count -- but still dropped,
# because nothing is lost by dropping it.
PLACEHOLDER = re.compile(
    r"YOUR[_\- ]?(?:PRIVATE[_\- ]?KEY|KEY|SECRET)|<[A-Z_ ]{3,}>|"
    r"xxxx|XXXX|\.\.\.\.|PLACEHOLDER|EXAMPLE_KEY|INSERT[_\- ]",
)


def classify(text: str) -> List[str]:
    """Return the names of every secret pattern present in ``text``."""
    return [name for name, pattern in PATTERNS if pattern.search(text)]


def scan_part(path: str) -> Dict[str, object]:
    """Scan one part file without modifying it."""
    kinds: collections.Counter = collections.Counter()
    files: collections.Counter = collections.Counter()
    offending = 0
    placeholder_only = 0
    total = 0

    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            total += 1
            try:
                record = json.loads(line)
            except ValueError:
                continue
            text = record.get("text") or ""
            hits = classify(text)
            if not hits:
                continue
            offending += 1
            if PLACEHOLDER.search(text):
                placeholder_only += 1
            for hit in hits:
                kinds[hit] += 1
            files[record.get("source_file", "?")] += 1

    return {
        "part": path,
        "chunks": total,
        "chunks_with_secrets": offending,
        "looks_templated": placeholder_only,
        "by_kind": dict(kinds.most_common()),
        "source_files": [
            {"file": name, "chunks": count} for name, count in files.most_common(25)
        ],
    }


def scrub_part(path: str) -> Dict[str, object]:
    """Rewrite one part in place, dropping chunks that carry secrets."""
    backup = path + ".preScrub"
    if not os.path.exists(backup):
        shutil.copy2(path, backup)

    kept = 0
    dropped = 0
    temp = path + ".tmp"

    with open(backup, "r", encoding="utf-8") as source, \
            open(temp, "w", encoding="utf-8") as out:
        for line in source:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                record = json.loads(stripped)
            except ValueError:
                dropped += 1
                continue
            if classify(record.get("text") or ""):
                dropped += 1
                continue
            out.write(stripped + "\n")
            kept += 1

    os.replace(temp, path)
    return {"part": path, "kept": kept, "dropped": dropped, "backup": backup}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--part", action="append", dest="parts", required=True,
                        help="Part .jsonl path or glob. Repeatable.")
    parser.add_argument("--write", action="store_true",
                        help="Drop offending chunks in place (backs up first).")
    parser.add_argument("--report")
    args = parser.parse_args(argv)

    expanded: List[str] = []
    for pattern in args.parts:
        matches = sorted(glob.glob(pattern))
        expanded.extend(matches if matches else [pattern])
    expanded = [p for p in expanded if os.path.isfile(p) and not p.endswith(".preScrub")]

    reports = [scan_part(path) for path in expanded]
    total_offending = sum(int(r["chunks_with_secrets"]) for r in reports)

    summary: Dict[str, object] = {
        "parts_scanned": len(reports),
        "total_chunks_with_secrets": total_offending,
        "safe_to_upload": total_offending == 0,
        "details": reports,
    }

    if args.write and total_offending:
        summary["scrubbed"] = [scrub_part(r["part"]) for r in reports
                               if int(r["chunks_with_secrets"])]

    rendered = json.dumps(summary, indent=2, ensure_ascii=False)
    print(rendered)
    if args.report:
        os.makedirs(os.path.dirname(os.path.abspath(args.report)) or ".", exist_ok=True)
        with open(args.report, "w", encoding="utf-8") as handle:
            handle.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
