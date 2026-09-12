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

Idempotent. Ships `server.mjs`, the unit and the nginx config, installs
dependencies, and restarts. It creates `/etc/jp-agent.env` on first run only, so
re-running never clobbers a key already in place.

## The two secrets

Deliberately not in this repo, not in the deploy script, and not passed through
any agent transcript.

**On the droplet** — `ANTHROPIC_API_KEY` is generated blank and must be filled:

```bash
ssh root@<ip>
nano /etc/jp-agent.env        # set ANTHROPIC_API_KEY=
systemctl restart jp-agent
```

**On Vercel** — the droplet generates `JP_AGENT_TOKEN` itself. Read it on the
box and set the pair against the project that serves the domain, which is
`jayti-dashboard`, not `jpbir_restructured`:

```bash
ssh root@<ip> 'grep JP_AGENT_TOKEN /etc/jp-agent.env'

vercel env add JP_AGENT_TOKEN production --scope jayti --project jayti-dashboard
vercel env add JP_AGENT_URL   production --scope jayti --project jayti-dashboard   # http://<ip>
```

## Before treating it as production

nginx currently serves plain HTTP. The bearer token is therefore in cleartext
between Vercel and the droplet. Put a hostname on it and run certbot:

```bash
certbot --nginx -d agent.jaytipargal.tech
```

Then set `JP_AGENT_URL=https://agent.jaytipargal.tech`.

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
curl -s http://<ip>/health
ssh root@<ip> 'systemctl status jp-agent --no-pager; journalctl -u jp-agent -n 40 --no-pager'
```
