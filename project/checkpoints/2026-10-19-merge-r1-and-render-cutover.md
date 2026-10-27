# Checkpoint — R1 merge to main + Render cutover (owner-directed)

- Date: 2026-10-19 (IST) / 2026-10-18T23:5xZ (UTC)
- Actor: orchestrator (openCode session), owner direction: "commit push and merge to main in github respective repo and cut it over to Render"
- Identities verified this session: gh `jaytipargal` (repo scope); render `jaytipargl.jp@gmail.com`; vercel whoami `jayti-2`

## Intent (recorded before the external changes)

1. Merge `feat/jp-agent-droplet-runner` (15 commits, R1 Step-1) into `main` on GitHub jaytipargal/jpbir via PR; merge commit style per repo history (#171).
2. Add custom domain `runner.jaytipargal.tech` to Render service `srv-dbalg58m7kps739ap6gg` (jp-agent).
3. Move DNS `runner.jaytipargal.tech` in the Vercel-managed zone from dead A `168.144.24.224` to the Render target (CNAME `jp-agent.onrender.com`).
4. Set `JP_AGENT_URL` / `JP_AGENT_TOKEN` on Vercel project `jayti-dashboard` (team team_pbbZItTCyIkGsw6LeGrcWx0c) to the Render service; redeploy production if a deployment is required for env pickup.

## Notes / constraints

- Untracked working files (eka-runner/, eka-runner-private/, jayti/, runs/, vscode-office/, project/plans/r1-step1-requirements.md) are NOT part of the merge — they await the owner's Q-2 answers; the requirements file has no commit history anywhere and stays out of main.
- Local `main` branch is diverged/stale (92c1eb4e path); do not push it; PR flow only.
- Render CLI has no domains subcommand; custom domain to be added via Render API (key from ~/.render/cli.yaml) or Dashboard.

## Receipts

### 1. PR merge (GitHub)

- PR #180 `feat/jp-agent-droplet-runner` → `main`, created via REST (2026-10-19 ~05:2x IST). First state: CONFLICTING (3 add/add conflicts in `project/environment/{Dockerfile,compose.yaml,run}` — R1 placeholder copies vs main's digest-pinned manifest).
- Resolution: local merge of `origin/main` into the branch; `project/environment/*` taken from main (digest-pinned D-8 manifest wins over the R1 placeholder); merge commit `69574d8c`; pushed.
- Merged: `c2fd5408` "Merge pull request #180 from jaytipargal/feat/jp-agent-droplet-runner" on `origin/main`.
- Verified: `git merge-base --is-ancestor f838eda0 origin/main` → true (R1 tip is in main). Local diverged `main` was never pushed.

### 2. Render custom domain

- `POST /v1/services/srv-dbalg58m7kps739ap6gg/custom-domains {"name":"runner.jaytipargal.tech"}` → id `cdm-dbaloj8m7kps739bjv60`, createdAt `2026-10-18T23:54:53Z`, domainType subdomain, verificationStatus `unverified` (bookkeeping only — domain serves live, see 5).
- Service state re-checked: `suspended=not_suspended`, plan free, region oregon, healthCheckPath `/health`, autoDeploy=yes branch=main.

### 3. DNS cutover (Vercel-managed zone)

- Removed: `rec_37aebedec0a9840b081988d5` (runner A 168.144.24.224 — dead droplet).
- Added: `rec_1077780c3c414ceaf1ecf92f` (runner CNAME `jp-agent.onrender.com`, zone jaytipargal.tech, team jayti2).
- Verified on public resolvers: 8.8.8.8 and 1.1.1.1 both follow runner.jaytipargal.tech → jp-agent.onrender.com → gcp-us-west1-1.origin.onrender.com.
- Residual: this laptop's Windows DNS client cache still returns a stale Vercel answer (ipconfig /flushdns needs elevation, not run); verified directly against the Render IP instead (`--resolve`).

### 4. Vercel project wiring (jpbir)

- Corrected link: repo `.vercel/project.json` was pointing at the empty `jayti-dashboard` project (stale id `prj_ert0BAxafhopYg8tjtbOMcfjDI9r` era); relinked to the real production project **`jpbir`** — `prj_47peuCvcDnURmUqhU3aFlaBP351J`, team `team_gcqCiU4UgkhcUJGRGLZYaQiW`.
- Added env (Production): `JP_AGENT_URL=https://runner.jaytipargal.tech`; `JP_AGENT_TOKEN` (Secret; value = C:\Users\abcom\.config\eka\jp_agent_render_token.txt, never printed). Confirmed via `vercel env ls production`: both present.
- Redeployed: `vercel redeploy https://jpbir-nudazo87j-jayti2.vercel.app` → "Aliased https://jaytipargal.tech / Ready in 43s".
- Post-merge: main-push auto-deploy `jpbir-8cbfpd3j5` queued to Production (carries the merge).

### 5. Final verification (2026-10-19 ~05:4x IST)

- `https://runner.jaytipargal.tech/health` (forced to Render IP): **200** `{"ok":true,"service":"jp-agent","sessions":1,"uptime_s":1434,"mcp":"in-process"}`.
- `https://runner.jaytipargal.tech/sessions` without token: **401**; with `JP_AGENT_TOKEN`: **200** `{"ok":true,"sessions":[...]}`.
- TLS: certificate CN=`runner.jaytipargal.tech`, issuer GTS WE1, valid to 2027-01-17; handshake OK on the Render IP.
- `https://jp-agent.onrender.com/health`: 200.

### Open items (recorded, not blockers)

1. `/api/agent-run` still 404 in production — `Backend/agent-run.js` is matched by the catch-all route but absent from `vercel.json` `builds`; no frontend calls it today; fix = add the build entry + deploy (proposed, owner may approve in the R2 batch).
2. Anthropic credential for jp-agent `/ask`: "Credit balance is too low" (owner decision pending: top up API key vs `claude setup-token` swap).
3. Render domain `verificationStatus=unverified` in the API while serving 200 + TLS — cosmetic; monitor.
4. Stray Vercel project-domain mapping for runner.jaytipargal.tech exists (edge returns DEPLOYMENT_NOT_FOUND for cached clients); left untouched — optional dashboard cleanup.
5. R1 process steps still owed per the flow: HOD verification, `tracker.py gate --step 1`, owner answers to the 12-question batch (`project/reports/2026-10-19.md`). The merge was executed on explicit owner direction ahead of those gates; this receipt records that ordering without claiming the gate outcomes.
