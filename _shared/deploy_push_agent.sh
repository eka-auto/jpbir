#!/bin/bash
# EKA Agent — Device Deployment Package
# This script is copied to each remote device to set up the push agent
#
# Usage on each device:
#   1. Copy this script + eka_agent_push.py to the device
#   2. Run: bash deploy_push_agent.sh <device_name>
#   3. Set up cron: 0 0 * * * python3 /opt/eka_agent/eka_agent_push.py --device <device_name>

DEVICE=$1
SCRIPT_DIR="/opt/eka_agent"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VPS_URL="${EKA_VPS_URL:-https://agent.urgaa.in}"
API_KEY="${EKA_API_KEY:-YOUR_API_KEY_HERE}"

if [ -z "$DEVICE" ]; then
    echo "Usage: bash deploy_push_agent.sh <device_name>"
    echo "  device_name: samsung_s24_ultra | asus_vivobook | jp_drivebackup | jp_birthday_site_server | termux_s24"
    exit 1
fi

echo "=== EKA Agent Push — Deploying on $DEVICE ==="

# Create directory
mkdir -p $SCRIPT_DIR
mkdir -p ~/.eka_agent

# Copy push script
cp "$SOURCE_DIR/eka_agent_push.py" "$SCRIPT_DIR/"

# Configure target VPS and API key in deployed script
sed -i "s|^VPS_URL = \".*\"$|VPS_URL = \"${VPS_URL}\"|" "$SCRIPT_DIR/eka_agent_push.py"
sed -i "s|^API_KEY = \".*\"$|API_KEY = \"${API_KEY}\"|" "$SCRIPT_DIR/eka_agent_push.py"

# Install dependencies
if command -v apt-get &> /dev/null; then
    apt-get update -qq
    apt-get install -y -qq python3 python3-pip curl sqlite3
    pip3 install --break-system-packages requests 2>/dev/null || pip3 install requests
elif command -v pkg &> /dev/null; then
    # Termux
    pkg install -y python curl sqlite
    pip install requests
fi

# Set up cron job
CRON_LINE="0 0 * * * python3 $SCRIPT_DIR/eka_agent_push.py --device $DEVICE >> $SCRIPT_DIR/push.log 2>&1"

# Add to crontab if not already there
(crontab -l 2>/dev/null | grep -v "eka_agent_push.py" ; echo "$CRON_LINE") | crontab -

echo "=== Deployed successfully on $DEVICE ==="
echo "  Script: $SCRIPT_DIR/eka_agent_push.py"
echo "  Cron:   $CRON_LINE"
echo "  VPS:    $VPS_URL"
if [ "$API_KEY" = "YOUR_API_KEY_HERE" ]; then
    echo "  WARNING: API key placeholder is still set. Export EKA_API_KEY before deploy."
fi
echo ""
echo "Test with: python3 $SCRIPT_DIR/eka_agent_push.py --device $DEVICE --dry-run"