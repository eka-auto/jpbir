# Inspection 2026-09-19 — verified findings, UI/UX reference, removal tiers, goal tracker

Seven read-only inspectors ran across Backend, Frontend, Database, Server, Devices,
Integrations/_shared and Deploy/CI. **Every load-bearing claim below was re-verified
against live state or the actual bytes before being recorded here.** Two headline findings
were refuted by verification, and one was confirmed and is the most actionable item in the
repo. Nothing was deleted, moved or deployed by this inspection.

Convention: **PROVEN** = I ran the check myself. **REPORTED** = an inspector claimed it and
I did not independently reproduce it. Treat REPORTED as a lead, not a fact.

---

## 1. Proven findings, ordered by consequence

### 1.1 Both Windows device installers can never complete — PROVEN

`Devices/Vivobook/install_vivobook.ps1:22` pins `single_instance.py` to
`334F103E2D7175A340D65E95011D59531E1940E5` — **40 hex characters**. The installer compares it
against `(Get-FileHash -Algorithm SHA256).Hash`, which is **64** characters, so the comparison
can never succeed for any file content. The value is a **git blob SHA-1**, not a file hash:

```
$ git hash-object Devices/Vivobook/single_instance.py
334f103e2d7175a340d65e95011d59531e1940e5     ← identical to the pinned "Hash"
```

`Devices/Lenovo/install_lenovo.ps1:22` pins `1A572F39DC96599E8DF55DEBE9CCD9BD8232CFFECAC08BBC898FF5FFF4F9EF46`
— a well-formed SHA-256, but of an **older generation**. The current file in both kits hashes to
`287fe1c114488e84…`. The other four pins in each installer (`device_agent.py` `BE75C4D8…`,
`broker_client.py` `E380867C…`, `signer.py` `8AABF8E5…`, `requirements-broker.txt` `37B13C7D…`)
**do** match the actual bytes. So exactly one pin per Windows installer is wrong.

Both installers `throw` on mismatch and abort before creating a venv, enrolling, or registering
a scheduled task.

**Why CI never caught it:** `Devices/sandbox/tests/test_deploy_kits.py` compares each kit's bytes
to `Devices/sandbox/`'s bytes. It **never parses the installers' hash tables**. All 15
byte-identity assertions pass while both Windows installs are dead on arrival.

**Why this matters:** it is the most plausible mechanical explanation for two of the four dark
devices. `jayti-asus-vivobook` has **never** written a field (its Firestore doc contains only
`commandQueue`; all 6 commands are terminal — 3 `cancelled`, 3 `expired-no-agent`), and
`g4g-lenovo-laptop` reports `daemon_version=channel-sandbox-2.0`, which is **not** a broker-kit
version string, i.e. that machine ran some older agent rather than the pinned kit.

**Fix:** two one-line edits — set both pins to
`287FE1C114488E847F0252C89170067E6FE5B33650780C72E8A8F00F7B63843A`. Note `Devices/` is on
QWEN.md's do-not-touch list, but these files are **installers**, not kit artifacts, and are
hash-pinned by nothing (see §1.6). Then add a test that parses each installer's pin table and
re-hashes the bundled file, asserting **64 hex chars** — the length check alone catches the
Vivobook bug.

`Server/install_lenovo.ps1` and `Server/install_vivobook.ps1` carry the identical broken values,
and their `device_agent.py` pin is stale as well. **REPORTED**, not re-verified.

### 1.2 The droplet's liveness check omits the control that caught a real spoof — PROVEN

`Server/jp-agent/device-health.mjs:19-27` requires `doc.online === true`, a fresh `lastSeen`, an
accepted `agentVersion` prefix, and `connectionMethod ∈ {termux-direct-cloud, direct-daemon}`,
plus a boot grace when `ackAge === null`. It **never checks `runtimeIsAndroid`**.
`Backend/jp-devices.js:179` requires `fields[S24_RUNTIME_EVIDENCE] === true`, and its own comment
at `:149-152` records that this field is *the* control that caught a production Windows bridge
spoofing `heartbeatAuth='termux-phone'`, `sourceType='live_termux'` and `liveDeviceVerified=true`,
because "a version string is one edit away from matching".

So `device_ping` / `list_devices` on the droplet would report such a bridge as
`device_online: true` **and** `heartbeat_authenticated: true` while the dashboard correctly
reports the same document offline. This contradicts QWEN.md's "New device-status logic must fail
closed the same way." It is a design divergence, not a typo: `tests/device-health.test.mjs`
asserts the boot-grace behaviour as intended. And because nothing runs that test in CI (§1.5),
there is no tripwire.

Honest note: I edited this file earlier today (`0637de9`, to widen the version prefixes) and did
not catch the missing attestation field.

### 1.3 `jp-track.js` is an unauthenticated scan-and-delete amplifier — PROVEN

