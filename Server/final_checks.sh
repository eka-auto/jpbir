#!/usr/bin/env bash
# Verify runs/jt_agent/chunks.jsonl, then scan it for credentials.
#
# Exists as a script because the long argument lists were being split by the
# terminal on paste ("chunks. jsonl", "-- report"), which argparse then
# rejected. One short command has nothing to mangle.
#
# Order matters. verify_corpus runs FIRST: if the corpus is damaged, the
# secret scan's counts describe a corrupt file and the 7.4 GiB pass is wasted.
# A merge report only records what a process intended to write -- on
# 2026-08-21 two merge processes wrote this file at once and the report was
# perfectly consistent with a file that had a 3.12 GiB hole in it.
#
# Each tool's own test runs before the tool does.
#
# Usage:  bash tools/final_checks.sh

set -uo pipefail
cd "$(dirname "$0")/.."

CORPUS=runs/jt_agent/chunks.jsonl
REPORT=runs/jt_agent/merge_report.json

hr() { printf '%s\n' "------------------------------------------------------------"; }

hr; echo "1/4  test verify_corpus"; hr
python tools/test_verify_corpus.py || { echo; echo "FAILED: verifier is broken, stopping."; exit 1; }

hr; echo "2/4  verify corpus integrity"; hr
python tools/verify_corpus.py "$CORPUS" --report "$REPORT"
rc=$?
if [ $rc -ne 0 ]; then
    echo
    echo "FAILED: corpus is not trustworthy. Not scanning it -- rebuild first"
    echo "with exactly one merge process:  bash tools/merge_after_crawl.sh"
    exit 1
fi

hr; echo "3/4  test scan_secrets"; hr
python tools/test_scan_secrets.py || { echo; echo "FAILED: scanner is broken, stopping."; exit 1; }

hr; echo "4/4  scan corpus for credentials"; hr
python tools/scan_secrets.py "$CORPUS" --report runs/jt_agent/secret_scan.json
rc=$?

hr
if [ $rc -eq 0 ]; then
    echo "All checks ran. Read the findings above before training."
    echo "Reports: $REPORT"
    echo "         runs/jt_agent/secret_scan.json"
fi
exit $rc
