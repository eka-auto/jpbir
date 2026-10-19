# Glossary — jpbir, Release R1 ("Stabilize and Harden")

**Status:** DRAFT — Step 1, Task 5 of the R1 Step 1 plan. Prepared 2026-10-19.

**Purpose.** One canonical name per concept per domain area (pinned skill
`project/audit/SKILL.md` §Engineering standards — "One name for each meaning").
These names are used in the database, API, code, UI text, and docs. Language casing
is not a second name: snake_case in SQL/Python and camelCase in JavaScript,
API, and Firestore are the same name in different spellings (§C). No synonyms,
import aliases, or unglossed abbreviations. One spelling convention everywhere:
US English. No secret values appear in this document.

## A. The owner's words → canonical names

| Owner's word | Canonical name(s) to use | Notes |
|---|---|---|
| device | **device** | One of the three fleet members: `samsung-s24-ultra`, `g4g-lenovo-laptop`, `jayti-asus-vivobook`. |
| runner | **device agent** (product side) / **self-hosted runner** (CI side) | "Runner" alone is not used in documents. Product side = the small always-running program on a device; CI side = the GitHub Actions runner on the droplet. "Eka Runner" is a separate project on the owner's machine, outside this product. |
| agent | **device agent** / **jp-agent** / **s24-mcp** | "Agent" alone is ambiguous — always use the specific name. `jp-agent` = the droplet's agent runtime; `s24-mcp` = the S24's tool server. |
| command | **command** | A remote instruction sent to a device; stored in the **command queue**. |
| telemetry | **telemetry** | The readings and status a device reports about itself. |
| WhatsApp ingestion | **WhatsApp ingestion** | The pipeline that stores incoming WhatsApp text (Postgres) and media bytes (Vercel Blob). |
| dashboard | **dashboard** | The static pages served at `jaytipargal.tech`. |
| droplet | **droplet** | The rented Linux server `runner.jaytipargal.tech` (DigitalOcean) hosting `jp-agent`. |
| S24 | **S24** | The Samsung Galaxy S24 Ultra; fleet device `samsung-s24-ultra`. |
| jp-agent | **jp-agent** | The agent runtime for the droplet (`Server/jp-agent/`). |
| s24-mcp | **s24-mcp** | The MCP server used with the S24. |

## B. Canonical terms

Every term used in the fact sheet (`project/plans/r1-facts.md`) and the BRD has an
entry here. Entries are grouped by domain area; within a group they stay
alphabetical.

**Product, hosting, and storage**

