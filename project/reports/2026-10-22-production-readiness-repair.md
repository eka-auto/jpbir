# Production-readiness repair — findings, proof and open gates

Date: 2026-10-22
Role: devops
Plan of record: `docs/plans/2026-10-22-0002-fix-production-readiness-plan.md`
Branch: `fix/production-readiness-repair`

Production was not changed by this work. Everything below was proved in the pinned project
environment (`project/environment/run`) or read from the provider and from the live panel's
own authorised projection.

---

## 1. What the live product actually said

Read at 2026-10-21T19:0xZ with the dashboard key against the deployed `/api/jp-stack`:

| | |
| --- | --- |
| rows | 38 |
| green | 30 |
| failing | 6 |
| warning | 0 |
| unproven | 2 |
| `overall` | **`fail`** |
| `cloud_fail` | 0 |

- The six failing rows were all `probe: devices` — the same S24, six rows in the stack map.
- The two unproven rows were the two on the `static` probe.
- `last_cron_run.checked_at` was two minutes old, so the scheduler was running. The panel
  was not blind; it was mis-reporting.

The same six rows were reported as "6 device-freshness red(s)" by the outside monitor,
which is a *warning*, and the monitor's job summary still said "All Endpoints Healthy". The
false green was in the reading, not in the data.

### Why the S24 was red

`GET /api/s24-public` (unauthenticated, read-only):

- `lastSeen` ~8548 minutes old — about six days.
- `agentVersion: s24-termux-https-worker-2026-07-27.1`, `connectionMethod:
  termux-direct-cloud` — the **legacy collector**, not the signed broker daemon
  (`s24-termux-broker-2026-09-21.2`, `signed-broker-v2`) the runtime contract requires.
- `live: false`, `liveness.reason: "heartbeatFresh is missing or stale"`.
- `commandQueueDepth: 5`, `commandQueuePendingDepth: 5` — commands queued and unclaimed,
  because nothing on the phone is polling for them.

There is no inbound listener to the phone by design, and the phone has not reported in six
days, so no remote path can restart it. **This needs a physical action on the device**; the
smallest one is in section 5.

---

## 2. What changed

| Area | Change |
| --- | --- |
| Verdicts | `overall` now ranks `unknown` above `ok`; a new `readiness` object carries `ready`, `verdict`, the reason and the rows holding the gate up. The nav dot and the readiness line follow it. |
| Devices | The S24 is judged by the shared attestation module, on its own declared reporting period. A future-dated heartbeat is a failure. Every fleet device is judged, including one with no document. |
| Evidence | The two rows with no live signal are now proved by signed CI receipts bound to a pinned subject digest, a trusted producer, the running revision and an expiry. |
| Schedule | Only the platform scheduler writes the native receipt. The panel and the outside monitor read it. A manual run cannot make a dead schedule look alive. |
| Alerts | The state machine works on the verdict. `unproven` alerts; `warn` does not wake anyone; a failure that becomes `unproven` never produces a recovery mail. The receipt carries the delivery outcome. |
| Monitor | The outside monitor fails on a missed scheduled run, on a malformed payload, and on missing evidence. It never calls `/api/stack-cron`. |
| Release | A new strict gate (`release-readiness.yml`) requires `readiness.ready` plus a current schedule. |
| CI | Lint, tests and the browser checks now run inside the project environment; `--if-present` is gone; the pinned subject digests are checked in CI. |
| Environment | An explicit `sslmode=disable` is honoured, so the migration runner works against the isolated Postgres. Nothing else about the TLS policy changed. |

---

## 3. What was proved, and where

All of it inside `project/environment/run` (contract rule 3).

| Check | Result |
| --- | --- |
| `npm run lint` | pass — "lint verified JavaScript syntax and 5 security/accessibility surfaces" |
| `npm test` | **51/52 suites pass** |
| `npm run test:browser` | **27/27 pass** |
| Runtime-contract proof | `contract-bundle-digest` pass, `contract-schema-valid` pass, `device-bundle-syntax` pass |
| Migration proof | `fresh-apply` pass, `second-run-noop` pass, `ledger-match` pass — against a **fresh** database created inside the isolated environment |
| Restore drill | `pg_dump` → restore into a second fresh database → 19 tables and 13 ledger rows identical |
| Pinned subjects | `stack-subjects.js` matches the tree |
| Provider | repository id `1350770272` → `eka-auto/jpbir`; ruleset `25339138` active; CI green on `main` pushes and pull requests |
| Pull request #192 | `Lint & Test`, `Code Quality`, `Security Scan`, `Validate workflow definitions`, `jp-agent tests`, `S24 MCP compatibility` (3.12 and 3.14), `Vercel Agent Review` — all pass |

