#!/data/data/com.termux/files/usr/bin/bash
# S24 WhatsApp pushers — one-shot Termux installer, run after install_s24.sh.
# Installs the WhatsApp inventory, media and chat-export pushers and their
# cron entries in ~/s24-agent, where the signed broker's `wa-push` and
# `wa-media-push` commands also find them. It installs no daemon of its own:
# install_s24.sh's signed broker is the only S24 runtime.
set -euo pipefail

APP_DIR="$HOME/s24-agent"
WA_DIR="$(cd "$(dirname "$0")" && pwd)"
BROKER_ROOT="$HOME/.local/share/eka-broker"
BROKER_CONFIG_PATH="$BROKER_ROOT/devices.json"

broker_recovery_required() {
  echo "FATAL: the signed S24 broker is not installed, enrolled, or boot-verified." >&2
  echo "  Run: bash $WA_DIR/install_s24.sh" >&2
  echo "  Complete its AndroidKeyStore enrollment and Termux:Boot checks before retrying." >&2
  exit 78
}

verify_broker_install() {
  # This installer is a companion to install_s24.sh, not a second S24 runtime.
  # Read the installed config and evidence so the broker owns its state and boot
  # paths; fail before any networked package work when recovery is incomplete.
  [ -s "$BROKER_CONFIG_PATH" ] || broker_recovery_required
  command -v python >/dev/null 2>&1 || broker_recovery_required
  if ! python - "$BROKER_CONFIG_PATH" <<'PY'
import json
import os
import sys

try:
    config = json.load(open(sys.argv[1], encoding="utf-8"))
    state_path = config["broker_state_file"]
    evidence_path = config["installation_evidence_file"]
    state = json.load(open(state_path, encoding="utf-8"))
    evidence = json.load(open(evidence_path, encoding="utf-8"))
    if not all(isinstance(record, dict) for record in (config, state, evidence)):
        raise ValueError("signed broker records must be JSON objects")
except (KeyError, OSError, ValueError, TypeError) as exc:
    raise SystemExit(f"invalid signed broker installation: {exc}")

if state.get("enrolled") is not True or not state.get("keyId"):
    raise SystemExit("signed broker is not enrolled")
boot_launcher = evidence.get("bootLauncher")
try:
    boot_launcher_ready = (
        isinstance(boot_launcher, str)
        and os.path.isfile(boot_launcher)
        and os.access(boot_launcher, os.X_OK)
        and os.path.getsize(boot_launcher) > 0
    )
except OSError:
    boot_launcher_ready = False
if not boot_launcher_ready:
    raise SystemExit("Termux:Boot launcher is missing, empty, or not executable")
if not all(evidence.get(name) is True for name in (
    "termuxBootPackageVerified", "bootLauncherVerified", "jobSchedulerVerified"
)):
    raise SystemExit("signed broker installation evidence is incomplete")
PY
  then
    broker_recovery_required
  fi
}

verify_broker_install

echo "==> Installing packages"
pkg update -y >/dev/null 2>&1 || true
# python runs the pushers (standard library only); cronie provides the Termux
# cron. nodejs-lts and openssl-tool are gone with the loopback agent below —
# nothing else here used them.
pkg install -y termux-api python cronie

echo "==> Preparing $APP_DIR"
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# ---- Retire the loopback agent earlier releases provisioned ---------------
# This installer used to write package.json, .env (AGENT_AUTH_TOKEN,
# AGENT_PORT=8787) and run.sh here for s24-agent-daemon.mjs, a Node HTTP server
# with a run_shell tool, and told the operator to start it. That is a second,
# shell-executing listener beside the signed broker, which runtime_contract.json
# forbids (transport.inboundListener: false). It never worked either: the .mjs
# was never copied here and ANTHROPIC_API_KEY was never set, so run.sh died on
# "Cannot find module". Only the exact files those releases generated are
# removed, so anything the owner put in this directory stays.
retire_generated_file() {
  local path="$1" expected="$2"
  [ -f "$path" ] || return 0
  if [ "$(cat "$path")" = "$expected" ]; then
    rm -f "$path"
    echo "==> Removed $path (retired loopback agent)"
  else
    echo "[warn] $path differs from the file earlier releases generated; left in place" >&2
  fi
}
retire_generated_file "$APP_DIR/package.json" '{ "name": "s24-agent", "version": "1.0.0", "type": "module", "private": true,
  "scripts": { "start": "node s24-agent-daemon.mjs" } }'
