#!/usr/bin/env bash
# GitHub Actions self-hosted runner setup for the jp-agent droplet.
#
# Get a token first:
#   gh api repos/jaytipargal/jpbir/actions/runners/registration-token -X POST
#
# Then run THIS script on the droplet as root:
set -euo pipefail

TOKEN="${REGISTRATION_TOKEN:?Need registration token — get one with: gh api repos/jaytipargal/jpbir/actions/runners/registration-token -X POST}"

mkdir -p /opt/actions-runner
cd /opt/actions-runner

# Download
curl -sSL https://github.com/actions/runner/releases/latest/download/actions-runner-linux-x64.tar.gz -o actions-runner.tar.gz
tar xzf actions-runner.tar.gz
rm -f actions-runner.tar.gz

# Install deps
./bin/installdependencies.sh

# Configure + install as service
./config.sh --url https://github.com/jaytipargal/jpbir --token "$TOKEN" \
  --name jp-agent-droplet --labels jp-agent,droplet,deploy --unattended --replace
sudo ./svc.sh install
sudo ./svc.sh start

echo "Runner jp-agent-droplet is starting. Check: https://github.com/jaytipargal/jpbir/settings/actions/runners"