### Three defects the CI run on the branch itself exposed

Moving the checks into the environment was what found them; they were invisible while the
checks ran on the runner.

1. **Git could not read the bind mount.** The container runs as root while a Linux runner's
   checkout belongs to the runner's uid, and git refuses that as "dubious ownership" and
   exits 1. Two suites that read the tracked file list — `dependency-hygiene` and
   `deploy-manifest` — failed in CI and nowhere else. The environment now declares
   `/workspace` safe, which is git's own documented way of saying that mount is expected.
2. **The pinned subject digests described one platform's checkout.** They were computed over
   the raw bytes of the file, and git checks the same file out with CRLF on Windows and LF on
   Linux. The CI producer on Linux would have computed a different digest from the pinned one,
   and **every receipt it published would have been refused** as "the checked subject has
   changed" — the whole evidence mechanism would have been dead on arrival. The digests are
   now taken over the file's text with line endings normalised, so they describe the file
   rather than a checkout. The two pinned values changed with this.
3. **The browser checks ran in a container that had no browser.** Playwright downloads
   Chromium into the container's own cache, and `docker compose run --rm` throws the
   container away, so installing in one step and testing in the next tested nothing. Both now
   happen in the same container.

### The one failing suite — not ours, and not touched

`_shared/tests/s24-wake-topic.test.mjs` fails. It is an **untracked** file in the working
tree (the owner's in-flight work) and it asserts that
`Backend/s24_phone_direct_cloud.py` defines `S24_NTFY_TOPIC = 'eka-agent-s24-cmd'`. That
constant does not exist in that file, and this work did not modify that file. The suite is
not committed, so it is not in CI.

It was left exactly as found: fixing it means implementing the owner's in-flight feature,
which is outside this work order and would collide with their work.

---

## 4. Provider reconciliation (contract rule 11)

- `jaytipargal/jpbir` **redirects to** `eka-auto/jpbir`; `repos/1350770272` still answers
  with that id and owner. Same repository, transferred, not forked.
- The repository is now **public** (D-15 recorded a private choice).
- `eka-auto` now holds **admin** because it owns the repository; the register recorded
  `write`. The extra privilege is **not used**: this work pushes a branch and opens a pull
  request. No merge to `main`, no ruleset change, no deploy.
- The local git identity is a personal login and was not used for the push.
- The GitHub billing lock recorded in T-04 is gone: CI/CD and Code Quality are green on
  `main` pushes and on pull requests, and the scheduled health check has run green every
  ~15 minutes since 2026-10-19.

---

## 5. Open gates — the smallest action that closes each

| # | Gate | Owner action |
| --- | --- | --- |
| A | The S24 runs the legacy collector, so the six device rows and the runtime-contract row cannot go green | On the phone: power it on, open Termux, and run the broker installer (`Devices/S24/install_s24.sh`), which registers the Termux boot package and the JobScheduler job so the daemon reports as `s24-termux-broker-2026-09-21.2` over `signed-broker-v2`. Nothing else in the product is needed for it. |
| B | `STACK_EVIDENCE_KEY` | **Closed 2026-10-22.** The owner configured the same generated value as a GitHub repository secret and as a Vercel production secret, without disclosure. The value is not recorded anywhere in this repository and must never be. |
| C | The strict gate needs the new `/api/jp-stack` and `/api/verify-db` responses, which need a production deploy | **Closed 2026-10-22.** PR #192 merged and deployed at `ea706b12`; the live `/api/jp-stack` now answers with the strict readiness verdict, the schedule block and the native cron receipt. |
| D | The ledger reconciliation could not explain eleven names in the shared ledger | **Closed 2026-10-22** by D-25: ten belong to the sibling repository `jaytipargal/jaytibirthday-site` and one is this repository's retired `010_telegram.sql`. `Database/schema/shared-ledger.json` records both, separately from the alias map so the runner's behaviour is untouched. |
| E | The ruleset requires no checks, reviews or CODEOWNERS, so any writer can push to `main` | **Closed 2026-10-22.** Ruleset `25339138` now requires eight status checks, one approving review, a code-owner review, a last-push approval, resolved review threads and no bypass; direct update to `main` was rejected and verified. CODEOWNERS is proposed through PR #193. |
| F | The 24-hour observation window has not run | Start it once the S24 is recovered. The window is defined in section 6. |

### Where the product stands now

Read from the deployed production at 2026-10-21T21:10Z:

| | |
| --- | --- |
| rows | 38 — 30 green, 6 failing, 2 unproven |
| verdict | `fail`, reason: "6 required row(s) failed" — the six device rows |
| schedule | alive; the native receipt is minutes old, `schedule.stale` is `false` |
| the two evidence-backed rows | unproven until the CI evidence job publishes a receipt; the shared-ledger reconciliation was the blocker and is now fixed (D-25) |
| the six device rows | red until the S24 runs the attested broker daemon (gate A) |

---

### The control change, reviewed

PR #193 (`chore/release-controls-192`) carries the owner's control change: CODEOWNERS, the
ruleset hardening already applied, and repairs to two workflows and one test. It was reviewed
independently before it merges, as contract rule 12 requires for a control change.

Findings:

- **The schedule verdict was wrong, and it was raising a false alarm.** `jq -r '.schedule.stale
  // true'` treats `false` as absent in jq, so a healthy schedule evaluated to `true` and the
  monitor announced a stopped scheduler every fifteen minutes for one that had run two
  minutes earlier. The reading is now `.schedule.stale != false` — `false` stays `false`, and
  a missing field still fails closed.
- **The ledger report path pointed at a container-only path**, so the reconciliation died
  with `ENOENT` before it could run.
- **The attested-S24 fixture had a millisecond race**: the attestation compares two strings
  for equality and the fixture built them from two separate clock reads.
- **The access register cited an approval record that did not exist.** `project/approvals/
  2026-10-22-bounded-release-admin.md` was on neither `main` nor `project-state`. A control
  record pointed at nothing. The record was added during the review — the owner's approval as
  given, each operation with its provider-verified evidence, and the limits that stay in
  force — and the citation corrected to where approvals are actually kept.

Review submitted as an approving review; the record is in `project/approvals/
2026-10-22-bounded-release-admin.md`.



The window starts when the strict gate first reports `ready: true`, and covers at least one
nightly repair tick and one unattended night.

What must hold for the whole window:

1. `release-readiness.yml` green on every run — 38 rows proven, zero failing, zero warning,
   zero unproven.
2. The native receipt age never exceeds 20 minutes: `GET /api/jp-stack` → `schedule.stale`
   is `false`, continuously.
3. The `Endpoint Health Check` workflow green on every scheduled run, with the summary
   table showing "Unattended schedule | ✅ OK".
4. No RECOVERED mail that is not backed by a proven pass — the alert state machine is
   checked by its own suite, and the mailbox is the witness.
5. One nightly repair tick observed end to end: the repair cron runs, its receipt is
   written with a notification outcome, and the alert state does not flap.
6. The S24's rows green **without** a laptop writing anything to the S24's document — the
   attestation suite covers that, and the live device's `evidence` field reads
   `signed-broker-v2`.

Anything that breaks inside the window goes back to its owner with the evidence, per
operating contract rule 6: a code or configuration defect gets a new repair attempt with a
recorded hypothesis; the attempt is never identical to an earlier one.

---

## 7. Files

Changed: `Backend/jp-stack.js`, `Backend/stack-cron.js`, `Backend/jp-devices.js`,
`Backend/verify-db.js`, `Backend/lib/stack-map.js`, `Backend/lib/s24-attestation.js`
(and its byte-identical `Server/jp-agent/` copy), `Backend/lib/stack-readiness.js`,
`Backend/lib/stack-evidence.js`, `Backend/lib/stack-digest.js`,
`Backend/lib/stack-subjects.js` (generated), `Frontend/index.html`,
`Integrations/postgres.js`, `project/environment/compose.yaml`, `.gitattributes`,
`.github/workflows/ci-cd.yml`, `.github/workflows/health-check.yml`,
`.github/workflows/evidence-publish.yml` (new),
`.github/workflows/release-readiness.yml` (new), `scripts/stack-subjects.mjs`,
`scripts/stack-evidence-publish.mjs`, `scripts/stack-migration-proof.mjs`,
`scripts/stack-ledger-reconcile.mjs`, `scripts/stack-runtime-contract-proof.mjs`,
`scripts/stack-restore-drill.mjs`, `_shared/tests/stack-health.test.mjs`,
`_shared/tests/stack-readiness.test.mjs` (new), `_shared/tests/stack-evidence.test.mjs`
(new), `_shared/tests/shared-ledger.test.mjs` (new), `_shared/tests/device-fleet.test.mjs`,
`_shared/tests/verify-db-health-key.test.mjs`, `Database/schema/shared-ledger.json` (new),
`Database/scripts/lib/migration-plan.mjs`, `project/decisions.md`, `project/ACCESS.md`,
`project/targets.json`, `project/approvals/2026-10-22-bounded-release-admin.md`,
`docs/plans/2026-10-22-0002-fix-production-readiness-plan.md`.

Pull request: https://github.com/eka-auto/jpbir/pull/192 (merged, deployed at `ea706b12`)