`Backend/jp-track.js:89-106` checks only CORS headers, method, and whether AWS credentials exist.
No key, no rate limit, no body-size cap. `eventType` (`:116`) and `visitorId` (`:117`) come
straight from the request body. For `browser_history` / `device_history` it calls
`prunePreviousHistory` (`:44-86`), which loops a paginated `ScanCommand` `while (startKey)` and
then `BatchWriteCommand`-deletes every matching row. DynamoDB applies `FilterExpression` *after*
reading items, so each call scans the whole `jaytipargal_telemetry` table regardless of how few
rows match.

Two points the inspector missed: **CORS is not a control here** — it is browser-enforced and
`curl` bypasses it entirely — and the delete is scoped to an **attacker-chosen** `visitor_id`, so
this destroys another visitor's history rows, not just budget.

The obvious fix is wrong: a browser analytics beacon cannot hold a key. Real options are bounding
the scan (`Limit` + one page), moving the prune into the existing `db-push` cron, or a per-IP
throttle. **Needs an owner decision.**

### 1.4 The bootstrap-key download is contract-violating but NOT live — PROVEN refuted

`Server/install_s24_direct_cloud.sh:31-48` curls
`https://firestore.googleapis.com/v1/projects/intrepid-stage-495117-q1/databases/(default)/documents/bootstrap/s24key`
with no credentials and writes the result to `serviceAccountKey.json`. That violates four of the
five `forbiddenRuntimeFeatures` in `Devices/S24/runtime_contract.json:31-37`
(`bootstrap-key-download`, `service-account-key-on-device`, plus `inbound-ssh` at `:92-94` and
`adb-over-tcp` at `:96-99`).

But the exposure is **not live**. Probed with no credentials:

```
databases/(default)/documents/bootstrap/s24key  → HTTP 403
databases/eka-agent/documents/bootstrap/s24key  → HTTP 403
```

An inspector rated this the audit's single most important open question. It is closed: the script
is still dangerous *documentation* — an agent following it would build a prohibited inbound path —
and should be quarantined, but no key is retrievable.

The same class of contradiction is **REPORTED** in `_shared/docs/SSH_MESH_README.md:10,22`
("All devices connect via direct SSH (port 22)… No broker, no tunnels") and in
`Devices/S24/setup_s24.sh:31-32`, which starts `sshd`. `DAEMON_ARCHITECTURE.md` §2 documents a
`bore` reverse tunnel. All three contradict `runtime_contract.json:23` (`inboundListener: false`).
`Devices/S24/` is hash-pinned and on the do-not-touch list, so this needs an owner decision, not
an edit.

### 1.5 Nothing runs the droplet's tests, and three Python tests cannot run — PROVEN

- `_shared/tests/run-all.mjs:17` globs `*.test.mjs` in its own directory, non-recursively, so
  `Server/jp-agent/tests/` is never scanned. `Server/jp-agent/package.json` has only `start`.
  Zero workflow files reference `Server/`, `jp-agent`, or `node --test`.
- The three `_shared/tests/test_*.py` files are not merely unrun — they are **broken**. Each does
  `sys.path.insert(0, dirname(__file__))` then imports its target, but the targets live in
  `_shared/tools/`. Running them gives `ModuleNotFoundError: No module named 'scan_secrets'` (×3).
  These are the regression tests for two recorded incidents: a 3.12 GiB run of NUL silently
  truncating a corpus (`verify_corpus.py:5-13`) and GitHub Actions `.credentials` files reaching
  the corpus past `scrub_secrets.classify()` (`scan_secrets.py:5-7`). The fix is one line each —
  the pattern `Database/build_db_chunks.py:43-45` already uses.
- `code-quality.yml` is decorative: lint (`:29`), `npm audit` (`:51`) and trufflehog (`:57`) all
  carry `continue-on-error: true`, and its one hard step `exit 0`s on a hit (`:36`). It cannot
  fail. **REPORTED** for the line numbers, consistent with QWEN.md's "mostly continue-on-error".

### 1.6 QWEN.md's "SHA-256-pinned bundles" claim is broader than the mechanism — PROVEN

Only `Lenovo/`, `Vivobook/` and `S24/` carry hash tables, and they pin **five** files:
`device_agent.py`, `broker_client.py`, `signer.py`, `single_instance.py`,
`requirements-broker.txt` (`test_deploy_kits.py:14-20` — five, not the four an earlier
investigation recorded). Those 15 intra-`Devices/` copies are all byte-identical and CI-guarded,
so QWEN.md's "do not deduplicate them" is **correct** for them.

Everything else is pinned by nothing: `devices.json`, `README.md`, `runtime_contract.json`,
`wa_*.py`, `pull_direct_cloud.py`, `push_to_vercel.py`, `daemon/*`, and **the installers
themselves**. `Devices/sandbox/` has no hash table at all — it is the canonical source the others
are compared against. Editing `install_lenovo.ps1` breaks no test, which is exactly how §1.1
survived.

