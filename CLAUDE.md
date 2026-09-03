# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`jpbir` is not one application — it is several loosely-related projects sharing a single git root.
Identify which one you are in before changing anything:

| Area | Stack | Purpose |
|---|---|---|
| `personal_folder_agent/` + `tools/` + `runs/` | Python 3.8+ | Crawl personal folders → extract → chunk → fine-tune Qwen 2.5-3B → retrieve |
| `Dashboard/Current/` | Node ESM, Vercel functions | Live telemetry + device dashboard (`jaytipargal.tech`, `agent.jaytipargal.tech`) — `frontend/` (UI), `backend/` (api, lib), `others/` (tests) |
| `Dashboard/S24/`, `Dashboard/Vivobook/` | Markdown | Per-device dashboard context (S24, VivoBook) — each has `frontend/`, `backend/`, `others/` subfolders |
| `Sandbox/Configuration/` | Python 3.12, Flask, Firestore REST | Device-to-dashboard channel verification scaffold + shared broker/signer code |
| `Sandbox/S24/`, `Sandbox/Vivobook/`, `Sandbox/Lenovo/` | Python + shell | Per-device deploy kits (agent, broker client, installer, signer) |
| `eka-runner/`, `eka-runner-private/` | Submodules | S24 Termux direct-cloud daemon (public + private) |
| `ccl_chromium_reader/` | Submodule | Python Chrome data reader library |
| root `vercel.json` | Vercel Python | (removed — `channel-sandbox` project uses `Sandbox/Configuration/vercel.json` directly) |

Earlier one-shot deployment experiments and their `*_GUIDE.txt` / `*_INSTRUCTIONS.txt` files
have been removed. The remaining root-level files are active infra.

## Commands

### Python agent

```powershell
# The working interpreter is venv/, NOT .venv/ (.venv exists but is not the one in use).
& .\venv\Scripts\python.exe -m pytest -q --no-cov          # full suite: 149 tests, all pass
& .\venv\Scripts\python.exe -m pytest -q --no-cov personal_folder_agent/tests/test_text_chunker.py
& .\venv\Scripts\python.exe -m pytest -q --no-cov -k "chunk_io and truncated"
& .\venv\Scripts\python.exe -m pytest --cov=personal_folder_agent --cov-report=term-missing
```

**`pytest` with no flags exits 1 even when every test passes.** `pyproject.toml` sets
`addopts = "--cov ... "` and `fail_under = 80`; actual coverage is ~69%. Always pass `--no-cov`
when you care about pass/fail, and never report "tests failing" from a bare `pytest` exit code
without reading the summary line.

`testpaths` also lists a root `tests/` directory that does not exist — harmless, but do not
create test files there expecting them to be the convention; tests live in
`personal_folder_agent/tests/`.

### Dashboard

```powershell
cd Dashboard/Current
node others/test/stale.test.mjs      # 8 cases — stale detection
node others/test/broker.test.mjs     # 12 cases — broker v2 contract
node others/test/connect.test.mjs    # 12 cases — Vercel Connect
npx vercel@latest --prod --yes       # manual production deploy
```

### Deployment

Two GitHub Actions workflows, both `on: push` to `main`:

- `.github/workflows/ci-deploy.yml` — runs tests (Python + Node) on every push/PR to `main`.
  Deployment is handled by Vercel's git integration (single pipeline).

Vercel projects under org `team_pbbZItTCyIkGsw6LeGrcWx0c`:
`channel-sandbox` (root: `Sandbox/Configuration/`), `jayti-dashboard` (root: `Dashboard/Current/`).
Verify a publish with `curl` plus a cache-busting query string — Vercel's edge serves stale HITs otherwise.

## The Python agent pipeline

Stages are deliberately decoupled by an on-disk artifact rather than in-process calls:

```
FolderCrawler → ConcreteTextProcessor → TextChunkerImpl → chunks.jsonl → TrainingPipeline
                                                              ↓
                              QueryRouter → RetrievalStrategies → DynamicRetriever
```

**Training never runs on this machine.** The laptop has no NVIDIA GPU and no torch installed.
`chunks.jsonl` (`personal_folder_agent/utils/chunk_io.py`) is the explicit hand-off to a Colab
GPU session. Two consequences that constrain how you write code here:

- **Keep `torch` / `transformers` / `datasets` imports inside the functions that use them**
  (see `training_pipeline.py:228, 272, 363`). Module-level heavy imports would make the whole
  package unimportable and untestable locally.
