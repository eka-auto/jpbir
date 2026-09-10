#!/data/data/com.termux/files/usr/bin/bash
set +e

# Silent boot launcher for the Samsung S24 direct-cloud daemon.

SCRIPT_NAME="s24_phone_direct_cloud.py"
SELF_NAME="$(basename "$0")"
LOG_DIR="${EKA_LOG_DIR:-$HOME/.local/state/eka}"
LOG_FILE="$LOG_DIR/s24_phone_direct_cloud.log"
BOOT_DIR="$HOME/.termux/boot"
BOOT_SCRIPT_PATH="$BOOT_DIR/$SELF_NAME"
WATCHDOG_JOB_ID="${EKA_S24_WATCHDOG_JOB_ID:-240619}"
WATCHDOG_PERIOD_MS="${EKA_S24_WATCHDOG_PERIOD_MS:-900000}"

resolve_self_path() {
  cd "$(dirname "$0")" 2>/dev/null || return 1
  printf '%s/%s\n' "$PWD" "$SELF_NAME"
}

resolve_root_dir() {
  for candidate in \
    "${EKA_REPO_DIR:-}" \
    "$HOME/eka-runner" \
    "$HOME/eka-llm" \
    "$HOME/storage/shared/eka-runner"
  do
    if [ -n "$candidate" ] && [ -d "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

ROOT_DIR="$(resolve_root_dir || true)"
SELF_PATH="$(resolve_self_path || true)"

mkdir -p "$LOG_DIR"

if [ -z "$ROOT_DIR" ]; then
  exit 0
fi

fetch_key_if_missing() {
  local key_path="$ROOT_DIR/serviceAccountKey.json"
  [ -f "$key_path" ] && return 0
  # Download key from Firestore bootstrap doc (no auth required)
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

ensure_boot_install() {
  mkdir -p "$BOOT_DIR" >/dev/null 2>&1 || true
  if [ -n "$SELF_PATH" ] && [ "$SELF_PATH" != "$BOOT_SCRIPT_PATH" ] && [ -f "$SELF_PATH" ]; then
    cp "$SELF_PATH" "$BOOT_SCRIPT_PATH" >/dev/null 2>&1 || true
  fi
  chmod 700 "$BOOT_SCRIPT_PATH" >/dev/null 2>&1 || true
}

register_watchdog() {
  if ! command -v termux-job-scheduler >/dev/null 2>&1; then
    return 0
  fi
  local script_path="$BOOT_SCRIPT_PATH"
  if [ ! -f "$script_path" ] && [ -n "$SELF_PATH" ] && [ -f "$SELF_PATH" ]; then
    script_path="$SELF_PATH"
  fi
  if [ ! -f "$script_path" ]; then
    return 0
  fi
  termux-job-scheduler \
    --job-id "$WATCHDOG_JOB_ID" \
    --script "$script_path" \
    --period-ms "$WATCHDOG_PERIOD_MS" \
    --network any \
    --battery-not-low false \
    --storage-not-low false \
    --charging false \
    --persisted true >/dev/null 2>&1 || true
}

if [ "${EKA_S24_AUTO_UPDATE:-1}" = "1" ] && [ -d "$ROOT_DIR/.git" ] && command -v git >/dev/null 2>&1; then
  (
    cd "$ROOT_DIR" 2>/dev/null || exit 0
    git pull --ff-only >/dev/null 2>&1 || true
  )
fi

ensure_boot_install
register_watchdog

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock >/dev/null 2>&1 || true
fi

# Enable ADB TCP on port 5555 so laptop can connect wirelessly
setprop service.adb.tcp.port 5555 >/dev/null 2>&1 || true
stop adbd >/dev/null 2>&1 || true
start adbd >/dev/null 2>&1 || true

if pgrep -f "python.*$SCRIPT_NAME" >/dev/null 2>&1; then
  exit 0
fi

cd "$ROOT_DIR" 2>/dev/null || exit 0

fetch_key_if_missing

export PYTHONUTF8=1
export EKA_VERBOSE_DEVICE_OUTPUT=0
export EKA_S24_ONE_SHOT=0
export EKA_S24_LOOP_INTERVAL_SECONDS="${EKA_S24_LOOP_INTERVAL_SECONDS:-300}"
export EKA_S24_CONTROL_POLL_SECONDS="${EKA_S24_CONTROL_POLL_SECONDS:-15}"

PYTHON_BIN="${EKA_PYTHON_BIN:-}"
if [ -z "$PYTHON_BIN" ]; then
  if command -v python >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python)"
  elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
  else
    exit 0
  fi
fi

# Ensure firebase-messaging is installed
"$PYTHON_BIN" -m pip install firebase-messaging --quiet --disable-pip-version-check 2>/dev/null || true

# Register device FCM token if available
if [ -f "$ROOT_DIR/termux/fcm_token.txt" ]; then
  FCM_TOKEN=$(cat "$ROOT_DIR/termux/fcm_token.txt")
  "$PYTHON_BIN" "$ROOT_DIR/termux/register_device_token.py" "$FCM_TOKEN" "samsung-s24-ultra" >>"$LOG_FILE" 2>&1 || true
fi

# Start FCM Listener in the background if not running
if ! pgrep -f "python.*fcm_listener.py" >/dev/null 2>&1; then
  nohup "$PYTHON_BIN" "$ROOT_DIR/termux/fcm_listener.py" >>"$LOG_DIR/fcm_listener.log" 2>&1 &
  disown || true
fi

nohup "$PYTHON_BIN" "$ROOT_DIR/$SCRIPT_NAME" >>"$LOG_FILE" 2>&1 &
disown || true