retire_generated_file "$APP_DIR/run.sh" '#!/data/data/com.termux/files/usr/bin/bash
set -a; . "$HOME/s24-agent/.env"; set +a
exec node "$HOME/s24-agent/s24-agent-daemon.mjs"'
# The .env carried a random token, so it is recognised by its shape.
if [ -f "$APP_DIR/.env" ] && [ "$(grep -c '' "$APP_DIR/.env")" -eq 3 ] \
  && grep -Eqx 'AGENT_AUTH_TOKEN=[0-9a-f]{64}' "$APP_DIR/.env" \
  && grep -qx 'AGENT_PORT=8787' "$APP_DIR/.env" \
  && grep -qx 'AGENT_BIND=127.0.0.1' "$APP_DIR/.env"; then
  rm -f "$APP_DIR/.env"
  echo "==> Removed $APP_DIR/.env (retired loopback agent token)"
fi
# Started by hand from an old copy of the .mjs, the listener would still be up.
if command -v pgrep >/dev/null 2>&1 && pgrep -f 's24-agent-daemon\.mjs' >/dev/null 2>&1; then
  pkill -f 's24-agent-daemon\.mjs' || true
  echo "==> Stopped a running s24-agent-daemon.mjs (forbidden inbound listener)"
fi

# keep crond and the signed broker running across screen-off
if command -v termux-wake-lock >/dev/null 2>&1; then termux-wake-lock || true; fi

# ---- WhatsApp inventory pusher ----------------------------------------
# The daemon's own tick loop doesn't know about WhatsApp. A Termux cron
# runs wa_push.py every 30 minutes: reads ~/storage/shared/WhatsApp/
# Databases/msgstore.db (WhatsApp needs to have been given storage
# permission once), builds the compact inventory, POSTs to
# jaytipargal.tech/api/wa-ingest under a fresh run_id.

echo "==> Installing wa_push.py"
cp "$WA_DIR/wa_push.py" "$APP_DIR/wa_push.py"
chmod +x "$APP_DIR/wa_push.py"

WA_ENV_FILE="$APP_DIR/wa_push.env"
if [ ! -f "$WA_ENV_FILE" ]; then
  umask 077
  # Placeholders. Fill WA_INGEST_KEY in AFTER the merge that ships
  # /api/wa-ingest on production and after the same key is set on the
  # Vercel project. A blank key here means the tick exits before touching
  # msgstore.db — safer than a partial sync while the key is unset.
  cat > "$WA_ENV_FILE" <<ENV
# Fill these in, then re-run install_daemon.sh (or just edit — cron reads
# this file every tick). See Devices/S24/wa_push.py for what each does.
WA_INGEST_URL=https://jaytipargal.tech/api/wa-ingest
WA_INGEST_KEY=
# Left unset on purpose. wa_push.py probes the scoped-storage root
# (~/storage/shared/Android/media/com.whatsapp/WhatsApp/Databases, Android 11+)
# before the legacy ~/storage/shared/WhatsApp one, and picks whichever exists.
# Pinning the legacy path here overrode that probe and made every tick exit 2
# on this Android 14 phone. Set these only to point at a non-standard copy.
#WA_MSGSTORE_DB=
#WA_CONTACTS_DB=
WA_DEVICE_ID=samsung-s24-ultra
ENV
  chmod 600 "$WA_ENV_FILE"
  echo "==> Generated $WA_ENV_FILE — set WA_INGEST_KEY before the next tick."
fi

# The wrapper sources the env, then runs the script. Keeping the env out
# of crontab means the key is only readable to this Termux user and can
# be rotated without editing cron.
cat > "$APP_DIR/wa_push_tick.sh" <<'RUN'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ENV_FILE="$HOME/s24-agent/wa_push.env"
[ -f "$ENV_FILE" ] || { echo "[wa_push] no env at $ENV_FILE"; exit 0; }
set -a; . "$ENV_FILE"; set +a
[ -n "${WA_INGEST_KEY:-}" ] || { echo "[wa_push] WA_INGEST_KEY blank; skipping tick"; exit 0; }
exec python "$HOME/s24-agent/wa_push.py" --once
RUN
chmod +x "$APP_DIR/wa_push_tick.sh"

# Install (idempotently) a */30 crontab entry that fires the wrapper.
# Grepping first so re-running the installer does not stack duplicates.
CRON_LINE="*/30 * * * * $APP_DIR/wa_push_tick.sh >> $APP_DIR/wa_push.log 2>&1"
CURRENT_CRON="$(crontab -l 2>/dev/null || true)"
if ! printf '%s\n' "$CURRENT_CRON" | grep -qF "$APP_DIR/wa_push_tick.sh"; then
  printf '%s\n%s\n' "$CURRENT_CRON" "$CRON_LINE" | grep -vE '^$' | crontab -
  echo "==> Installed cron: every 30 minutes"
