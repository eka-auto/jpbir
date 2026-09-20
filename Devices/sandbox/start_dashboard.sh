#!/usr/bin/env bash
# Start the channel-sandbox dashboard locally.
#
# This exists because the launcher the module docstring points at no longer
# works. Server/start_dashboard.bat does `cd /d %~dp0` into Server/ and then
# runs `dashboard_api.py --config devices.json`, but the restructure moved both
# files to Devices/sandbox/ and neither is in Server/ any more — so the only
# documented way to start this service referenced two paths that do not exist.
# It was also Windows-only and hardcoded an absolute interpreter path, which no
# CI runner or Linux machine could follow.
#
# Defaults are the loopback developer workflow: no STATS_KEY, so dashboard_api
# waives auth for a loopback bind and refuses any other bind without a key.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p logs
exec "${PYTHON:-python3}" dashboard_api.py \
  --config "${SANDBOX_CONFIG:-devices.emulator.json}" \
  --host "${HOST:-127.0.0.1}" \
  --port "${PORT:-5000}"
