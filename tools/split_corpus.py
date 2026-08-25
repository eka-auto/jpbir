#!/usr/bin/env python3
"""Split merged corpus into two agent-specific chunk files.

Automobile Agent (Agent 1):
  Labels: go4garage, g4g_products, repos_e2e
  Output: runs/automobile_agent/chunks.jsonl

JT Agent (Jay's Agent):
  Everything else (profile, device, personal life, code, etc.)
  Output: runs/jt_agent/chunks_jt.jsonl
"""

from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SRC = os.path.join(ROOT, "runs", "jt_agent", "chunks.jsonl")
AUTO_OUT = os.path.join(ROOT, "runs", "automobile_agent", "chunks.jsonl")
JT_OUT = os.path.join(ROOT, "runs", "jt_agent", "chunks_jt.jsonl")

# Labels that belong to the automobile / Go4Garage agent
AUTO_LABELS = {"go4garage", "g4g_products", "repos_e2e"}

# Source-file path fragments that indicate Go4Garage content
AUTO_KEYWORDS = ["go4garage", "g4g", "g_4_g", "garage", "automobile", "vehicle"]


def is_automobile(chunk: dict) -> bool:
    label = chunk.get("metadata", {}).get("corpus_label", "")
    if label in AUTO_LABELS:
        return True
    src = chunk.get("source_file", "").lower()
    return any(kw in src for kw in AUTO_KEYWORDS)


def main() -> None:
    if not os.path.isfile(SRC):
        print("ERROR: source corpus not found: %s" % SRC)
        sys.exit(1)

    os.makedirs(os.path.dirname(AUTO_OUT), exist_ok=True)

    auto_count = 0
    jt_count = 0
    errors = 0

    print("Splitting corpus: %s" % SRC)
    print("  → Automobile Agent: %s" % AUTO_OUT)
    print("  → JT Agent:         %s" % JT_OUT)
    print()

    with open(SRC, "r", encoding="utf-8") as f_in, \
         open(AUTO_OUT, "w", encoding="utf-8") as f_auto, \
         open(JT_OUT, "w", encoding="utf-8") as f_jt:

        for i, line in enumerate(f_in):
            line = line.strip()
            if not line:
                continue
            try:
                chunk = json.loads(line)
            except json.JSONDecodeError:
                errors += 1
                continue

            if is_automobile(chunk):
                f_auto.write(line + "\n")
                auto_count += 1
            else:
                f_jt.write(line + "\n")
                jt_count += 1

            if (i + 1) % 100_000 == 0:
                print("  %d processed  |  auto=%d  jt=%d" % (i + 1, auto_count, jt_count))

    total = auto_count + jt_count
    print()
    print("Done.")
    print("  Total chunks:       %d" % total)
    print("  Automobile Agent:   %d chunks  (%.1f%%)" % (auto_count, 100 * auto_count / max(total, 1)))
    print("  JT Agent:           %d chunks  (%.1f%%)" % (jt_count, 100 * jt_count / max(total, 1)))
    if errors:
        print("  Malformed lines:    %d (skipped)" % errors)


if __name__ == "__main__":
    main()
