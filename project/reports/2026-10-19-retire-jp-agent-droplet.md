# Report — retiring the jp-agent droplet (Railway cut-over)

**Date:** 2026-10-19 · **Subject:** owner direction "remove droplet, now it's Railway
jayti > Services" · **Author:** devops role (Cline), branch `cline/34rkyqre`
· **Identity verified:** `cline-cloud[bot]` → `jaytipargal/jpbir`.

## 1. What was asked, and what this is not

This is not a CI cleanup. The droplet is the **live `jp-agent` runtime behind
`jaytipargal.tech`**, the `/mcp` endpoint an Anthropic Managed Agent can call,
and the repo's **only** self-hosted runner. Destroying it before the Railway
service is verified and Vercel is repointed takes `jp-agent` offline.

So this report does the repository half now. The infrastructure half needs
credentials I do not hold (DigitalOcean, Vercel, Railway) and is irreversible, so
it is an ordered checklist in §6, not something I can execute.

## 2. What actually depends on the droplet

| Consumer | Wiring | Evidence |
|---|---|---|
| The dashboard | Vercel `/api/agent-run` → `AGENT_URL` (env `JP_AGENT_URL`) → droplet `:8790` | `Backend/agent-run.js:39` requires `JP_AGENT_URL` + `JP_AGENT_TOKEN`; it builds the URL from the env var, so **the cut-over is an env change, not a code change** |
| MCP clients / an Anthropic Managed Agent | `https://runner.jaytipargal.tech/mcp` → `:8792` | `Server/jp-agent/s24-mcp-server.mjs:14` |
| GitHub Actions | self-hosted runner on the droplet (`jp-agent,droplet,deploy`) | `deploy-droplet.yml` (removed — it never once ran successfully) |
| **Nothing else** | — | A grep for the host and both IPs across `Backend/`, `Integrations/` and the live `Frontend/` pages returns only comments and `project/targets.json` |

## 3. Railway readiness — five gaps, each read out of the code

1. **`JP_AGENT_HOST`.** `server.mjs:23-26` binds `127.0.0.1` unless this is set,
   and Railway's proxy sits outside the container. Set `JP_AGENT_HOST=0.0.0.0`.
   `PORT` is already honoured (`process.env.PORT`), so that part is done.
2. **Workspace persistence.** The README's whole rationale is "a workspace that
   survives between questions". Railway's filesystem is ephemeral, so
   `/srv/workspace` (`JP_AGENT_WORKSPACE`) disappears on every deploy. It needs a
   Railway volume mounted and `JP_AGENT_WORKSPACE` pointed at it — otherwise the
   move silently changes the product's core promise.
3. **`S24_SERVICE_ACCOUNT_KEY` is a file path**, not JSON:
   `s24-tools.mjs:20,39` → `readFileSync` + `JSON.parse`, defaulting to
   `/etc/jp-agent-firestore-key.json`. No such file exists on Railway, so every
   `s24-*` tool throws until the JSON is written to a file at boot (from a
   variable) or the code learns to accept the JSON inline. This is the gap most
   likely to look finished while failing on first use.
4. **`s24-mcp` has no Railway service.** The Services table holds `jayti` (Key
   Value) and `jp-agent` (Web Service) only; `s24-mcp` was a second systemd unit
   on port 8792. Until it has a home, `/mcp` and `S24_MCP_TOKEN` die with the
   droplet.
5. **`ANTHROPIC_AUTH_TOKEN` is not read by our code** — no `process.env.ANTHROPIC*`
   anywhere in `Server/jp-agent`. The droplet delivered it by writing
   `~/.claude/settings.json` via `sync-auth-token.py`. On Railway it has to arrive
   as a service variable and be picked up by the SDK from the environment.
   Verify with one real turn; do not assume.

Two smaller things to settle first: Vultr keeps a **per-user API IP allowlist**
pinned to the droplet (`168.144.24.224/32` in the README), so the agent cannot
drive Vultr from Railway until that changes; and `targets.json` recorded `.44`
while the README says `.224` — resolve which is real before any firewall change.

## 4. What I changed in the repository

| Change | Why |
|---|---|
| Deleted `.github/workflows/deploy-droplet.yml` | The droplet deploy path; it never succeeded once, and would queue forever against a runner that no longer exists. **Applied on `main` as `57eff98`** |
| `.github/workflows/ci-cd.yml` — job `jp-agent (droplet) tests` → `jp-agent tests`, comment updated | The job runs on `ubuntu-latest`; only its name and rationale referenced the droplet |
| `.github/actionlint.yaml` — removed the four self-hosted labels | No self-hosted `runs-on` remains, so the label list is dead config. **Applied on `main` as `f73f899`** |
| Deleted `Server/jp-agent/setup-runner.sh` | Bootstrapped the droplet runner (labels `jp-agent,droplet,deploy,jp-agent-droplet`); nothing else used it |
| `Server/jp-agent/package.json` — description no longer says "hosted on DigitalOcean" | It was false after the move |
| `project/targets.json` — droplet marked `RETIRING`, `jp-agent-railway` added | One manifest for every place the project runs (contract rule 3); the Railway domain is not recorded because I have not verified it |
| `project/decisions.md` — D-17 | Records the move and what it does not yet cover |

