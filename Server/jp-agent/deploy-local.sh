#!/usr/bin/env bash
# Local deploy — runs ON the droplet via the self-hosted GitHub Actions runner.
#
# This is the local equivalent of deploy.sh's remote block. It assumes the
# repository is already checked out in the runner's workspace, so no scp/ssh
# is needed. Run from Server/jp-agent/ on the droplet:
#
#   cd "$GITHUB_WORKSPACE/Server/jp-agent" && bash deploy-local.sh
#
# The workflow (.github/workflows/deploy-droplet.yml) calls this after checkout.
set -euo pipefail

# The GitHub Actions runner runs as a non-root user by default. We need root
# for systemctl, nginx, and chown. Re-exec if not root.
if [ "$(id -u)" -ne 0 ]; then
  echo "==> Re-running as root via sudo"
  exec sudo "$0" "$@"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing jp-agent and s24-mcp to local filesystem"

# Create the service directories with correct ownership.
install -d -o jpagent -g jpagent /opt/jp-agent /opt/s24-mcp /srv/workspace
mkdir -p /srv/workspace
chown jpagent:jpagent /srv/workspace

# Copy files. The repo is checked out at $SCRIPT_DIR (which is the jp-agent dir).
cp "$SCRIPT_DIR/server.mjs" "$SCRIPT_DIR/s24-tools.mjs" \
   "$SCRIPT_DIR/device-health.mjs" "$SCRIPT_DIR/s24-attestation.js" \
   "$SCRIPT_DIR/sync-auth-token.py" \
   "$SCRIPT_DIR/package.json" "$SCRIPT_DIR/package-lock.json" \
   /opt/jp-agent/

cp "$SCRIPT_DIR/s24-mcp-server.mjs" "$SCRIPT_DIR/device-health.mjs" \
   "$SCRIPT_DIR/s24-attestation.js" \
   /opt/s24-mcp/

cp "$SCRIPT_DIR/jp-agent.service" /etc/systemd/system/jp-agent.service
cp "$SCRIPT_DIR/s24-mcp.service" /etc/systemd/system/s24-mcp.service
cp "$SCRIPT_DIR/nginx-jp-agent.conf" /etc/nginx/sites-available/jp-agent.new

# The recursive chown below reaches everything under /opt/jp-agent, including
# root-only artifacts (reconcile-* dirs, *.bak-* snapshots). Hand those back.
ROOT_ONLY="$(mktemp)"
trap 'rm -f "$ROOT_ONLY"' EXIT
find /opt/jp-agent -mindepth 1 -user root -print0 > "$ROOT_ONLY"

chown -R jpagent:jpagent /opt/jp-agent

echo "==> Installing dependencies"
cd /opt/jp-agent
sudo -u jpagent npm ci --omit=dev --no-audit --no-fund --silent
# The privileged stdin receiver must not be writable by the agent service.
chown root:root /opt/jp-agent /opt/jp-agent/sync-auth-token.py
chmod 755 /opt/jp-agent
chmod 644 /opt/jp-agent/sync-auth-token.py

if [ -s "$ROOT_ONLY" ]; then
  echo "==> Restoring root ownership on pre-existing root-only paths"
  xargs -0 -r -a "$ROOT_ONLY" chown root:root --
fi

