#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

# One-time broker setup for the physical Samsung S24 Ultra in Termux.
DEVICE_ID='samsung-s24-ultra'
INSTALL_ROOT="$HOME/.local/share/eka-broker"
STATE_PATH="$INSTALL_ROOT/$DEVICE_ID.broker-state.json"
CODE_PATH="$INSTALL_ROOT/enrollment_code.txt"
EVIDENCE_PATH="$INSTALL_ROOT/installation-evidence.json"
LOG_PATH="$INSTALL_ROOT/logs/$DEVICE_ID.log"
PID_PATH="$INSTALL_ROOT/logs/$DEVICE_ID.pid"
BOOT_DIR="$HOME/.termux/boot"
BOOT_PATH="$BOOT_DIR/start_eka_s24_broker.sh"
JOB_ID='240619'
RELEASE_ID='s24-termux-broker-2026-09-21.1'
KIT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

MANUFACTURER="$(getprop ro.product.manufacturer 2>/dev/null || true)"
MODEL="$(getprop ro.product.model 2>/dev/null || true)"
[[ "${MANUFACTURER,,}" == samsung* ]] || fail "hardware guard expected Samsung, found '$MANUFACTURER'"
[[ "$MODEL" == SM-S928* ]] || fail "hardware guard expected SM-S928*, found '$MODEL'"
printf '[ok] hardware guard: %s %s\n' "$MANUFACTURER" "$MODEL"

command -v pkg >/dev/null 2>&1 || fail 'this installer must run inside Termux'
pkg install -y python termux-api python-cryptography python-psutil

command -v python >/dev/null 2>&1 || fail 'Python was not installed'
command -v termux-keystore >/dev/null 2>&1 || fail 'termux-keystore is unavailable; install the matching Termux:API Android app'
command -v termux-job-scheduler >/dev/null 2>&1 || fail 'termux-job-scheduler is unavailable; install the matching Termux:API app and package'
termux-keystore list -d >/dev/null || fail 'Termux:API keystore call failed; grant the required app permission and retry'
BOOT_PACKAGE="$(pm path com.termux.boot 2>/dev/null || true)"
[[ "$BOOT_PACKAGE" == package:* ]] || fail 'Termux:Boot is required; install it from the same trusted source as Termux, open it once, and retry'

umask 077
mkdir -p "$INSTALL_ROOT/logs" "$BOOT_DIR"

install_verified() {
  local name="$1"
  local expected="$2"
  local source="$KIT_DIR/$name"
  local destination="$INSTALL_ROOT/$name"
  local temporary="$destination.download"
  [[ -f "$source" ]] || fail "deploy kit is incomplete: missing $name"
  cp "$source" "$temporary"
  local actual
  actual="$(sha256sum "$temporary" | cut -d ' ' -f 1)"
  [[ "$actual" == "${expected,,}" ]] || {
    rm -f "$temporary"
    fail "integrity check failed for $name"
  }
  mv -f "$temporary" "$destination"
}

install_verified 'device_agent.py' '200a3433cc33da5c1367ddfda6f0e83df8e100e9e8b7a60deae3197a2d945fd3'
install_verified 'broker_client.py' 'e380867c5843e49c21d7e46704db20607389a9f1faad4b3cf61f9b4eab173bb1'
install_verified 'signer.py' '8aabf8e5fff25a067b02901ef4798d061a9c2b3d5844d72e59db1419112632f7'
install_verified 'single_instance.py' '287fe1c114488e847f0252c89170067e6fe5b33650780c72e8a8f00f7b63843a'
printf '[ok] copied and verified bundled broker artifacts for release %s\n' "$RELEASE_ID"

VENV="$INSTALL_ROOT/.venv"
if [[ ! -x "$VENV/bin/python" ]]; then
  python -m venv --system-site-packages "$VENV"
fi
"$VENV/bin/python" -m pip install --disable-pip-version-check 'requests==2.34.2'
"$VENV/bin/python" -c 'import cryptography, psutil, requests'

# A release reinstall must replace the running process, not leave the previous
# Python image holding the guard while the newly verified launcher exits.
PYTHONPATH="$INSTALL_ROOT" "$VENV/bin/python" - "$DEVICE_ID" "$PID_PATH" <<'PY'
import sys
from pathlib import Path

import psutil
from single_instance import check_guard

device_id, pidfile_name = sys.argv[1:]
pidfile = Path(pidfile_name)
if check_guard(device_id, pidfile):
    pid = int(pidfile.read_text(encoding="ascii").splitlines()[0])
    process = psutil.Process(pid)
    process.terminate()
    try:
        process.wait(timeout=10)
    except psutil.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
pidfile.unlink(missing_ok=True)
PY

cat >"$INSTALL_ROOT/devices.json" <<EOF
{
  "transport": "broker",
  "broker_url": "https://jaytipargal.tech",
  "signer": "android-keystore",
  "key_alias": "eka-broker-samsung-s24-ultra",
  "broker_state_file": "$STATE_PATH",
  "enrollment_code_file": "$CODE_PATH",
  "installation_evidence_file": "$EVIDENCE_PATH",
  "heartbeat_interval_seconds": 45,
  "command_poll_interval_seconds": 15,
  "devices": [
    {
      "id": "$DEVICE_ID",
      "display_name": "Samsung S24 Ultra",
      "role": "primary",
      "type": "phone"
    }
  ],
  "allowed_commands": ["status-only", "ping", "echo", "wa-push", "wa-media-push", "sync-now"]
}
EOF

