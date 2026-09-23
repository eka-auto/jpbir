#!/data/data/com.termux/files/usr/bin/bash
# S24 Agent Daemon — one-shot Termux installer
set -euo pipefail

APP_DIR="$HOME/s24-agent"
ENV_FILE="$APP_DIR/.env"

echo "==> Installing packages"
pkg update -y >/dev/null 2>&1 || true
pkg install -y nodejs-lts termux-api openssl-tool python python-cryptography

# Verify the service account key is present before the daemon starts.
# Without it, the S24 phone daemon cannot authenticate to Firestore
# and the /api/jp-stack health verdict stays in fail state.
SERVICE_KEY_PATH="$HOME/serviceAccountKey.json"
if [ ! -f "$SERVICE_KEY_PATH" ]; then
  echo "FATAL: serviceAccountKey.json not found at $SERVICE_KEY_PATH" >&2
  echo "  Copy it from the eka-runner repo or re-provision via the" >&2
  echo "  boot script (start_s24_direct_cloud.sh) before retrying." >&2
  exit 78
fi
echo "[ok] serviceAccountKey.json found"

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

echo
echo "==> Install complete."
echo "    1. bash $APP_DIR/run.sh"
echo "    2. Use the authenticated loopback-only status-only request in README.md"
echo
