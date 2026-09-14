#!/data/data/com.termux/files/usr/bin/bash
# S24 Agent Daemon — one-shot Termux installer.
# Also installs the WhatsApp inventory pusher and its 30-min cron entry, so
# after this runs once the device auto-syncs WA chats/media/audio to
# jaytipargal.tech alongside the daemon's own telemetry.
set -euo pipefail

APP_DIR="$HOME/s24-agent"
ENV_FILE="$APP_DIR/.env"
WA_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing packages"
pkg update -y >/dev/null 2>&1 || true
# python is needed by wa_push.py; cronie provides the Termux cron.
pkg install -y nodejs-lts termux-api openssl-tool python cronie

echo "==> Preparing $APP_DIR"
mkdir -p "$APP_DIR" "$HOME/agent-workspace"
cd "$APP_DIR"

if [ ! -f package.json ]; then
  cat > package.json <<'JSON'
{ "name": "s24-agent", "version": "1.0.0", "type": "module", "private": true,
  "scripts": { "start": "node s24-agent-daemon.mjs" } }
JSON
fi

if [ ! -f "$ENV_FILE" ]; then
  umask 077
  AGENT_TOKEN="$(openssl rand -hex 32)"
  cat > "$ENV_FILE" <<ENV
AGENT_AUTH_TOKEN=$AGENT_TOKEN
AGENT_PORT=8787
AGENT_BIND=127.0.0.1
ENV
  chmod 600 "$ENV_FILE"
  echo "==> Generated $ENV_FILE"
  echo "    A local authentication token was generated; do not share this file."
fi

cat > "$APP_DIR/run.sh" <<'RUN'
#!/data/data/com.termux/files/usr/bin/bash
set -a; . "$HOME/s24-agent/.env"; set +a
exec node "$HOME/s24-agent/s24-agent-daemon.mjs"
RUN
chmod +x "$APP_DIR/run.sh"

# keep the daemon alive across screen-off
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
WA_MSGSTORE_DB=$HOME/storage/shared/WhatsApp/Databases/msgstore.db
WA_CONTACTS_DB=$HOME/storage/shared/WhatsApp/Databases/wa.db
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
echo "==> Install complete."
echo "    1. bash $APP_DIR/run.sh"
echo "    2. Use the authenticated loopback-only status-only request in README.md"
echo "    3. Edit $WA_ENV_FILE and set WA_INGEST_KEY (the same value on Vercel);"
echo "       the cron picks it up on the next tick."
echo "    4. To test the WhatsApp push now: bash $APP_DIR/wa_push_tick.sh"
echo