`test_deploy_kits.py:79` does assert `transport.inboundListener == false`, and `:64-71` asserts
`install_s24.sh` contains no `sshd`, `bore`, `service.adb.tcp`, `bootstrap/s24key` or `set +e`.
Those substring bans guard **that one installer only**.

### 1.7 `.vercelignore`'s own comment invites a production-breaking edit — PROVEN

`.vercelignore:22-24` says *"jayti-dashboard never builds or serves these files (its vercel.json
builds only `Backend/` and `Frontend/`)"*. That is incomplete: **20 built handlers import across
into `Integrations/`** (`check-stale.js:4`, `db-api.js:17`, `jp-live-content.js:17-18`,
`s24-ingest.js:15-16`, `wa-ingest.js:21-22`, and 15 more), and `@vercel/node` traces those in.
`Integrations/` is part of the deployed artifact. Adding it to `.vercelignore` alongside `Server/`
and `archive/` — which the comment invites — would strip `postgres.js` from every data route.
`deploy-manifest.test.mjs` would **not** catch it: check #2 resolves imports against the working
tree, not the post-ignore upload set.

The guard that *does* work is confirmed green: `git -c core.ignorecase=true ls-files --cached
--ignored --exclude-from=.vercelignore -- Devices/sandbox` returns **0**.

### 1.8 `_shared/.gitignore` is armed to swallow the next file — PROVEN, and it already bit me

Its tail blanket-ignores `*.json`, `*.py` and `*.html`. Four of its five negations are dead:
`!package.json` and `!package-lock.json` resolve to `_shared/package*.json`, which do not exist;
`!Dashboard/**/*.html` and `!Sandbox/**/*.html` point at directories that do not exist; `!*.ps1`
and `!*.sh` un-ignore extensions `*.py` never matched. Only
`!config/vercel-env.manifest.json` is live — and it is load-bearing, because
`env-manifest.test.mjs` reads that file.

I hit this directly: `git add _shared/config/vercel-env.manifest.json` was **refused** until the
negation was added. Any new `.py` test added to `_shared/tests/` — the canonical test home per
QWEN.md — will be silently untracked. Do not `git add -f`; that leaves the file ignored so later
edits are never picked up.

### 1.9 `device_telemetry` is owned by the sibling repo, and the error is swallowed — PROVEN

An inspector reported this table had no DDL anywhere and called it the audit's highest-severity
item. **Refuted**: the live `schema_migrations` ledger shows it was created by
**`009_device_telemetry.sql`**, applied 2026-09-18T06:35:28Z — a migration belonging to
`jaytibirthday-site`, which shares this Neon database *and this ledger*. All 16 columns
`jp-devices.js:21-25` selects are present, and the live query returns 2 rows.

The real risk is sharper than the one reported: **two repos share one ledger and the numbering
invariant is already broken three times.** `002`, `005` and `007` are each used by two different
files across the two repos (`002_enrich_events` / `002_whatsapp`; `005_s24_local_sync` /
`005_wa_attachments`; `007_site_api_enrichment` / `007_clean_whatsapp_senders`). They coexist only
because the ledger's primary key is `filename`, and `migrate.mjs:29` orders by plain string
`.sort()` with no numeric parsing and no repo awareness — so this repo's `007_clean_…` sorts
*before* the sibling's `007_site_…`, which was applied two days earlier in production.
`004_whatsapp.sql:11-13` states interleaving is safe "as long as the numbers keep advancing".

Compounding it: `jp-devices.js:31-33` swallows any error with a bare `catch { return new Map(); }`,
so if that cross-repo table changed shape, the Neon freshness overlay would silently vanish and
liveness would fall back to Firestore-only with nothing surfaced.

Also **PROVEN**: `device_telemetry` carries three columns the code never reads —
`ssh_fingerprint`, `capabilities` (ARRAY, NOT NULL) and `observed_at`.

### 1.10 `sync-keys-to-vercel.yml` IS a production deploy path — REPORTED, consistent with what I know

`.github/scripts/sync-keys-to-vercel.mjs:82-86` POSTs `/v13/deployments?forceNew=1` with
`target: 'production'` against the live deployment's `uid`, and the workflow hardcodes
`VERCEL_PROJECT_ID: prj_ert0BAxafhopYg8tjtbOMcfjDI9r` — the jayti-dashboard id I confirmed
independently. QWEN.md's "No workflow is involved, and none should be" is therefore **incomplete**:
no workflow ships *code*, but this one rebuilds production. It clones the currently-live `uid`, so
it cannot deploy `HEAD`. Push triggers are dry-run; only `workflow_dispatch` with `dry_run`
unticked writes. There is no `environment:` approval gate.

Its `SECRETS_JSON: ${{ toJSON(secrets) }}` puts **every** repo secret into the job environment,
not just the 33 in `SYNC_KEYS`.

---

## 2. Live fleet state — PROVEN, three ways, 18:35–18:38 UTC

All four registered devices are dark. Newest device-originated write in any store:
**2026-09-14T07:10:19Z**.