# Create or update the env file. Unlike deploy.sh, this runs on the droplet
# itself, so we can read existing secrets from the environment or prompt.
if [ ! -f /etc/jp-agent.env ]; then
  echo "==> Creating /etc/jp-agent.env"
  TOKEN="$(openssl rand -hex 32)"
  MCP_TOKEN="$(openssl rand -hex 32)"

  # Use GitHub Actions secrets if available (preferred), otherwise generate.
  if [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
    ANTHROPIC_TOKEN="${ANTHROPIC_AUTH_TOKEN}"
  else
    ANTHROPIC_TOKEN=""
  fi

  cat > /etc/jp-agent.env <<ENV
# Filled by GitHub Actions deploy workflow.
ANTHROPIC_AUTH_TOKEN=$ANTHROPIC_TOKEN
JP_AGENT_TOKEN=$TOKEN
S24_MCP_TOKEN=$MCP_TOKEN
JP_AGENT_WORKSPACE=/srv/workspace
JP_AGENT_PORT=8790
S24_SERVICE_ACCOUNT_KEY=/etc/jp-agent-firestore-key.json
S24_PROJECT_ID=intrepid-stage-495117-q1
S24_FIRESTORE_DB=eka-agent
ENV
  chmod 600 /etc/jp-agent.env
  echo "    generated JP_AGENT_TOKEN (grep JP_AGENT_TOKEN /etc/jp-agent.env)"
  echo "    generated S24_MCP_TOKEN (grep S24_MCP_TOKEN /etc/jp-agent.env)"
else
  echo "==> /etc/jp-agent.env already present, left untouched"
  grep -q "^S24_SERVICE_ACCOUNT_KEY=" /etc/jp-agent.env || cat >> /etc/jp-agent.env <<ENV
S24_SERVICE_ACCOUNT_KEY=/etc/jp-agent-firestore-key.json
S24_PROJECT_ID=intrepid-stage-495117-q1
S24_FIRESTORE_DB=eka-agent
ENV
  if ! grep -q "^S24_MCP_TOKEN=" /etc/jp-agent.env; then
    echo "==> Generating S24_MCP_TOKEN"
    printf 'S24_MCP_TOKEN=%s\n' "$(openssl rand -hex 32)" >> /etc/jp-agent.env
    chmod 600 /etc/jp-agent.env
  fi
fi

# Read the S24_MCP_TOKEN from the env file (handles both fresh and upgrade paths).
S24_MCP_TOKEN="$(grep '^S24_MCP_TOKEN=' /etc/jp-agent.env | cut -d= -f2-)"

# Copy the MCP config that points jp-agent at the standalone s24-mcp server.
# This file is created by the deploy workflow. It configures the MCP server
# URL and the bearer token (interpolated from the environment).
cat > /etc/jp-agent-mcp.json <<MCP
{
  "servers": [
    {
      "name": "s24-connect",
      "type": "http",
      "url": "http://127.0.0.1:8792/mcp",
      "headers": {
        "Authorization": "Bearer ${S24_MCP_TOKEN}"
      }
    }
  ]
}
MCP
chmod 600 /etc/jp-agent-mcp.json
chown jpagent:jpagent /etc/jp-agent-mcp.json

# Handle the Firestore service account key if not present.
if [ ! -f /etc/jp-agent-firestore-key.json ]; then
  if [ -n "${S24_FIRESTORE_KEY:-}" ]; then
    echo "$S24_FIRESTORE_KEY" > /etc/jp-agent-firestore-key.json
    chown jpagent:jpagent /etc/jp-agent-firestore-key.json
    chmod 600 /etc/jp-agent-firestore-key.json
    echo "    provisioned Firestore service account key from secret"
  else
    echo "==> /etc/jp-agent-firestore-key.json is missing — s24-connect tools will fail"
    echo "    Set the S24_FIRESTORE_KEY secret in the repository, then re-deploy"
  fi
fi

# Seed the s24-mcp package.json and install its dependencies.
if [ ! -f /opt/s24-mcp/package.json ]; then
  echo "==> Seeding /opt/s24-mcp/package.json"
  cp /opt/jp-agent/package.json /opt/jp-agent/package-lock.json /opt/s24-mcp/
fi
echo "==> Installing s24-mcp dependencies"
cd /opt/s24-mcp
sudo -u jpagent npm ci --omit=dev --no-audit --no-fund --silent

# Reload systemd and restart both services.
systemctl daemon-reload
systemctl enable jp-agent >/dev/null
systemctl restart jp-agent
sleep 2
systemctl is-active jp-agent && echo "==> jp-agent active" || { echo "ERROR: jp-agent is not active"; exit 1; }

systemctl enable s24-mcp >/dev/null
systemctl restart s24-mcp
sleep 2
if systemctl is-active --quiet s24-mcp; then
  echo "==> s24-mcp active"
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8792/mcp)"
  echo "    unauthenticated POST /mcp -> $code (401 expected)"
else
  echo "==> WARNING: s24-mcp is not active"
  journalctl -u s24-mcp -n 40 --no-pager
  exit 1
fi

echo "==> Local deploy complete"
