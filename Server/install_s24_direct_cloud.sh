#!/data/data/com.termux/files/usr/bin/bash
set +e

# Silent installer/updater for the Samsung S24 direct-cloud runtime.

REPO_DIR="${EKA_REPO_DIR:-$HOME/eka-runner}"
REPO_URL="${EKA_REPO_URL:-https://github.com/jaytipargal/eka-runner.git}"
BOOT_DIR="$HOME/.termux/boot"
BOOT_SCRIPT_NAME="start_s24_direct_cloud.sh"
BOOT_SCRIPT_PATH="$BOOT_DIR/$BOOT_SCRIPT_NAME"
STATE_DIR="${EKA_LOG_DIR:-$HOME/.local/state/eka}"
PYTHON_BIN="${EKA_PYTHON_BIN:-}"
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

# Prefer the working bootstrap key from Firestore (unauthenticated read).
# The env-var key is only a fallback and may be a disabled/rotated credential.
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

cp "$REPO_DIR/termux/boot/$BOOT_SCRIPT_NAME" "$BOOT_SCRIPT_PATH"
chmod 700 "$BOOT_SCRIPT_PATH"

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

if [ -z "$PYTHON_BIN" ]; then
  if command -v python >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python)"
  elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
  fi
fi

if [ -n "$PYTHON_BIN" ]; then
  export EKA_PYTHON_BIN="$PYTHON_BIN"
fi

export EKA_REPO_DIR="$REPO_DIR"
export EKA_VERBOSE_DEVICE_OUTPUT=0
export EKA_S24_ONE_SHOT=1
export EKA_S24_LOOP_INTERVAL_SECONDS="${EKA_S24_LOOP_INTERVAL_SECONDS:-300}"
export EKA_S24_CONTROL_POLL_SECONDS="${EKA_S24_CONTROL_POLL_SECONDS:-15}"

if command -v sshd >/dev/null 2>&1; then
  sshd || true
fi

# Enable ADB TCP so laptop can connect wirelessly
setprop service.adb.tcp.port 5555 >/dev/null 2>&1 || true
stop adbd >/dev/null 2>&1 || true
start adbd >/dev/null 2>&1 || true

nohup bash "$BOOT_SCRIPT_PATH" >/dev/null 2>&1 &