- `load_chunks_jsonl` *refuses* a truncated file and reports the line number rather than
  returning a short dataset. Preserve that behaviour — a killed Colab session producing a
  quietly shortened corpus is the failure this guards against.

`.kiro/specs/personal-folder-trained-agent/{requirements,design,tasks}.md` is the spec-driven
roadmap; `tasks.md` carries the live checkbox state for what is built.

### `pyproject.toml` is aspirational in places

`pyproject.toml`'s `[project.scripts]` entry point references
`personal_folder_agent/cli.py`, plus `inference_engine.py`, `progress_monitor.py`,
`utils/security.py` and `utils/errors.py`. **None of those files exist.** There is no working
`personal-folder-agent` console script. The query path that does exist is `tools/ask.py`
over the `query_router` / `retrieval_strategies` / `dynamic_retriever` trio.

### `tools/` and `runs/` — the corpus pipeline

`tools/` is a hard-won set of corpus builders and safety checks, each with a docstring
explaining the incident that motivated it. Read the docstring before using one.

- `build_*_chunks.py` produce per-source JSONL parts; `merge_chunks.py` de-dupes them by
  `chunk_id` (`<source_file>:<chunk_index>`, first occurrence wins).
- `verify_corpus.py` checks the file on disk against the merge report — run it after **every**
  merge, before training or scanning. A past double-merge produced a file with valid JSON at
  both ends and 3.12 GiB of NUL in the middle while the report claimed success.
- `scan_secrets.py` audits a finished corpus for credentials and reports counts and source
  paths only, never matched values. `redact_secrets.py` substitutes typed placeholders
  (`[REDACTED-OPENAI_KEY]`) instead of dropping chunks, because the richest personal material
  is assistant session logs that occasionally echo a key.

`runs/` is gitignored and holds multi-gigabyte artifacts (`runs/jt_agent/chunks.jsonl` is
~7.5 GB). Never read, cat, or grep these whole; sample with `head`-equivalents or use the
tools above.

## Vercel function conventions (`Dashboard/Current/backend/api/`, `jaytibirthday-site/api/`)

These are hand-rolled Node ESM handlers with no framework. Match the existing shape:

- **Env vars are read via split string literals**: `_env['STATS_' + 'KEY']`,
  `_env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON']`. Every handler does this consistently — keep it
  when adding one.
- **Auth is a per-file `timingSafeEqual` copy** comparing `?key=` or the `x-stats-key` header
  against `STATS_KEY`. Cron endpoints additionally accept `Authorization: Bearer <CRON_SECRET>`.
- **Only `lib/stale.js` is shared logic**, and it is shared precisely because it is pure and
  therefore unit-testable apart from the endpoint. `check-stale.js` inlines its SMTP recipient
  list rather than importing from outside the Vercel project root.
- **Firestore is accessed over the raw REST API**, not the SDK: a self-signed service-account
  JWT exchanged for a token (cached in module scope), plus hand-written `enc()`/`dec()` value
  codecs. `getFirestoreToken`, `enc`, and `dec` are duplicated across handlers by design.
- **New endpoints need a `rewrites` entry in that project's `vercel.json`**, matching the
  existing `/api/x → /api/x.js` pattern.

Data stores in play: DynamoDB `jaytipargal_telemetry` (us-west-2) for web telemetry,
Firestore database `eka-agent` (`devices/` docs carry `lastSeen`, `staleAlert`, `commandQueue`)
for device heartbeats and queued commands, and Vercel Blob for the older
`jaytibirthday.in` visitor records read by `api/stats.js` and `api/visitor.js`.

`vercel.json` registers a cron hitting `/api/check-stale` every 5 minutes. That endpoint is
edge-triggered: it emails only on healthy↔alerted transitions, and it **sends the email before
persisting the new state** so a transient SMTP failure retries next tick instead of going silent.

## Repo-wide notes

- `.gitignore` excludes `runs/`, `*.jsonl`, `*.zip`, `data/*.db`, `.env*`, `.claude/`, and
  `_tmp_*.mjs`. A `.env.example` is the one env file that would be committed.
- The only `package.json` is `Dashboard/Current/` (AWS SDK + nodemailer + Vercel Blob,
  `"type": "module"`).
- Files named `_tmp_*.mjs`, `_verify_task_*.py`, `check_*.mjs`, `audit_*.mjs`, `dump_*.mjs` are
  disposable investigation scripts, not part of any suite.
