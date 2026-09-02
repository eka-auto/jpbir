#!/data/data/com.termux/files/usr/bin/bash
set +e

# S24 direct-cloud daemon installer (channel-sandbox deploy kit).
# Run once in Termux:  bash install_s24.sh

REPO_DIR="${EKA_REPO_DIR:-$HOME/eka-runner}"
REPO_URL="${EKA_REPO_URL:-https://github.com/jaytipargal/eka-runner.git}"
BOOT_DIR="$HOME/.termux/boot"
BOOT_SCRIPT_NAME="start_s24_direct_cloud.sh"
BOOT_SCRIPT_PATH="$BOOT_DIR/$BOOT_SCRIPT_NAME"
STATE_DIR="${EKA_LOG_DIR:-$HOME/.local/state/eka}"
WATCHDOG_JOB_ID="${EKA_S24_WATCHDOG_JOB_ID:-240619}"
WATCHDOG_PERIOD_MS="${EKA_S24_WATCHDOG_PERIOD_MS:-900000}"

mkdir -p "$BOOT_DIR" "$STATE_DIR"

if command -v pkg >/dev/null 2>&1; then
  pkg install -y git python termux-api openssh >/dev/null 2>&1 || true
fi

pip install --quiet google-auth requests 2>/dev/null || true

if [ ! -d "$REPO_DIR/.git" ]; then
  rm -rf "$REPO_DIR" >/dev/null 2>&1 || true
  git clone --depth 1 "$REPO_URL" "$REPO_DIR" >/dev/null 2>&1
else
  git -C "$REPO_DIR" pull --ff-only >/dev/null 2>&1 || true
fi

# Fetch the bootstrap key from Firestore (unauthenticated public read).
fetch_bootstrap_key() {
  local key_path="$REPO_DIR/serviceAccountKey.json"
  [ -f "$key_path" ] && return 0
  local url="https://firestore.googleapis.com/v1/projects/intrepid-stage-495117-q1/databases/(default)/documents/bootstrap/s24key"
  if command -v curl >/dev/null 2>&1; then
    curl -sf "$url" 2>/dev/null \
      | python3 -c "import sys,json,base64; d=json.load(sys.stdin); k=d['fields']['keyB64']['stringValue']; sys.stdout.buffer.write(base64.b64decode(k))" \
      2>/dev/null > "$key_path" || rm -f "$key_path"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$url" 2>/dev/null \
      | python3 -c "import sys,json,base64; d=json.load(sys.stdin); k=d['fields']['keyB64']['stringValue']; sys.stdout.buffer.write(base64.b64decode(k))" \
      2>/dev/null > "$key_path" || rm -f "$key_path"
  fi
}

fetch_bootstrap_key

if [ ! -f "$REPO_DIR/serviceAccountKey.json" ] && [ -n "${EKA_SERVICE_ACCOUNT_KEY_B64:-}" ]; then
  printf '%s' "$EKA_SERVICE_ACCOUNT_KEY_B64" | base64 -d >"$REPO_DIR/serviceAccountKey.json"
fi

# Place the runtime contract (device identity + command allowlist).
cp "$HOME/eka-runner/../runtime_contract.json" "$REPO_DIR/runtime_contract.json" 2>/dev/null || true

cp "$REPO_DIR/termux/boot/$BOOT_SCRIPT_NAME" "$BOOT_SCRIPT_PATH" 2>/dev/null || true
chmod 700 "$BOOT_SCRIPT_PATH" 2>/dev/null || true

if command -v termux-job-scheduler >/dev/null 2>&1; then
  termux-job-scheduler \
    --job-id "$WATCHDOG_JOB_ID" \
    --script "$BOOT_SCRIPT_PATH" \
    --period-ms "$WATCHDOG_PERIOD_MS" \
    --network any \
    --battery-not-low false \
    --storage-not-low false \
    --charging false \
    --persisted true >/dev/null 2>&1 || true
fi

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock >/dev/null 2>&1 || true
fi

if command -v sshd >/dev/null 2>&1; then
  sshd || true
fi

# Enable ADB TCP so the laptop can connect wirelessly.
setprop service.adb.tcp.port 5555 >/dev/null 2>&1 || true
stop adbd >/dev/null 2>&1 || true
start adbd >/dev/null 2>&1 || true

export EKA_VERBOSE_DEVICE_OUTPUT=0
export EKA_S24_ONE_SHOT=0
export EKA_S24_LOOP_INTERVAL_SECONDS="${EKA_S24_LOOP_INTERVAL_SECONDS:-300}"
export EKA_S24_CONTROL_POLL_SECONDS="${EKA_S24_CONTROL_POLL_SECONDS:-15}"

nohup bash "$BOOT_SCRIPT_PATH" >/dev/null 2>&1 &

echo "[install_s24] daemon started. Dashboard should show samsung-s24-ultra LIVE within 5 min."
