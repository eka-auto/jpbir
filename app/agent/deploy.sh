#!/usr/bin/env bash
# Provision or update jp-agent on the droplet. Idempotent — safe to re-run.
#
#   ./deploy.sh <droplet-ip> [ssh-key-path]
#
# Secrets are NOT handled here. /etc/jp-agent.env is created empty-but-valid on
# first run and the two values are filled in on the box, so no key ever passes
# through a repo, a shell history, or an agent transcript:
#
#   ANTHROPIC_API_KEY   your Anthropic key
#   JP_AGENT_TOKEN      generated on the droplet by this script if absent
set -euo pipefail

IP="${1:?usage: deploy.sh <droplet-ip> [ssh-key-path]}"
KEY="${2:-$HOME/.ssh/jayat_laptop_key}"
SSH=(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY" "root@$IP")

echo "==> shipping service files"
"${SSH[@]}" "install -d -o jpagent -g jpagent /opt/jp-agent"
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY" \
  "$(dirname "$0")/server.mjs" "$(dirname "$0")/package.json" "root@$IP:/opt/jp-agent/"
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY" \
  "$(dirname "$0")/jp-agent.service" "root@$IP:/etc/systemd/system/jp-agent.service"
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY" \
  "$(dirname "$0")/nginx-jp-agent.conf" "root@$IP:/etc/nginx/sites-available/jp-agent"

"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
chown -R jpagent:jpagent /opt/jp-agent

echo "==> installing dependencies"
cd /opt/jp-agent
sudo -u jpagent npm install --omit=dev --no-audit --no-fund --silent

# Create the env file on first run only, so re-deploying never clobbers a key
# that is already in place.
if [ ! -f /etc/jp-agent.env ]; then
  echo "==> creating /etc/jp-agent.env"
  TOKEN="$(openssl rand -hex 32)"
  cat > /etc/jp-agent.env <<ENV
# Fill ANTHROPIC_API_KEY in, then: systemctl restart jp-agent
ANTHROPIC_API_KEY=
JP_AGENT_TOKEN=$TOKEN
JP_AGENT_WORKSPACE=/srv/workspace
JP_AGENT_PORT=8790
ENV
  chmod 600 /etc/jp-agent.env
  echo "    generated JP_AGENT_TOKEN (read it with: grep JP_AGENT_TOKEN /etc/jp-agent.env)"
else
  echo "==> /etc/jp-agent.env already present, left untouched"
fi

ln -sf /etc/nginx/sites-available/jp-agent /etc/nginx/sites-enabled/jp-agent
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

systemctl daemon-reload
systemctl enable --now jp-agent >/dev/null 2>&1 || true
systemctl restart jp-agent
sleep 2
systemctl is-active jp-agent && echo "==> jp-agent active"
curl -sf http://127.0.0.1:8790/health && echo
REMOTE

echo "==> done"