| device_id | platform | `online` | newest device write | age |
|---|---|---|---|---|
| `samsung-s24-ultra` | android SM-S928B | `false` | 2026-09-14T04:40:16Z | 5.58d |
| `g4g-lenovo-laptop` | windows | `false` | 2026-09-10T20:18:36Z | 8.93d |
| `eka-cloud-sandbox` | linux | `false` | 2026-09-08T18:40:41Z | 11d |
| `jayti-asus-vivobook` | windows | `null` | **never** | — |

Corroborated by Firestore `eka-agent/devices`, Neon `device_telemetry`, `devices`, `s24_agents`
(all four agents `status=stale`), `s24_device_snapshots`, every `s24_*` ingest table, and
`wa_messages` (110,398 rows) / `wa_chats` / `wa_sync_runs`. I swept **every timestamp column in
all 28 public tables**.

**The trap that makes them look alive:** `devices.synced_at`, `device_telemetry.observed_at` and
`device_dataset_status.observed_at` all read `2026-09-19T03:15:18Z` (15.4h) while `last_seen_at`
reads 5.58d. Those are stamped by a **cloud job copying Firestore → Neon** — every row carries
`source_system=firestore`. `Frontend/db.html:712` renders `synced_at` in a column labelled
**"Synced"**. `db.html` is otherwise careful (`Freshness` derives from `last_seen_at` per
`db-api.js:262-267`, and the page says *"when the two disagree, believe the timestamp"*), and
`jp-devices.js:339-352` overlays on `last_seen_at` and requires `online === true`, so the main
dashboard is never misled. This is QWEN.md's `generated_at` rule violated in a new place.

Also fresh but not device data: `events` / `sessions` / `visitors` / `video_events` are **browser**
analytics, including the operator's own clicks on `jayti-dashboard-staging.vercel.app`.

**New finding:** `device_dataset_status` shows the S24's `sms`, `callLogs` and `location` datasets
all `empty`/`unavailable`, `rows_seen=0`, `detail=[WinError 2] The system cannot find the file
specified`, observed 03:15 UTC. `WinError 2` is a **Windows** error — a laptop-side bridge
attempted S24 collection and failed. Corroborated by row counts: `s24_sms` 0, `s24_locations` 0,
`s24_queue_items` 0, while `s24_records` 74, `s24_calls` 32, `s24_commands` 31.

The S24's 3 queued commands are still `pending` — nothing has consumed them.

---

## 3. Dashboard UI/UX — current design in one place

**There is no shared design system. There are four unrelated ones.** All 8 pages carry 100% inline
`<style>`; not one links a local `.css` file; nothing is imported. With no bundler, duplication is
structural. (Frontend audit, **REPORTED** — I did not re-read all 8 pages.)

### Family A — "Amber & Cream" (`index`, `s24`, `vivobook`, `agent`) — the real house style
- Dark espresso shell over warm cream cards: `--bg #1C1007` vs `--panel #FFF8EE` / `--panel2 #FFFDF9`,
  joined by `linear-gradient(180deg, var(--panel2), var(--panel))`.
- Single amber accent ramp `#8E4A07 → #C87A1E → #E4A64A → #F0B968`; primary button
  `linear-gradient(180deg, var(--amber-glow), var(--amber))` with near-black text `#241505`.
- Semantic trio `--good #3E8E4E`, `--bad #C0392B`, `--warn #B9770E`.
- Editorial type: **Fraunces** (variable serif) for every number, heading and timestamp; **Inter**
  for body; `ui-monospace` for IDs.
- Shared micro-patterns: 3px reset; `::selection rgba(200,122,30,.4)`; sticky topbar
  `rgba(28,16,7,.92)` + `backdrop-filter: blur(10px)`; serif brand with an amber `.dot` full stop;
  pulsing live-dot `#4CAF50`; uppercase 10px/700/1.4px micro-labels; `theme-color #0E0A08`;
  `robots noindex,nofollow`; password gate cleared on 401; `$()` + `esc()` helper pair.

### Family B — "GitHub Dark" (`db.html`)
`#0B0D10`/`#12161B` neutrals, accent `#4C9AFF`, GitHub's exact status trio
`#3FB950`/`#D29922`/`#F85149` plus `#A371F7`/`#39C5CF`. System fonts only, no serif,
monospace-first KPIs. 208px sidebar + sticky toolbar.

### Family C — "Slate" (`jteka.html`)
`#0e1116`/`#161b22`, accent `#5b8cff`, tri-state badges with paired bg/border tokens. Flat 1100px
single column, no sidebar.

