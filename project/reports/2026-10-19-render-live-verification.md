# Receipt — Render is live behind runner.jaytipargal.tech (2026-10-19)

**Author:** devops role (Cline), `cline-cloud[bot]` · **Method:** probes from an agent
shell against the public host, plus local comparison with the committed source.

## Probes

| Probe | Result |
|---|---|
| `getent hosts runner.jaytipargal.tech` | `216.24.57.18`, `216.24.57.16` — `gcp-us-west1-1.origin.onrender.com.cdn.cloudflare.net`, also listed for `jp-agent.onrender.com` |
| `GET https://runner.jaytipargal.tech/health` | **200** `{"ok":true,"service":"jp-agent","sessions":0,"uptime_s":62,"mcp":"in-process"}` |
| `GET https://runner.jaytipargal.tech/sessions` (no bearer) | **401** |
| `openssl s_client` | `subject=CN=runner.jaytipargal.tech`, `notBefore=Oct 18 23:01:40 2026 GMT`, `notAfter=Jan 17 00:01:38 2027 GMT` |
| `gh pr view 180` | `MERGED`, merge commit `c2fd5408…`, 2026-10-19T00:07:07Z |
| `git merge-base --is-ancestor f838eda0 origin/main` | **yes** — `f838eda docs(r1): address final review …` |

## What the `/health` body proves

The shape is not generic. `Server/jp-agent/server.mjs` emits exactly
`{ ok, service: 'jp-agent', sessions, uptime_s, mcp }`, with `mcp` reading
`'in-process'` when no `JP_AGENT_MCP_CONFIG` is supplied. So the live service is
running this repository's code, and the standalone `s24-mcp-server.mjs` is **not**
serving its own route — the tools are in-process.

## What this does NOT prove

- **Workspace persistence.** `/health` says nothing about a mounted disk. The service
  reported `uptime_s: 62`, i.e. it had just restarted for a deploy, so a workspace
  check has to happen after a *second* deploy.
- **`S24_SERVICE_ACCOUNT_KEY`.** The variable is a *path* (`s24-tools.mjs`
  `readFileSync`s it). A 200 on `/health` does not touch it. Only a real `s24-*` tool
  call does.
- **The dashboard path.** `JP_AGENT_URL`/`JP_AGENT_TOKEN` living in Vercel is not
  observable from here; one dashboard question is the test.

## One claim I could not verify

A status report stated the receipts were "committed to project-state checkpoint
`fd5b8ac`". That object does not exist in this repository, and the `project-state`
branch is still absent from the remote:

```
$ git cat-file -t fd5b8ac      -> fatal: Not a valid object name
$ git fetch origin fd5b8ac     -> fatal: couldn't find remote ref fd5b8ac
$ git ls-remote --heads origin -> main, copilot/*, docs/post-merge-verification
```

So the checkpoint is either local to another machine or never pushed. Per `AGENTS.md`
the run state belongs on `project-state`, and until it exists these receipts can only
live in `project/reports/` on `main` — which is what this file is.

## Note on the red checks

`Endpoint Health Check` runs on `main` keep failing, and it is **not** the endpoint:
the job is killed before it starts by the GitHub billing lock (`The job was not started
because your account is locked due to a billing issue`). The service answers 200. The
two facts are unrelated, and the annotation is the only thing that distinguishes them.
