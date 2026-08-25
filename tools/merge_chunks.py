"""Merge chunk part files into a single training corpus, de-duplicated.

Each part is produced independently by ``tools/build_jt_chunks.py``. Roots
can overlap (a backup folder holding a copy of a work folder, say), so the
same chunk can appear in more than one part. ``chunk_id`` is
``<source_file>:<chunk_index>`` and is the identity used here; the first
occurrence wins and later duplicates are counted, not silently dropped.

Whole source trees can be dropped at merge time with ``--exclude-source``.
Crawled roots sometimes pull in tooling that is not personal material --
runner logs, framework checkouts -- and those swamp the signal in a corpus
meant to be trained on one person's data. Patterns match against a
normalised ``source_file`` (lowercased, backslashes folded to forward
slashes), so ``c:/eka2/`` catches both spellings the crawler emits.

Usage:
    python tools/merge_chunks.py --out runs/jt_agent/chunks.jsonl \\
        --part runs/jt_agent/parts/*.jsonl \\
        --part runs/documents/checkpoints/chunks.jsonl \\
        --exclude-source c:/eka2/ --exclude-source c:/eka-runner/
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import string
import sys
from collections import Counter
from typing import Dict, List, Optional, Set

# Characters that real text does not contain. Deliberately defined as a small
# BAD set rather than a printable-ASCII GOOD set: this corpus is bilingual, and
# scoring against string.printable marks Devanagari as binary and deletes every
# Hindi chunk. Verified by test -- the ASCII version dropped
# "नमस्ते जयति, जून का बिल संलग्न है।" as 0% printable.
#
# C0 controls except tab/newline/carriage-return, DEL, the C1 block, and U+FFFD
# (what errors="replace" leaves behind when a binary file is decoded as text).
_NON_TEXT = (
    [c for c in range(0x00, 0x20) if c not in (0x09, 0x0A, 0x0D)]
    + [0x7F]
    + list(range(0x80, 0xA0))
    + [0xFFFD]
)

# str.translate runs in C. A per-character generator over a 745M-token corpus
# does not finish in ten minutes; this does it in about three.
_DELETE_NON_TEXT = {c: None for c in _NON_TEXT}

# A 512-character head is ample to tell an MP4 container or a SQLite page
# from prose, and bounds the cost per chunk regardless of chunk size.
_PRINTABLE_SAMPLE = 512


def normalise_source(source: str) -> str:
    """Lowercase and fold separators so one pattern matches either style."""
    return source.replace("\\", "/").lower()


def printable_ratio(text: str) -> float:
    """Fraction of a chunk's leading characters that could be human text.

    Binary files that were decoded with ``errors="replace"`` chunk cleanly and
    look like valid records -- they simply hold U+FFFD and control characters
    instead of language. Nothing upstream rejects them: the crawler gates on
    file extension, and ``AUD-20260526-WA0003`` (a 3GP audio file) has none.
    Measuring the text itself catches those regardless of what they are named.

    Any assigned character counts as text, so Hindi, emoji and accented Latin
    all score 1.0. Only controls and replacement characters count against.
    """
    sample = text[:_PRINTABLE_SAMPLE]
    if not sample:
        return 1.0
    return len(sample.translate(_DELETE_NON_TEXT)) / len(sample)


def merge(part_paths: List[str], out_path: str, min_tokens: int,
          exclude_sources: Optional[List[str]] = None,
          min_printable: float = 0.0) -> Dict[str, object]:
    """Concatenate parts into one JSONL, dropping duplicate chunk_ids."""
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)

    patterns = [normalise_source(p) for p in (exclude_sources or [])]

    seen: Set[str] = set()
    written = 0
    excluded = 0
    per_pattern: Counter = Counter()
    duplicates = 0
    too_short = 0
    binary_dropped = 0
    binary_tokens = 0
    binary_by_extension: Counter = Counter()
    malformed = 0
    tokens = 0
    per_part: Dict[str, int] = {}
    by_label: Counter = Counter()
    by_extension: Counter = Counter()

    with open(out_path, "w", encoding="utf-8") as out:
        for part in part_paths:
            kept_here = 0
            if not os.path.isfile(part):
                print("  [skip] missing part: %s" % part, file=sys.stderr)
                per_part[part] = 0
                continue

            with open(part, "r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except ValueError:
                        malformed += 1
                        continue

                    if patterns:
                        candidate = normalise_source(record.get("source_file") or "")
                        hit = next((p for p in patterns if p in candidate), None)
                        if hit is not None:
                            excluded += 1
                            per_pattern[hit] += 1
                            continue

                    chunk_id = record.get("chunk_id")
                    if not chunk_id:
                        malformed += 1
                        continue
                    if chunk_id in seen:
                        duplicates += 1
                        continue
                    if int(record.get("token_count") or 0) < min_tokens:
                        too_short += 1
                        continue
                    if min_printable > 0.0:
                        if printable_ratio(record.get("text") or "") < min_printable:
                            binary_dropped += 1
                            binary_tokens += int(record.get("token_count") or 0)
                            binary_by_extension[
                                os.path.splitext(
                                    normalise_source(record.get("source_file") or "")
                                )[1] or "(none)"] += 1
                            continue

                    seen.add(chunk_id)
                    out.write(json.dumps(record, ensure_ascii=False) + "\n")
                    written += 1
                    kept_here += 1
                    tokens += int(record.get("token_count") or 0)

                    metadata = record.get("metadata") or {}
                    by_label[metadata.get("corpus_label", "unlabelled")] += 1
                    source = record.get("source_file", "")
                    by_extension[os.path.splitext(source)[1].lower() or "(none)"] += 1

            per_part[part] = kept_here

    return {
        "out": out_path,
        "parts": per_part,
        "chunks_written": written,
        "excluded_by_source": excluded,
        "excluded_per_pattern": dict(per_pattern.most_common()),
        "duplicates_dropped": duplicates,
        "short_chunks_dropped": too_short,
        "binary_chunks_dropped": binary_dropped,
        "binary_tokens_dropped": binary_tokens,
        "binary_dropped_by_extension": dict(binary_by_extension.most_common(15)),
        "malformed_lines": malformed,
        "total_tokens": tokens,
        "approx_mb": round(os.path.getsize(out_path) / (1024 * 1024), 1),
        "by_label": dict(by_label.most_common()),
        "by_extension": dict(by_extension.most_common(15)),
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--part", action="append", dest="parts", required=True,
                        help="Part .jsonl path or glob. Repeatable.")
    parser.add_argument("--out", required=True, help="Merged output .jsonl path.")
    parser.add_argument("--min-tokens", type=int, default=1,
                        help="Drop chunks with fewer tokens than this.")
    parser.add_argument("--exclude-source", action="append", dest="exclude_sources",
                        default=[],
                        help="Drop chunks whose source_file contains this "
                             "(case-insensitive, separator-agnostic) substring. "
                             "Repeatable.")
    parser.add_argument("--min-printable", type=float, default=0.0,
                        help="Drop chunks whose leading 512 characters are "
                             "less than this fraction printable text. 0 "
                             "disables the check; 0.85 rejects decoded binary "
                             "while keeping heavily-accented prose.")
    parser.add_argument("--report", help="Write the JSON summary here as well.")
    args = parser.parse_args(argv)

    expanded: List[str] = []
    for pattern in args.parts:
        matches = sorted(glob.glob(pattern))
        expanded.extend(matches if matches else [pattern])

    summary = merge(expanded, args.out, args.min_tokens, args.exclude_sources,
                    args.min_printable)
    rendered = json.dumps(summary, indent=2, ensure_ascii=False)
    print(rendered)
    if args.report:
        os.makedirs(os.path.dirname(os.path.abspath(args.report)) or ".", exist_ok=True)
        with open(args.report, "w", encoding="utf-8") as handle:
            handle.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
