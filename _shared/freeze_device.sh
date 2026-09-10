#!/data/data/com.termux/files/usr/bin/bash
# Freeze/Unfreeze S24 device in Firestore
# Usage: ./freeze_device.sh [freeze|unfreeze]
# Default action: freeze

set -euo pipefail

ACTION="${1:-freeze}"
DEVICE_ID="samsung-s24-ultra"
DISPLAY_NAME="Samsung S24 Ultra"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "============================================================"
echo "S24 DEVICE FREEZE TOOL"
echo "============================================================"
echo "Device: $DEVICE_ID"
echo "Action: $ACTION"
echo ""

# Check if Python is available
if ! command -v python &> /dev/null; then
    echo "[ERROR] Python not found. Install with: pkg install python"
    exit 1
fi

# Check if firebase-admin is installed
if ! python -c "import firebase_admin" 2>/dev/null; then
    echo "[INFO] Installing firebase-admin..."
    pip install firebase-admin --quiet
fi

# Run the freeze script
python "$REPO_DIR/tools/freeze_device.py" --device "$DEVICE_ID" --action "$ACTION"

echo ""
echo "============================================================"
echo "COMPLETE"
echo "============================================================"
