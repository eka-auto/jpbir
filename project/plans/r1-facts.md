# R1 Product Fact Sheet — jpbir (Jayti Device Dashboard)

Task 1 of Step 1 (R1 "stabilize and harden"). This is the shared ground truth that
later R1 tasks (BRD, TRD, threat model, registry) will cite. Written 2026-10-18.

- Tree scanned: branch `feat/jp-agent-droplet-runner` at commit `2e04c369` (HEAD of
  that branch, which is 5 commits ahead of `origin/feat/jp-agent-droplet-runner`).
- Repository: `C:\Users\abcom\jpbir` (GitHub `jaytipargal/jpbir`, private) —
  [inferred-from-code: package.json `repository.url`; project/targets.json "source" target].
- Tracked files at this commit: 2,566 (counted with `git ls-files`).
- Method: read-only inspection. No code was changed and no live data was read.
- Tagging rules used in this document:
  - `owner-confirmed (D-n)` = traceable to project/decisions.md decision D-1..D-16
    or project/PROFILE.md (which itself is assembled from those decisions).
  - `inferred-from-code (<path>)` = read from the repository at the commit above.
  - `open question (Q-n)` = cannot be resolved from the repo; listed in the last
    section with options and a recommendation.

No secret value appears anywhere in this document. The hygiene scan reports file
paths and match counts only.

---

## 1. Component map

### Product code (deployed or device-side)

