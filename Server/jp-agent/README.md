# jp-agent

The terminal, moved behind `jaytipargal.tech`. Answers questions and *does the
work* — shell, file edits, git, deploys — from the dashboard instead of a local
shell.

## Why a droplet and not Vercel

A Vercel function is short-lived with an ephemeral filesystem. An agent needs a
workspace that survives between questions, and tasks that can run for minutes
(installs, builds, test suites). Those are opposite requirements, so the runtime
lives on DigitalOcean and Vercel only proxies to it.

## Shape

```
browser  ──dashboard key──▶  jaytipargal.tech /api/agent-run   (Vercel)
                                     │ Bearer JP_AGENT_TOKEN
                                     ▼
                              nginx :80  (sole ingress)
                                     ▼
                       jp-agent :8790  bound to 127.0.0.1
                          user jpagent · cwd /srv/workspace
```

The browser never holds the droplet token. Two separate credentials, so
compromising the dashboard key does not hand over the agent.

| | |
|---|---|
| Droplet | `jp-agent`, blr1, s-1vcpu-2gb |
| Service | `/opt/jp-agent`, systemd unit `jp-agent` |
| Workspace | `/srv/workspace` |
| Secrets | `/etc/jp-agent.env`, root-owned `0600` |

## Deploying

```bash
./deploy.sh <droplet-ip> [ssh-key-path]
```

Idempotent. Ships `server.mjs`, `s24-tools.mjs`, `device-health.mjs`,
`sync-auth-token.py`, the unit and the nginx config, installs dependencies, and
restarts. It creates `/etc/jp-agent.env` on first run only, so re-running never
clobbers a key already in place.

## The two secrets

Deliberately not in this repo, not in the deploy script, and not passed through
any agent transcript.

**On the droplet** — `ANTHROPIC_AUTH_TOKEN` is generated blank and must be filled
without leaving the value in shell history (pipe it over stdin, never as an
argument):

```bash
ssh root@<ip>
printf '%s' "$TOKEN" | python3 /opt/jp-agent/sync-auth-token.py
```

**On Vercel** — the droplet generates `JP_AGENT_TOKEN` itself. Read it on the
box and set the pair against the project that serves the domain, which is
`jayti-dashboard`, not `jpbir_restructured`:

```bash
ssh root@<ip> 'grep JP_AGENT_TOKEN /etc/jp-agent.env'

vercel env add JP_AGENT_TOKEN production --scope jayti --project jayti-dashboard
vercel env add JP_AGENT_URL   production --scope jayti --project jayti-dashboard   # https://runner.jaytipargal.tech
```

## Model and limits

Optional vars in `/etc/jp-agent.env`; change and `systemctl restart jp-agent`.
No redeploy — `server.mjs` reads them at startup.

| Var | Default | Notes |
|---|---|---|
| `JP_AGENT_MODEL` | `claude-sonnet-5` | Agentic-coding tier at $2/$10 per MTok. Opus 5 is $5/$25 for the same job here. |
| `JP_AGENT_MAX_TURNS` | `150` | Agent-loop cap. |
| `JP_AGENT_PORT` | `8790` | Bound to `127.0.0.1`. |
| `JP_AGENT_WORKSPACE` | `/srv/workspace` | Must stay inside the unit's `ReadWritePaths`. |

The turn cap is not what limits a dashboard question — `Backend/agent-run.js`
aborts the proxy at 780s (against an 800s `maxDuration`), so wall-clock binds
first. Raise `maxTurns` for long runs driven from the droplet itself; for the
dashboard, the 780s abort is the number to change.

## Cloud CLIs

The agent can drive DigitalOcean, GitHub and Vultr. All of it lives in the
`jpagent` home, because the unit's `ProtectSystem=strict` makes everything else
read-only:

| | |
|---|---|
| Binaries | `~/bin/gh`, `~/bin/doctl`, `~/bin/vultr-cli` (official linux releases, no root) |
| Credentials | `~/.config/jp-cloud/credentials.env`, `0600`: `DIGITALOCEAN_ACCESS_TOKEN`, `GH_TOKEN`, `VULTR_API_KEY` |
| CLI config | `~/.config/doctl/config.yaml`, gh auth + `gh auth setup-git`, `~/.vultr-cli.yaml` (`0600`) |

