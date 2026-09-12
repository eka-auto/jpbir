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

The repository is organized into a five-layer structure. For the full rationale
and a file-by-file account of how it was arranged, see
[`INTEGRATION.md`](./INTEGRATION.md) and the machine-readable
[`RESTRUCTURE_STATE.json`](./RESTRUCTURE_STATE.json).

| Layer | Path | What it holds |
|-------|------|----------------|
| Frontend | [`Frontend/`](./Frontend/) | Static dashboard pages, components, styles |
| Backend | [`Backend/`](./Backend/) | Vercel serverless functions — the API |
| Database | [`Database/`](./Database/) | Schemas, Firestore helpers, DB tooling |
| Server | [`Server/`](./Server/) | The `jp-agent` droplet runtime, deploy scripts, nginx/systemd config |
| Integrations | [`Integrations/`](./Integrations/) | Third-party clients (Firebase, telemetry) |
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

Requires **Node ≥ 18** and the [Vercel CLI](https://vercel.com/docs/cli) (pinned
as a dev dependency).

```bash
npm install
npm run dev      # vercel dev — local frontend + serverless functions
```

| Script | Command | What it does |
|--------|---------|--------------|
| `npm run dev` | `vercel dev` | Run the app locally |
| `npm run build` | — | No-op; frontend is served statically |
| `npm run deploy` | `vercel --prod` | Deploy to production |

> `npm test` is not yet wired up. Test files live under
> [`_shared/tests/`](./_shared/tests/).

### Configuration

Runtime configuration comes from environment variables (set in the Vercel
project and, for the agent, in `/etc/jp-agent.env` on the droplet). Confirmed
variables include:

- `FIREBASE_SERVICE_ACCOUNT_JSON` — service-account JSON for Firestore access
- `FIRESTORE_DB` — Firestore database id (defaults to `eka-agent`)
- `JP_AGENT_TOKEN` — bearer token for the `/api/agent-run` proxy

See `_shared/docs/` (for example `ADD_FIREBASE_SECRET_TO_GITHUB.md`,
`GITHUB_ACTIONS_SETUP.md`) and `Server/jp-agent/README.md` for the full set and
setup instructions.

## CI

Three GitHub Actions workflows run from [`.github/workflows/`](./.github/workflows/):

- **CI/CD Pipeline** (`ci-cd.yml`)
- **Code Quality Checks** (`code-quality.yml`)
- **Endpoint Health Check** (`health-check.yml`)

## License

Private and unlicensed (`UNLICENSED`). © Jayti Pargal.