**Frontend/** — the browser dashboard. 1,976 tracked files, of which only 8 are
live pages: `index.html` (analytics dashboard, route `/`), `s24.html` (`/s24`),
`vivobook.html` (`/vivobook`), `jteka.html` (`/jteka`), `agent.html` (`/agent`),
`db.html` (`/db`), `viewer.html` (`/viewer`), and `template.html` (page scaffold,
no route). Pages are hand-written HTML with inline vanilla JS; no frontend
framework and no build step for them. The remaining ~1,968 files are vendored
editor/viewer code (see section 2). `vercel.json` sets `outputDirectory` to
`Frontend` and maps routes to these pages —
[inferred-from-code: vercel.json; Frontend/ directory listing].

**Backend/** — the serverless API. 175 tracked files: 39 Node ESM handlers
named in `vercel.json` `builds` (plus a catch-all route `/api/<name>` →
`Backend/<name>.js` that reaches further handlers), `Backend/lib/` (8 files of
real product logic: `s24-attestation.js`, `warehouse.js`, `ddb-scan.js`,
`cron-auth.js`, `media-auth.js`, `stale.js`, `stack-map.js`, `geo.js`), plus
~90 vendored/drifted files (TypeScript editor providers, i18n locale files,
`pdf.js`/`pdf.worker.js`, and Python scripts `eka_*.py` that CLAUDE.md documents as
drifted copies of `jayti/scripts/`). Key handlers: `broker.js` (device broker,
P-256 enrollment + hardware attestation, `HARDWARE_RULES` names the three-device
fleet), `device-enroll.js`, `device-heartbeat.js`, `device-commands-poll.js`,
`broker-command-claim.js`, `broker-command-complete.js`, `jp-devices.js`,
`s24-public.js`, `s24-ingest.js`, `wa-ingest.js`, `wa-media.js`, `db-push.js` —
[inferred-from-code: vercel.json builds/routes; Backend/ listing; CLAUDE.md].

**Database/** — schemas and DB tooling. 33 tracked files: `schema/` holds 18
`CREATE TABLE` definitions across 7 SQL files (WhatsApp tables `wa_chats`,
`wa_messages`, `wa_attachments`, `wa_sync_runs`; S24 tables `s24_records`,
`s24_device_snapshots`, `s24_calls`, `s24_sms`, `s24_locations`, `s24_agents`,
`s24_commands`, `s24_files`, `s24_queue_items`, `s24_sync_runs`,
`s24_sync_datasets`, `s24_sync_batches`, `s24_ingest_seen`; plus
`warehouse_sync_state`), plus 3 Prisma-demo `CREATE TABLE` statements inside
`schema/prelude.gql`, 6 GraphQL schema files, and a `migration-aliases.json`.
`scripts/migrate.mjs` applies Postgres migrations (`npm run db:migrate`);
`wa-build-inventory.mjs`/`wa-import.mjs`/`wa-export-import.mjs` build and import
the WhatsApp inventory; `backups/` holds two committed data dumps
(`firestore-devices-backup.json`, `dynamodb-telemetry-backup.json`) and a README —
[inferred-from-code: git ls-files Database; Database/schema/004-009 SQL].

**Devices/** — self-contained per-device installer bundles. 73 tracked files in
four kits: `Lenovo/` (9), `S24/` (23, includes `runtime_contract.json` which bans
inbound listeners and encodes the outbound-only transport, `pull_direct_cloud.py`,
`push_to_vercel.py`, the Node daemon `s24-agent-daemon.mjs`), `Vivobook/` (10), and
`sandbox/` (31 — a Python device-agent test rig that is ALSO its own Vercel project:
it has its own `vercel.json` building `dashboard_api.py` as `@vercel/python`, plus
`firebase.json` and emulator configs). CLAUDE.md marks the device kits as
SHA-256-pinned and byte-identical-installer packages that must not be deduplicated —
[inferred-from-code: git ls-files Devices; Devices/sandbox/vercel.json; CLAUDE.md
"Do not touch"].

**Server/** — device-support and droplet runtime. 75 tracked files. The core is
`Server/jp-agent/` (27 files): an agent runtime for the DigitalOcean droplet
(entry point `server.mjs`, MCP server `s24-mcp-server.mjs`, `s24-tools.mjs`,
deploy scripts `deploy.sh`/`deploy-local.sh`, systemd units `jp-agent.service` +
`s24-mcp.service`, nginx conf, its own package.json depending on
`@anthropic-ai/claude-agent-sdk` and `@modelcontextprotocol/sdk`). The other ~48
loose files at `Server/` root are device install scripts (`install_s24.sh`,
`setup_laptop.ps1`, `*.bat`), systemd/nginx units, and a handful of swept-in
strays: 6 GitHub workflow files (`main.yml`, `ci-deploy.yml`, `python-publish.yml`,
`python-package-conda.yml`, `verify-secrets.yml`, `runner-health-check.yml`) that
do nothing where they sit (GitHub only reads `.github/workflows/`), plus a vendored
editor grammar (`nginx.tmLanguage`, `nginxLanguage.ts`) —
[inferred-from-code: git ls-files Server; Server/jp-agent/package.json].

**Integrations/** — shared store clients. 11 tracked files: `postgres.js`,
`wa-store.js`, `s24-store.js` (the store clients Backend handlers import), the
`s24-connect-mcp/` MCP server (Python: `server.py`, `requirements.txt`,
`smoke_test.py`, README), plus strays `.firebaserc`, `constants.ts`,
`util/telemetry.ts`, and `hf_bucket_credential_audit.py` —
[inferred-from-code: git ls-files Integrations].

**_shared/** — project-wide config, docs, and all tests. 109 tracked files:
`tests/` (53 test files, driven by `npm test` → `_shared/tests/run-all.mjs`),
`docs/` (33 files, setup guides and historical docs), `tools/` (17 files including
`scan_secrets.py`, `redact_secrets.py`, `scrub_secrets.py`, and
`generate-env-manifest.mjs`), `config/vercel-env.manifest.json` (the authoritative
inventory of Vercel environment-variable names — holds names and fingerprints, no
values), `eslint.config.mjs` (exists but not wired to a root lint script until
recently — see section 7) — [inferred-from-code: git ls-files _shared; README.md;
CLAUDE.md].

### .github/ — CI

11 tracked files: 9 workflows (`ci-cd.yml` — lint+test only, no deploy;
`code-quality.yml`; `health-check.yml` — endpoint checks every 15 minutes;
`device-sandbox-tests.yml`; `sync-keys-to-vercel.yml` — dispatch-only, add-only
key sync then production rebuild; `deploy-droplet.yml` — on push to `main`, runs
jp-agent tests on a self-hosted runner labeled `jp-agent-droplet` and deploys
`Server/jp-agent` to the droplet; `s24-export-sync.yml` — scheduled S24
export-sync from Firestore to `/api/s24-ingest` with a P-256 signature, requires
repo secrets `EKA_SERVICE_ACCOUNT_JSON` and `S24_SYNC_PRIVATE_KEY_PEM`;
`dashboard-parity-check.yml` — dispatch-only production parity checks against
`jaytipargal.tech` using `STATS_KEY`; `db-push-backfill.yml` — dispatch-only
DynamoDB → Postgres backfill using secret `DB_ADMIN_KEY`), plus `actionlint.yaml`
and `scripts/sync-keys-to-vercel.mjs`. README.md lists only 5 workflows and also
describes a doubled-path `endform-e2e.yml` bug that no longer exists —
[inferred-from-code: git ls-files .github; workflow file headers; README.md;
section 7].

### Root config

`package.json` (name `jpbir`, private, `"type": "module"`, Node 24 engines;
scripts: `dev`, `build` → `scripts/build.mjs`, `lint` → `scripts/lint.mjs`,
`test`, `test:browser` (Playwright), `db:migrate`, `db:import-backup`,
`wa:build`, `wa:import`, `wa:export-import`; dependencies: `pg`, `@vercel/blob`,
`@vercel/connect`, `@aws-sdk/client-dynamodb`, `@aws-sdk/client-sts`,
`@aws-sdk/lib-dynamodb`, `nodemailer`; one devDependency `@playwright/test`);
`vercel.json` (the deploy contract, section 4); `.vercelignore` (a long, heavily
commented guard list for laptop-run CLI deploys); `.gitignore` (guards service
account keys, env files, data dumps); `playwright.config.mjs`; `e2e/` (1 tracked
Playwright spec for the main dashboard); `scripts/` (`dev-server.mjs`,
`build.mjs`, `lint.mjs`) — [inferred-from-code: package.json; root listing].

### Non-product trees (untracked, not in git)

**eka-runner/** — a nested Git repository (has its own `.git`) with `scripts/`,
`termux/`, `.github/`, and a `.pr-body.md`. 90 files on disk. Not product code —
[inferred-from-code: directory listing].

**eka-runner-private/** — a second nested Git repository with `termux/` and
`.github/`. 7 files on disk — [inferred-from-code: directory listing].

**jayti/** — a nested Git repository holding the deployment scripts for the
Jayti Hub VPS (`eka_agent_cloud.py`, `eka_retrieval_server_vps.py`, systemd units
`eka-agent.service`/`eka-retrieval.service`, nginx config, `install.sh`,
`DEPLOYMENT_GUIDE.md`). CLAUDE.md names `jaytipargal/jayti` (public repo) as the
upstream of the drifted `Backend/eka_*.py` copies. 65 files on disk —
[inferred-from-code: directory listing; CLAUDE.md "agent.jaytipargal.tech" section].

**runs/** — run-artifact tree, 5,071 files / 25.5 GB on disk: agent run outputs
(`automobile_agent/`, `jt_agent/` with exported corpus parts `*.jsonl` covering
chrome history, drive, phone app, eka tools/cloud), two release snapshots
(`frontend-assembly-*`, `frontend-release-*` containing a full node_modules copy),
and `documents/`. Untracked and NOT covered by .gitignore as a whole (only the
`*.jsonl` members are); `.vercelignore` excludes it from CLI deploys because a
CLI deploy uploads the working directory — [inferred-from-code: directory listing
and size measurement; .vercelignore comment "~28 GB (runs/ alone is 26 GB)"].

**vscode-office/** — the full upstream repo of the vscode-office VSCode extension
(has `.git`, `node_modules`, `out`, `vditor`, `src`, `lib`). 64,194 files on disk —
the single largest tree in the workspace. It is the source the vendored
`Frontend/` and `Backend/` editor code was swept from — [inferred-from-code:
directory listing; name/structure match with Frontend/ vendored files].

**jpbir/** — a duplicate inspection checkout of this project inside itself (has
its own `.git`, `Dashboard/`, `eka-runner/`, `Sandbox/`, `tools/`, `training/`,
`pyproject.toml`). 284 files. Hidden from `git status` only by the machine-local
`.git/info/exclude` (`/jpbir/`, `/scratch/`, `.neon`) — [inferred-from-code:
directory listing; .git/info/exclude].

**scratch/** — old audit workspaces (`s24-contract-audit-20260906`,
`s24-readiness-20260906`, `search_db.mjs`), 24 files, hidden by
`.git/info/exclude` — [inferred-from-code: directory listing; .git/info/exclude].

**personal_folder_agent/** — residue of a "personal folder agent" project: only
`.hypothesis/` state, `__pycache__/` trees, and subdirectories with no source
files at top level; 107 files, every one of them ignored cache/log material —
[inferred-from-code: directory listing; git status --ignored].

**dashboard/** — 4,723 files on disk, ALL of them a single orphaned
`node_modules` under `dashboard/Current/` with no package.json alongside. Fully
invisible to git (the `node_modules/` ignore rule swallows it) and to `vercel
--prod` (anchored `/dashboard/` rule in `.vercelignore`) — [inferred-from-code:
recursive count; .gitignore; .vercelignore].

**Sandbox/** — compiled-test debris for the sandbox kit: 30 files, all
`__pycache__` `.pyc` files plus a `Sandbox/Configuration/.vercel/project.json`
Vercel link artifact. All ignored — [inferred-from-code: recursive listing].

**Smaller debris:** `data/` (3 local SQLite files: `analytics.db`, `test.db`,
`visitors.db`, ignored via `*.db`), `logs/` (3 log files, ignored via `*.log`),
`tools/` (only `__pycache__`), `permanent_agent/` (1 log file), `test-results/`
(Playwright output, ignored), `website_assets/`, `undefined/`, `-p/` (empty
directories), root `s24_daemon_run.log` (ignored), `.firebase/` (1 debug log) —
[inferred-from-code: recursive listings; .gitignore].

**Tool-owned directories:** `node_modules/` (5,284), `.venv/` (48,117),
`venv/` (8,748 files — every one a `.pyc`), `.vercel/` (4,948 — CLI cache plus
the two link files described in section 4), `.agents/`, `.qwen/`, `.claude/`
(12 tracked files = the `project-restructurer` skill; settings.local.json
ignored), `.hypothesis/`, `.pytest_cache/`, `.superpowers/` (task briefs for this
step; ignored by its own nested `.gitignore`). All ignored — [inferred-from-code:
counts; .gitignore].

**archive/** — cold storage, 57 tracked files: content-hash-named files, two
Colab training notebooks, `charmap.json.gz`-style codec bundles, and residue
files with sensitive-sounding names (`secret_scan.err`, `secret_scan.pid`,
`pfa_b64.txt`, `merge_run.err`). README/CLAUDE.md say: don't import from it,
don't reorganize it — [inferred-from-code: git ls-files archive; CLAUDE.md
"Do not touch"].

---

## 2. Bloated / vendored trees (quantified)

Tracked bloat — code that ships in the repo but is not the app:

| Where | Files | What it is | Why it's there |
|---|---|---|---|
| `Frontend/assets/icons/` | 1,320 | icon set from the vscode-office extension | vendored wholesale |
| `Frontend/assets/` (rest) | 119 | hashed build chunks (`index-*.js/css`), font/ttf, per-provider `.ico` files | generated build output |
| `Frontend/view/` | 253 | vscode-office webview source (React-based viewer) | vendored source |
| `Frontend/util/` + root `.ts` files | ~230 (53 + 177) | TypeScript editor/viewer providers, i18n locale `*.ts` (de, es, fr, ja, ko, ru, pt-br, zh-cn, zh-tw), CodeMirror/Vditor logic | vendored source |
| `Backend/` vendored | ~90 | TS language-service providers, i18n `*_*.js` locales, `pdf.js` + `pdf.worker.js`, `woff2_decompress_binding.js`, excel/xlsx perf tests, `Backend/service/` + `Backend/frontend/` vscode-office TS (48 files) | vendored/drifted |
| `Server/` root strays | ~8 | foreign CI yml files that GitHub never loads + editor grammar | swept in |
| `archive/` | 57 | cold storage (intentional) | by design |
| Root skill copies | 2 | `SKILL (11).md` and `CICD_DevOps_Pipeline_Skill_v2.2_for_review (3).md` — review copies of the pinned pipeline skill at `project/audit/SKILL.md` | stray copies |

Live-app core is roughly 350–400 of the 2,566 tracked files (8 HTML pages + ~60
API handlers + lib + schema + device kits + tests). CLAUDE.md states the same
conclusion ("1976 tracked files but only 8 are live pages") and that
`vercel.json` is the authoritative surface — [inferred-from-code: git ls-files
groupings; CLAUDE.md; vercel.json].

On-disk (untracked/ignored) bloat, largest first: `vscode-office/` 64,194;
`.venv/` 48,117; `venv/` 8,748 (all `.pyc`); `node_modules/` 5,284;
`dashboard/` 4,723 (orphan node_modules); `.vercel/` 4,948; `runs/` 5,071 files
/ 25.5 GB; `jpbir/` 284; `personal_folder_agent/` 107; `eka-runner/` 90;
`Devices/` ignored caches 23; `Sandbox/` 30; `jayti/` 65; `scratch/` 24 —
[inferred-from-code: on-disk recursive counts].

R1 prune/gitignore candidates (list only; removal decisions belong to later
tasks): `dashboard/` (orphan node_modules — safe delete), `vscode-office/`
(upstream repo — delete or move out of the workspace), `venv/` (all-.pyc
venv — safe delete), `personal_folder_agent/`, `permanent_agent/`, `Sandbox/`
compiled debris, `data/*.db`, `logs/`, root `s24_daemon_run.log`, `jpbir/` and
`scratch/` (dissolve or relocate the duplicate checkout), the 2 root skill
copies, the 6 stray workflow ymls in `Server/`, and vendored trees under
`Frontend/`+`Backend/` (needs a scope decision — see Q-6). Also: add `runs/`,
`personal_folder_agent/`, `permanent_agent/`, `tools/`, `data/`, `logs/`,
`eka-runner/`, `eka-runner-private/`, `jayti/`, `vscode-office/` to `.gitignore`
so `git add -A` cannot sweep them (today only `.vercelignore` fences them out of
deploys, and `.git/info/exclude` hides only `jpbir/` and `scratch/` on this one
machine) — [inferred-from-code: .gitignore; .git/info/exclude; .vercelignore].

---

## 3. Live product wiring

**Deploy contract:** `vercel.json` — `outputDirectory: Frontend`; 40 `builds`
entries (39 Backend handlers as `@vercel/node` + `Frontend/**` as
`@vercel/static`); 4 cron jobs (`/api/check-stale` every 10 min,
`/api/db-push` daily at 18:30 UTC, `/api/s24-sync-cron` every 6 h at :17,
`/api/stack-cron` every 5 min); security headers on every route (CSP
frame-ancestors 'none', X-Frame-Options DENY, nosniff, no-referrer,
Permissions-Policy); routes map `/s24`, `/vivobook`, `/jteka`, `/db`, `/agent`,
`/viewer` to the pages, `/agent/*` to `jp-live-agent`/`jp-hub-state`, device
broker and WhatsApp/S24 ingest routes to Backend handlers, with a fallback
`/api/(.*)(.js)?` → `Backend/$1.js` — [inferred-from-code: vercel.json].

**Which project actually serves production:** Vercel team `jayti2`
(`team_gcqCiU4UgkhcUJGRGLZYaQiW`), project `jpbir`, domains
`jaytipargal.tech`, `www.jaytipargal.tech`, `jpbir.vercel.app`; production
deployment `dpl_BzR5Z8UMxeBu2HDp4dDRpTG7JYpE` (commit `f6e21fc`, READY),
verified 2026-10-12 — [owner-confirmed (D-12); owner-confirmed (D-9)
targets.json "vercel-jayti2"]. `/api/s24-public` returning 200 with Firestore
device data was confirmed live — [owner-confirmed (D-4)].

**A second Vercel project builds from this repo:** `channel-sandbox`, with Root
Directory `Devices/sandbox/` (its own `vercel.json`, re-created 2026-09-19 per
INTEGRATION.md; the repo-root `.vercelignore` once stripped its files and was
fixed for it). `targets.json` does not record this project — [inferred-from-code:
.vercelignore Devices/* comment; Devices/sandbox/vercel.json; INTEGRATION.md;
open question Q-4].

**Where push-to-deploy is broken:** the owner reported that dashboard deploys do
not reflect pushes. The recorded cause: the Vercel GitHub App for
`jaytipargal/jpbir` on branch `main` is not linked in team `jayti2`, so Git
integration is disconnected; missing environment secrets on `jayti2/jpbir` also
need populating. Both are owner-owned actions on vercel.com (agents never
receive the values) — [owner-confirmed (D-12) open items; owner-confirmed (D-15)
"Vercel: the owner will re-link the GitHub App and set the missing secrets"].
The local machine's Vercel CLI links point at the WRONG (legacy) projects:
`.vercel/project.json` links `jayti-dashboard` (`prj_ert0BAxafhopYg8tjtbOMcfjDI9r`)
and `.vercel/repo.json` links `jpbir_restructured`
(`prj_erW8UF9j4ngIUlY8MzAnOXLm2dOv`), both under the legacy org
`team_pbbZItTCyIkGsw6LeGrcWx0c` — the billing-blocked legacy scope D-12
describes. Nothing in the local link points at live project `jpbir`/team
`jayti2` — [inferred-from-code: .vercel/project.json; .vercel/repo.json;
owner-confirmed (D-12) for the legacy project's status].

**Other deploy paths:** `deploy-droplet.yml` deploys `Server/jp-agent` to the
DigitalOcean droplet on every push to `main` via a self-hosted runner labeled
`jp-agent-droplet` (tests first, then deploy) — [inferred-from-code:
.github/workflows/deploy-droplet.yml; owner-confirmed (D-9) targets.json
"jp-agent-droplet" note: self-hosted GitHub Actions runner registered with
labels jp-agent,droplet,deploy]. `sync-keys-to-vercel.yml` syncs add-only keys
to Vercel on dispatch — [inferred-from-code: .github/workflows/
sync-keys-to-vercel.yml]. CLAUDE.md records that CLI deploys from CI were
deliberately removed and must not be re-added — [inferred-from-code: CLAUDE.md
Deployment section, citing `.github/workflows/ci-cd.yml` comment]. D-3 records
there is no CI runner on this machine; the no-CI fallback runs tracker.py
locally via Windows Task Scheduler (`jpbir-hod-audit`, daily) —
[owner-confirmed (D-3); owner-confirmed (D-5)].

**Environment variables (names only):** README points to
`_shared/config/vercel-env.manifest.json` as the authoritative inventory (names,
types, environments, fingerprints — no values). D-12 lists as missing on
`jayti2/jpbir` (names only): `BLOB_READ_WRITE_TOKEN`, `S24_SYNC_PUBLIC_KEYS`,
`WA_INGEST_KEY`, "etc." — [inferred-from-code: README.md Configuration section;
owner-confirmed (D-12)]. `FIREBASE_SERVICE_ACCOUNT_JSON` and `FIRESTORE_DB`
(default `eka-agent`) are the Firestore vars — [inferred-from-code: README.md].

---

## 4. Data stores (as visible from code and config)

**Firestore** — project `intrepid-stage-495117-q1`, database `eka-agent`.
Collections in use: `devices` (one doc per device; the S24 doc carries the
`commandQueue` map that device daemons poll) and `deviceKeys` (broker enrollment
keys, read/written by `device-enroll.js` and every broker route via
`fsGet("/deviceKeys/<keyId>")`). Python tools in `Backend/` and `Database/` also
read `devices` — [inferred-from-code: Backend/broker-command-claim.js:60,
Backend/device-enroll.js:145,167, Backend/device-heartbeat.js:108,
Backend/connect_and_freeze.py:74, Database/freeze_device.py:87; owner-confirmed
(D-9) targets.json "firestore-eka-agent"; CLAUDE.md data-flow table].

**Postgres (Neon)** — project `fancy-cloud-99501540`, role `neondb_owner`
(shared with the `jaytibirthday-site` Vercel project; password rotation there
has twice broken this dashboard until re-pasted — CLAUDE.md documents the
mechanism). Tables defined in `Database/schema/`: 17 s24_/wa_ tables +
`warehouse_sync_state` (full list in section 1 Database entry). Written by
telemetry/ingest handlers and the daily `db-push` cron; read by dashboard data
routes — [inferred-from-code: Database/schema/004-009; vercel.json crons;
owner-confirmed (D-9) targets.json "neon-jaytibirthday-db"; CLAUDE.md].

**Vercel Blob** — two stores `store_vxETiZ3lYBeN`, `store_y8X2dcvEtuqy` (team
`jayti2`); holds WhatsApp media bytes; written by `wa-blob-upload`, read via the
`wa-media` proxy and `blob_url` columns — [inferred-from-code: Backend/
jp-agent.js, Backend/jp-stack.js, Backend/wa-blob-upload.js, Backend/wa-media.js
(git grep "vercel/blob"); owner-confirmed (D-9) targets.json "vercel-blob"].

**AWS DynamoDB** — a fourth store visible in code but absent from targets.json
and from the README/CLAUDE data-flow story: dependency
`@aws-sdk/client-dynamodb` in package.json; `Backend/db-push.js`,
`Backend/backup-db.js`, `Backend/lib/ddb-scan.js`, `Backend/lib/warehouse.js`,
`Backend/verify-db-setup.js`; the `db-push-backfill.yml` workflow ("Backfill
DynamoDB → Postgres", secret `DB_ADMIN_KEY`); `Database/schema/
009_dynamodb_repair_state.sql`; a committed `dynamodb-telemetry-backup.json`.
The evidence pattern suggests DynamoDB was the older telemetry store being
migrated into Postgres — [inferred-from-code: files above; open question Q-1].

**Other local stores (not production):** `data/*.db` SQLite files (ignored),
`Database/eka_vector_db.py` uses a Chroma-style local vector store —
[inferred-from-code: .gitignore; Database/eka_vector_db.py].

---

## 5. Secret hygiene scan

Method: `git grep` over tracked files only (the repo as committed), case as
noted, binary files skipped, `archive/` excluded per the task brief. Untracked
trees were scanned separately with `git grep --no-index`, excluding
`node_modules`, `.git`, `__pycache__`, `.hypothesis`, `.pytest_cache`, and the
vendored `vscode-office/{out,lib,vditor,node_modules}`. Counts are matches per
file; values were never printed or recorded. One directory
(`Server/jp-agent/.pytest_cache/`) is unreadable (Windows permission error) and
could not be scanned — [inferred-from-code: scan commands run 2026-10-18].

### Tracked files — findings

| Pattern class | Hits | Verdict |
|---|---|---|
| Firebase service-account JSON (`"type": "service_account"`) | 0 | clean |
| Google API key (`AIza…` 35 chars) | 0 | clean |
| GitHub tokens (`ghp_/gho_/github_pat_`) | 0 | clean |
| Anthropic/OpenAI `sk-`-style keys | 0 | clean |
| AWS key ids (`AKIA/ASIA`) | 0 | clean |
| Slack tokens (`xox…`) | 0 | clean |
| PEM `PRIVATE KEY` blocks | 3 files: Devices/sandbox/.env.example (1), _shared/tests/test_redact_secrets.py (2), _shared/tests/test_scan_secrets.py (1) | all placeholder/fixture content (`.env.example` template with `...` values; scanner test fixtures) |
| Connection strings | 3 files: Devices/sandbox/.env.example:73, Devices/sandbox/tests/test_sandbox.py:396, _shared/tests/postgres-ssl.test.mjs:23 | all placeholders/test strings (`user:password@…`, `user:pass@ep-demo…`, `user:${PW}@…`) |
| Generic `key/secret/token/password = "…"` assignments | 14 files | placeholders (`YOUR_API_KEY` in Backend/eka_agent_pull.py:29, Backend/eka_agent_push.py:29, Backend/eka_agent_server.py:36, Server/setup_vps_db.sh:10), test fixtures (_shared/tests/…), and vendored-library internals (Backend/pdf.worker.js, Backend/woff2_decompress_binding.js, Frontend/public/woff2_decompress_binding.js) |
| Jayti Hub key shape (`jt_…`) | 4 files (Backend/run_final_s24.py, Backend/run_phone_app.py, Integrations/hf_bucket_credential_audit.py, Server/merge_after_crawl.sh) | all are directory/bucket path names containing "jt_agent…", not API keys |

Bottom line for tracked code: **no live secret found in any tracked file** at
this commit — [inferred-from-code: scan results above].

### Untracked trees — findings (paths and counts only)

- `jayti/`: 5 files with placeholder hits (README.md:2; scripts/eka_agent_pull.py,
  eka_agent_push.py, eka_agent_server.py, setup_vps_db.sh — same `YOUR_API_KEY`
  placeholders as the Backend copies) — [inferred-from-code: scan].
- `jpbir/` (excluded duplicate checkout): `jpbir/Dashboard/Current/.vercel/
  .env.development.local` — 1 match. NOT read. A local env file inside a
  duplicate checkout is a live-key hazard class per the repo's own .gitignore
  commentary about Vercel CLI env dumps — [inferred-from-code: scan;
  .gitignore comment "/production /preview /development (contain
  VERCEL_OIDC_TOKEN)"].
- `vscode-office/`: 3 files, all vendored library internals — clean —
  [inferred-from-code: scan].
- `runs/`: in the scannable subset (2,209 text files under 5 MB = 43 MB of the
  25.5 GB tree), 26 files with hits: node_modules library internals inside the
  frontend-release snapshot, and the `runs/jt_agent/parts/*.jsonl` data files
  (3–11 matches each — field-name-shaped matches in exported data chunks).
  The remaining ~23 GB (media, documents, large files) was NOT content-scanned —
  declared limitation — [inferred-from-code: scan; size measurement].
- `eka-runner/`, `eka-runner-private/`, `scratch/`, `dashboard/`,
  `personal_folder_agent/`, `permanent_agent/`, `Sandbox/`, `tools/`, `data/`,
  `logs/`, `test-results/`: 0 hits — [inferred-from-code: scan].

### Secret-bearing files that exist on disk (existence recorded, never read)

- `.env.local` (repo root) — ignored by the `.env*` rule — [inferred-from-code:
  root listing; .gitignore].
- `.vercel/.env.production.local` — inside the ignored `.vercel/` tree —
  [inferred-from-code: .vercel listing; .gitignore comment names such dumps as
  containing VERCEL_OIDC_TOKEN].
- `jpbir/Dashboard/Current/.vercel/.env.development.local` — inside the excluded
  duplicate checkout — [inferred-from-code: scan hit above].

### Structural guards (all verified present)

`.gitignore` ignores `.env*` (except `.env.example`), `intrepid-stage-*.json`,
`*serviceAccountKey*.json`, `*service_account*.json`, `*.db`, `*.jsonl`,
`Database/wa-*.json`; `.vercelignore` blocks env files, `*.pem`, `*.key`, key
JSON, and the heavy untracked trees from CLI deploys; `.gitignore` comments
document the historical incidents (a live SA key under `app/`, Vercel CLI env
dumps). Verified absent on disk at this commit: `app/` (deleted),
`Database/wa-*.json`, any `intrepid-stage-*.json` within depth 2 —
[inferred-from-code: .gitignore; .vercelignore; checks run 2026-10-18].

---

## 6. Docs staleness

| Doc | State | Evidence |
|---|---|---|
| `README.md` | **Mostly accurate, stale in 4 places.** (a) Says "There is no build step and no dev dependencies" — package.json now has a `build` script (`scripts/build.mjs`), a `lint` script, and the devDependency `@playwright/test`. (b) Lists 5 CI workflows; 9 exist (missing: deploy-droplet, s24-export-sync, dashboard-parity-check, db-push-backfill). (c) Describes a doubled-path `endform-e2e.yml` bug that no longer exists (no such file in `.github/workflows/`). (d) Says "every push gets a preview, main goes to production" — push-to-deploy is currently broken per D-12/D-15. Architecture, commands, test conventions and env-manifest sections match the code. | [inferred-from-code: README.md vs package.json, .github/workflows listing; owner-confirmed (D-12)/(D-15)] |
| `CLAUDE.md` | **Rich and mostly accurate; stale in 4 places.** (a) Deployment section names project `jayti-dashboard` → `jaytipargal.tech` and team `jayti` statuses — live is now project `jpbir` under team `jayti2` (D-12 cutover). (b) "There is no lint script at the root" — `package.json` now has `lint`. (c) "`npm run build` — No-op … echo" — now `node scripts/build.mjs`. (d) Tracked-file counts (2497 total; Backend 172, Database 26, Server 63, _shared 93, Integrations 9) — now 2566 / 175 / 33 / 75 / 109 / 11. Its own note that "README states npm test is not yet wired up" is itself stale — current README no longer says that. Fleet rules, attestation, security conventions and Do-not-touch sections match code and AGENTS.md global knowledge. | [inferred-from-code: CLAUDE.md vs package.json, git ls-files; owner-confirmed (D-12)] |
| `QWEN.md` | Same overview as CLAUDE.md; its deployment section still names `jayti-dashboard` and lists an `npm run deploy` → `vercel --prod` script that no longer exists in package.json. Kept "as Qwen wrote it" by policy. | [inferred-from-code: QWEN.md deployment section vs package.json] |
| `GEMINI.md`, `AGENTS.md` | 11 lines each: the required pipeline pointer block + a local note only. Current (pointer normalized per D-13/D-14). No product content to go stale. | [inferred-from-code: file contents] |
| `INTEGRATION.md` + `RESTRUCTURE_STATE.json` | Last refreshed 2026-09-19 against `main@87ba028`; state counts (2520 total; _shared 137, Backend 166, Database 23, Server 61, Integrations 7) drift from today's 2566/109/175/33/75/11. Directionally correct; counts stale. | [inferred-from-code: RESTRUCTURE_STATE.json; INTEGRATION.md; git ls-files] |
| Root strays | `SKILL (11).md` and `CICD_DevOps_Pipeline_Skill_v2.2_for_review (3).md` are tracked review copies of the pinned skill (canonical: `project/audit/SKILL.md`, pinned per D-7, restored byte-for-byte per D-13). Candidate clutter. | [inferred-from-code: root listing; owner-confirmed (D-7)/(D-13)] |
| `_shared/docs/` (33 files) | Mixture: setup guides referenced by README (`ADD_FIREBASE_SECRET_TO_GITHUB.md`, `GITHUB_ACTIONS_SETUP.md`) plus historical docs (`INSPECTION_2026-09-19.md`, `SAFE_TO_DELETE_FILES.md`, `WORKSPACE_DIRECTORY_MAP.md`, Chinese/Taiwanese README mirrors, Vditor docs). A staleness audit of each is not part of this fact sheet; flagged for the docs task. | [inferred-from-code: git ls-files _shared/docs] |
| `Server/jp-agent/README.md`, `Devices/*/README.md`, `Devices/S24/DAEMON_ARCHITECTURE.md`, `Database/backups/README.md` | Present and referenced by README/CLAUDE/INTEGRATION as entry-point docs; contents not audited here. | [inferred-from-code: file presence] |

---

## 7. Production state (owner-confirmed records)

- **Product**: jpbir, "Jayti Device Dashboard" — real-time device monitoring,
  telemetry and remote command behind jaytipargal.tech —
  [owner-confirmed (PROFILE.md; D-4)].
- **Live**: `jaytipargal.tech` (+ `www.`, `jpbir.vercel.app`), Vercel team
  `jayti2` (`team_gcqCiU4UgkhcUJGRGLZYaQiW`), project `jpbir`, deployment
  `dpl_BzR5Z8UMxeBu2HDp4dDRpTG7JYpE` at `f6e21fc` (READY); legacy `jayti-dashboard`
  (`prj_ert0…`, team `team_pbbZ…`) is billing-blocked and irrelevant to live
  hosting — [owner-confirmed (D-12); owner-confirmed (D-9)].
- **Fleet**: three devices only — `samsung-s24-ultra`, `g4g-lenovo-laptop`,
  `jayti-asus-vivobook`; broker refuses any other id — [inferred-from-code:
  Backend/broker.js HARDWARE_RULES via CLAUDE.md; corroborated by AGENTS.md
  global device registry].
- **Targets (6)**: GitHub `jaytipargal/jpbir` (repo id 1350770272); vercel-jayti2;
  firestore-eka-agent (SA key-id prefix `95f094fa2830…`); neon-jaytibirthday-db
  (`fancy-cloud-99501540`); vercel-blob (2 stores); jp-agent-droplet
  (`runner.jaytipargal.tech`, region blr1, s-1vcpu-2gb, systemd services on ports
  8790/8792, self-hosted Actions runner) — [owner-confirmed (D-9);
  project/targets.json].
- **Risk tier**: Internal; one agent may play every role with self-review;
  availability 99.5%, p95 1 s, RPO/RTO 24 h — [owner-confirmed (D-1)].
- **Compliance**: India / DPDP Act; WhatsApp content is the highest-sensitivity
  class, kept out of logs, traces, prompts, agent context — [owner-confirmed
  (D-10)].
- **Budget**: constraint removed 2026-10-12; contract rule 8 not enforced this
  run — [owner-confirmed (D-11)].
- **Backup**: local bundle + untracked archive at
  `C:\Users\abcom\.local\share\kilo\cicd-backups` (SHA-256 recorded in D-2),
  re-verified 2026-10-18; off-machine copy satisfied via OneDrive
  (`C:\Users\abcom\OneDrive\cicd-backups\jpbir\`), hash-verified —
  [owner-confirmed (D-2); owner-confirmed (D-15)].
- **No CI runner on this machine** (D-3); tracker runs locally; scheduled audit
  via Windows Task Scheduler task `jpbir-hod-audit` (D-5), repaired 2026-10-18
  with durable paths (D-14) — [owner-confirmed (D-3)/(D-5)/(D-14)].
- **Branch protection**: T-04 formally Blocked — owner chose to keep the repo
  private and not upgrade (D-15); compensating control ACTIVE: GitHub ruleset
  25339138 ("pipeline-protected-branch") enforces deletion + non-fast-forward
  protection on the default branch; remaining free-plan gaps: required reviews,
  required status checks, CODEOWNERS enforcement — [owner-confirmed (D-6);
  owner-confirmed (D-15)].
- **Controls**: pinned skill v2.2.0 restored byte-for-byte after an unrecorded
  2.4.0 replacement (D-13, preserved in history at commit 286b1645); pointer
  blocks normalized (D-13/D-14); environment manifest per D-8 —
  [owner-confirmed (D-7)/(D-8)/(D-13)/(D-14)].
- **R1 scope direction**: "stabilize and harden" — no new features; inherited
  debt (bloated vendored trees, stale documentation, disconnected Vercel
  push-to-deploy, secret hygiene) + wiring of protections + documentation;
  production stays as-is; formal freeze in T-06 — [owner-confirmed (D-16)].
- **Owner-owned open actions carried from Step 0**: Vercel GitHub App re-link +
  missing secrets on `jayti2/jpbir` (D-12/D-15); droplet-record and PROFILE
  confirmations not yet given (D-15) — [owner-confirmed (D-12)/(D-15)].

---

## 8. Open questions for the owner

Each question lists plain-language options and a recommendation. Nothing here
blocks this fact sheet; answers would sharpen the BRD/TRD (T-06 batch).

**Q-1. Is AWS DynamoDB still a live data store, or already retired?**
Why it matters: code and a workflow still treat it as a source
(`db-push` cron + `db-push-backfill.yml` migrate DynamoDB → Postgres), but
targets.json has no AWS target and PROFILE/README never mention it.
Options: (a) still live — add an AWS target to targets.json and document it;
(b) migration done, only leftovers remain — retire `db-push` cron, the backfill
workflow and the `@aws-sdk` dependencies in R1; (c) unsure — schedule a
read-only DynamoDB check in the TRD task before deciding.
Recommendation: (c) then (a) or (b) based on what the check finds — do not
delete anything until the table is proven empty.

**Q-2. What should happen to the big untracked local trees
(`runs/` 25.5 GB, `vscode-office/` 64k files, `dashboard/` orphan node_modules,
`jpbir/` duplicate checkout, `scratch/`, `personal_folder_agent/`,
`venv/`)?**
Options: (a) delete the obvious debris now (`dashboard/`, `venv/`,
`personal_folder_agent/`, compiled `Sandbox/` debris) and gitignore the rest;
(b) move `runs/`, `jayti/`, `eka-runner/`, `eka-runner-private/` out of the
workspace; (c) leave everything and only add `.gitignore` rules.
Recommendation: (a) plus gitignoring every untracked tree — the
`git add -A` hazard is the real risk; deletion of `runs/` data should be an
explicit separate owner decision because those chunks are recovered-data
exports (D-10 sensitivity class).

**Q-3. Should the two tracked root skill copies
(`SKILL (11).md`, `CICD_DevOps_Pipeline_Skill_v2.2_for_review (3).md`) be
removed?**
Options: (a) delete; (b) move to `archive/`; (c) keep.
Recommendation: (b) — they are review residue of the pinned skill; `archive/`
is the repo's designated cold storage and keeps history inspectable.

**Q-4. Which Vercel team owns the `channel-sandbox` project today, and are its
env vars set?**
Why it matters: it deploys from this repo (Root Directory `Devices/sandbox/`)
and is absent from targets.json; INTEGRATION.md left "set the sandbox's three
env vars" as an owner action on 2026-09-19.
Options: (a) it's in team `jayti2` — verify on vercel.com, add it to
targets.json; (b) it's in the legacy scope — decide keep-or-delete; (c) no
longer wanted — delete the project and the `Devices/sandbox` vercel.json.
Recommendation: (a) verify and record; it is used by CI tests
(device-sandbox-tests) so deleting it needs a replacement plan.

**Q-5. Should the local `.vercel/` link files be re-pointed at the live project
or removed?**
Why it matters: they point at the dead legacy projects (`jayti-dashboard`,
`jpbir_restructured` on the legacy team), so any local CLI command targets the
wrong project — a foot-gun while push-to-deploy is being repaired.
Options: (a) owner re-links locally to `jpbir`/`jayti2` when they do the
GitHub App re-link; (b) delete `.vercel/` entirely (regenerable); (c) leave it.
Recommendation: (b) — the repo never needs a local link (no deploy scripts
use the CLI), and CLAUDE.md warns `vercel link` creates projects when absent.

**Q-6. R1 scope for the tracked vendored code under `Frontend/` and
`Backend/` (~1,700 files): prune in R1, or only document?**
Why it matters: D-16 names "bloated vendored trees" as inherited debt to fix in
R1, but removing them changes what the deployed repo contains and must not
touch the 8 live pages or anything `vercel.json` builds.
Options: (a) prune now (delete unreachable vendored files, verify
`npm test` + deploy + parity checks); (b) gitignore-style quarantine (move to
`archive/`); (c) R1 only documents the boundary (CLAUDE.md already states it)
and pruning moves to R2.
Recommendation: (c) for R1 given "production stays as it is" (D-16) — write
the boundary into the TRD, prune in a later release with live verification.
(Deleting on-disk untracked debris, Q-2, is unaffected by this.)

**Q-7. Confirm the droplet record and PROFILE** (carried from D-15, unanswered
this session): does the jp-agent-droplet target (`runner.jaytipargal.tech`,
region blr1) and the PROFILE.md product description still match what the owner
expects? Options: (a) confirm as recorded; (b) owner corrects specific fields.
Recommendation: (a) — no code evidence contradicts them.

---

## Appendix: scan command summary (for reviewer replication)

All scans run 2026-10-18 against `feat/jp-agent-droplet-runner` @ `2e04c369`.
Tracked scan: `git grep -I -c -i -E -f <patterns>` with pathspec
`:(exclude)archive`, over pattern classes: Firebase SA JSON shape, `AIza…`,
`ghp_/gho_/github_pat_`, `sk-`/`sk-ant-`, PEM block markers, `AKIA/ASIA`,
`xox…`, connection-string schemes (postgres/mongodb/mysql/redis/amqp), and a
generic `key/secret/token/password` assignment shape. Untracked scan: same
patterns via `git grep --no-index` over the named untracked trees with
`node_modules`, `.git`, `__pycache__`, `.hypothesis`, `.pytest_cache` and
`vscode-office/{out,lib,vditor,node_modules}` excluded; `runs/` limited to text
files under 5 MB (2,209 of 5,071 files; 43 MB of 25.5 GB). No secret value was
read, printed, or stored at any point.