- **Vercel** — the hosting service that serves the website and runs its API functions.
- **Vercel Blob** — Vercel's file storage for large items such as photos, video, and voice notes; holds the WhatsApp media bytes.
- **Serverless API** — small functions that start on demand on the host's computers; no always-on machine for us to manage.
- **Handler** — a function that answers one kind of request; the Backend handlers are the pieces behind each `/api/...` address.
- **Endpoint** — one specific address the app answers, for example `/api/s24-public`.
- **Route** — a rule mapping an address like `/s24` to the page or function that answers it.
- **Catch-all route** — a fallback rule: any unmatched `/api/<name>` address is handled by `Backend/<name>.js`.
- **Cron** — a scheduler that runs a task on a fixed timetable.
- **Firestore** — Google's document database, used here for device state and the command queue.
- **Postgres** — the table-based relational database storing the analytics and message history.
- **Neon** — the hosted Postgres service this project uses.
- **DynamoDB** — Amazon's key–value database, which stores records looked up by ID; visible in code, absent from the target manifest (open question Q-BRD-1).
- **SQLite** — a small single-file database; the `data/*.db` files are local only.
- **Vector store** — a database for AI-style similarity search over documents (`Database/eka_vector_db.py`).
- **Broker** — the middleman service devices check in with, fetch work from, and report results to; enrollment is how a device first registers with it.
- **Telemetry** — the readings and status a device reports about itself.
- **Heartbeat** — the regular "I'm alive" message a device sends about itself.
- **Attestation** — cryptographically proving a claim, for example that a heartbeat really came from the device's own hardware.
- **P-256** — a standard cryptographic key format; the devices hold such keys sealed in their hardware.
- **Signature** — cryptographic proof that a message came from the claimed sender and was not altered on the way.
- **Ingest** — receiving and storing incoming data.
- **Schema** — the definition of a database's tables and columns.
- **Migration** — a recorded, repeatable change that updates a database's structure.
- **Collection / doc** — in Firestore, a collection is a folder-like group of records, and a doc is one record in it.
- **Database** — see **Postgres**, **Firestore**, **DynamoDB**, **SQLite** — each store is always called by its specific name.
- **Dashboard** — the static pages served at `jaytipargal.tech` (owner's word, made canonical here).
- **Command** — a remote instruction sent to a device through the existing mechanism; stored in the **command queue**.
- **Command queue** — the queued commands for a device: `commandQueue` in Firestore, mirrored for analytics as `s24_queue_items` in Postgres.
- **WhatsApp ingestion** — the pipeline that stores incoming WhatsApp message text in Postgres and media bytes in Vercel Blob.

**Devices and fleet**

- **S24** — shorthand for the Samsung Galaxy S24 Ultra phone, one of the three devices.
- **Device** — one of the three fleet members (`samsung-s24-ultra`, `g4g-lenovo-laptop`, `jayti-asus-vivobook`).
- **Device agent** — a small always-running program on a device that sends telemetry and picks up commands (owner's word "runner", product side).
- **jp-agent** — the agent runtime for the DigitalOcean droplet (`Server/jp-agent/`).
- **s24-mcp** — the MCP (Model Context Protocol) server used with the S24.
- **Daemon** — a small program that runs continuously in the background on a device or server.
- **Poll** — to check for new work on a schedule rather than being notified instantly.
- **Dispatch-only** — a workflow that never runs on its own; a person must trigger it.
- **Droplet** — DigitalOcean's name for a rented Linux server.
- **Emulator** — a local fake of a live service, used only in tests.
- **VPS** — virtual private server: a rented full Linux machine (the Jayti Hub runs on one).
- **CLI** — command-line interface: running tools by typing commands instead of clicking.
- **Webview** — an HTML page shown inside another program; here, the VS Code extension's document viewer.

**Engineering and CI**

- **API** — how two programs talk to each other over the web; this product's API is the set of `/api/...` addresses the dashboard and the devices call.
- **CI (continuous integration)** — the automated checks and builds GitHub runs every time code changes.
- **ESM** — ES modules, the modern JavaScript module format used throughout this repository.
- **Lint** — automated code-style checking.
- **Build** — the step that turns source files into what gets served; this project needs almost none (pages are served as written).
- **Node** — the JavaScript runtime that executes this project's server code (version 24 here).
- **node_modules** — the folder of downloaded third-party libraries a JavaScript project installs; regenerable, never hand-edited.
- **Playwright** — a tool that drives a real browser for end-to-end tests.
- **TypeScript** — JavaScript with added type checking; it must be compiled before browsers can run it (present here only in vendored code).
- **Vanilla JS** — plain JavaScript with no frameworks or libraries.
- **React** — a framework for building user interfaces; the vendored viewer code is written with it.
- **CodeMirror / Vditor** — two open-source text-editor components the vendored viewer code is built on.
- **i18n** — internationalization: the translation files that let software display many languages.
- **JSON** — a plain-text data format both people and programs can read; the config and backup files here use it.
- **GraphQL** — an alternative API query language; the GraphQL files here are schema leftovers.
- **Prisma** — a database toolkit; the "Prisma-demo" tables are its generated demo shapes.
- **MCP (Model Context Protocol)** — a standard protocol that lets AI assistants use external tools; this project has two MCP servers.
- **SDK** — software development kit: a prebuilt library for talking to a service.
- **Systemd** — the Linux service manager; its "units" are start-up definitions.
- **nginx** — a web server that receives requests and forwards them to the right service.
- **Git / GitHub** — Git records the project's history; GitHub hosts the repository online.
- **Git bundle** — a single-file archive of an entire repository, used here for backups.
- **GitHub App** — a connector that lets GitHub and another service (here Vercel) react to each other's events; it is what normally makes pushes deploy.
- **GitHub workflow** — an automation script GitHub runs on events such as pushes, schedules, or a manual trigger.
- **Self-hosted runner** — a machine we own and register with GitHub that executes workflow steps, instead of GitHub's rented machines.
- **Fixture** — a sample file or value made for tests, never a real credential.
- **p95** — the 95th-percentile response time: 95% of requests arrive faster than this.
- **.pyc** — a compiled Python cache file; debris, regenerable.
- **Vendored** — third-party code copied wholesale into the repository rather than installed as a dependency.
- **Corpus** — a collected body of data samples; here, the exported data chunks under `runs/`.
- **Backfill** — copying older data from one store into another to fill missing history.
- **Hash / fingerprint / SHA-256** — a fixed-length digital fingerprint of a file or value; matching hashes prove two files are identical.
- **Service account (SA)** — an identity issued for automated, non-human access, for example to Google Cloud.
- **Env var (environment variable)** — a configuration value the running code reads, set outside the code itself.
- **Cold storage** — archived files kept but unused; here, the `archive/` folder.
- **Commit** — a recorded snapshot of changes in Git history.
- **Tracked / untracked** — tracked files are managed by Git and ship with the repository; untracked files exist only on this machine.
- **Tracker (tracker.py)** — the audit and status tool from the pinned pipeline skill; it records task state from event files.
- **Runtime** — the environment code runs in; also used for the long-running program itself (the droplet's agent runtime).

**Pipeline and governance**

- **BRD / TRD** — the Business Requirements Document and Technical Requirements Document for this release.
- **Branch protection** — rules that stop unprotected changes from landing on the main branch.
- **Repository ruleset** — a GitHub-enforced rule applied to a branch (here: no deletions, no history rewrites).
- **Non-fast-forward protection** — blocks pushes that would rewrite or erase existing commit history.
- **CODEOWNERS** — a repository file naming the reviewers who must approve changes to specific paths.
- **Parity check** — comparing live production behavior with what the repository expects.
- **RPO / RTO** — recovery point objective (the most data loss allowed) and recovery time objective (the most downtime allowed); both 24 hours here.

## C. Language casing mapping (casing is not an alias)

| Concept | snake_case (SQL / Python tooling) | camelCase (JavaScript / API / Firestore) | Notes |
|---|---|---|---|
| command queue | `s24_queue_items` (Postgres table; columns `created_at`, `last_seen`) | `commandQueue` (Firestore map on the device doc; `commandId` keys; fields `status`, `deadLetterAt`) | One concept, two storage shapes. Casing follows the language; the name does not change. |
| device key | — | `deviceKeys` collection, `keyId` | Firestore-only; the broker reads `/deviceKeys/<keyId>`. |
| WhatsApp message store | `wa_messages` (Postgres) | — | Postgres-only; media bytes live in Vercel Blob (`blob_url` column). |
| device record | `s24_records` (Postgres analytics) | `devices` (Firestore doc per device) | Live device state is Firestore; analytics copies land in Postgres. |
| sync run | `s24_sync_runs`, `warehouse_sync_state` (Postgres) | — | Postgres-only bookkeeping. |

Rule: identifiers in new code use the canonical name with the language's casing
convention. A concept never gets two different words (for example, never "job" for
"command"). Evidence for the table: `Backend/broker-command-claim.js` (`commandId`,
`commandQueue`), `Backend/check-stale.js` and `Backend/db-api.js`
(`s24_queue_items`), `Backend/device-enroll.js` (`deviceKeys`).