already_enrolled='false'
if [[ -f "$STATE_PATH" ]]; then
  already_enrolled="$("$VENV/bin/python" - "$STATE_PATH" <<'PY'
import json
import sys

try:
    state = json.load(open(sys.argv[1], encoding="utf-8"))
    print("true" if state.get("enrolled") is True and state.get("keyId") else "false")
except (OSError, ValueError):
    raise SystemExit("invalid existing broker state")
PY
)"
fi

if [[ "$already_enrolled" != 'true' ]]; then
  ENROLLMENT_CODE="${EKA_ENROLLMENT_CODE:-}"
  if [[ -z "$ENROLLMENT_CODE" ]]; then
    read -r -s -p 'Enter the 32-character one-time enrollment code: ' ENROLLMENT_CODE
    printf '\n'
  fi
  [[ "$ENROLLMENT_CODE" =~ ^[0-9a-fA-F]{32}$ ]] || fail 'enrollment code must be exactly 32 hexadecimal characters'
  printf '%s' "$ENROLLMENT_CODE" >"$CODE_PATH"
  unset ENROLLMENT_CODE EKA_ENROLLMENT_CODE
fi

rm -f "$INSTALL_ROOT/serviceAccountKey.json" "$HOME/eka-runner/serviceAccountKey.json"

cd "$INSTALL_ROOT"
"$VENV/bin/python" -c "from signer import TermuxKeystoreSigner; TermuxKeystoreSigner('eka-broker-samsung-s24-ultra').public_key_pem(); print('[ok] AndroidKeyStore signer ready')"
"$VENV/bin/python" "$INSTALL_ROOT/device_agent.py" "$INSTALL_ROOT/devices.json" "$DEVICE_ID" --enroll-only --log-file "$LOG_PATH"

[[ -f "$STATE_PATH" ]] || fail 'broker state was not created'
"$VENV/bin/python" - "$STATE_PATH" <<'PY'
import json
import sys

state = json.load(open(sys.argv[1], encoding="utf-8"))
if state.get("enrolled") is not True or not state.get("keyId"):
    raise SystemExit("signed enrollment did not complete")
PY
[[ ! -e "$CODE_PATH" ]] || fail 'enrollment code was not consumed; persistent startup was not installed'
printf '[ok] signed enrollment verified\n'

cat >"$BOOT_PATH" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT='$INSTALL_ROOT'
exec "\$ROOT/.venv/bin/python" "\$ROOT/device_agent.py" "\$ROOT/devices.json" '$DEVICE_ID' --log-file '$LOG_PATH'
EOF
chmod 700 "$BOOT_PATH"
[[ -x "$BOOT_PATH" ]] || fail 'boot launcher was not installed as an executable file'

# Launching the activity clears Android's stopped state. Merely copying a file
# under ~/.termux/boot does not prove the separate boot receiver can run it.
am start -n com.termux.boot/.BootActivity >/dev/null 2>&1 || fail 'Termux:Boot is installed but its activity could not be started'

termux-job-scheduler --cancel --job-id "$JOB_ID" >/dev/null 2>&1 || true
termux-job-scheduler \
  --job-id "$JOB_ID" \
  --script "$BOOT_PATH" \
  --period-ms 900000 \
  --network any \
  --persisted true >/dev/null

PENDING_JOBS="$(termux-job-scheduler --pending)" || fail 'could not inspect pending Termux jobs'
JOB_LINE=''
while IFS= read -r line; do
  if [[ "$line" == *"Job $JOB_ID: $BOOT_PATH"* ]]; then
    JOB_LINE="$line"
    break
  fi
done <<<"$PENDING_JOBS"
[[ -n "$JOB_LINE" ]] || fail "JobScheduler did not retain job $JOB_ID for $BOOT_PATH"
[[ "$JOB_LINE" == *"(periodic: 900000ms)"* ]] || fail 'JobScheduler did not retain the 15-minute period'
[[ "$JOB_LINE" == *"(persisted)"* ]] || fail 'JobScheduler did not retain reboot persistence'

"$VENV/bin/python" - "$EVIDENCE_PATH" "$RELEASE_ID" "$BOOT_PATH" "$JOB_ID" <<'PY'
import json
import sys
from datetime import datetime, timezone

path, release, launcher, job_id = sys.argv[1:]
evidence = {
    "release": release,
    "verifiedAt": datetime.now(timezone.utc).isoformat(),
    "termuxBootPackage": "com.termux.boot",
    "termuxBootPackageVerified": True,
    "bootLauncher": launcher,
    "bootLauncherVerified": True,
    "jobSchedulerId": int(job_id),
    "jobSchedulerPeriodMs": 900000,
    "jobSchedulerPersisted": True,
    "jobSchedulerVerified": True,
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(evidence, handle, separators=(",", ":"), sort_keys=True)
PY
printf '[ok] Termux:Boot launcher and persisted JobScheduler recovery verified\n'

# This is deliberately the installer's final heartbeat: installation evidence
# must exist before this release can publish liveDeviceVerified=true.
"$VENV/bin/python" "$INSTALL_ROOT/device_agent.py" "$INSTALL_ROOT/devices.json" "$DEVICE_ID" --once --log-file "$LOG_PATH"
printf '[ok] final signed heartbeat published with installation evidence\n'

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock >/dev/null
fi

nohup "$BOOT_PATH" >/dev/null 2>&1 &
DAEMON_PID=$!
sleep 5
kill -0 "$DAEMON_PID" 2>/dev/null || fail "daemon did not remain running; review $LOG_PATH"
printf '[ok] S24 broker daemon is running (pid %s)\n' "$DAEMON_PID"
