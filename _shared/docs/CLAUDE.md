# CLAUDE.md

Repository guidance for coding agents. See [PROJECT.md](PROJECT.md) for the current layout.

## Project locations

| Area | Purpose |
| --- | --- |
| `Dashboard/Current/` | Node ESM dashboard, Vercel `api/`, shared `lib/`, frontend, and tests |
| `Dashboard/S24/`, `Dashboard/Vivobook/` | Per-device dashboard context |
| `Sandbox/Configuration/` | Shared broker, Flask API, signer, and tests |
| `Sandbox/S24/`, `Sandbox/Vivobook/`, `Sandbox/Lenovo/` | Device deploy kits |
| `Sandbox/S24/daemon/` | Former root daemon variants; older versions are in `legacy/` |
| `tools/mcp/` | MCP servers and connection helpers |
| `tools/diagnostics/` | Device and queue inspection scripts |
| `tools/` | Corpus tooling and local test pipeline |
| `training/` | Colab notebook and training requirements |
| `eka-runner/`, `eka-runner-private/` | Device-agent submodules |

Keep new scripts inside their owning project. Root files are repository
configuration, this guidance, and `PROJECT.md`. Preserve distinct daemon variants;
`Sandbox/S24/install_daemon.sh` still uses its sibling `s24-agent-daemon.mjs`.

## Checks

From the repository root, run `.\tools\pipeline.ps1`. It uses the existing
`venv/Scripts/python.exe`, with `python` as fallback, and accepts `-PythonPath`.
Install the sandbox dependencies plus pytest, pytest-cov, pytest-mock,
hypothesis, and pyyaml, and run `npm ci` inside `Dashboard/Current` first.

The pipeline runs sandbox tests, all tracked JavaScript syntax checks, and the
three dashboard test files. Root `pyproject.toml` configures test discovery for
`Sandbox/Configuration/tests`; it does not enable a coverage threshold.

MCP connection helpers perform live device operations when executed. Use syntax
and import-path inspection when checking a file move; do not run these helpers
as tests.

## Deployment

`.github/workflows/ci-deploy.yml` validates pushes and pull requests to `main`.
`.github/workflows/verify-secrets.yml` is a manually dispatched diagnostic.
Vercel Git integration deploys `channel-sandbox` and `jpbir` from
`Sandbox/Configuration/`, and `jayti-dashboard` from `Dashboard/Current/`.

## Historical training pipeline

The following training notes describe the separately supplied
`personal_folder_agent` package. That package is no longer tracked in this
repository; the notebook retained under `training/` still depends on it.


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

## Vercel function conventions (`Dashboard/Current/api/`)

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

Data stores in play: Neon Postgres for web telemetry and dashboard analytics,
Firestore database `eka-agent` (`devices/` docs carry `lastSeen`, `staleAlert`, `commandQueue`)
for device heartbeats and queued commands, and Vercel Blob for media objects.

`vercel.json` registers a cron hitting `/api/check-stale` every 5 minutes. That endpoint is
edge-triggered: it emails only on healthy↔alerted transitions, and it **sends the email before
persisting the new state** so a transient SMTP failure retries next tick instead of going silent.

## Repo-wide notes

- `.gitignore` excludes `runs/`, `*.jsonl`, `*.zip`, `data/*.db`, `.env*`, `.claude/`, and
  `_tmp_*.mjs`. A `.env.example` is the one env file that would be committed.
- `Dashboard/Current/package.json` declares dashboard dependencies.
  `Sandbox/S24/daemon/package.json` sets the daemon module format.
- Files named `_tmp_*.mjs`, `_verify_task_*.py`, `check_*.mjs`, `audit_*.mjs`, `dump_*.mjs` are
  disposable investigation scripts, not part of any suite.
