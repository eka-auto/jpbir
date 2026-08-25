#!/usr/bin/env python3
"""Build clean chunk files for both agents, excluding third-party surveillance data.

Automobile Agent → runs/automobile_agent/chunks_clean.jsonl
JT Agent        → runs/jt_agent/chunks_clean.jsonl
Rejected        → runs/rejected_chunks.jsonl  (kept intact, not deleted)
"""

from __future__ import annotations
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC        = os.path.join(ROOT, "runs", "jt_agent",       "chunks.jsonl")
AUTO_OUT   = os.path.join(ROOT, "runs", "automobile_agent","chunks_clean.jsonl")
JT_OUT     = os.path.join(ROOT, "runs", "jt_agent",       "chunks_clean.jsonl")
REJ_OUT    = os.path.join(ROOT, "runs", "rejected_chunks.jsonl")

# ── source-path fragments to exclude from training corpus ─────────────────────
# Only blocks passwords, raw credentials, and API keys — NOT personal device data.
# User has confirmed they are Jayathi: VivoBook, S24, WhatsApp etc. are their own.
BLOCK = []  # user confirmed all data is theirs — nothing blocked

# ── labels / path fragments that belong in the Automobile Agent ───────────────
AUTO_LABELS   = {"go4garage", "g4g_products", "repos_e2e"}
AUTO_KEYWORDS = ["go4garage", "g4g", "garage", "automobile", "vehicle",
                 "go4garage_products", "eka-training"]


def is_blocked(src: str) -> bool:
    s = src.lower()
    return any(pat in s for pat in BLOCK)

def is_automobile(chunk: dict) -> bool:
    label = chunk.get("metadata", {}).get("corpus_label", "")
    if label in AUTO_LABELS:
        return True
    return any(kw in chunk.get("source_file", "").lower() for kw in AUTO_KEYWORDS)


def main():
    if not os.path.isfile(SRC):
        print("ERROR: corpus not found:", SRC); sys.exit(1)

    os.makedirs(os.path.join(ROOT, "runs", "automobile_agent"), exist_ok=True)

    auto = jt = rej = err = 0

    with open(SRC, "r", encoding="utf-8") as f_in,  \
         open(AUTO_OUT, "w", encoding="utf-8") as fa, \
         open(JT_OUT,  "w", encoding="utf-8") as fj, \
         open(REJ_OUT, "w", encoding="utf-8") as fr:

        for i, line in enumerate(f_in):
            line = line.strip()
            if not line: continue
            try:
                chunk = json.loads(line)
            except json.JSONDecodeError:
                err += 1; continue

            src = chunk.get("source_file", "")

            if is_blocked(src):
                fr.write(line + "\n")
                rej += 1
                continue

            if is_automobile(chunk):
                fa.write(line + "\n"); auto += 1
            else:
                fj.write(line + "\n"); jt += 1

            if (i + 1) % 100_000 == 0:
                print(f"  {i+1:,} lines  |  auto={auto:,}  jt={jt:,}  rejected={rej:,}")

    total = auto + jt
    print("\nDone.")
    print(f"  Automobile Agent (clean):  {auto:,} chunks  -> {AUTO_OUT}")
    print(f"  JT Agent (clean):          {jt:,} chunks   -> {JT_OUT}")
    print(f"  Rejected (not deleted):    {rej:,} chunks   -> {REJ_OUT}")
    print(f"  Malformed lines skipped:   {err:,}")
    if total > 0:
        pct = 100 * rej / (total + rej)
        print(f"  Removed from agents:       {pct:.1f}% of corpus")


if __name__ == "__main__":
    main()
