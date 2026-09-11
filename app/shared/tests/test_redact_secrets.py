#!/usr/bin/env python3
"""Tests for tools/redact_secrets.py.

Three things have to hold, or redaction is worse than useless:

  1. The secret is gone and the surrounding conversation is not. The whole
     point of redacting rather than dropping is to keep .codex/.claude/.gemini
     session logs, so the prose either side of a key must survive byte-exact.

  2. The output is still valid JSONL with every field intact. A placeholder
     containing a quote or backslash would corrupt the record it was meant to
     sanitise.

  3. A PEM block loses its BODY, not just its header. scan_secrets detects a
     private key by its "-----BEGIN" line; replacing only that line would
     leave the actual key material sitting in the corpus and the scanner would
     then report the file clean.

Planted values are obvious fakes (repeated characters).

Usage:
    python tools/test_redact_secrets.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import redact_secrets as rs  # noqa: E402
import scan_secrets as ss  # noqa: E402

FAKE_OPENAI = "sk-" + "d" * 44
FAKE_AWS = "AKIA" + "E" * 16
FAKE_BODY = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBK" + "F" * 60
FAKE_PEM = ("-----BEGIN RSA PRIVATE KEY-----\\n"
            + FAKE_BODY + "\\n-----END RSA PRIVATE KEY-----")

PROSE = "जयति ने पूछा कि बिल कहाँ है, and I answered with the invoice total."


def build(tmp: str) -> str:
    path = os.path.join(tmp, "in.jsonl")
    recs = [
        {"chunk_id": "a:0", "source_file": "C:/JP/clean.txt",
         "text": PROSE, "token_count": 12,
         "metadata": {"corpus_label": "misc"}},
        {"chunk_id": "b:0", "source_file": "D:/Previous/.codex/sessions/x.jsonl",
         "text": "before the key " + FAKE_OPENAI + " after the key",
         "token_count": 20, "metadata": {"corpus_label": "misc"}},
        {"chunk_id": "c:0", "source_file": "C:/JP/aws.txt",
         "text": "id=" + FAKE_AWS + " region=ap-south-1",
         "token_count": 9, "metadata": {"corpus_label": "misc"}},
        {"chunk_id": "d:0", "source_file": "C:/jp-final/docs/ENV.md",
         "text": "key follows:\\n" + FAKE_PEM + "\\ndone",
         "token_count": 40, "metadata": {"corpus_label": "misc"}},
    ]
    with open(path, "w", encoding="utf-8") as handle:
        for r in recs:
            handle.write(json.dumps(r, ensure_ascii=False) + "\n")
    return path


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        src = build(tmp)
        out = os.path.join(tmp, "out.jsonl")
        s = rs.redact(src, out)

        print("scanned %d, redacted %d, values replaced %d"
              % (s["chunks_scanned"], s["chunks_redacted"],
                 s["values_replaced"]))
        print("by kind: %s" % s["replacements_by_kind"])

        assert s["chunks_scanned"] == 4, s["chunks_scanned"]
        assert s["chunks_redacted"] == 3, s["chunks_redacted"]

        raw = open(out, "rb").read()
        # 1. secrets gone
        for fake in (FAKE_OPENAI, FAKE_AWS, FAKE_BODY):
            assert fake.encode() not in raw, "a planted secret survived"
        assert b"-----BEGIN RSA PRIVATE KEY-----" not in raw, \
            "PEM header survived"

        # 2. output is valid JSONL with fields intact
        records = [json.loads(l) for l in open(out, encoding="utf-8") if l.strip()]
        assert len(records) == 4, len(records)
        for r in records:
            assert r["chunk_id"] and r["source_file"] and r["text"] is not None
            assert r["metadata"]["corpus_label"] == "misc"

        # 3. context preserved -- this is the reason for redacting at all
        assert records[0]["text"] == PROSE, "clean record was altered"
        assert records[1]["text"].startswith("before the key ")
        assert records[1]["text"].endswith(" after the key")
        assert "[REDACTED-OPENAI_KEY]" in records[1]["text"]
        assert records[2]["text"].endswith(" region=ap-south-1")
        assert "[REDACTED-PRIVATE_KEY_BLOCK]" in records[3]["text"]
        assert records[3]["text"].endswith("done")

        # 4. the scanner now finds nothing -- the end-to-end contract
        after = ss.scan(out)
        print("rescan: %d scanned, %d flagged, kinds=%s"
              % (after["chunks_scanned"], after["chunks_flagged"],
                 after["by_kind"]))
        assert after["chunks_flagged"] == 0, after["by_kind"]

    print("\nALL ASSERTIONS PASSED "
          "(secrets removed, PEM body removed, context and JSON intact, "
          "rescan clean)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