### Family D — "Light Neutral" (`viewer.html`)
The only light theme (`#f5f5f5` on white, accent `#2563eb`), the only page with **zero** CSS custom
properties, and the only one written in ES6+ (contradicting QWEN.md's ES5 rule).

### Conventions that hold repo-wide
One header name `x-stats-key` on all 6 authenticated pages. Password gate before data on all 6.
No framework, no build — one self-contained HTML file each. `generated_at` is **never** labelled
"synced" (index says "fetched at"/"fetched", jteka says "as of") — QWEN.md's rule is honoured.
`noindex,nofollow` on all 6 real pages.

### Divergences worth fixing
- **🔴 `sessionStorage['jbt_site']` holds two incompatible values.** `jteka.html:83` stores the
  **dashboard key** there; `index.html:726` reads the same key as the **site selector** (legal
  values `'jbt'`/`'jp'`). Both pages are same-origin. Unlocking jteka makes index query the wrong
  property's endpoints (`/api/visitor` instead of `/api/jp-visitor`); changing index's site
  dropdown clobbers jteka's key and locks the operator out with "That key was rejected." Almost
  certainly a copy-paste slip for `jbt_stats_key`. **REPORTED**, high confidence.
- **🔴 Three storage keys for one credential**: `jbt_stats_key` in **localStorage** (index),
  `jbt_stats_key` in **sessionStorage** (s24/vivobook/agent), `s24DashboardKey` (db),
  `jbt_site` (jteka). `index.html:719` migrates the key to localStorage and **deletes** the
  sessionStorage copy, so visiting index actively logs the operator out of s24/vivobook/agent —
  contradicting `s24.html:243-245`, which promises "the key carries over".
- **🟠 `esc()` duplicated 5× with 2 implementations.** `jteka.html:99-100` escapes only 4 chars
  `[&<>"]`, omitting the single quote the other four escape. `agent.html` has no `esc()` at all and
  uses `textContent` (safest). `viewer.html` has no escaping and 7 raw `${}` → `innerHTML` sinks.
- **🟠 Four auth transports for one key**: `x-stats-key` header (6 pages); `Authorization: Bearer`
  (`index.html:2660`, `/api/s24-command` only, with a preceding comment at `:2656` saying "no key
  required" — one of the two is wrong); `?key=` query string (`index.html:939`, `/api/wa-media`,
  sanctioned for `<img>`/`<video>` but it leaks the key into access logs on the highest-volume
  path, which is exactly what `stripKeyFromUrl()` exists to prevent); and none (`viewer.html:96`).
- **🟠 Key validation exists on exactly one page.** `db.html:204-212` strips zero-width/BOM chars
  and enforces `^[\x21-\x7E]{32,256}$`, and is the only page distinguishing **503** (unconfigured)
  from **401** (wrong key) in its UI — the fail-closed split QWEN.md calls deliberate. The other
  five send raw input into a header. Given that a leading U+FEFF on `VERCEL_PROJECT_ID` was a real
  incident this week, this validation belongs everywhere.
- **🟡 Five responsive strategies** (900/760/560 · 880 · 700 · 520 · none+safe-area-inset ·
  none+auto-fit). Two structurally identical sidebar shells collapse at different widths.
- **🟡 The amber family is not internally consistent**: `agent.html` ships a 9-variable subset of
  the 16-variable `:root` and is the only amber page with no `--mono` despite being the chat
  console; `theme-color #0E0A08` matches **no** variable in any palette (amber `--bg` is `#1C1007`);
  `index.html:11` requests Fraunces italic as `1,9..144,300..700` while the other three request
  bare `1`; `s24.html` and `vivobook.html` are 25/105-line forks that have drifted on liveness
  semantics (s24 shows `Agent proof` + `Last command ACK` + a strict-attestation diagnostic light;
  vivobook shows none and labels its rule `lastSeen < 3×heartbeat`).
- **🟡 Accessibility is near-absent and uniformly so**: 3 total `aria-*`/`<label>` matches across
  all 8 pages, 0 `role=`, 0 `alt=`, 0 `tabindex`, 0 `:focus-visible`, 0 `prefers-reduced-motion`,
  0 skip-links — against **8** `outline: none` declarations with no replacement indicator and three
  infinite animations. Cheapest high-impact fix: `:focus-visible` for those 8.

### Page/endpoint map
`index.html` (3556 lines, 13 views, 16 endpoints, 10s poll) · `db.html` (1254 lines, 13 views,
**one** endpoint `/api/db-api` multiplexed by `?view=`, no poll) · `s24.html` (431 lines,
`/api/jp-devices` + `/api/jp-device?device=samsung-s24-ultra`, 30s poll, the only page rendering
strict-liveness diagnostics) · `vivobook.html` (351 lines, same shape, 30s) · `jteka.html`
(187 lines, `/api/jp-devices` only, 30s, the only page respecting `document.hidden`, tri-state
`LIVE`/`REPORTED`/`OFFLINE` vocabulary that renders QWEN.md's "a stored `online: true` is not
sufficient" distinction) · `agent.html` (189 lines, `/agent/health` + `/agent/query` — the only
live endpoints **not** under `/api/`) · `viewer.html` and `template.html` — see §4.

Only **9** of `Frontend/`'s 1976 tracked files are live: the 8 HTML pages plus `jp-tracker.js`
(7142 bytes, ES5, POSTs to `/api/jp-track` with a 30s heartbeat). No live page references
`Frontend/assets/*`, `Frontend/view/*`, `Frontend/styles/*`, `katex`, `lute`, `mermaid`,
`plantuml-encoder`, or any of the 8 Vditor theme CSS files. There is **no tsconfig anywhere**, so
the 280 `.ts` + 44 `.tsx` files are never compiled.

**Two QWEN.md errors, PROVEN:** there are **0** `*.tmLanguage` files under `Frontend/` (they are
`Server/nginx.tmLanguage` and `_shared/reg.tmLanguage`), and there is no Vditor *bundle* — only
`vditorPlugin.ts` plus unbranded LESS/theme sources.

---

## 4. Removal candidates — tiered, NOT executed

`QWEN.md` forbids cleaning vendored files, touching the pinned kits, reorganizing `archive/`, and
deduplicating the intentional per-device copies. `deploy-manifest.test.mjs:8-12` exists because
"not in builds = dead" reasoning nearly deleted load-bearing shared modules. **Nothing below was
removed, and nothing should be removed without an explicit owner decision.**

### Tier 1 — safe on the evidence, zero references, outside every do-not-touch list
`Backend/stale.js` (**PROVEN** byte-identical to `Backend/lib/stale.js`, both sha256
`2ee4bdf7cbaeb320825047ae577f0cfbd49caef682b54c4e98ffd86ece2de83c`, zero importers, not in
`builds`) · `_shared/.git__1` (a Windows worktree pointer committed as a file) ·
`_shared/.config.kiro` · `_shared/.gitkeep` (dir holds 143 files) · `_shared/.gitmodules`
(declares `eka-runner/` + `eka-runner-private/`, neither exists) · `_shared/.claudesignore` ·
`_shared/package-lock.json` (`"name": "jayti-dashboard"`, doesn't match its sibling
`package.json`) · `_shared/README.txt` (byte-identical to `_shared/.vercel/README.txt`) ·
`Integrations/hf_bucket_credential_audit.py` · `Integrations/constants.ts` ·
`Integrations/util/telemetry.ts` · `.github/workflows/.github/workflows/endform-e2e.yml`
(**PROVEN** never loaded — depth-4 path; boilerplate with the literal `your-vercel-project-name`).

### Tier 2 — divergent duplicates; delete the copy, keep the authoritative original
`_shared/reports/RESTRUCTURE_STATE.json` (43,260 lines, `created 2026-09-10`, no `refreshed` key)
vs root `RESTRUCTURE_STATE.json` (22,181 lines, `refreshed_against: main@87ba028`) — **two
divergent machine-readable manifests with the same name is the most likely thing here to actively
mislead an agent** · `_shared/docs/INTEGRATION.md` (says "five-layer", 3372 files,
Integrations=91; reality is 8 layers, ~2520, Integrations=9) · `_shared/docs/DAEMON_ARCHITECTURE.md`
(byte-identical to the `Devices/S24/` copy, but *not* hash-pinned, so it can drift silently) ·
`_shared/docs/README.md` vs `Devices/sandbox/README.md` · `_shared/docs/CLAUDE.md` vs root
`CLAUDE.md`.

### Tier 3 — needs an owner decision, not a deletion
`_shared/LICENSE` says **"MIT License / Copyright (c) 2026 urgaa-eka"** while root
`package.json:39` says `UNLICENSED` and QWEN.md says "Private and unlicensed. © Jayti Pargal." A
committed MIT grant from a third party on a repo declared private. **This is a legal fact, not
cleanup.** · `_shared/docs/SSH_MESH_README.md` + the `Server/setup_*` SSH-mesh scripts (contradict
`runtime_contract.json`) · `Server/install_s24_direct_cloud.sh` + `start_s24_direct_cloud.sh`
(violate the contract on 4 counts; §1.4 proves the key is not retrievable, but the scripts are
dangerous instructions) · `_shared/tools/*.py` (15) — a coherent, self-documented corpus pipeline
with real incident history, dead *in this repo* but the owner may still run it on the Windows
machine whose paths it hardcodes. **Fixing is cheaper than deleting**: repoint three `Server/*.sh`
invokers and three `sys.path` lines. · `_shared/pyproject.toml` — **do not delete; relocate with
care.** Its `[tool.vercel] entrypoint = "dashboard_api:app"` points at a file in
`Devices/sandbox/`, and it sits outside that project's Root Directory so Vercel never sees it. Its
own `:6-8` warns that its mere presence switches the Python builder from pip to uv, so moving it
*into* `Devices/sandbox/` could break a currently-working deploy. Test on a preview first.

### Tier 4 — vendored, and QWEN.md says leave it alone
`_shared/reg.tmLanguage`, `locale.properties` (all 100+ `@import` targets absent),
`viewer.properties`, `vite.config.ts`, `frontend-assembly.patch`, `.vscodeignore`,
`LICENSE_FOXIT`, `LICENSE_LIBERATION`, `eslint.config.mjs`, 17 Chinese-language Vditor/Obsidian
docs in `_shared/docs/`, and the ~1968 non-live files under `Frontend/`. Evidence that they are
inert is clean (zero references from any live page, build entry, or workflow) — but the standing
instruction is explicit, so these are listed for completeness, **not** recommended.

### Explicitly NOT candidates
`archive/` (zero code references **PROVEN** by grep, but "Kept per instruction") · the 25
`Backend/*.js` files not in `builds` (the guard test warns this reasoning already nearly deleted
`_auth.js`) · the 41 `.vercelignore`-stripped `Devices/` files (pinned kits) · the 15 intra-`Devices/`
duplicate copies (byte-identical and CI-guarded) · `Integrations/postgres.js`, `wa-store.js`,
`s24-store.js` (18 / 7 / 1 live consumers).

---

## 5. Goal tracker

### Goal 1 — FREEZE: **complete** (`3322688`, `bb40a14`, `8a22cb3`, `fe94932`, `6a5517c`)
Manifest + generator + 14-assertion offline guard; `.env.example` byte-identical to production
(675 chars, sha256 `3a32b4623517`); README and `RESTRUCTURE_STATE.json` corrected; `clone-lab/`
fenced in both ignore files; Python pinned to 3.12 from one file that CI reads via
`python-version-file` (CI confirmed `CPython 3.12.14`; suite passes on 3.12.3 **and** 3.14.2).

### Goal 2 — FIX: open
Ordered by consequence.

1. **Two installer hash pins** (§1.1) — one line each, unblocks enrolling both Windows devices,
   plus a test that parses the pin tables and asserts 64 hex chars.
2. **`device-health.mjs` missing `runtimeIsAndroid`** (§1.2) — better: extract one shared module
   both sides import so they cannot drift again.
3. **`jp-track.js` unbounded scan/delete** (§1.3) — needs a design decision, not a patch.
4. **`GMAIL_APP_PASSWORD` still absent.** `staleAlert` has read `"alerted"` since
   2026-09-18T16:30Z and **no email was sent**. A device has been dark 5.58 days and the only push
   signal was silently skipped. Cheapest high-value item on this list.
5. **Quarantine the contract-violating device scripts** (§1.4) and resolve the SSH-mesh /
   `DAEMON_ARCHITECTURE.md` contradiction with `runtime_contract.json`.
6. **`db.html:712` "Synced" label** (§2) — rename to something like "Copied to Neon" so a
   cloud-side timestamp cannot be read as device activity.
7. **24 of 73 jayti-dashboard env vars are Vercel-flagged `readable-secret`** — stored
   `encrypted`, not `sensitive`, so plaintext-readable by anyone with project access. Includes
   `DATABASE_URL`, `POSTGRES_PASSWORD`, `BLOB_READ_WRITE_TOKEN`, all 18 `GATE_*`, 4 `KV_*`/`REDIS_URL`.
8. **Blob token-in-variable-name** — rotate in the dashboard (no CLI path). Deleting the names does
   **not** revoke the tokens. The generator redacts them from the manifest for this reason.
9. **42 of 73 keys are referenced by no source file**, now grouped with reasons in
   `env-manifest.test.mjs`: 18 `GATE_*` (empty store pending removal), 12 Neon-connection siblings
   (a storage connection re-syncs these if deleted by hand), 5 Upstash, 5 Blob token-in-name,
   `BLOB_STORE_ID`, `ENDFORM_API_KEY`.
10. **Fix the three broken Python tests and three broken `Server/*.sh` invokers** (§1.5) — one line
    each, and they are the regression tests for two recorded incidents.
11. **`code-quality.yml` cannot fail** (§1.5) and pins `trufflesecurity/trufflehog@main` — the one
    **live** mutable-ref action in the repo.
12. **Human-only, agent-blocked by vendor design:** four Blob `vercel storage disconnect` (2 per
    project) + `device-data` (Upstash), and `private-file-gate-db` removal (verified empty — would
    also clear 18 of the 42 orphans). I will not route around the guardrail.
13. **Deploy the droplet.** `Server/jp-agent/device-health.mjs` is committed but not live; nothing
    automates it (`deploy.sh <droplet-ip> [ssh-key-path]`).
14. **Unverified half of the IAM claim:** the SA's read of `eka-agent` is **PROVEN**
    (`devices_present_in_firestore: 2`); that `(default)` is *denied* is still unverified — my
    unauthenticated probe got 403, which is consistent but not proof of the role boundary.
15. **Test coverage gaps, REPORTED:** `jp-live-content.js` (reads the WhatsApp store, zero
    coverage, and possibly outside `wa-endpoint-auth.test.mjs`'s grep guard — the suite that exists
    because an unguarded WA endpoint leaked 862 contact names), `s24-sync-cron.js` (a cron with zero
    coverage), `jp-visitor.js`, `agent-run.js`; `wa-store.js`'s attachment path
    (`normalizeAttachment` + `upsertAttachments`) entirely untested while `wa_attachments` backs two
    deployed routes; `directPool()`'s deliberate no-fallback behaviour untested.
16. **`S24_DEVICE_ID` is declared three times** (`Integrations/s24-store.js:9`,
    `Backend/s24-command.js:7`, `Backend/jp-devices.js:109`) and hardcoded in ~12 more places; the
    test imports the `Backend/` copy, so divergence from the value `s24-store.js:243` enforces is
    undetectable.
17. **Doc-count drift:** QWEN.md says Integrations 7 (actual 9), _shared 137 (143), Devices 67 (68),
    Server ~61 (62), "21 suites" (25), and "not `node:test` files" (5 of 25 are).
    `deploy-manifest.test.mjs:3` says 33 builds (actual 36). `_shared/docs/WORKSPACE_DIRECTORY_MAP.md:120`
    still names only one agentVersion prefix.
18. **`package.json` / `package-lock.json` are modified but uncommitted**, adding
    `@neondatabase/neon-js` and `react-router-dom` (+4290 lock lines). **PROVEN neither is imported
    by any tracked source file.** `react-router-dom` in a bundler-less vanilla-JS frontend is
    anomalous. Left alone deliberately — operator's in-progress work.

### Goal 3 — AUTOMATE: not started
1. **Reconcile job** — diff live env against `_shared/config/vercel-env.manifest.json` and report.
   Now has something to reconcile against. Must respect: add-only semantics, no CLI deploy step in
   CI, `vercel --prod` forbidden.
2. **Pinned toolchain container** — `gcloud`, `vercel`, `gh`, `neonctl`, Python 3.12 + Node 24 at
   fixed versions. Fixes the three things that blocked verification this session (`gcloud` absent,
   expired Vercel OAuth token, `neonctl` ignoring its env API key).
3. **Verify probes as code** — the `/api/diag` + endpoint health checks run by hand here, plus
   **cron-route probing**: `health-check.yml` probes only `/`, `/api/jp-devices`, `/api/jp-stats`,
   `/api/verify-db`, so all three cron handlers are unmonitored and a silent `db-push` or
   `check-stale` failure is undetectable from CI.
4. **Wire `Server/jp-agent/tests/` and the three Python tests into CI.**
5. **Installer pin verification** (§1.1) — the test that would have caught both broken pins.
6. **Extend `deploy-manifest.test.mjs:114-120`**, which asserts only five `.vercelignore` entries,
   to cover the rules that actually prevented incidents (`app/`, `archive/`, `Server/`,
   `clone-lab/`, `.qwen/`, `Devices/*` + `!Devices/sandbox/`, `intrepid-stage-*.json`) **and** add
   an `Integrations/` must-NOT-be-ignored assertion (§1.7).
7. **Repair `_shared/.gitignore`** (§1.8) — add negations for `tests/` and `tools/`, or drop the
   blanket rules now that the reports they excluded are candidates for removal.
8. **Add `.qwen/` and `.vscode/` to root `.gitignore`** — both are untracked *and* unignored, so
   agent scratch state is one `git add -A` away from being committed. Add `__pycache__/`, `*.pyc`
   and `Database/wa-*.json` to `.vercelignore` (the last holds real contact names on the operator's
   laptop and has no `.vercelignore` rule).
9. **eslint is not wired and could not run if it were** — `_shared/eslint.config.mjs` is Vditor's
   upstream config, scoped to a `src/` directory that does not exist, importing seven plugins none
   of which is installed, and located where ESLint's flat-config lookup will never find it. Wiring
   it means writing a **new** root config scoped to `Backend/**/*.js`, `Integrations/**/*.js`,
   `Database/**/*.mjs`, `_shared/**/*.mjs`, adding `eslint` + `globals` + `@eslint/js`, and adding a
   `lint` script — CI then picks it up via the existing `--if-present` with no workflow edit.
   Until then: **do not claim lint passes. It has never run.**

---

## 6. What was verified versus reported

I re-verified myself: the fleet state (three independent stores, all 28 Neon tables swept), the
`device_telemetry` DDL ownership and 16-column contract, the migration ledger and its number
collisions, the anonymous-readability of `bootstrap/s24key` (403), both Windows installer pins
(including proving the Vivobook value is a git blob SHA-1), the `device-health.mjs` attestation
gap, `Backend/stale.js` byte-identity, the 36-vs-33 builds count, `remove-frontend-auth.js` and
`s24-agent-daemon.js` contents, the `jp-track.js` code path end to end, the catch-all's inability
to reach unbuilt files (6 × 404 on production), and `_shared/.gitignore` swallowing the manifest.

Two inspector headline findings were **refuted** by that verification (§1.4, §1.9) and one was
**corrected** (§1.6: five pinned files, not four). Everything else in §1, §3, §4 and §5 that is not
marked PROVEN is REPORTED and should be re-checked before acting.