The unit loads that credentials file as an optional `EnvironmentFile` and puts
`/home/jpagent/bin` first on `PATH`, so tools the agent runs find the CLIs
without sourcing a shell profile — a service shell is non-login and
non-interactive, and Ubuntu's `.bashrc` returns before any appended line runs.

Credential scope:

- **DigitalOcean / GitHub** — the operator's own tokens. Neither CLI can mint a
  new token, so a compromise of this droplet means rotating both everywhere.
- **Vultr** — a dedicated sub-user `jp-agent` limited to `subscriptions`,
  `subscriptions_view`, `provisioning`, `dns`, `firewall` (no billing, no user
  management). Vultr keeps a **per-user** API IP allowlist; this user's allows
  only the droplet (`168.144.24.224/32`). Manage it with
  `/v2/users/{id}/ip-whitelist`.

Tokens are delivered out of band, never through a prompt, so they don't land in
an agent transcript. Rotating one: replace the line in `credentials.env`, re-run
`doctl auth init` / `gh auth login --with-token` / rewrite `~/.vultr-cli.yaml`,
then `systemctl restart jp-agent` so the unit reloads the environment.

Cost per turn is dominated by the SDK's system prompt and 18 tool definitions,
so a short answer is not cheap: a one-word reply on a cold session bills ~$0.08,
while the same reply on a warm cached session bills ~$0.006. Reusing a session
matters more than the model choice for short questions.

## TLS — done

Served over HTTPS at **https://runner.jaytipargal.tech**, Let's Encrypt, with
`certbot.timer` active for renewal. Plain HTTP 301-redirects to it, so the
bearer token is never in cleartext on the wire.

`runner.` and not `agent.`: `agent.jaytipargal.tech` was already a live Vercel
CNAME serving another project, and taking it would have broken that.

The 301 only applies when the Host header matches. Certbot's `:80` block is
`server_name runner.jaytipargal.tech`, and it is now the *only* port-80 server,
so it is also the default — **any HTTP request with a different Host gets a bare
404**, including `curl http://<droplet-ip>/health`. That 404 is nginx working as
configured, not the service being down. Health-check the real name over HTTPS:

```bash
curl -s https://runner.jaytipargal.tech/health          # 200 {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' http://<ip>/health   # 404 — expected
```

Nothing reaches the agent without the bearer token either, so `401 unauthorized`
from `/ask` is also healthy. `missing key` is never from here — that string is
the dashboard's own `STATS_KEY` gate in `Backend/_auth.js`.

jaytipargal.tech runs on Vercel nameservers, so the A record is managed with
`vercel dns`, not doctl:

```bash
vercel dns add jaytipargal.tech runner A <droplet-ip> --scope jayti
```

Note the zone has a wildcard `* ALIAS` pointing at Vercel — an explicit record
for a name overrides it, which is what makes this work.

## Security notes

The agent executes arbitrary commands by design, so the confinement matters:

- binds `127.0.0.1`; nginx is the only way in
- bearer token compared with `timingSafeEqual` over SHA-256 digests, so neither
  the value nor its length leaks through timing
- runs as unprivileged `jpagent`, never root
- systemd `ProtectSystem=strict` — only `/srv/workspace` and `/home/jpagent`
  are writable
- `cwd` is pinned to the workspace and cannot be set per-request
- tool-use events stream the tool *name* and a 200-char argument preview only;
  full arguments can carry file contents and reach a browser

Refuses to start if `JP_AGENT_TOKEN` is unset, rather than serving open.

## Checks

```bash
curl -s https://runner.jaytipargal.tech/health     # 200
curl -s -o /dev/null -w '%{http_code}'      https://runner.jaytipargal.tech/sessions      # 401 without a bearer token
ssh root@<ip> 'systemctl status jp-agent --no-pager; journalctl -u jp-agent -n 40 --no-pager'
```

Verified: HTTPS 200, unauthenticated `/sessions` 401, HTTP 301 to HTTPS,
service running as `jpagent`, `ProtectSystem=strict` with only
`/srv/workspace` and `/home/jpagent` writable, `NoNewPrivileges=yes`, ufw
limited to 22/80/443, and `unattended-upgrades` active for security patches.
