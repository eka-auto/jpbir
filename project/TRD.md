# Technical Requirements Document — jpbir, Release R1 ("Stabilize and Harden")

**Status:** DRAFT for owner review. Prepared for the Step 1 sign-off. The owner approves
(with possible edits) at the T-06 scope-freeze review.

**How to read this document.** Every requirement has an ID (`TR-xxx`). Where a requirement
implements a business fix, its ID maps 1:1 to the corresponding `BR-xxx` in
`project/BRD.md`. Where a requirement is a non-functional target (NFR), it is explicitly
tagged `NFR-with-owner-confirmation-tag` so the owner can confirm or veto it.

Every statement is either:

- **owner-confirmed (D-n)** — traceable to a decision in `project/decisions.md` (D-1..D-16)
  or `project/PROFILE.md` (which itself is assembled from those decisions); or
- **inferred-from-code** — read directly from the repository; cited to the section of the
  fact sheet `project/plans/r1-facts.md` that recorded it (written as "facts §n" below).

**Plain language.** Specialized words are explained in parentheses where they first appear.
The full plain-language glossary is at `r1-facts.md §9` — every glossed term below appears
there too.

**Secrets.** No secret, key, or token value is written anywhere in this document.
Configuration values are referred to by name only (e.g., `S24_SYNC_PRIVATE_KEY_PEM`).

---

## 1. Architecture as-is

This section records the real system today. Each element is tagged `inferred-from-code`
(with its fact-sheet citation) or `owner-confirmed` (with its decision citation). R1 does
not change any of these components' behavior — the goal is to stabilize and harden them
[owner-confirmed (D-16)].

### 1.1 Product components