else
  echo "==> Cron entry already present; not duplicated"
fi

# ---- Media & audio pusher (path 3) ----------------------------------
# Walks ~/storage/shared/Android/media/com.whatsapp/WhatsApp/Media/, uploads
# each file ≤4 MB to Vercel Blob via /api/wa-blob-upload, POSTs metadata to
# /api/wa-ingest as attachments. Same env file as wa_push, so the key set
# above is reused. Skipped when the env file has no key.
if [ -f "$WA_DIR/wa_media_push.py" ]; then
  cp "$WA_DIR/wa_media_push.py" "$APP_DIR/wa_media_push.py"
  chmod +x "$APP_DIR/wa_media_push.py"
  cat > "$APP_DIR/wa_media_tick.sh" <<'RUN'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ENV_FILE="$HOME/s24-agent/wa_push.env"
[ -f "$ENV_FILE" ] || { echo "[wa_media_push] no env"; exit 0; }
set -a; . "$ENV_FILE"; set +a
[ -n "${WA_INGEST_KEY:-}" ] || { echo "[wa_media_push] WA_INGEST_KEY blank; skipping"; exit 0; }
exec python "$HOME/s24-agent/wa_media_push.py" --once --limit "${WA_MEDIA_LIMIT:-300}"
RUN
  chmod +x "$APP_DIR/wa_media_tick.sh"
  MEDIA_CRON="15,45 * * * * $APP_DIR/wa_media_tick.sh >> $APP_DIR/wa_media_push.log 2>&1"
  if ! crontab -l 2>/dev/null | grep -qF "$APP_DIR/wa_media_tick.sh"; then
    (crontab -l 2>/dev/null || true; echo "$MEDIA_CRON") | grep -vE '^$' | crontab -
    echo "==> Installed media-push cron (:15 and :45 every hour)"
  fi
fi

# ---- Chat-export importer (path 2) ----------------------------------
# Reads WhatsApp Chat Export .txt files placed in ~/wa-exports/ (with a
# mapping.json alongside naming which chat_id each file belongs to), parses
# the bodies, POSTs to /api/wa-ingest as messages. Nothing runs until the
# operator drops the first .txt file, so the cron is safe to install now.
if [ -f "$WA_DIR/wa_export_import.py" ]; then
  cp "$WA_DIR/wa_export_import.py" "$APP_DIR/wa_export_import.py"
  chmod +x "$APP_DIR/wa_export_import.py"
  mkdir -p "$HOME/wa-exports"
  cat > "$APP_DIR/wa_export_tick.sh" <<'RUN'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ENV_FILE="$HOME/s24-agent/wa_push.env"
[ -f "$ENV_FILE" ] || { echo "[wa_export_import] no env"; exit 0; }
set -a; . "$ENV_FILE"; set +a
[ -n "${WA_INGEST_KEY:-}" ] || { echo "[wa_export_import] WA_INGEST_KEY blank; skipping"; exit 0; }
[ -f "$HOME/wa-exports/mapping.json" ] || { echo "[wa_export_import] no mapping.json in ~/wa-exports/; skipping"; exit 0; }
exec python "$HOME/s24-agent/wa_export_import.py" --dir "$HOME/wa-exports" --once
RUN
  chmod +x "$APP_DIR/wa_export_tick.sh"
  EXPORT_CRON="30 3 * * * $APP_DIR/wa_export_tick.sh >> $APP_DIR/wa_export_import.log 2>&1"
  if ! crontab -l 2>/dev/null | grep -qF "$APP_DIR/wa_export_tick.sh"; then
    (crontab -l 2>/dev/null || true; echo "$EXPORT_CRON") | grep -vE '^$' | crontab -
    echo "==> Installed chat-export cron (03:30 daily)"
  fi
fi
# Make sure crond itself is running; on Termux this is a plain background
# start, no service manager.
if ! pgrep -x crond >/dev/null 2>&1; then
  crond -b 2>/dev/null || echo "[warn] crond did not start; run 'crond -b' by hand"
fi

echo
echo "==> Install complete. The signed broker from install_s24.sh is the only S24 runtime;"
echo "    nothing here listens for connections."
echo "    1. Edit $WA_ENV_FILE and set WA_INGEST_KEY (the same value on Vercel);"
echo "       the cron picks it up on the next tick."
echo "    2. To test the WhatsApp push now: bash $APP_DIR/wa_push_tick.sh"
echo "    3. To prove the command path end to end, queue one status-only command for"
echo "       samsung-s24-ultra from the dashboard and confirm its completed result."
echo
