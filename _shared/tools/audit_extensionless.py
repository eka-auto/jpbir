#!/usr/bin/env python3
"""Report what the extensionless-source chunks in a corpus actually are.

``merge_chunks.py`` buckets 153,498 chunks under ``(none)`` -- ``splitext``
found no extension on their ``source_file``. That bucket is exactly where the
Chromium disk-cache blobs hid on D: (``data_1``, ``f_0000ab``, ``index``), and
the C: parts were built by the crawler *before* that hole was closed. So the
bucket needs eyes on it before anything trains on the corpus.

Splits findings into three groups so the answer is readable at a glance:

  known-good   dotfiles and conventional extensionless text (.env, Makefile,
               LICENSE, Dockerfile, ...) -- legitimate personal/source material
  cache-junk   basenames matching known browser/app cache blob shapes
  unknown      everything else, listed by basename and by parent directory

Read-only. Prints counts and paths; never prints chunk text.

Usage:
    python tools/audit_extensionless.py runs/jt_agent/chunks.jsonl
    python tools/audit_extensionless.py runs/jt_agent/chunks.jsonl --report out.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from typing import Dict, List, Optional

# Names that legitimately carry no extension. Anything here is personal or
# source material and is expected in the corpus.
KNOWN_GOOD = {
    "makefile", "dockerfile", "license", "licence", "readme", "notice",
    "changelog", "authors", "contributors", "copying", "install", "news",
    "todo", "version", "procfile", "vagrantfile", "rakefile", "gemfile",
    "brewfile", "justfile", "cmakelists", "codeowners", "manifest",
}

# Chromium / Electron disk-cache artifacts. ``data_N`` and ``f_XXXXXX`` are
# the simple-cache block files; ``index`` is its table of contents. These are
# extensionless binary blobs and are the reason this audit exists.
CACHE_SHAPES = [
    re.compile(r"^data_\d+$"),
    re.compile(r"^f_[0-9a-f]{6,}$"),
    re.compile(r"^index$"),
    re.compile(r"^the-real-index$"),
    re.compile(r"^index-dir$"),
    re.compile(r"^\d{6}$"),          # leveldb .ldb siblings / numbered blobs
    re.compile(r"^lock$"),
    re.compile(r"^current$"),
    re.compile(r"^manifest-\d+$"),
]


def classify(basename: str) -> str:
    name = basename.lower()
    if name.startswith("."):
        return "known-good"          # .env, .gitignore, .bashrc, ...
    if name in KNOWN_GOOD:
        return "known-good"
    if any(rx.match(name) for rx in CACHE_SHAPES):
        return "cache-junk"
    return "unknown"


def audit(path: str, top: int = 40) -> Dict[str, object]:
    scanned = 0
    extensionless = 0
    malformed = 0
    by_group: Counter = Counter()
    tokens_by_group: Counter = Counter()
    names: Dict[str, Counter] = {g: Counter() for g in
                                 ("known-good", "cache-junk", "unknown")}
    unknown_dirs: Counter = Counter()

    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            scanned += 1
            try:
                record = json.loads(line)
            except ValueError:
                malformed += 1
                continue

            source = record.get("source_file") or ""
            if os.path.splitext(source)[1]:
                continue

            extensionless += 1
            norm = source.replace("\\", "/")
            basename = os.path.basename(norm)
            group = classify(basename)

            by_group[group] += 1
            tokens_by_group[group] += int(record.get("token_count") or 0)
            names[group][basename.lower()] += 1
            if group == "unknown":
                unknown_dirs[os.path.dirname(norm).lower()] += 1

    return {
        "corpus": path,
        "chunks_scanned": scanned,
        "malformed_lines": malformed,
        "extensionless_chunks": extensionless,
        "by_group": dict(by_group.most_common()),
        "tokens_by_group": dict(tokens_by_group.most_common()),
        "top_names": {g: [{"basename": n, "chunks": k}
                          for n, k in names[g].most_common(top)]
                      for g in names},
        "top_unknown_dirs": [{"dir": d, "chunks": k}
                             for d, k in unknown_dirs.most_common(top)],
        "distinct_unknown_names": len(names["unknown"]),
        "distinct_unknown_dirs": len(unknown_dirs),
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", help="Path to the .jsonl corpus to audit.")
    parser.add_argument("--report", help="Write the JSON summary here as well.")
    parser.add_argument("--top", type=int, default=40,
                        help="Entries to list per group.")
    args = parser.parse_args(argv)

    if not os.path.isfile(args.corpus):
        print("no such file: %s" % args.corpus, file=sys.stderr)
        return 2

    summary = audit(args.corpus, args.top)

    print("corpus:              %s" % summary["corpus"])
    print("chunks scanned:      %s" % format(summary["chunks_scanned"], ","))
    print("extensionless:       %s" % format(summary["extensionless_chunks"], ","))
    print("\n-- groups --")
    for group, n in summary["by_group"].items():
        toks = summary["tokens_by_group"].get(group, 0)
        print("  %-12s %10s chunks  %14s tokens"
              % (group, format(n, ","), format(toks, ",")))

    for group in ("cache-junk", "unknown", "known-good"):
        entries = summary["top_names"].get(group) or []
        if not entries:
            continue
        print("\n-- %s basenames --" % group)
        for e in entries:
            print("  %8s  %s" % (format(e["chunks"], ","), e["basename"][:90]))

    if summary["top_unknown_dirs"]:
        print("\n-- unknown, by parent directory (%s distinct) --"
              % format(summary["distinct_unknown_dirs"], ","))
        for e in summary["top_unknown_dirs"]:
            print("  %8s  %s" % (format(e["chunks"], ","), e["dir"][:110]))

    if args.report:
        os.makedirs(os.path.dirname(os.path.abspath(args.report)) or ".",
                    exist_ok=True)
        with open(args.report, "w", encoding="utf-8") as handle:
            json.dump(summary, handle, indent=2, ensure_ascii=False)
        print("\nreport -> %s" % args.report)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
