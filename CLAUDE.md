# CLAUDE.md — jpbir

Operating context for **Claude Code** (and any AI agent) working in this
repository. Read this before editing. This is Claude's own working file; a
parallel `QWEN.md` written by Qwen covers the same project from its own
perspective — this file is the one Claude follows.

## Working agreement: "change it" means change it

**When the operator asks for a change, they are asking for the running system to
be different afterwards.** They are not asking for a proposal, a draft, a plan
file, or a second copy of the thing placed next to the original. Deliver the
edit, not a description of the edit.

This rule exists because the repo already carries the scar of the opposite
habit. `Frontend/` holds 1976 tracked files to serve a 404 KB dashboard — three
unrelated vendored trees that were swept in and left beside the real code rather
than resolved. Every "I'll add a new file instead of changing the existing one"
decision compounds into exactly that. The tree is the evidence; don't add to it.

Concretely, for each kind of ask:

| Ask | What "done" means | What is **not** done |
|-----|-------------------|----------------------|
| Code change | Edit the handler/module in place; `npm test` passes | A new `*-v2.js` beside the old one |
| DB change | A real migration in `Database/migrations/`, applied via `npm run db:migrate` | A `.sql` file nobody runs, or a schema doc |
| UI/UX change | Edit the live page in `Frontend/` (one of the 8 in the layout table); load it and confirm it renders | A mockup, an artifact, or a new `*-new.html` |
| Config/infra | Edit `vercel.json`, the workflow, or the unit file itself | A snippet in chat saying what to paste |
| Docs | Update the doc that already covers the topic | A second doc covering the same topic |

Corollaries:

- **Edit existing files over creating new ones.** A new file needs a reason that
  survives being asked "why not change the one that already does this?"
- **No `.md` summary of work as a substitute for the work.** Write-ups are for
  when they are asked for, or when the reasoning genuinely will not fit in a
  commit message. A plan file is not a deliverable.
- **Verify, don't assert.** "Changed and tests pass" requires having run them.
  A UI change requires having loaded the page. Report what actually happened,
  including failures.
- **Finish the whole ask.** If part is blocked, complete every other part and
  say plainly which piece was left and why.

**This does not override the guardrails below.** `## Do not touch` still holds,
secrets still never enter the repo or a transcript, and genuinely destructive or
irreversible actions (dropping data, force-pushing, rotating a live credential,
deploying to production) are still confirmed before they are taken. "Act, don't
draft" is about ordinary engineering work, not about skipping the seatbelts.

## Project overview

