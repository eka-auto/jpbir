#!/usr/bin/env bash
# Provision or update jp-agent on the droplet. Idempotent — safe to re-run.
#
#   ./deploy.sh <droplet-ip> [ssh-key-path]
#
# Secrets are NOT handled here. /etc/jp-agent.env is created empty-but-valid on
# first run and the two values are filled in on the box, so no key ever passes
# through a repo, a shell history, or an agent transcript:
#
#   ANTHROPIC_AUTH_TOKEN   your current Anthropic OAuth token
#   JP_AGENT_TOKEN      generated on the droplet by this script if absent
#
# The s24-connect MCP tools (s24-tools.mjs) need a Firestore-capable service
# account key. Same rule as above — never in the repo or an agent transcript.
# Provision it once, by hand, before or after the first deploy:
#
#   scp -i <ssh-key-path> <path-to-key.json> root@<ip>:/etc/jp-agent-firestore-key.json
#   ssh -i <ssh-key-path> root@<ip> \
#     'chown jpagent:jpagent /etc/jp-agent-firestore-key.json && chmod 600 /etc/jp-agent-firestore-key.json'
#
# This script wires the non-secret S24_* env vars (project, database, and the
# key's path — not its contents) into /etc/jp-agent.env; without the key file
# in place, jp-agent still starts, but every s24-connect tool call fails.
set -euo pipefail

IP="${1:?usage: deploy.sh <droplet-ip> [ssh-key-path]}"
KEY="${2:-$HOME/.ssh/jayat_laptop_key}"
SSH=(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY" "root@$IP")

echo "==> shipping service files"
"${SSH[@]}" "install -d -o jpagent -g jpagent /opt/jp-agent"
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY" \
  "$(dirname "$0")/server.mjs" "$(dirname "$0")/s24-tools.mjs" \
  "$(dirname "$0")/device-health.mjs" "$(dirname "$0")/s24-attestation.js" \
  "$(dirname "$0")/sync-auth-token.py" \
  "$(dirname "$0")/package.json" "$(dirname "$0")/package-lock.json" \
  "root@$IP:/opt/jp-agent/"
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY" \
  "$(dirname "$0")/jp-agent.service" "root@$IP:/etc/systemd/system/jp-agent.service"
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY" \
  "$(dirname "$0")/nginx-jp-agent.conf" "root@$IP:/etc/nginx/sites-available/jp-agent.new"

"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail

# The recursive chown below reaches everything under /opt/jp-agent, including
# root-only artifacts that are not part of the runtime — the reconcile-* quarantine
# dirs and the timestamped *.bak-* snapshots. Handing those to the service user
# widens what a compromised agent can read, so snapshot them and restore after.
ROOT_ONLY="$(mktemp)"
trap 'rm -f "$ROOT_ONLY"' EXIT
find /opt/jp-agent -mindepth 1 -user root -print0 > "$ROOT_ONLY"

chown -R jpagent:jpagent /opt/jp-agent

echo "==> installing dependencies"
cd /opt/jp-agent
# `npm ci`, not `npm install`: the droplet installs exactly the versions in the
# committed package-lock.json. `npm install` re-resolves the `^` ranges in
# package.json on every deploy, so the box could run a claude-agent-sdk release
# nobody tested. `npm ci` also fails loudly if the lockfile and package.json
# disagree, instead of quietly rewriting the lockfile on the server.
sudo -u jpagent npm ci --omit=dev --no-audit --no-fund --silent
# The privileged stdin receiver must not be writable by the agent service.
chown root:root /opt/jp-agent /opt/jp-agent/sync-auth-token.py
chmod 755 /opt/jp-agent
chmod 644 /opt/jp-agent/sync-auth-token.py

if [ -s "$ROOT_ONLY" ]; then
  echo "==> restoring root ownership on pre-existing root-only paths"
  xargs -0 -r -a "$ROOT_ONLY" chown root:root --
fi

# Create the env file on first run only, so re-deploying never clobbers a key
# that is already in place.
if [ ! -f /etc/jp-agent.env ]; then
  echo "==> creating /etc/jp-agent.env"
  TOKEN="$(openssl rand -hex 32)"
  cat > /etc/jp-agent.env <<ENV
# Fill ANTHROPIC_AUTH_TOKEN securely, then: systemctl restart jp-agent
ANTHROPIC_AUTH_TOKEN=
JP_AGENT_TOKEN=$TOKEN
JP_AGENT_WORKSPACE=/srv/workspace
JP_AGENT_PORT=8790
S24_SERVICE_ACCOUNT_KEY=/etc/jp-agent-firestore-key.json
S24_PROJECT_ID=intrepid-stage-495117-q1
S24_FIRESTORE_DB=eka-agent
ENV
  chmod 600 /etc/jp-agent.env
  echo "    generated JP_AGENT_TOKEN (read it with: grep JP_AGENT_TOKEN /etc/jp-agent.env)"
else
  echo "==> /etc/jp-agent.env already present, left untouched"
  # Upgrade path for a box deployed before the s24-connect tools existed: add
  # the (non-secret) S24_* vars if missing, without touching anything else.
  grep -q "^S24_SERVICE_ACCOUNT_KEY=" /etc/jp-agent.env || cat >> /etc/jp-agent.env <<ENV
S24_SERVICE_ACCOUNT_KEY=/etc/jp-agent-firestore-key.json
S24_PROJECT_ID=intrepid-stage-495117-q1
S24_FIRESTORE_DB=eka-agent
ENV
fi

if [ ! -f /etc/jp-agent-firestore-key.json ]; then
  echo "==> /etc/jp-agent-firestore-key.json is missing — s24-connect tool calls will fail until it's provisioned"
  echo "    scp the Firestore service-account key there, then:"
  echo "    chown jpagent:jpagent /etc/jp-agent-firestore-key.json && chmod 600 /etc/jp-agent-firestore-key.json"
fi

# Same rule as the env file above: never clobber what the box has customised.
# Once certbot has run it rewrites this vhost in place — moves :80 to a redirect
# block and adds the :443 listener plus cert paths. Overwriting it would silently
# drop TLS, and JP_AGENT_URL is https://, so the dashboard terminal would break.
if [ -f /etc/nginx/sites-available/jp-agent ] &&
   grep -q "managed by Certbot" /etc/nginx/sites-available/jp-agent; then
  echo "==> nginx vhost is certbot-managed, left untouched"
  echo "    shipped copy parked at /etc/nginx/sites-available/jp-agent.new"
  echo "    to adopt it: install it, then re-run certbot --nginx -d runner.jaytipargal.tech"
else
  mv /etc/nginx/sites-available/jp-agent.new /etc/nginx/sites-available/jp-agent
fi

ln -sf /etc/nginx/sites-available/jp-agent /etc/nginx/sites-enabled/jp-agent
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

systemctl daemon-reload
systemctl enable jp-agent >/dev/null
systemctl restart jp-agent
sleep 2
systemctl is-active jp-agent && echo "==> jp-agent active"
curl -sf http://127.0.0.1:8790/health && echo
REMOTE

echo "==> done"
