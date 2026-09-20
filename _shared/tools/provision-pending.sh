#!/usr/bin/env bash
# The two provisioning steps that only the owner can perform, scripted.
#
# Both need a secret this repository does not and must not hold, so neither can
# be done from an agent session or from CI. What CAN be removed is the chance of
# getting the sequence wrong: each step below is ordered, verified, and cleans up
# after itself.
#
# Handling rules this script follows, and you should too if you deviate from it:
#   * Secrets arrive on STDIN or as a file path — NEVER as an argv value, which
#     would land verbatim in shell history and in the process table.
#   * No secret value is ever echoed. Only lengths and fingerprints.
#   * Every temp file holding key material is shredded, including on failure.
#
#   ./_shared/tools/provision-pending.sh sandbox-db
#   ./_shared/tools/provision-pending.sh s24-secrets
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEAM="jayti"
SANDBOX_PROJECT="channel-sandbox"
VERCEL="npx --no-install vercel"

die() { printf '\n!! %s\n' "$*" >&2; exit 1; }
note() { printf '   %s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed"; }

# ---------------------------------------------------------------- sandbox-db --
# channel-sandbox's /api/data/whatsapp queries Neon through dashboard_api.py's
# neon_query(). Without DATABASE_URL that one card renders "live source
# unavailable" and everything else on the page works — so this is a feature
# switched cleanly off, not an outage. Decide it on the security question, not
# on urgency:
#
#   This points a SANDBOX project at the PRODUCTION Neon database, whose
#   wa_messages table holds real WhatsApp message bodies. channel-sandbox has
#   SSO protection on its vercel.app domains but is a lower-trust surface than
#   jayti-dashboard. If you would not grant it production message content, the
#   correct action is to leave DATABASE_URL unset and keep the card dark.
#
# Prefer a READ-ONLY Neon role here. Neon issues those per-branch; a pooled
# read-only connection string is enough for every query the sandbox makes.
provision_sandbox_db() {
  need npx
  step "channel-sandbox -> DATABASE_URL"
  note "Paste the Neon connection string, then press Ctrl-D."
  note "It is read from stdin so it never enters your shell history."
  printf '   > '
  IFS= read -r -d '' CONN || true
  CONN="${CONN%$'\n'}"
  [ -n "$CONN" ] || die "nothing read from stdin; aborted without changing anything"
  case "$CONN" in
    postgres://*|postgresql://*) ;;
    *) die "that does not look like a Postgres connection string (expected postgres:// or postgresql://)" ;;
  esac
  note "read ${#CONN} characters, sha256 $(printf '%s' "$CONN" | sha256sum | cut -c1-12)…"

  step "writing it to the $SANDBOX_PROJECT production environment"
  printf '%s' "$CONN" | $VERCEL env add DATABASE_URL production \
    --scope "$TEAM" --sensitive --force
  unset CONN

  step "regenerating the env manifest"
  ( cd "$ROOT" && node _shared/tools/generate-env-manifest.mjs )

  step "verifying"
  ( cd "$ROOT" && node _shared/tests/env-manifest.test.mjs )
  note "commit the regenerated _shared/config/vercel-env.manifest.json"
}

# --------------------------------------------------------------- s24-secrets --
# .github/workflows/s24-export-sync.yml fails closed on both of these, so until
# they exist the scheduled export goes red twice a day. That is deliberate: an
# export job that quietly skipped its credentials would leave you believing the
# archive was current.
provision_s24_secrets() {
  need gh; need openssl; need python3
  gh auth status >/dev/null 2>&1 || die "run 'gh auth login' first"

  step "1/3  EKA_SERVICE_ACCOUNT_JSON  (Firestore READ-ONLY service account)"
  note "Path to the service-account JSON file:"
  printf '   > '
  read -r SA_PATH
  [ -f "$SA_PATH" ] || die "no such file: $SA_PATH"
  python3 - "$SA_PATH" <<'PYEOF' || die "that file is not a Firestore service-account key"
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as exc:
    print("   not valid JSON: %s" % exc); raise SystemExit(1)
if d.get("type") != "service_account":
    print("   type is %r, expected 'service_account'" % d.get("type")); raise SystemExit(1)
if not d.get("client_email") or not d.get("private_key"):
    print("   missing client_email or private_key"); raise SystemExit(1)
print("   valid service_account for %s" % d["client_email"])
PYEOF
  gh secret set EKA_SERVICE_ACCOUNT_JSON < "$SA_PATH"
  note "set (the file on disk is untouched; delete it yourself when done)"

  step "2/3  S24_SYNC_PRIVATE_KEY_PEM  (dedicated, exportable CI signing key)"
  note "A CI runner cannot reach the laptop's non-exportable TPM key, so this is"
  note "a SEPARATE key that exists only for CI. Never reuse another key here."
  KEYDIR="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "find '$KEYDIR' -type f -exec shred -u {} + 2>/dev/null || true; rm -rf '$KEYDIR'" EXIT INT TERM
  openssl ecparam -name prime256v1 -genkey -noout -out "$KEYDIR/s24-ci.pem"
  chmod 600 "$KEYDIR/s24-ci.pem"
  note "generated a P-256 key in $KEYDIR (shredded when this script exits)"
  gh secret set S24_SYNC_PRIVATE_KEY_PEM < "$KEYDIR/s24-ci.pem"
  note "set"

  step "3/3  publish the PUBLIC half to Vercel"
  note "APPEND this block to S24_SYNC_PUBLIC_KEYS on jayti-dashboard."
  note "Do NOT replace the existing value — the laptop's TPM key must keep"
  note "verifying. Backend/s24-ingest.js loadPublicKeys() accepts several PEM"
  note "blocks newline-separated, or a JSON array of them."
  printf '\n'
  ( cd "$ROOT/Devices/S24" && python3 push_to_vercel.py --software-key "$KEYDIR/s24-ci.pem" --print-public-key )
  printf '\n'
  note "Then: Actions -> S24 Direct-Cloud Export Sync -> Run workflow, to confirm green."
}

case "${1:-}" in
  sandbox-db)   provision_sandbox_db ;;
  s24-secrets)  provision_s24_secrets ;;
  *) cat <<USAGE
usage: $0 <step>

  sandbox-db    set DATABASE_URL on the channel-sandbox Vercel project,
                regenerate the env manifest and verify it.
                READ THE SECURITY NOTE in this file first — it points a sandbox
                project at production WhatsApp message content.

  s24-secrets   set EKA_SERVICE_ACCOUNT_JSON and S24_SYNC_PRIVATE_KEY_PEM as
                GitHub secrets, and print the public half to append to Vercel.

Secrets are read from stdin or a file path, never from argv.
USAGE
     exit 64 ;;
esac
