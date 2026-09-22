# jpbir — Jayti Device Dashboard

Real-time device monitoring, telemetry, and remote command for the machines
behind **[jaytipargal.tech](https://jaytipargal.tech)**. A browser dashboard
shows each enrolled device's status and analytics; a signed command broker lets
the dashboard send work to those devices; and a persistent agent runtime does
longer-running jobs (shell, file edits, git, deploys) that a serverless function
can't.

The web app (static frontend + serverless API) is hosted on **Vercel**. The
agent runtime lives on a **DigitalOcean** droplet that Vercel proxies to.

## Architecture

The repository is organized into an eight-layer structure. For the full rationale
and a file-by-file account of how it was arranged, see
[`INTEGRATION.md`](./INTEGRATION.md) and the machine-readable
[`RESTRUCTURE_STATE.json`](./RESTRUCTURE_STATE.json).

| Layer | Path | What it holds |
|-------|------|----------------|
| Frontend | [`Frontend/`](./Frontend/) | Static dashboard pages, components, styles |
| Backend | [`Backend/`](./Backend/) | Vercel serverless functions — the API |
| Database | [`Database/`](./Database/) | Schemas, Firestore helpers, DB tooling |
| Server | [`Server/`](./Server/) | The `jp-agent` droplet runtime, deploy scripts, nginx/systemd config |
| Integrations | [`Integrations/`](./Integrations/) | Shared store clients (`postgres.js`, `wa-store.js`, `s24-store.js`) |
| _shared | [`_shared/`](./_shared/) | Project-wide config, docs, and tests |
| Devices | [`Devices/`](./Devices/) | Self-contained per-device installer bundles |
| archive | [`archive/`](./archive/) | Cold storage: superseded or regenerable files |

```
browser (dashboard) ──API──▶ Backend (Vercel serverless) ──▶ Firestore / DynamoDB / Blob
                                     │
                                     └── /api/agent-run ──▶ jp-agent runtime (DigitalOcean)
```

> Note: the restructure swept a number of **vendored files** into `Backend/`
> and `_shared/docs/` (a Vditor markdown-editor bundle, i18n `*.js` locale
> files, TypeScript language-service providers). These are not part of the live
> app. The authoritative API surface is exactly what
> [`vercel.json`](./vercel.json) builds and routes.

## Frontend

Static HTML served by Vercel from `Frontend/`.

| Route | Page | Purpose |
|-------|------|---------|
| `/` | `index.html` | Analytics dashboard |
| `/s24` | `s24.html` | Samsung S24 Ultra device view |
| `/vivobook` | `vivobook.html` | ASUS Vivobook device view |
| `/jteka` | `jteka.html` | JTEKA fleet status |
| `/agent` | `agent.html` | Ask the `jp-agent` runtime (via `/agent/query`) |
| `/db` | `db.html` | Data browser over the Postgres warehouse |
| `/viewer` | `viewer.html` | Chrome data browser (synced browser media/history) |

`template.html` is the page scaffold the others are built from and has no route.

## API

Serverless Node functions (ES modules) under `Backend/`, mapped to routes by
`vercel.json`. `/api/<name>` resolves to `Backend/<name>.js` unless a more
specific route overrides it. Highlights:

- **Device broker** (cryptographically authenticated via `Backend/broker.js`;
  devices enroll with P-256 keys and a hardware-fingerprint attestation):
  - `POST /api/device-enroll` — register a device
  - `POST /api/device-heartbeat` — liveness / status
  - `POST /api/device-commands-poll` — device pulls pending commands
  - `/api/device-command-claim[/:commandId]` — claim a command
  - `/api/device-command-complete[/:commandId]` — report a result
- **Dashboard data:** `jp-devices`, `jp-device`, `jp-stats`, `jp-track`,
  `jp-visitor`, `stats`, `visitor`, `vercel-analytics`, `check-stale`
- **Agent:** `/api/agent-run` — proxies a request to the `jp-agent` runtime
  (see below), authenticated with a separate token

## The jp-agent runtime

A Vercel function is short-lived with an ephemeral filesystem; an agent needs a
workspace that survives between requests and tasks that can run for minutes. So
the runtime lives on a DigitalOcean droplet, reachable only through nginx, and
Vercel's `/api/agent-run` proxies to it with its own `JP_AGENT_TOKEN`. The
browser never holds the droplet token. Full detail and deploy steps are in
[`Server/jp-agent/README.md`](./Server/jp-agent/README.md).

## Getting started

Requires **Node 24** (`engines` in `package.json`). There is no build step and
no dev dependencies: the Vercel CLI was dropped in #96 because nothing in the
repo shells out to it and its transitive tree was the entire `npm audit` report.

```bash
npm install
npm run dev      # scripts/dev-server.mjs — static Frontend/ on :3000, no API
```

`npm run dev` serves only the static pages. The `Backend/*.js` handlers need
Vercel's runtime and are exercised in preview and production deploys, which
come from Vercel's Git integration — every push gets a preview, `main` goes to
production.

| Script | Command | What it does |
|--------|---------|--------------|
| `npm run dev` | `node scripts/dev-server.mjs` | Serve `Frontend/` locally on port 3000 |
| `npm run build` | — | No-op; frontend is served statically |
| `npm test` | `node _shared/tests/run-all.mjs` | Run every `*.test.mjs` suite, each in its own child process |
| `npm run db:migrate` | `node Database/scripts/migrate.mjs` | Apply Postgres schema migrations |
| `npm run wa:build` | `node Database/scripts/wa-build-inventory.mjs` | Build the WhatsApp inventory |
| `npm run wa:import` | `node Database/scripts/wa-import.mjs` | Import it |

Tests live in [`_shared/tests/`](./_shared/tests/), not beside the code they cover,
and are plain ESM scripts rather than `node:test` files — `node --test` will not
drive them. Drop a `<name>.test.mjs` in that directory to add a suite; no
registration is needed. There is no root `lint` script: CI runs
`npm run lint --if-present`, which silently no-ops.

The Python suite for the device sandbox is separate and is not run by `npm test`:

```bash
cd Devices/sandbox && python -m pytest tests/ -q
```

`Devices/sandbox/.python-version` pins the interpreter, and CI reads that same
file, so the suite runs on the version channel-sandbox actually deploys.

### Configuration

Runtime configuration comes from environment variables (set in the Vercel
project and, for the agent, in `/etc/jp-agent.env` on the droplet). Common
variables include:

- `FIREBASE_SERVICE_ACCOUNT_JSON` — service-account JSON for Firestore access
- `FIRESTORE_DB` — Firestore database id (defaults to `eka-agent`)
- `JP_AGENT_TOKEN` — bearer token for the `/api/agent-run` proxy

The authoritative inventory of what is actually set on each Vercel project —
name, type, which environments, and whether Vercel flags it as a readable secret
— is [`_shared/config/vercel-env.manifest.json`](./_shared/config/vercel-env.manifest.json).
It holds **no secret values**: `type: encrypted` variables are still readable in
plaintext by anyone with project access, so copying one here would commit a
credential. Only a small allowlist of non-credential identifiers carries a
`sha256_12` fingerprint, which is enough to detect a BOM, a truncation or a
re-save without disclosing anything.

Regenerate it after changing any environment variable. The script shells out to
the Vercel CLI, which is no longer a dev dependency, so install it globally and
log in first (`npm i -g vercel && vercel login`):

```bash
node _shared/tools/generate-env-manifest.mjs
```

`_shared/tests/env-manifest.test.mjs` then checks it offline — no network, no
credentials — and fails if a secret shape reaches the file, if a variable name
embeds a token, or if the set of variables nothing reads changes without being
explained.

See `_shared/docs/` (for example `ADD_FIREBASE_SECRET_TO_GITHUB.md`,
`GITHUB_ACTIONS_SETUP.md`) and `Server/jp-agent/README.md` for setup
instructions.

## CI

Five GitHub Actions workflows run from [`.github/workflows/`](./.github/workflows/):

- **CI/CD Pipeline** (`ci-cd.yml`) — lint and test only; it does not deploy.
  Production deploys come from Vercel's Git integration.
- **Code Quality Checks** (`code-quality.yml`)
- **Endpoint Health Check** (`health-check.yml`) — every 15 minutes and on each
  deployment
- **Device Sandbox Tests** (`device-sandbox-tests.yml`) — the channel-sandbox
  pytest suite, including the check that every device kit bundles a
  byte-identical copy of the canonical agent, plus a dashboard-to-agent E2E
  run against an isolated Firestore emulator
- **Sync keys to Vercel** (`sync-keys-to-vercel.yml`) — dispatch-only; add-only
  across the keys the deployed code reads, then rebuilds production

A sixth file, `endform-e2e.yml`, sits at
`.github/workflows/.github/workflows/` — a doubled path, so GitHub never loads it
and no end-to-end coverage exists. It is unmodified vendor boilerplate and would
not run if moved: `project-name` is still the literal `your-vercel-project-name`,
it installs with **pnpm** while this repo uses npm and has no `pnpm-lock.yaml`,
and it pins a third-party action to the mutable `@main` ref while requesting
`id-token: write`. Fix or delete it deliberately; do not just relocate it.

## License

Private and unlicensed (`UNLICENSED`). © Jayti Pargal.