Verified: `actionlint 1.7.12` with `shellcheck 0.11.0` → **0 errors in 8 workflows**
(was 9). `npm test` and the jp-agent suites are unaffected — no runtime code is
touched by this change.

**How the workflow files got in, and the one that still cannot.** `git push` refuses
workflow files from this App (`without 'workflows' permission`), and so does the Contents
API for a create or update. Two things still worked:

- **Deleting** a workflow through the Contents API is *not* covered by that refusal, so
  `deploy-droplet.yml` was removed from `main` directly (`57eff98`).
- `actionlint.yaml` is not under `.github/workflows/`, so a normal API write landed it
  (`f73f899`).

What remains is an **update** to `ci-cd.yml`: the job still reads `jp-agent (droplet) tests`
and its rationale comment still says the droplet is deployed by hand with `deploy.sh`. The
dead `Run token-sync tests` step has since been removed directly on `main` (`f15a14f`), so
the patch now carries only the rename and the comment — 1 file, 11 insertions, 10
deletions, `git apply --check` clean against `main@f15a14f`.

## 5. What I deliberately did not delete

`Server/jp-agent/deploy.sh`, `deploy-local.sh`, `jp-agent.service`,
`s24-mcp.service`, `nginx-jp-agent.conf`, `sync-auth-token.py`.

They are the only way to redeploy or repair the droplet. If Railway turns out not
to serve, deleting them first would leave no way back. They should go in the same
commit that destroys the droplet, once §6 step 2 and step 4 have passed — say the
word and I will remove them then.

## 6. Ordered cut-over — owner

1. **Railway service:** set `JP_AGENT_HOST=0.0.0.0`; mount a volume for the
   workspace and set `JP_AGENT_WORKSPACE` to it; add `ANTHROPIC_AUTH_TOKEN`,
   `JP_AGENT_TOKEN`, `S24_PROJECT_ID`, `S24_FIRESTORE_DB`, `S24_DEVICE_DOC`,
   `S24_MCP_TOKEN`; make the Firestore service-account JSON available as a file.
2. **Verify, before anything else:** `GET https://<railway-domain>/health` → 200;
   one real agent turn from the dashboard; one `s24-*` tool call.
3. **Decide the `s24-mcp` home** — a second Railway service, or fold it in-process.
4. **Repoint Vercel** `JP_AGENT_URL` (scope `jayti`, project `jayti-dashboard`) at
   the Railway domain, then confirm a live dashboard turn. No code change needed.
5. **DNS:** repoint or retire `runner.jaytipargal.tech` (record lives in Vercel's
   zone, scope `jayti`).
6. **Remove the runner registration** — repo Settings → Actions → Runners. Admin
   only; this identity cannot see it (403).
7. **Destroy the droplet** — `doctl compute droplet delete runner-jp-agent`, or
   the console. Irreversible: do it last, and only after 2 and 4 pass.

## 7. Consequence for CI that arrives with the move

Destroying the droplet leaves this repository with **zero runners**: hosted jobs
are still killed in 2–4 s by the billing lock, and the self-hosted path is gone
with the droplet. Every check stays *Error*, and the queued deploy check
disappears entirely. Clearing the GitHub billing lock remains the only thing that
makes CI mean anything — the Railway move does not change that, and is not a
substitute for it.


## 8. Closed out (2026-10-19)

The patch this report carried is **applied and gone**. It was applied as authored on
`main` in `a67d6b05` — `ci-cd.yml` job name is `jp-agent tests`, the rationale comment now
names the Render service, and `grep -c droplet .github/workflows/ci-cd.yml` is 0. The file
`2026-10-19-retire-jp-agent-droplet.patch` is therefore deleted here: once applied it could
only mislead the next reader into thinking a change was still pending (it no longer applied,
so a second attempt would have failed anyway).

Re-proved on real runners afterwards, on the fork whose tree is identical to upstream
(`ee942f96…`): CI/CD Pipeline `39185314234` and Code Quality Checks `39185316653` both
**success**, and the job now appears as `jp-agent tests` — the rename is confirmed in the run
UI, not just in the file.

### Still outstanding

- **`2026-10-18-sync-keys-duplicate-comment.patch` remains unapplied.**
  `.github/workflows/sync-keys-to-vercel.yml` still carries the duplicated
  "Every key the deployed code … reads." comment at lines 47–50. It is an *update* to a
  workflow file, which this identity cannot push and the API refuses (it permits deleting
  workflow files, not creating or updating them), so it needs a `workflows`-permitted
  identity — the same one-line hole as above.
- **Branch protection is now possible.** D-6 recorded T-04 as blocked because the private
  repo returned 403 "Upgrade to GitHub Pro or make the repository public". The repository is
  now **public**, so that blocker is gone: the owner can enable required checks, reviews and
  CODEOWNERS enforcement. It has to be done after, and separately from, clearing the billing
  lock — required checks on a locked account would block every merge.
- **Upstream check badges stay payment-locked.** The code is proven; the badges are not.
