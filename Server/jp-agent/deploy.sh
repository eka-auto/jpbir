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
"${SSH[@]}" "install -d -o jpagent -g jpagent /opt/jp-agent /opt/s24-mcp"
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY" \
  "$(dirname "$0")/server.mjs" "$(dirname "$0")/s24-tools.mjs" \
  "$(dirname "$0")/device-health.mjs" "$(dirname "$0")/s24-attestation.js" \
  "$(dirname "$0")/sync-auth-token.py" \
  "$(dirname "$0")/package.json" "$(dirname "$0")/package-lock.json" \
  "root@$IP:/opt/jp-agent/"
# s24-mcp is a separate process with its own systemd unit, so it gets its own
# directory. s24-mcp-server.mjs imports ./device-health.mjs relatively, and
# device-health.mjs in turn imports ./s24-attestation.js — so the whole
# transitive closure has to land in one directory or node fails at startup with
# ERR_MODULE_NOT_FOUND. These are the same files shipped to /opt/jp-agent above;
# s24-attestation.test.mjs asserts the repo-side copies are byte-identical, so
# the two droplet copies cannot drift either.
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY" \
  "$(dirname "$0")/s24-mcp-server.mjs" "$(dirname "$0")/device-health.mjs" \
  "$(dirname "$0")/s24-attestation.js" \
  "root@$IP:/opt/s24-mcp/"
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY" \
  "$(dirname "$0")/jp-agent.service" "root@$IP:/etc/systemd/system/jp-agent.service"
# The unit's ExecStart must name s24-mcp-server.mjs. It used to say server.mjs,
# which does not exist in /opt/s24-mcp, so systemctl start would have failed with
# "file not found" even once the file was shipped. s24-mcp.service and the file
# shipped above are kept in step here.
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY" \
  "$(dirname "$0")/s24-mcp.service" "root@$IP:/etc/systemd/system/s24-mcp.service"
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
  # A second, independent token for the standalone s24-mcp HTTP server. Generated
  # separately from JP_AGENT_TOKEN on purpose: the browser-facing dashboard key and
  # the MCP loopback key have different blast radii, so one leaking should not
  # authenticate the other. Read it with: grep S24_MCP_TOKEN /etc/jp-agent.env
  MCP_TOKEN="$(openssl rand -hex 32)"
  cat > /etc/jp-agent.env <<ENV
# Fill ANTHROPIC_AUTH_TOKEN securely, then: systemctl restart jp-agent s24-mcp
ANTHROPIC_AUTH_TOKEN=
JP_AGENT_TOKEN=$TOKEN
S24_MCP_TOKEN=$MCP_TOKEN
JP_AGENT_WORKSPACE=/srv/workspace
JP_AGENT_PORT=8790
S24_SERVICE_ACCOUNT_KEY=/etc/jp-agent-firestore-key.json
S24_PROJECT_ID=intrepid-stage-495117-q1
S24_FIRESTORE_DB=eka-agent
ENV
  chmod 600 /etc/jp-agent.env
  echo "    generated JP_AGENT_TOKEN (read it with: grep JP_AGENT_TOKEN /etc/jp-agent.env)"
  echo "    generated S24_MCP_TOKEN (read it with: grep S24_MCP_TOKEN /etc/jp-agent.env)"
else
  echo "==> /etc/jp-agent.env already present, left untouched"
  # Upgrade path for a box deployed before the s24-connect tools existed: add
  # the (non-secret) S24_* vars if missing, without touching anything else.
  grep -q "^S24_SERVICE_ACCOUNT_KEY=" /etc/jp-agent.env || cat >> /etc/jp-agent.env <<ENV
S24_SERVICE_ACCOUNT_KEY=/etc/jp-agent-firestore-key.json
S24_PROJECT_ID=intrepid-stage-495117-q1
S24_FIRESTORE_DB=eka-agent
ENV
  # Same for a box deployed before the standalone s24-mcp unit existed. Without
  # this the unit exits 1 on startup (it refuses to serve unauthenticated), and
  # the failure looks like a missing file rather than a missing token.
  if ! grep -q "^S24_MCP_TOKEN=" /etc/jp-agent.env; then
    echo "==> generating S24_MCP_TOKEN (s24-mcp refuses to start without it)"
    # Append before chmod'ing again so the file is never briefly world-readable.
    printf 'S24_MCP_TOKEN=%s\n' "$(openssl rand -hex 32)" >> /etc/jp-agent.env
    chmod 600 /etc/jp-agent.env
    echo "    read it with: grep S24_MCP_TOKEN /etc/jp-agent.env"
  fi
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

# s24-mcp needs its own node_modules: it is a separate process in a separate
# directory, and it imports @modelcontextprotocol/sdk, which jp-agent itself
# does not use. Ship the same package.json/package-lock.json so `npm ci` pins
# identical versions rather than re-resolving the ^ ranges on the box.
if [ ! -f /opt/s24-mcp/package.json ]; then
  echo "==> seeding /opt/s24-mcp/package.json"
  cp /opt/jp-agent/package.json /opt/jp-agent/package-lock.json /opt/s24-mcp/
fi
echo "==> installing s24-mcp dependencies"
cd /opt/s24-mcp
sudo -u jpagent npm ci --omit=dev --no-audit --no-fund --silent

systemctl daemon-reload
systemctl enable jp-agent >/dev/null
systemctl restart jp-agent
sleep 2
systemctl is-active jp-agent && echo "==> jp-agent active"
curl -sf http://127.0.0.1:8790/health && echo

systemctl enable s24-mcp >/dev/null
systemctl restart s24-mcp
sleep 2
if systemctl is-active --quiet s24-mcp; then
  echo "==> s24-mcp active"
  # 401 without a bearer token is the healthy answer: it proves the listener is
  # up and refusing anonymous callers. A connection error or 404 would not.
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8792/mcp)"
  echo "    unauthenticated POST /mcp -> $code (401 expected)"
  if [ "$code" != "401" ]; then
    echo "    WARNING: expected 401 from /mcp without a token; got $code"
    echo "    check: journalctl -u s24-mcp -n 40 --no-pager"
  fi
else
  echo "==> WARNING: s24-mcp is not active"
  echo "    check: journalctl -u s24-mcp -n 40 --no-pager"
  echo "    a missing S24_MCP_TOKEN in /etc/jp-agent.env is the usual cause"
fi
REMOTE

echo "==> done"
