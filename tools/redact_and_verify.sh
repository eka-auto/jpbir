#!/usr/bin/env bash
# Redact the 522 flagged credential values, then prove the result is clean.
#
# Redaction rather than exclusion: most of the hits are .codex / .claude /
# .gemini session logs, the richest personal material in the corpus. Dropping
# a whole conversation because one line of it echoed an API key throws away
# the wrong thing. The value goes, the context stays.
#
# The rescan in step 4 is the actual contract. Everything before it is
# machinery; step 4 is the sentence "there are no credentials in this file",
# and it must come from the same scanner that found them.
#
# Usage:  bash tools/redact_and_verify.sh

set -uo pipefail
cd "$(dirname "$0")/.."

IN=runs/jt_agent/chunks.jsonl
OUT=runs/jt_agent/chunks.redacted.jsonl

hr() { printf '%s\n' "------------------------------------------------------------"; }

hr; echo "1/4  test redact_secrets"; hr
python tools/test_redact_secrets.py || { echo; echo "FAILED: redactor is broken, stopping."; exit 1; }

hr; echo "2/4  redact the corpus"; hr
python tools/redact_secrets.py "$IN" --out "$OUT" \
    --report runs/jt_agent/redaction_report.json || exit 1

hr; echo "3/4  verify the redacted corpus is structurally sound"; hr
# No --report: the merge report describes the pre-redaction file. Byte counts
# and token sums legitimately differ now; structure must not.
python tools/verify_corpus.py "$OUT" || {
    echo; echo "FAILED: redaction damaged the corpus."; exit 1; }

hr; echo "4/4  rescan for credentials -- expect zero"; hr
python tools/scan_secrets.py "$OUT" --report runs/jt_agent/secret_scan.redacted.json
rc=$?

hr
echo "Train on: $OUT"
echo
echo "REDACTION IS NOT ROTATION. Every key found is still in its source file,"
echo "and these are probably in git history too:"
echo "  C:/jp-final/docs/RAILWAY_ENV_VARS.md          private key block"
echo "  C:/jp-final/frontend/.env.local               google api key"
echo "  C:/jp-final/cloudbuild.yaml                   google api key"
echo "  C:/jp-final/fix_runner.ps1                    google api key"
echo "  .../kailash-flywithvvk/backend/app/core/config.py       anthropic key"
echo "  .../kailash-flywithvvk/backend/app/services/ganesha_ai.py  anthropic key"
echo "Rotate those, and revoke the OpenAI/Anthropic keys echoed into the"
echo "assistant session logs."
exit $rc
