#!/usr/bin/env bash
# Rebuild chunks.jsonl once tools/crawl_missing.py finishes.
#
# EXCLUSIONS AND WHY
#
# Tooling trees. Framework checkouts and CI runner logs, not personal
# material. Left in they would swamp the corpus this agent is trained on:
# eka2 1.4G + eka-runner 1.2G + COMPANY_G4G/actions-runner (the bulk of that
# root's 5.8G, almost entirely _diag/*.log). The bare "/actions-runner/"
# pattern catches every nesting -- C:\actions-runner\ and
# C:\COMPANY_G4G\actions-runner\ alike -- so it replaces the old
# "c:/actions-runner/" pattern rather than sitting alongside it.
#
# Runner credential dotfiles. crawl_missing.py gates on
#   ext = os.path.splitext(fname)[1]; if ext and ext not in TEXT_EXT: skip
# but splitext(".credentials") returns (".credentials", "") -- a leading-dot
# name has NO extension by that rule, so ext == "" and the guard never fires.
# Every dotfile is therefore crawled regardless of TEXT_EXT, and
# .credentials / .credentials_rsaparams reached the corpus having also passed
# scrub_secrets.classify(). Same bug makes the ".gitignore"/".env" entries in
# TEXT_EXT dead code. Dropping them here is the mitigation; the crawler
# itself still needs the fix.
#
# NO PATTERN MAY START WITH "/". Under Git Bash, MSYS path conversion rewrites
# a bare leading-slash argument into a Windows path before Python sees it:
#   $ python -c "import sys;print(sys.argv[1:])" /actions-runner/
#   ['C:/Program Files/Git/actions-runner/']
# The exclusion then silently matches nothing and the merge looks like it
# worked. Substring matching does not need the anchor, so "actions-runner/"
# is both correct and safe. Verified: with the slash 0 chunks were excluded,
# without it 604.
#
# Binary decoded as text. --min-printable 0.85 is the important one. The
# crawler decides what to ingest from the file EXTENSION, so a WhatsApp export
# named "AUD-20260526-WA0003" (a 3GP audio file, no extension) sails through,
# gets decoded with errors="replace", and chunks into thousands of records of
# U+FFFD. Measured on the 2026-08-20 merge: 151,538 of the 153,498
# extensionless chunks were binary, .m4a was 99.7% binary, and the whole
# corpus was ~15% byte noise. Source-path patterns cannot express this --
# C:/JP/WhatsApp/ holds both the audio blobs and the real chat .txt exports.
# Scoring the text keeps the chat logs and drops the audio.
#
# Threshold is 0.85 against a BAD-character definition (controls + U+FFFD),
# not printable-ASCII: this corpus is bilingual and an ASCII rule scores
# Devanagari at 0.0. Measured separation is wide -- prose and Hindi score
# 1.000, decoded 3GP scores 0.07, SQLite 0.05.
#
# Credential extractions. Two directories are dumps of browser secret stores:
# ASUS_VivoBook_Keys_Extraction holds Chrome's Cookies SQLite, and
# credentials_export_20260605_172652 holds Local_State, which carries the
# DPAPI-wrapped AES key Chrome uses to encrypt those cookies. Local_State is
# valid JSON, so the binary filter does NOT catch it -- it needs its own
# pattern.
#
# c:/eka-agent/ is deliberately NOT excluded -- 0.5 MB, cheap to keep.
# The d_drive root lives on D: -- C: ran out of space mid-crawl on 2026-08-20,
# so that root was re-run with JT_PARTS_DIR=D:/jt_agent/parts. Both part
# directories must be globbed or D:\ silently drops out of the corpus.
# D:/jt_agent_excluded/ is NOT globbed: it holds the tooling parts moved off
# C: plus the killed partial, and is meant to stay out.
set -euo pipefail
cd "$(dirname "$0")/.."

python tools/merge_chunks.py \
    --out runs/jt_agent/chunks.jsonl \
    --report runs/jt_agent/merge_report.json \
    --part 'runs/jt_agent/parts/*.jsonl' \
    --part 'D:/jt_agent/parts/*.jsonl' \
    --min-printable 0.85 \
    --exclude-source keys_extraction/ \
    --exclude-source credentials_export \
    --exclude-source c:/eka2/ \
    --exclude-source c:/eka-runner/ \
    --exclude-source actions-runner/ \
    --exclude-source .credentials \
    --exclude-source .runner \
    --exclude-source .gradle/ \
    --exclude-source .m2/ \
    --exclude-source .nuget/ \
    --exclude-source .cargo/ \
    --exclude-source .npm/ \
    --exclude-source .pub-cache/ \
    --exclude-source .rustup/ \
    --exclude-source .android/ \
    --exclude-source go/pkg/mod/ \
    --exclude-source .vscode/ \
    --exclude-source .vscode-server/
