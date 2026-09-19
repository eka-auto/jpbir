# CLAUDE.md — jpbir

Operating context for **Claude Code** (and any AI agent) working in this
repository. Read this before editing. This is Claude's own working file; a
parallel `QWEN.md` written by Qwen covers the same project from its own
perspective — this file is the one Claude follows.

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
| Backend | `Backend/` | Vercel serverless functions — the API | 166 |
| Database | `Database/` | Schemas, migrations, Firestore/vector tooling | 23 |
| Server | `Server/` | `jp-agent` droplet runtime, deploy scripts, nginx/systemd | 61 |
| Integrations | `Integrations/` | Shared store clients (`postgres.js`, `wa-store.js`, `s24-store.js`) | 7 |
| _shared | `_shared/` | Project-wide config, docs, and **all tests** | 137 |
| Devices | `Devices/` | Self-contained per-device installer bundles | 67 |
| archive | `archive/` | Cold storage: superseded or regenerable artifacts | 57 |

~2520 tracked files total (counts as of `main@87ba028`, 2026-09-19).

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
npm run dev      # vercel dev — local frontend + serverless functions
npm test         # _shared/tests/run-all.mjs — 21 suites, all must pass
```

| Script | Command | Notes |
|--------|---------|-------|
| `npm run dev` | `vercel dev` | Requires the Vercel CLI (pinned devDependency) |
| `npm test` | `node _shared/tests/run-all.mjs` | Runs every `*.test.mjs` in its own child process |
| `npm run build` | `echo '...'` | **No-op.** Frontend is served statically; there is nothing to compile |
| `npm run deploy` | `vercel --prod` | Manual CLI deploy — see the deployment warning below |
| `npm run db:migrate` | `node Database/scripts/migrate.mjs` | Postgres schema migrations |
| `npm run wa:build` / `wa:import` | `node Database/scripts/wa-*.mjs` | WhatsApp inventory build / import |

**There is no `lint` script at the root.** CI runs `npm run lint --if-present`,
which silently no-ops. An `_shared/eslint.config.mjs` exists but is not wired
to the root package. Don't claim lint passed — it never ran.

> `README.md` states "`npm test` is not yet wired up." That is stale: it is
> wired and passing. Trust `package.json` over the README.

## Testing conventions

Tests live in **`_shared/tests/`**, not beside the code they cover. They are
**plain ESM scripts**, not `node:test` files — `node --test` will not drive
them. `run-all.mjs` discovers `*.test.mjs` alphabetically, spawns each in a
child process, and treats any non-zero exit (including a signal kill) as a
failure.

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
- **Liveness is attested, not asserted.** `strictS24Liveness` requires multiple
  independent writer-honest signals (Android runtime, authenticated heartbeat,
  fresh command ACK). A stored `online: true` or a matching version string is
  not sufficient — a Windows bridge process once spoofed exactly that in
  production. New device-status logic must fail closed the same way.
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