| Element | Description | Tag | Citation |
|---|---|---|---|
| **Frontend** (browser dashboard) | Hand-written static HTML pages with inline vanilla JavaScript (plain JS, no framework). Eight live pages: `index.html`, `s24.html`, `vivobook.html`, `jteka.html`, `agent.html`, `db.html`, `viewer.html`, and `template.html`. The other ~1,968 tracked files under `Frontend/` are vendored (third-party code copied wholesale) editor/viewer code. | inferred-from-code | [facts §1] |
| **Backend** (serverless API) | Small functions that start on demand on Vercel's computers. 39 Node ES-module handlers named in `vercel.json` `builds`, plus a catch-all route (a fallback rule sending any unmatched `/api/<name>` to `Backend/<name>.js`). `Backend/lib/` holds the real product logic (`s24-attestation.js`, `warehouse.js`, `ddb-scan.js`, `cron-auth.js`, `media-auth.js`, `stale.js`, `stack-map.js`, `geo.js`). | inferred-from-code | [facts §1] |
| **Database/** (schema and tooling) | 18 `CREATE TABLE` definitions across 7 SQL files (WhatsApp tables `wa_*`, S24 tables `s24_*`, plus `warehouse_sync_state`), 3 Prisma-demo statements, 6 GraphQL schema files, and migration tooling (`scripts/migrate.mjs`). | inferred-from-code | [facts §1] |
| **Devices/** (installer kits) | Per-device installer bundles: `Lenovo/` (9 files), `S24/` (23 files, includes `runtime_contract.json` which bans inbound listeners), `Vivobook/` (10 files), and `sandbox/` (31 files — a test rig that is also its own Vercel project). Kits are SHA-256-pinned (each installer verifies every bundled file against a fixed checksum) and byte-identical; they are not touched in R1. | inferred-from-code | [facts §1; owner-confirmed (D-16)] |
| **Server/** (droplet runtime) | `Server/jp-agent/` (27 files): agent runtime for the DigitalOcean droplet (a rented Linux server) — entry `server.mjs`, MCP server `s24-mcp-server.mjs` (a standard protocol for AI assistants to use external tools), systemd units (Linux service definitions) `jp-agent.service` + `s24-mcp.service`, and nginx config. The other ~48 loose files at `Server/` root include device install scripts and six GitHub workflow files that do nothing where they sit. | inferred-from-code | [facts §1] |
| **Integrations/** (store clients) | 11 tracked files: `postgres.js`, `wa-store.js`, `s24-store.js`, and the Python `s24-connect-mcp/` MCP server. | inferred-from-code | [facts §1] |
| **_shared/** (config, docs, tests) | `tests/` (53 files, driven by `npm test`), `docs/` (33 files), `tools/` (17 files including `scan_secrets.py` and `generate-env-manifest.mjs`), and `config/vercel-env.manifest.json` (the authoritative inventory of Vercel environment-variable names — names and fingerprints, no values). | inferred-from-code | [facts §1] |

### 1.2 Deployment and CI topology

| Element | Description | Tag | Citation |
|---|---|---|---|
| **Live production hosting** | Vercel team `jayti2` (`team_gcqCiU4UgkhcUJGRGLZYaQiW`), project `jpbir`, domains `jaytipargal.tech`, `www.jaytipargal.tech`, `jpbir.vercel.app`; production deployment `dpl_BzR5Z8UMxeBu2HDp4dDRpTG7JYpE` (commit `f6e21fc`, READY). The legacy `jayti-dashboard` project is billing-blocked and irrelevant to live hosting. | owner-confirmed | [owner-confirmed (D-12); owner-confirmed (D-9) targets.json] |
| **Deploy contract** | `vercel.json` sets `outputDirectory` to `Frontend`, 40 `builds` entries, 4 cron jobs (cron = a scheduler that runs a task on a fixed timetable: `/api/check-stale` every 10 min, `/api/db-push` daily 18:30 UTC, `/api/s24-sync-cron` every 6 h, `/api/stack-cron` every 5 min), and security headers on every route. | inferred-from-code | [facts §3] |
| **Push-to-deploy** | Currently broken. The Vercel GitHub App for `jaytipargal/jpbir` on branch `main` is not linked in team `jayti2`, so pushes do not trigger a deploy; missing environment secrets on `jayti2/jpbir` also need populating. Both are owner-owned actions on vercel.com — agents never receive the values. | owner-confirmed | [owner-confirmed (D-12), (D-15)] |
| **Local CLI link files** | `.vercel/project.json` and `.vercel/repo.json` point at two dead legacy projects (`jayti-dashboard`, `jpbir_restructured` on the legacy team). Nothing in the local link points at the live project. | inferred-from-code | [facts §3] |
| **Droplet deploy path** | `deploy-droplet.yml` deploys `Server/jp-agent` to the droplet on every push to `main` via a self-hosted runner (a machine we own and register with GitHub) labeled `jp-agent-droplet`. | inferred-from-code | [facts §3; owner-confirmed (D-9) targets.json] |
| **Other deploy paths** | `sync-keys-to-vercel.yml` (dispatch-only key sync) and `dashboard-parity-check.yml` (dispatch-only production parity checks — comparing live production behavior with what the repository expects). CLI deploys from CI were deliberately removed and must not be re-added. | inferred-from-code | [facts §3; CLAUDE.md Deployment section] |
| **CI fallback** | No CI runner on this machine. The orchestrator runs `tracker.py` (the audit and status tool from the pinned skill) locally via Windows Task Scheduler task `jpbir-hod-audit` (daily 08:47 IST). | owner-confirmed | [owner-confirmed (D-3); owner-confirmed (D-5)] |

### 1.3 Data stores

| Store | Description | Tag | Citation |
|---|---|---|---|
| **Firestore** (Google's document database) | Project `intrepid-stage-495117-q1`, database `eka-agent`. Collections: `devices` (one doc per device; the S24 doc carries the `commandQueue` map device daemons poll) and `deviceKeys` (broker enrollment keys). | inferred-from-code | [facts §4] |
| **Postgres (Neon)** | Project `fancy-cloud-99501540`, role `neondb_owner`. Tables defined in `Database/schema/`. Written by telemetry/ingest handlers and the daily `db-push` cron. | inferred-from-code | [facts §4; owner-confirmed (D-9)] |
| **Vercel Blob** (Vercel's file storage) | Two stores (`store_vxETiZ3lYBeN`, `store_y8X2dcvEtuqy`). Holds WhatsApp media bytes; written by `wa-blob-upload`, read via `wa-media` proxy. | inferred-from-code | [facts §4; owner-confirmed (D-9)] |
| **AWS DynamoDB** (Amazon's key–value database) | A fourth store visible in code but absent from the target manifest and the profile. Dependencies (`@aws-sdk/client-dynamodb`), handlers (`db-push.js`, `backup-db.js`), a workflow (`db-push-backfill.yml`), and a committed telemetry backup exist. Likely the older telemetry store being migrated into Postgres. | inferred-from-code | [facts §4; facts §8 Q-1] |
| **Local stores** | `data/*.db` SQLite files (small single-file databases, local only, ignored) and a Chroma-style local vector store in `Database/eka_vector_db.py`. | inferred-from-code | [facts §4] |

### 1.4 How the components talk

Devices enroll and send telemetry through the serverless API handlers
(`device-enroll.js`, `device-heartbeat.js`, `broker-command-claim.js`,
`broker-command-complete.js`). The `broker.js` handler acts as the middleman service —
devices check in with it, fetch work from it, and report results to it. Enrollment
uses a P-256 cryptographic key (a standard key format sealed in the device's hardware)
and hardware attestation (cryptographically proving a claim, e.g. that a heartbeat
really came from the device's own hardware) [facts §1]. Data lands in Firestore
(device state, command queue) and Postgres (telemetry, message history). WhatsApp media
bytes land in Vercel Blob. The dashboard reads from the same API [facts §4].
The three-device fleet (`samsung-s24-ultra`, `g4g-lenovo-laptop`, `jayti-asus-vivobook`)
is enforced by the broker's `HARDWARE_RULES` — the broker refuses any other identity
[facts §7].

---

## 2. Technical requirements per in-scope fix

These requirements implement the business fixes `BR-101`..`BR-105` in `project/BRD.md`.
Each ID below maps 1:1 to the corresponding `BR-xxx` requirement and adds the technical
acceptance criteria and evidence source for it.

### TR-101 (maps to BR-101): Repository cleanup and ignore-rule gaps

**Requirement.** R1 fences off or deletes (with owner approval only) all untracked
workspace trees listed in the fact sheet, so that a careless automated "add everything"
command cannot sweep them into the project history [facts §2; owner-confirmed (D-16)].

**Technical acceptance criteria.**

- The ignore rules in `.gitignore` cover every untracked workspace tree listed in the
  fact sheet (`runs/`, `vscode-office/`, `jpbir/`, `scratch/`, `personal_folder_agent/`,
  `permanent_agent/`, `eka-runner/`, `eka-runner-private/`, `jayti/`, `dashboard/`,
  `Sandbox/`, `venv/`, `tools/`, `data/`, `logs/`, and the root log file) — [facts §2].
- After the rules are added, running the equivalent of a plain "add everything" command
  (e.g., `git add -A`) stages **zero** files from those trees.
- Deletion of any tree happens only after the owner answers the corresponding questions
  (Q-BRD-2, Q-BRD-3) in `project/BRD.md`; no deletion occurs without a recorded decision.
- The two tracked root skill-review copies (`SKILL (11).md`,
  `CICD_DevOps_Pipeline_Skill_v2.2_for_review (3).md`) are handled per the owner's
  Q-BRD-3 decision (delete, move to `archive/`, or keep).
- The six stray workflow YAML files in `Server/` root stay where they are and are
  documented as inert in R1 — GitHub only reads `.github/workflows/`, so relocating them
  would activate six dormant workflows (deploy/publish and secret-verification among
  them), a behavior change outside R1's stabilize-and-harden scope (D-16); relocation or
  removal is deferred past R1 [facts §1, §2].

**Source tags.** [facts §2] for the bloat inventory and ignore-rule gaps;
[owner-confirmed (D-16)] for "bloated vendored trees" being in-scope debt.

### TR-102 (maps to BR-102): Documentation tells the truth

**Requirement.** Every stale statement found in the fact sheet's docs audit (section 6)
is corrected or explicitly marked as historical, and the live hosting identity —
team `jayti2`, project `jpbir`, domain `jaytipargal.tech` — is stated correctly
[owner-confirmed (D-16); facts §6; owner-confirmed (D-12)].

**Technical acceptance criteria.**

- `README.md`: the four stale spots recorded in the fact sheet (no build step, workflow
  count, the nonexistent `endform-e2e.yml` bug, and "every push deploys") are corrected
  or annotated as historical [facts §6].
- `CLAUDE.md`: the four stale spots recorded in the fact sheet (legacy hosting project
  name, lint script status, build script status, and drifted file counts) are corrected
  or annotated [facts §6; owner-confirmed (D-12)].
- The live identity (`team jayti2`, project `jpbir`, domain `jaytipargal.tech`) is
  reflected in every doc that mentions deployment or hosting.
- `QWEN.md` and `INTEGRATION.md` are corrected or annotated, or the owner decides they
  remain "as written" (QWEN.md is kept "as Qwen wrote it" by policy) — [facts §6].

**Source tags.** [facts §6] for the staleness audit; [owner-confirmed (D-12)] for the
live hosting cutover.

### TR-103 (maps to BR-103): Repair the broken deploy link

**Requirement.** The push-to-deploy path works end to end, the missing configuration
values are populated on the live project, and the stale local link files are removed or
re-pointed per the owner's choice [owner-confirmed (D-12), (D-15); facts §3].

**Technical acceptance criteria.**

- The Vercel GitHub App for `jaytipargal/jpbir` on branch `main` is linked in team
  `jayti2`, so pushes to `main` trigger a Vercel production deploy [owner-confirmed
  (D-12), (D-15)].
- The missing environment secrets on `jayti2/jpbir` are populated (owner action; names
  include `BLOB_READ_WRITE_TOKEN`, `S24_SYNC_PUBLIC_KEYS`, `WA_INGEST_KEY` — values are
  never written in documents or accessed by agents) [owner-confirmed (D-12), (D-15)].
- The local `.vercel/` link files pointing at dead legacy projects are deleted or
  re-pointed at the live project, per the owner's Q-BRD-5 decision [facts §3].
- The proposed acceptance criterion is confirmed or calibrated by the owner (Q-BRD-8):
  "Given a push to `main` with a functional change, When the owner opens
  `jaytipargal.tech` within 10 minutes, Then the dashboard reflects the pushed change."
- CLI deploys from CI remain removed (never re-added) [facts §3].

**Source tags.** [owner-confirmed (D-12), (D-15)] for the broken integration, missing
secrets, and owner-owned actions; [facts §3] for the local-link mismatch and deploy paths.

### TR-104 (maps to BR-104): Keep secrets out of the repository

**Requirement.** R1 preserves the clean secret-scan baseline and keeps the structural
guards in force [owner-confirmed (D-16); facts §5].

**Technical acceptance criteria.**

- A re-run of the secret scan (the fact sheet's section 5 method) over tracked files
  finds **zero** live-secret findings at the R1 completion commit [facts §5].
- The three secret-bearing environment files that exist on disk (root `.env.local`,
  `.vercel/.env.production.local`, and one inside the duplicate checkout) are never
  read, printed, or committed [facts §5].
- The structural guards (`.gitignore` rules for key files and env files,
  `.vercelignore` deploy-time exclusion) remain at least as strict as before any R1
  change [facts §5].
- Secret scanning in CI: the repository's secret-scanning tooling is verified and, if
  feasible, run as part of CI (see TR-107 and Section 3) — [facts §1, §5].

**Source tags.** [facts §5] for the scan method, findings, and guards;
[owner-confirmed (D-16)] for "secret hygiene" being in scope.

### TR-105 (maps to BR-105): Baseline protections verified

**Requirement.** R1 re-verifies each baseline protection on demand and records the
results; nothing new is invented [owner-confirmed (D-2), (D-5), (D-7), (D-13), (D-15);
facts §7].

**Technical acceptance criteria.**

- The GitHub ruleset `25339138` ("pipeline-protected-branch") remains active on the
  default branch, blocking history rewrites and deletions [owner-confirmed (D-15)].
- The pinned audit skill (`project/audit/SKILL.md`) still matches its recorded
  SHA-256 fingerprint [owner-confirmed (D-7), (D-13)].
- The daily scheduled audit (Windows Task Scheduler task `jpbir-hod-audit`) runs and
  passes: selftest 35/35, all audit checks pass [owner-confirmed (D-5), (D-14)].
- The two backup files (git bundle and untracked archive) hash-verify against their
  recorded fingerprints, and the OneDrive off-machine copy remains present and
  hash-identical [owner-confirmed (D-2), (D-15)].
- The paid-plan branch protection remains formally parked (owner chose to keep the repo
  private) [owner-confirmed (D-15)].

**Source tags.** [owner-confirmed (D-2), (D-5), (D-7), (D-13), (D-15)] for each control;
[facts §7] for the consolidated production state.

---

## 3. Non-functional targets for R1

These are targets rather than code changes. Each is tagged
`NFR-with-owner-confirmation-tag` so the owner can confirm or adjust it at sign-off.

### TR-106 (NFR-with-owner-confirmation-tag): Availability and performance targets

**Target.** The existing dashboard availability and response-time targets recorded in
`project/PROFILE.md` stay in force for R1 — [owner-confirmed (D-1)].

- **Availability target:** 99.5% for the existing dashboard at `jaytipargal.tech`
  [owner-confirmed (D-1)].
- **Performance target:** 95% of API responses arrive within one second (p95 1 s)
  [owner-confirmed (D-1)].
- **Owner confirmation needed:** the owner confirms these remain the R1 targets, since
  they were originally set as tier-level targets in D-1 and are carried forward unchanged.
  If the owner wants a different level, it must be recorded as a new decision.

**Source tags.** [owner-confirmed (D-1)] for the tier and targets;
[owner-confirmed (D-16)] for R1 scope.

### TR-107 (NFR-with-owner-confirmation-tag): Backup and restore targets

**Target.** R1 maintains and re-verifies the backup posture recorded in
`project/PROFILE.md` [owner-confirmed (D-1), (D-2), (D-15)].

- **Recovery point objective (RPO):** at most 24 hours of data may be lost
  [owner-confirmed (D-1)].
- **Recovery time objective (RTO):** the service must be back within 24 hours
  [owner-confirmed (D-1)].
- **Backup destination:** local folder `C:\Users\abcom\.local\share\kilo\cicd-backups`
  (git bundle + untracked archive, hashes recorded in D-2) [owner-confirmed (D-2)].
- **Off-machine copy:** satisfied via OneDrive sync
  (`C:\Users\abcom\OneDrive\cicd-backups\jpbir\`), hash-verified byte-identical
  [owner-confirmed (D-15)].
- **Repo-level backup targets:** the two archive files must be re-generated or re-verified
  at the end of R1 so the backup reflects the post-R1 state. Both hashes must be recorded
  and verified after any significant R1 change (e.g., post-prune or post-doc-update).
- **Owner confirmation needed:** the owner confirms this cadence and the target that a
  refreshed backup pair is created before R1 closes.

**Source tags.** [owner-confirmed (D-1)] for RPO/RTO; [owner-confirmed (D-2), (D-15)]
for backup destination and off-machine copy.

### TR-108 (NFR-with-owner-confirmation-tag): Security baseline

**Target.** The security baseline in `project/PROFILE.md` and the fact sheet's structural
guards stay in force and are extended with a dependency-scanning step [facts §5;
owner-confirmed (D-10)].

- **Secret scanning in CI:** the repository's own secret scanner (`_shared/tools/
  scan_secrets.py`) is verified and, if feasible, wired into CI so that a push with a
  real secret value fails the check [facts §1, §5].
- **Dependency scanning:** a dependency-scanning step (e.g., a package-vulnerability
  audit against the `npm` dependency list) is proposed. It is not currently part of CI
  (no such workflow exists in `.github/workflows/`) [facts §1]. The owner must confirm
  whether this is added in R1 or deferred to a later release.
- **Compliance scope:** India's DPDP Act governs the data classes (device telemetry,
  WhatsApp content/media, device identifiers, IP/fingerprint). WhatsApp content is the
  highest-sensitivity class — kept out of logs, traces, prompts, and agent context
  [owner-confirmed (D-10)].

**Owner confirmation needed:** whether the dependency-scanning step is added in R1
(currently no such workflow exists) [facts §1], and whether the secret scanner is wired
into CI or stays local-only.

**Source tags.** [facts §1] for the CI workflow inventory (no dependency-scanning
workflow exists); [facts §5] for the secret scanner and guards;
[owner-confirmed (D-10)] for compliance scope.

---

## 4. Environment manifest confirmation

**Requirement.** `project/environment/` is the committed environment manifest (one
committed definition of every machine and environment the project runs on) —
[owner-confirmed (D-8); facts §7]. It must cover every component R1 will build and test.

**Contents (verified present on disk).**

- `project/environment/Dockerfile` — base image `node:24.16.0-bookworm-slim` (pinned by
  tag; digest to be pinned at first build per D-8), installs `git` and `python3`,
  workspace at `/workspace`. [owner-confirmed (D-8); facts §7]
- `project/environment/compose.yaml` — dev service building from the Dockerfile, plus a
  pinned `postgres:16.4-bookworm` instance for local development (production uses Neon).
  [owner-confirmed (D-8)]
- `project/environment/run` — entry point that runs any command inside the environment
  via `docker compose run`. [owner-confirmed (D-8)]
- Local Python 3.14.6 (`C:\Users\abcom\AppData\Local\Python\bin\python.exe`) is used for
  `tracker.py` (stdlib-only). [owner-confirmed (D-8); facts §7]

**Coverage check against R1 work.**

| Component R1 will build/test | Covered? | Detail |
|---|---|---|
| **Node for Backend functions and scripts** (e.g., `_shared/tests/run-all.mjs`, `scripts/build.mjs`, `scripts/lint.mjs`) | Yes | The Dockerfile base image is `node:24.16.0-bookworm-slim` — matches the repository's Node 24 engines requirement [facts §1; owner-confirmed (D-8)]. |
| **Node test suite** (`npm test` → `_shared/tests/run-all.mjs`) | Yes | Runs inside the container via `project/environment/run` [owner-confirmed (D-8)]. |
| **Python for scripts** (`tracker.py`, `scan_secrets.py`, `redact_secrets.py`, `scrub_secrets.py`) | Yes | The Dockerfile installs `python3`. Local Python 3.14.6 is used for `tracker.py` outside the container [owner-confirmed (D-8)]. |
| **Postgres migrations** (`npm run db:migrate`) | Yes | `compose.yaml` provides a pinned `postgres:16.4-bookworm` dev instance [owner-confirmed (D-8)]. |
| **Firestore / Vercel Blob / Vercel project access** | Partial | These are external services; the manifest covers the runtime base but not the external connections themselves. Not a gap for R1 builds/tests, which do not require live external-service writes. |
| **Browser end-to-end tests** (`npm run test:browser` via Playwright) | Partial | Playwright is a devDependency; it requires a browser binary inside the container. The current Dockerfile does not install browser binaries. Not needed for R1's core work (docs, gitignore, secret scans), so this is noted as a known gap, not an R1 blocker. |

**Gaps noted.**

1. **Python version pin inside the container.** The Dockerfile installs `python3` without
   pinning a specific Python version (the local tracker uses Python 3.14.6). If any R1
   Python script needs an exact version, the Dockerfile must be updated to pin it.
2. **Playwright browser binaries.** The Dockerfile does not install browser binaries
   needed for Playwright end-to-end tests. Not an R1 blocker since R1 does not change
   the browser surface, but noted for completeness.

---

## 5. Risks and open technical questions

These are the risks and open questions carried from the fact sheet and the BRD that
affect the technical work.

### Risks

- **Risk: cleanup touches something live.** Mitigation: R1 prunes only untracked debris
  and documents the tracked-vendored boundary instead; production stays as it is
  [owner-confirmed (D-16); facts §2; facts §8 Q-6].
- **Risk: the DynamoDB machinery is retired while the store is still live.** Mitigation:
  nothing is deleted before a read-only check proves it empty (Q-BRD-1) [facts §4, §8 Q-1].
- **Risk: BR-103 cannot finish because the owner-owned Vercel actions wait.** Mitigation:
  every other R1 task proceeds without them; TR-103 completion is verified after the
  owner acts [owner-confirmed (D-15)].
- **Risk: the `runs/` tree is deleted as "debris" by mistake.** Mitigation: it is
  excluded from any blanket deletion and treated as the highest-sensitivity data class
  [owner-confirmed (D-10); facts §2].
- **Risk: an unrecorded control change replaces the pinned skill or tracker.** Mitigation:
  the pinned skill and tracker are hash-verified on every audit run; any upgrade must be
  a reviewed decision [owner-confirmed (D-13); facts §7].
- **Risk: `.gitignore` work lands before owner answers Q-BRD-2/Q-BRD-3, and a later
  decision contradicts it.** Mitigation: ignore rules only fence things off; they delete
  nothing, and any deletion is a separate recorded decision.

### Open technical questions

- **Q-1: Is AWS DynamoDB still a live data store, or already retired?** The store is
  visible in code but absent from the target manifest. A read-only check is recommended
  before any retirement [facts §4, §8 Q-1; Q-BRD-1].
- **Q-2: What should happen to the big untracked local trees?** Delete the obvious debris
  now, move the rest out of the workspace, or leave everything and only add `.gitignore`
  rules [facts §2, §8 Q-2; Q-BRD-2].
- **Q-3: Should the two tracked root skill copies be removed?** Delete, move to
  `archive/`, or keep [facts §2, §6, §8 Q-3; Q-BRD-3].
- **Q-4: Which Vercel team owns the `channel-sandbox` project today, and are its env
  vars set?** The project deploys from `Devices/sandbox/` but is missing from the target
  manifest [facts §3, §8 Q-4; Q-BRD-4].
- **Q-5: Should the local `.vercel/` link files be re-pointed or removed?** They point at
  dead legacy projects and are a foot-gun while push-to-deploy is being repaired
  [facts §3, §8 Q-5; Q-BRD-5].
- **Q-6: R1 scope for the tracked vendored code (~1,700 files) under `Frontend/` and
  `Backend/`: prune in R1, or only document?** Recommendation: document only in R1 given
  "production stays as it is" [facts §2, §8 Q-6; Q-BRD-6].
- **Q-7: Confirm the droplet record and PROFILE.** The jp-agent-droplet target and the
  profile description have not been re-confirmed by the owner [facts §7, §8 Q-7; Q-BRD-7].

These questions are batched for the owner at the T-06 sign-off; answering them finalizes
the R1 scope.
