#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

echo '== Setting up SSH on samsung-s24-ultra =='
MANUFACTURER="$(getprop ro.product.manufacturer 2>/dev/null || true)"
MODEL="$(getprop ro.product.model 2>/dev/null || true)"
[[ "${MANUFACTURER,,}" == samsung* ]] || { echo "ERROR: Expected Samsung, found '$MANUFACTURER'"; exit 1; }
[[ "$MODEL" == SM-S928* ]] || { echo "ERROR: Expected SM-S928*, found '$MODEL'"; exit 1; }
echo "[ok] Hardware: $MANUFACTURER $MODEL"

pkg install -y openssh || { echo 'ERROR: Failed to install openssh'; exit 1; }

SSH_DIR="$HOME/.ssh"
umask 077
mkdir -p "$SSH_DIR"

KEY_PATH="$SSH_DIR/id_ed25519"
if [[ ! -f "$KEY_PATH" ]]; then
    ssh-keygen -t ed25519 -f "$KEY_PATH" -N '' -C 'samsung-s24-ultra-2026'
fi

PUB_KEY_PATH="$SSH_DIR/id_ed25519.pub"
AUTH_KEYS_PATH="$SSH_DIR/authorized_keys"
[[ -f "$PUB_KEY_PATH" ]] && cp "$PUB_KEY_PATH" "$AUTH_KEYS_PATH"

chmod 700 "$SSH_DIR"
chmod 600 "$KEY_PATH"
chmod 644 "$PUB_KEY_PATH"
chmod 600 "$AUTH_KEYS_PATH"

if ! pgrep -x sshd >/dev/null 2>&1; then
    sshd
fi

IP_ADDRESS="$(ip addr show wlan0 | grep "inet\b" | awk '{print $2}' | cut -d/ -f1 2>/dev/null || echo "unknown")"
echo "[ok] SSH setup complete. Device IP: $IP_ADDRESS"
echo 'Public key (copy to other devices):'
cat "$PUB_KEY_PATH"
