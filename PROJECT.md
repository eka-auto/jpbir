# jpbir

Multi-project monorepo for a private AI agent system — personal folder training pipeline,
live device dashboard, and per-device sandbox deploy kits.

## Structure

```
jpbir/
├── personal_folder_agent/     Python agent: crawl → extract → chunk → fine-tune Qwen 2.5-3B → retrieve
├── tools/                      Corpus builders, merge/de-dup, secret scanners
├── runs/                       (gitignored) multi-GB training artifacts
│
├── Dashboard/                  Live telemetry + device dashboard
│   ├── Current/                Node ESM Vercel functions → jaytipargal.tech
│   │   ├── frontend/           index.html, jp-tracker.js
│   │   ├── backend/            api/ (18 serverless functions), lib/ (broker, stale)
│   │   ├── others/             test/ (stale, broker, connect)
│   │   └── vercel.json, package.json (root-level for Vercel)
│   ├── S24/                    S24 dashboard context (frontend/, backend/, others/)
│   └── Vivobook/               VivoBook dashboard context (frontend/, backend/, others/)
│
├── Sandbox/                    Device-to-dashboard channel verification + deploy kits
│   ├── Configuration/          Shared broker client, signer, Flask API, tests
│   ├── S24/                    S24 deploy kit (agent, installer, SSH setup)
│   ├── Vivobook/               VivoBook deploy kit (agent, installer, SSH setup)
│   └── Lenovo/                 Lenovo deploy kit (agent, installer)
│
├── eka-runner/                 Submodule: S24 Termux daemon (public)
├── eka-runner-private/         Submodule: S24 daemon snapshot (private)
├── ccl_chromium_reader/        Submodule: Python Chrome data reader library
│
├── pipeline.ps1                Local CI test runner
├── train_both_agents_colab.ipynb  Colab training notebook
├── CLAUDE.md                   Agent guidance
├── S24_DAEMON_ARCHITECTURE.md  S24 daemon architecture doc
├── pyproject.toml              Python project metadata
└── requirements.txt            Python dependencies
```

## Projects

### 1. Personal Folder Agent (`personal_folder_agent/`)

Crawls personal folders, extracts text, chunks it, and fine-tunes Qwen 2.5-3B for
retrieval-augmented query answering. Training runs on Colab GPU; local machine handles
crawl/chunk/verify only.

```
FolderCrawler → TextProcessor → TextChunker → chunks.jsonl → TrainingPipeline (Colab)
                                                            ↓
                              QueryRouter → RetrievalStrategies → DynamicRetriever
```

### 2. Dashboard (`Dashboard/`)

Live Vercel-hosted telemetry and device dashboard at `jaytipargal.tech`.
Node ESM hand-rolled handlers, raw Firestore REST API, DynamoDB for web telemetry.

- `Current/` — active deployment source (frontend/, backend/, others/)
- `S24/` — S24 device dashboard context (frontend/, backend/, others/)
- `Vivobook/` — VivoBook device dashboard context (frontend/, backend/, others/)

### 3. Sandbox (`Sandbox/`)

Device-to-dashboard channel verification scaffold. Python 3.12 + Flask + Firestore REST.
Per-device deploy kits with broker client, ECDSA P-256 signer, and hardware-guarded installers.

- `Configuration/` — shared code (broker_client, signer, dashboard_api, firestore_client, tests)
- `S24/` — Samsung S24 Ultra deploy kit + SSH mesh setup
- `Vivobook/` — ASUS VivoBook deploy kit + SSH mesh setup
- `Lenovo/` — Lenovo laptop deploy kit

### 4. Submodules

- `eka-runner/` — S24 Termux direct-cloud daemon (public)
- `eka-runner-private/` — S24 daemon snapshot (private, no history)
- `ccl_chromium_reader/` — Python Chrome data reader library

## Testing

```powershell
# Python agent (149 tests)
& .\venv\Scripts\python.exe -m pytest -q --no-cov

# Sandbox (39 tests)
& .\venv\Scripts\python.exe -m pytest Sandbox/Configuration/tests -q -o addopts=""

# Dashboard (32 tests)
cd Dashboard/Current
node others/test/stale.test.mjs
node others/test/broker.test.mjs
node others/test/connect.test.mjs

# All (local CI mirror)
.\pipeline.ps1
```

## CI/CD

- `.github/workflows/ci-deploy.yml` — runs Python + Node tests on every push to `main`
- Vercel git integration handles deployment (single pipeline)
- Vercel projects: `channel-sandbox` (root: `Sandbox/Configuration/`), `jayti-dashboard` (root: `Dashboard/Current/`)

## Data Stores

- **DynamoDB** `jaytipargal_telemetry` (us-west-2) — web telemetry
- **Firestore** `eka-agent` — device heartbeats, queued commands (`devices/` docs)