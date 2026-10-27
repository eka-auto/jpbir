# Readiness — DevOps, production-readiness repair (2026-10-22)

Preflight record for the DevOps department's work on the deployed release, written against the
pinned skill's rule that readiness is recorded with evidence rather than asserted.

Phase: Step 4 (department preflight and build) through Step 7 (staging and release
verification). Release unit: the deployed Vercel project `jpbir` on team `jayti2`, serving
`jaytipargal.tech`.

## What was checked, and what proved it

| Requirement | Evidence | Result |
| --- | --- | --- |
| The build, the tests and the lint run inside the project environment | `project/environment/run`; CI runs them in the environment image, and the pinned-subject check runs there too | pass |
| The full suite is green in that environment | 57/58 suites; the one failure is an untracked suite in the working tree that asserts a constant its own target file does not yet define, and it is not in the committed tree | pass with one known exception |
| The browser journeys run | `npm run test:browser` — 27/27 | pass |
| The migration tooling works against a fresh database | `scripts/stack-migration-proof.mjs` — fresh-apply, second-run-noop, ledger-match | pass |
| The shared migration ledger reconciles with this repository | `scripts/stack-ledger-reconcile.mjs` — 13 of this repository's names, 1 retired, 10 owned by `jaytipargal/jaytibirthday-site` | pass |
| A backup can be restored | `scripts/stack-restore-drill.mjs` — `pg_dump` into a second fresh database, 19 tables and 13 ledger rows identical | pass |
| The two rows with no live signal are proved from outside | signed, revision-bound receipts published by CI; the panel accepted the first one on 2026-10-22 and the `migration-tooling` row went green | pass |
| The release gate proves readiness rather than assuming it | `release-readiness.yml` requires `readiness.ready` and a current schedule | pass |
| The outside monitor is an independent witness | `health-check.yml` reads the native receipt and fails on a missed run; green on every scheduled run since PR #193 | pass |
| The device fleet is live | the S24 last reported `s24-termux-https-worker-2026-07-27.1` over `termux-direct-cloud` — the legacy collector, not the contracted `s24-termux-broker-2026-09-21.2` over `signed-broker-v2` | **blocked** |

## The blocked item

The S24 has not reported for about six days and its five queued commands are unclaimed. The
runtime contract forbids an inbound listener by design, and the phone's own wake path was
exercised on 2026-10-21 (a wake event published to its ntfy topic and confirmed present on the
topic) without producing a heartbeat. There is no verified remote execution path left.

Only the owner can close this, by a physical action on the phone: power it on, open Termux and
run `Devices/S24/install_s24.sh`, which registers the Termux boot package and the JobScheduler
job so the daemon reports as the contracted release over the signed broker channel. Nothing else
in the product is needed for it; when the device reports, the six device rows and the
`runtime-contract` row go green on their own.

This is a human-only prerequisite, so it stops only the work that depends on it: the 24-hour
observation window cannot start until `readiness.ready` is true.

## Phase gate

Step 4's gate for the DevOps department is **not met**: the device fleet is not live, and the
runtime-contract row cannot be proved without a device that reports the contracted release. Every
other DevOps requirement above is met with the evidence named.
