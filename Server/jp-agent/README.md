# jp-agent

The terminal, moved behind `jaytipargal.tech`. Answers questions and *does the
work* — shell, file edits, git, deploys — from the dashboard instead of a local
shell.

## Why a long-lived service and not a Vercel function

A Vercel function is short-lived with an ephemeral filesystem. An agent needs a
workspace that survives between questions, and tasks that can run for minutes
(installs, builds, test suites). Those are opposite requirements, so the runtime
lives on Render and Vercel only proxies to it.

## Shape

```
browser  ──dashboard key──▶  jaytipargal.tech /api/agent-run   (Vercel)
                                     │ Bearer JP_AGENT_TOKEN
                                     ▼
                              Render web service  jp-agent
                                     ▼
                       jp-agent :$PORT  bound to 0.0.0.0
```

The browser never holds the service token. Two separate credentials, so
compromising the dashboard key does not hand over the agent.

| | |
|---|---|
| Host | Render web service `jp-agent`, workspace `jayti` (`project/targets.json`) |
| Listener | `JP_AGENT_HOST=0.0.0.0`, `PORT` supplied by Render |
| Workspace | `JP_AGENT_WORKSPACE`, on a mounted Render disk — **not** the container filesystem |
| Secrets | Render environment variables; never in this repo or a transcript |

`server.mjs` defaults to `127.0.0.1`, which is unreachable from outside the
container: a Render service that does not set `JP_AGENT_HOST=0.0.0.0` accepts no
connections at all.

## Deploying

Render deploys from git. There is no deploy script, no ssh, no systemd unit and
no nginx config in this repository, and none should be added: a second deploy
path is how the old host drifted in the first place.

`render.yaml` at the repository root declares the service (root directory, start
command, health check, and which variables must be set). See `project/reports/2026-10-19-retire-jp-agent-droplet.md`
for the cut-over checklist that preceded it.

## Environment

Required on the service:

| Var | Notes |
|---|---|
| `JP_AGENT_TOKEN` | Bearer token Vercel presents. `Backend/agent-run.js` requires it. |
| `ANTHROPIC_AUTH_TOKEN` | Read by the Claude Agent SDK from the environment. |
| `S24_SERVICE_ACCOUNT_KEY` | **A path**, not JSON (`s24-tools.mjs`). Point it at the key file written at boot. |
| `S24_PROJECT_ID` / `S24_FIRESTORE_DB` | Firestore target for the s24 tools. |
| `S24_MCP_TOKEN` | Bearer for the standalone MCP server; it refuses to start without one. |
| `JP_AGENT_HOST` | `0.0.0.0`. See above. |

Optional, read at startup — change and restart the service, no redeploy:

| Var | Default | Notes |
|---|---|---|
| `JP_AGENT_MODEL` | `claude-sonnet-5` | Agentic-coding tier at $2/$10 per MTok. Opus 5 is $5/$25 for the same job here. |
| `JP_AGENT_MAX_TURNS` | `150` | Agent-loop cap. |
| `JP_AGENT_WORKSPACE` | `/srv/workspace` | Must be inside the mounted disk, or the workspace dies on the next deploy. |

The turn cap is not what limits a dashboard question — `Backend/agent-run.js`
aborts the proxy at 780s (against an 800s `maxDuration`), so wall-clock binds
first.

Cost per turn is dominated by the SDK's system prompt and 18 tool definitions,
so a short answer is not cheap: a one-word reply on a cold session bills ~$0.08,
while the same reply on a warm cached session bills ~$0.006. Reusing a session
matters more than the model choice for short questions.

## The second process: s24-mcp

`s24-mcp-server.mjs` is the network-transport twin of the in-process tools in
`s24-tools.mjs`. It was a second systemd unit on the old host; on Render it needs
its own web service (or to be folded in-process) before the `/mcp` endpoint is
reachable again. Until then the in-process tools in `s24-tools.mjs` are the only
path, and `s24-mcp-deploy.test.mjs` guards the module contract.

## Verification

```bash
curl -s https://<service-host>/health            # {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' https://<service-host>/sessions   # 401 without a bearer token
```

A `200` on `/health` proves the process is up; it does not prove the workspace
persists or that the s24 tools can read their key file. Check those with one real
agent turn and one `s24-*` tool call.