**jpbir** ("Jayti Device Dashboard") is real-time device monitoring, telemetry,
and remote command for the machines behind **[jaytipargal.tech](https://jaytipargal.tech)**.

Three cooperating pieces:

1. **A browser dashboard** — static HTML showing each enrolled device's status,
   site analytics, and WhatsApp content.
2. **A serverless API** — Vercel Node functions serving the dashboard and
   receiving device telemetry.
3. **`jp-agent`** — a persistent agent runtime on a DigitalOcean droplet for
   long-running work (shell, file edits, git, deploys) that a serverless
   function cannot do. Vercel proxies to it; the browser never holds the
   droplet token.

Stack: Node 24 (ESM throughout), Vercel serverless + static hosting, no build
step and no frontend framework — pages are hand-written HTML with inline
vanilla JS. Data lives in Firestore, Postgres (Neon), Vercel Blob, and DynamoDB.

## Repository layout

Eight layers, produced by a one-time restructure (PRs #9/#10) whose full
manifest is in [`RESTRUCTURE_STATE.json`](./RESTRUCTURE_STATE.json) and whose
rationale is in [`INTEGRATION.md`](./INTEGRATION.md).

| Layer | Path | Holds | Tracked files |
|-------|------|-------|---------------|
| Frontend | `Frontend/` | Static dashboard pages, styles, components | 1976 |
| Backend | `Backend/` | Vercel serverless functions — the API | 172 |
| Database | `Database/` | Schemas, migrations, Firestore/vector tooling | 26 |
| Server | `Server/` | `jp-agent` droplet runtime, deploy scripts, nginx/systemd | 63 |
| Integrations | `Integrations/` | Shared store clients (`postgres.js`, `wa-store.js`, `s24-store.js`) | 9 |
| _shared | `_shared/` | Project-wide config, docs, and **all tests** | 93 |
| Devices | `Devices/` | Self-contained per-device installer bundles | 71 |
| archive | `archive/` | Cold storage: superseded or regenerable artifacts | 57 |

2497 tracked files total (counts as of `main@dec21fa`, 2026-09-20).

### ⚠️ The tree is much larger than the app

`Frontend/` holds 1976 tracked files but only **8 are live pages**:
`index.html`, `s24.html`, `vivobook.html`, `agent.html`, `db.html`,
`jteka.html`, `viewer.html`, `template.html`. The rest is vendored noise the
restructure swept in — a Vditor markdown-editor bundle, `*.tmLanguage`
grammars, i18n locale `*.js`, TypeScript language-service providers, editor
themes. `Backend/` has the same problem (`*.ts` editor providers, `eka_*.py`
ML scripts, `excel*` perf tests).

**[`vercel.json`](./vercel.json) is the authoritative API surface.** A file is
part of the deployed app only if it appears in `builds`/`routes` there, or is
reachable from something that does. Before reasoning about "the backend",
check `vercel.json` — not a directory listing. Do not "clean up" or refactor
vendored files; they are inert.

## Commands

```bash
npm install
npm run dev      # scripts/dev-server.mjs — serve Frontend/ on :3000 (static only)
npm test         # _shared/tests/run-all.mjs — every *.test.mjs, all must pass
```

| Script | Command | Notes |
|--------|---------|-------|
| `npm run dev` | `node scripts/dev-server.mjs` | Static frontend server on `:3000`. It does NOT run the serverless API — `Backend/*.js` handlers require Vercel's own runtime and are only exercised in preview / production deploys. |
| `npm test` | `node _shared/tests/run-all.mjs` | Runs every `*.test.mjs` in its own child process |
| `npm run build` | `echo '...'` | **No-op.** Frontend is served statically; there is nothing to compile |
| `npm run db:migrate` | `node Database/scripts/migrate.mjs` | Postgres schema migrations |
| `npm run wa:build` / `wa:import` | `node Database/scripts/wa-*.mjs` | WhatsApp inventory build / import |

There is no root-level `deploy` script and no `vercel` CLI in `devDependencies`. Production deploys go through Vercel's Git integration (see below); nothing in this repo shells out to `vercel`. The 28-vulnerability audit report the CLI's transitive tree used to drag in went with it — `npm audit` is now clean.

**There is no `lint` script at the root.** CI runs `npm run lint --if-present`,
which silently no-ops. An `_shared/eslint.config.mjs` exists but is not wired
to the root package. Don't claim lint passed — it never ran.

> `README.md` states "`npm test` is not yet wired up." That is stale: it is
> wired and passing. Trust `package.json` over the README.

## Testing conventions

Tests live in **`_shared/tests/`**, not beside the code they cover. Most are
**plain ESM scripts** that set `process.exitCode` directly, not `node:test`
suites — `node --test` will not drive those. A handful are real `node:test`
files; `grep -l "node:test" _shared/tests/*.test.mjs` lists the current set.
`run-all.mjs` covers both kinds: it discovers `*.test.mjs` alphabetically,
spawns each as `node <file>` in a child process, and treats any non-zero exit
(including a signal kill) as a failure.

The house pattern, from `_shared/tests/device-liveness.test.mjs`:

```js
import assert from 'node:assert/strict';
import { strictS24Liveness } from '../../Backend/jp-devices.js';

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

t('S24 is live only when every attestation check and ACK is fresh', () => { /* ... */ });
```

Conventions to match:
- Import the **real exported function** from `Backend/`; don't reimplement logic in the test.
- Set `process.exitCode = 1` on failure — never `process.exit()`, so remaining assertions still report.
- Test names are full sentences describing the **contract**, often naming the production incident that motivated them ("a bridge process acknowledging commands on time is still not the phone").
- Add a new suite by dropping `<name>.test.mjs` into `_shared/tests/`; no registration needed.

A few Python tests (`test_redact_secrets.py`, `test_scan_secrets.py`,
`test_verify_corpus.py`) also live there but are **not** run by `run-all.mjs`.

## Architecture: data flows and where content actually lives

This is the most commonly misunderstood part of the system. Four separate
stores, and the dashboard reads all of them:

| Store | Contents | Written by | Read by |
|-------|----------|-----------|---------|
| **Firestore** (project `intrepid-stage-495117-q1`, db `eka-agent`) | Device telemetry docs + each doc's `commandQueue` | Device daemon heartbeat | `jp-devices`, `jp-agent`'s `s24-tools.mjs` |
| **Postgres / Neon** | `wa_messages`, `wa_attachments`, `device_telemetry` | `POST /api/wa-ingest` | `jp-live-content`, `jp-whatsapp`, `jp-wa-*` |
| **Vercel Blob** | WhatsApp media bytes | `wa-blob-upload` / ingest | via `blob_url` columns |
| **DynamoDB** | Site analytics events (visitor devices, IPs, pageviews) | `jp-track` | `jp-device`, `stats`, `visitor` |

```
Phone daemon / Termux cron ──outbound HTTPS──▶ Vercel API ──▶ Postgres + Blob ──▶ dashboard
dashboard / agent / MCP    ────────────────▶ Firestore commandQueue ──▶ (phone reads it on its next tick)
```

**Both arrows originate at the device.** Nothing on the cloud side can pull
from a device, so when a device daemon dies, queued commands pile up
unexecuted and no new content arrives. There is no cloud-side fix for a dead
daemon — this is a deliberate design constraint, not a bug.

`Devices/S24/runtime_contract.json` encodes it explicitly:
`transport.inboundListener: false`, and `forbiddenRuntimeFeatures` bans
`inbound-ssh`, `reverse-tunnel`, `adb-over-tcp`, `service-account-key-on-device`,
and `bootstrap-key-download`. Devices authenticate with non-exportable
Android Keystore P-256 keys and signed outbound HTTPS only.

Consequence for the agent: every tool in `Server/jp-agent/s24-tools.mjs`
(`device_ping`, `device_wake`, `device_send`, `device_result`, `device_queue`)
is just a Firestore REST GET/PATCH against a device doc. The agent and the MCP
server are **mailbox clients** — they can queue a command and read back a
result, and nothing more. Queued ≠ executed; always check `device_result`.

### `generated_at` is not a sync time

Every backend response stamps `generated_at: new Date().toISOString()` when it
answers a poll. On a 10 s polling dashboard that value resets every 10 seconds
and says **nothing** about the device. The device's real sync time is its
Firestore `lastSeen`. Frontend labels must not describe `generated_at` as
"synced" — use "fetched"/"polled" for it, and `newestLastSeen(devices)`
(`Frontend/index.html`) when a genuine sync figure is wanted.

## Deployment

**Production deploys come from Vercel's Git integration** (project
`jayti-dashboard` → `jaytipargal.tech`). No workflow is involved, and none
should be.

A CI job that ran `vercel link --yes --project jpbir_restructured && vercel
deploy --prod` was **deliberately removed on 2026-09-18** (see the comment
block at the foot of `.github/workflows/ci-cd.yml`). Reasons, in order of cost:

1. `jpbir_restructured` is not production — no custom domain, one env var — so
   every data route 500'd while the check reported "Deploy to Production" green.
2. `vercel link --yes --project <name>` **creates** the project when absent, so
   deleting it just resurrected an empty one that accumulated 89 deployments.
3. A CLI deploy uploads the **working directory**, not the committed tree.

**Do not re-add a CLI deploy step to CI.** `.github/workflows/ci-cd.yml` lints
and tests only.

**A red `Vercel – jpbir` commit status is not this repo's failure.** On
2026-09-22 every commit (PR #102's head `fc8f214`, then `main@fa5a461`) carried
a third Vercel status, `Vercel – jpbir → Deployment failed.`, beside the two
green ones team `jayti` posts (`jayti-dashboard`, `channel-sandbox`). Its
Details link resolves to Vercel's cron-jobs pricing page: a stray `jpbir`
project in the **Hobby-plan** scope `g4-g` had been Git-linked to this repo,
and Hobby rejects any cron that runs more than once a day, so its build failed
before it started. `vercel.json` schedules `check-stale` every 10 min,
`stack-cron` every 5 min and `s24-sync-cron` every 6 h on purpose — that
cadence *is* the device-offline detection — so the fix was on Vercel (the
project was deleted; probe commit `4cb53e3` then carried only the two team
statuses), never a relaxed schedule. Production stayed READY throughout. If a
`Vercel – <name>` context appears that team `jayti` does not own, find and
remove that project; do not edit the crons to appease it.

**"Git author jaytipargal must have access to the project" / "Deployment was
blocked" is an account link, not code.** A Pro-team project deploys a commit
only if the commit author's GitHub login is connected to a Vercel account that
is a member of team `jayti`. On 2026-09-22 at 01:54 UTC the merge of PR #103
(`main@c21193f`) was blocked on both projects with "the github user jaytipargal
who initiated the deployment does not have an account on Vercel". At 01:17 UTC
the same author had deployed `fa5a461` fine, credited to the developer account
`go4garageofficial-1587`; that GitHub connection disappeared between 01:18 and
01:54 UTC, the window in which the stray `g4-g` scope was cleaned up. PR heads
authored as `Claude <noreply@anthropic.com>` kept deploying (credited to the
team owner), which is why previews stay green while the merge commit, which
GitHub authors as the GitHub account, is the one that fails. The fix is in
Vercel → Account Settings → Authentication: connect GitHub `jaytipargal` to a
team member (the owner), then Redeploy the blocked production deployment or
merge the next PR. Nothing in git config, CI or `vercel.json` can unblock it;
do not add a deploy workflow to route around it.

**"password authentication failed for user 'neondb_owner'" means the Neon
password was rotated and this project was not told.** The Neon project
`jaytibirthday-db` (`fancy-cloud-99501540`, role `neondb_owner`) is shared with
the `jaytibirthday-site` Vercel project. A password reset there invalidates the
connection strings on **both** projects, and Vercel bakes env vars in at deploy
time. On 2026-09-22 the role was reset at 17:44 UTC and fresh strings went only
into `jaytibirthday-site` (17:50 UTC); `/api/verify-db` had passed at 16:47 UTC,
and from 17:44 UTC every dashboard Postgres call failed with SQLSTATE 28P01
(`jp-track`'s warehouse mirror, then the 18:30 UTC `db-push` cron). The same
thing happened on 2026-09-20 (reset 17:08 UTC, strings pasted 17:23 UTC, healed
by the next deploy). Fix: put the new pooled string in `DATABASE_URL` and
`POSTGRES_URL` and the direct one in `DATABASE_URL_UNPOOLED` and
`POSTGRES_URL_NON_POOLING` on `jayti-dashboard`, then rebuild production with
`vercel redeploy <production-url> --scope jayti` or the dashboard's Redeploy
button — both rebuild the existing deployment from git and upload nothing.
Never run `vercel` or `vercel --prod` in a working directory for this: it
uploads that directory (a run from a home directory on 2026-09-22 was stopped
only by an unreadable Docker socket). The CLI's "Value starts with whitespace"
warning is real: a leading space makes the parser read the host as `base`.
Resolved 2026-09-22: variables re-set 19:02–19:05 UTC, production rebuilt as
`dpl_GDAzXNH83ZFL65sMgZfB6Sphqk3Y` at 19:06 UTC, `/api/verify-db` green at
19:09 UTC. Nothing is lost meanwhile: `jp-track` still journals to DynamoDB and
`db-push` re-imports with ON CONFLICT DO NOTHING. Never paste a connection
string into a transcript, PR or commit. The `GATE_*` variables on this project
belong to `private-file-gate-db` and are unused here.

`.vercelignore` exists because of point 3: it keeps untracked local trees —
including a live GCP service-account private key and `app/shared/.env.local`
that once sat under `app/` — out of a laptop-run `vercel --prod`. It also
excludes ~28 GB of heavy local-only trees (`runs/` alone is 26 GB) that would
otherwise make the upload hang forever. Keep that list **ahead** of the tree
being tidied, not behind it.

CI workflows in `.github/workflows/`: `ci-cd.yml` (lint + test),
`code-quality.yml` (quality + security scan, mostly `continue-on-error`),
`health-check.yml` (endpoint health), `device-sandbox-tests.yml`,
`sync-keys-to-vercel.yml`.

## Security conventions

- **Fail closed.** `Backend/_auth.js` `checkKey`/`requireKey` return **503**
  when `STATS_KEY` is unconfigured and **401** when it's wrong — deliberately
  distinguishable, so an operator doesn't hunt for a bug in the browser.
  Handlers use `if (!requireKey(req, res)) return;`.
- **Timing-safe comparison.** Both sides are SHA-256 digested before
  `timingSafeEqual`, because that function throws on length mismatch and would
  otherwise leak the key's length.
- **Liveness is attested, not asserted.** A stored `online: true` or a matching
  version string is never sufficient — a Windows bridge process once spoofed
  exactly that in production. What `strictS24Liveness` requires depends on the
  evidence mode, decided once in `S24_EVIDENCE_REQUIREMENTS`
  (`Backend/lib/s24-attestation.js`):
  - **`signed-broker-v2`**: the broker's own stamp of a heartbeat it verified
    (device signature, active unexpired key, enrolled hardware), an
    AndroidKeyStore key, and the Android runtime evidence. A command ACK is
    **not** required — commands run hours apart — and is reported separately as
    `commandExecutionRecentlyProven`.
  - **Legacy direct-cloud** (no server stamp): all of the runtime evidence plus a
    fresh *completed* command ACK that matches its queue entry.

  Only the S24's own enrolled key may write the S24 evidence fields
  (`S24_ONLY_TELEMETRY` in `Backend/device-heartbeat.js`). The dashboard, the
  droplet and both Python mirrors take the policy from that module, and
  `_shared/tests/s24-attestation.test.mjs` runs them against each other. New
  device-status logic must fail closed the same way.
- **Secrets never enter the repo, the deploy script, or an agent transcript.**
  On the droplet, `ANTHROPIC_AUTH_TOKEN` is piped over **stdin**
  (`printf '%s' "$TOKEN" | python3 /opt/jp-agent/sync-auth-token.py`), never
  passed as an argument, so it never lands in shell history. When Claude audits
  env vars or credentials, it masks every value to the last 4 characters — and
  note that in this Vercel team some secrets are embedded in env var *names*, so
  names need masking too.
- Two separate credentials by design: the dashboard key and `JP_AGENT_TOKEN`.
  Compromising one must not hand over the other.

## Do not touch

- **`Devices/Lenovo/`, `Devices/S24/`, `Devices/Vivobook/`, `Devices/sandbox/`**
  are SHA-256-pinned installer bundles. Each installer verifies its own
  bundled files by hash, so the bundles must stay whole and byte-identical.
  `RESTRUCTURE_STATE.json` records 31 duplicate groups / 46 redundant files
  (~480 KiB reclaimable) — **most are these intentional per-device copies. Do
  not deduplicate them.**
- **`archive/`** is cold storage for regenerable artifacts with zero inbound
  references. Don't import from it, don't reorganize it.
- **Pinned roots** must stay at the repo root or tooling silently stops finding
  them: `.github/`, `.gitignore`, `.vercelignore`, `package.json`,
  `package-lock.json`, `vercel.json`.
- Vendored editor/i18n/grammar files under `Frontend/` and `Backend/` (see above).

## Style notes

- **ESM everywhere** in JS (`"type": "module"`); `.mjs` for scripts and tests,
  `.js` for serverless handlers.
- **Comments explain *why*, at length.** Files routinely open with a paragraph
  naming the bug, incident, or constraint that shaped them (`Backend/_auth.js`,
  `_shared/tests/run-all.mjs`, `.vercelignore`, `ci-cd.yml`). Match this — when
  you fix something non-obvious, record the reason, not a narration of the code.
- Frontend JS is ES5-flavoured vanilla (`var`, `function`, string-concatenated
  HTML with an `esc()` helper). Keep it that way; there is no bundler.
- Serverless handlers are exported per `vercel.json` `builds` entries and mapped
  by `routes`; `/api/<name>` falls through to `Backend/<name>.js` unless a
  specific route overrides it.
- Cron schedules live in `vercel.json` `crons`: `db-push` daily 18:30 UTC,
  `check-stale` every 10 min, `s24-sync-cron` every 6 h at :17.

## Reference docs

- [`QWEN.md`](./QWEN.md) — Qwen's parallel context file (kept as Qwen wrote it)
- [`README.md`](./README.md) — human-facing overview (slightly stale on `npm test`)
- [`INTEGRATION.md`](./INTEGRATION.md) — the restructure, file by file
- [`Server/jp-agent/README.md`](./Server/jp-agent/README.md) — droplet runtime, deploy, secrets
- [`Devices/S24/DAEMON_ARCHITECTURE.md`](./Devices/S24/DAEMON_ARCHITECTURE.md) — the phone daemon
- `_shared/docs/` — setup guides (`GITHUB_ACTIONS_SETUP.md`, `ADD_FIREBASE_SECRET_TO_GITHUB.md`, …)

## License

Private and unlicensed (`UNLICENSED`). © Jayti Pargal.
