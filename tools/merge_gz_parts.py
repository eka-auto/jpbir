#!/usr/bin/env python3
"""Append jayti_personal_chunks.jsonl.gz and diac_case_chunks.jsonl.gz
into the existing clean agent chunk files.

jayti_personal_chunks  -> jt_agent/chunks_clean.jsonl   (personal data)
diac_case_chunks       -> automobile_agent/chunks_clean.jsonl  (legal/business)
"""

from __future__ import annotations
import gzip, json, os, sys

ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ABCOM  = r"C:\Users\abcom"

PERSONAL_GZ = os.path.join(ABCOM, "jayti_personal_chunks.jsonl.gz")
DIAC_GZ     = os.path.join(ABCOM, "diac_case_chunks.jsonl.gz")

AUTO_OUT = os.path.join(ROOT, "runs", "automobile_agent", "chunks_clean.jsonl")
JT_OUT   = os.path.join(ROOT, "runs", "jt_agent",        "chunks_clean.jsonl")


def append_gz(gz_path: str, out_path: str, label: str) -> int:
    if not os.path.isfile(gz_path):
        print(f"  SKIP (not found): {gz_path}")
        return 0
    count = 0
    with gzip.open(gz_path, "rt", encoding="utf-8", errors="replace") as f_in, \
         open(out_path, "a", encoding="utf-8") as f_out:
        for line in f_in:
            line = line.strip()
            if not line:
                continue
            try:
                json.loads(line)   # validate
            except json.JSONDecodeError:
                continue
            f_out.write(line + "\n")
            count += 1
            if count % 50_000 == 0:
                print(f"    {label}: {count:,} written so far...")
    return count


def main():
    print("Appending jayti_personal_chunks.jsonl.gz -> JT Agent ...")
    n1 = append_gz(PERSONAL_GZ, JT_OUT, "JT")
    print(f"  Done: {n1:,} chunks added to {JT_OUT}")

    print("Appending diac_case_chunks.jsonl.gz -> Automobile Agent ...")
    n2 = append_gz(DIAC_GZ, AUTO_OUT, "AUTO")
    print(f"  Done: {n2:,} chunks added to {AUTO_OUT}")

    print(f"\nTotal added: {n1 + n2:,} chunks")


if __name__ == "__main__":
    main()
