# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`jpbir` is not one application — it is five loosely-related projects sharing a single git root.
Identify which one you are in before changing anything:

| Area | Stack | Purpose |
|---|---|---|
| `personal_folder_agent/` + `tools/` + `runs/` | Python 3.8+ | Crawl personal folders → extract → chunk → fine-tune Qwen 2.5-3B → retrieve |
| `jayti-dashboard/` | Node ESM, Vercel functions | Live telemetry + device dashboard (`jaytipargal.tech`, `agent.jaytipargal.tech`) |
| `jaytibirthday-site/` | Static + Vercel functions | The `jaytibirthday.in` letter site — **a git submodule**, own remote and CI |
| `channel-sandbox/` | Python 3.12, Flask, Firestore REST | Emulator-first device-to-dashboard channel verification scaffold |
| root `server.js` + `routes/` + `utils/` + `public/` | Express + SQLite | Legacy self-hosted mirror of the analytics API; superseded by the Vercel functions |

Root-level `*.py` (`domain_letter_agent.py`, `enhanced_domain_agent.py`, `permanent_deployment.py`),
`permanent_agent/`, `email_notifications/`, `integration/`, `jaytibirthday_analytics_deployment/`,
and the many `*_GUIDE.txt` / `*_INSTRUCTIONS.txt` files are earlier one-shot deployment
experiments. Treat them as historical unless a task names them.

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
cd jayti-dashboard
node test/stale.test.mjs      # the only automated test here; plain node:assert, 8 cases
npx vercel@latest --prod --yes   # manual production deploy
```

### Legacy Express server

```powershell
npm start        # port 3001, serves public/ and mirrors /api/track
npm run dev      # nodemon
# `npm test` is a stub that exits 1 — the real JS tests are the ad-hoc scripts in test/
```

### Deployment

Two GitHub Actions workflows, both `on: push` to `main`:

- `.github/workflows/vercel-deploy.yml` — deploys `jayti-dashboard/`, then aliases the
  deployment to `jaytipargal.tech` and `agent.jaytipargal.tech`. The alias step depends on
  `DEPLOY_URL` scraped out of the CLI output, so changes to the deploy step's output handling
  break aliasing silently.
- `jaytibirthday-site/.github/workflows/vercel-deploy.yml` — lives in the submodule and fires
  on pushes to the **submodule's** repo, not this one.

All three Vercel projects live under the same org (`team_pbbZItTCyIkGsw6LeGrcWx0c`):
`jpbir`, `jayti-dashboard`, `jaytibirthday-site`. Verify a publish with `curl` plus a
cache-busting query string — Vercel's edge serves stale HITs otherwise.

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

### README.md is aspirational — do not trust it

`README.md` and `pyproject.toml`'s `[project.scripts]` entry point both reference
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

## Vercel function conventions (`jayti-dashboard/api/`, `jaytibirthday-site/api/`)

These are hand-rolled Node ESM handlers with no framework. Match the existing shape:

- **Env vars are read via split string literals**: `_env['STATS_' + 'KEY']`,
  `_env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON']`. Every handler does this consistently — keep it
  when adding one.
- **Auth is a per-file `timingSafeEqual` copy** comparing `?key=` or the `x-stats-key` header
  against `STATS_KEY`. Cron endpoints additionally accept `Authorization: Bearer <CRON_SECRET>`.
- **Only `lib/stale.js` is shared logic**, and it is shared precisely because it is pure and
  therefore unit-testable apart from the endpoint. `check-stale.js` inlines its SMTP recipient
  list rather than importing `email_notifications/email_config.js` — that file is CommonJS and
  outside the Vercel project root, so a cross-root import would not reliably bundle.
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

## The `jaytibirthday-site` submodule

`jaytibirthday-site/` is a git submodule (`https://github.com/jaytipargal/jaytibirthday-site.git`,
branch `main`) with its own working tree, remote, and CI. Commits must be made and pushed from
*inside* that directory; the parent repo only tracks the pointer, so `git status` in the root
shows the submodule as modified rather than showing file-level changes.

That directory is the deployment source of truth — not the stale clone at
`C:/Users/abcom/jaytibirthday_site_repo`.

### Standing constraint on this site

The site is a personal "healing letter" addressed to a former partner. Benign expressive
work on it is in scope. Features that target or surveil the named individual are not, and have
been declined repeatedly: auto-emailing her on page updates, per-visitor identification
reported back to the user, and name-SEO / JSON-LD / sitemap changes that make her findable.
Anonymous aggregate analytics is fine; per-visitor detail about a specific person is not.
The page carries `noindex` — a previous automated run added `sitemap.xml` and flipped
`robots.txt` to `Allow: /`, which contradicts it. Do not extend that without a fresh explicit ask.

## Repo-wide notes

- `.gitignore` excludes `runs/`, `*.jsonl`, `*.zip`, `data/*.db`, `.env*`, `.claude/`, and
  `_tmp_*.mjs`. A `.env.example` is the one env file that would be committed.
- Two `package.json` files with unrelated dependency sets: the root one (Express/SQLite,
  CommonJS) and `jayti-dashboard/` (AWS SDK + nodemailer + Vercel Blob, `"type": "module"`).
  Running `npm install` in the wrong directory installs the wrong tree.
- Files named `_tmp_*.mjs`, `_verify_task_*.py`, `check_*.mjs`, `audit_*.mjs`, `dump_*.mjs` are
  disposable investigation scripts, not part of any suite.
