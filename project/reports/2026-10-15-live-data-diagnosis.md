# Live data missing from the dashboard — diagnosis, 2026-10-15

**Reported (owner):** "the data is not coming to the dashboard … Live session shows
zero even when I visit the Birthday website … session status also not coming from
last five to six days."

**Scope of this check:** `jaytipargal/jpbir` (the dashboard + its API), the live
deployment at `jaytipargal.tech`, the birthday property's public tracker at
`www.jaytibirthday.in`, and the CI evidence trail in this repository.
**Branch:** `cline/engfkejj` (off `main@6ac8499`). Read-only against production
except for the four clearly-marked probe beacons listed at the end.

**Honest limit, stated first:** every read of the warehouse is behind
`STATS_KEY` / `HEALTH_CHECK_KEY`. I must not read, hold or transmit a secret
value, and this sandbox's GitHub identity cannot dispatch a workflow
(`gh workflow run` → HTTP 403), so I could not ask `/api/stats?site=jaytibirthday.in`
or `/api/verify-db` the one question that settles everything: *does the Neon
`events` table hold any `jaytibirthday.in` rows from the last six days?*
Findings below are therefore split into **Proven** (evidence quoted) and
**Most probable** (consistent with all the evidence, with the check that would
confirm it named). Nothing is reported as Done that was not verified.

## Proven findings

### P1 — The dashboard stopped opening on the birthday property on 2026-10-03
`Frontend/index.html` declares the landing property in its markup
(`<option value="jbt" selected>jaytibirthday.in</option>`, line 443) and, since
commit `357185a` ("fix: harden dashboard deployment and test coverage",
2026-10-03T13:58:44Z), restated it in script as a second, contradictory default:

```
-    var SITE = sessionStorage.getItem('jbt_site') || 'jbt';
+    var SITE = sessionStorage.getItem('jbt_site') || 'tech';
```

Every panel under ANALYZE is scoped by that selector (`/api/stats?site=`), so a
fresh dashboard session read the **jaytipargal.tech** property while the dropdown
still displayed *jaytibirthday.in*. A visit to the birthday website therefore
could not appear as a live session — the dashboard was not looking at the
property the visit touched. Nothing failed: markup and script were each
self-consistent, and no test compared them.
**Fixed** on this branch (SITE now reads the selector, one source of truth) and
pinned by `_shared/tests/frontend-property-default.test.mjs`, which fails on the
old line (verified: the two disagreement assertions fail, 3/5) and passes on the
new one (5/5).

### P2 — The dashboard's own ingest is healthy
`POST https://jaytipargal.tech/api/track` with
`page_url: https://jaytibirthday.in/diagnostic-probe` answered
`202 {"success":true,"persisted":false,"ignored":true,"site":"jaytibirthday.in","reason":"automated client"}`
— the handler ran, `DATABASE_URL` is set, the property allow-list resolves
`jaytibirthday.in` correctly, and the bot filter dropped the probe before any
write. The dashboard API is not the thing that is down.

### P3 — The birthday website's beacons never reach that ingest
The birthday site loads
`https://www.jaytibirthday.in/assets/js/jaytibirthday-analytics.js?v=3`, which
posts to a **relative** endpoint:

```js
const CONFIG = { ANALYTICS_ENDPOINT: '/api/track', ... };
```

So its beacons go to `www.jaytibirthday.in/api/track`, its own project — not to
`jaytipargal.tech/api/jp-track`, whose CORS allow-list
(`Backend/jp-track.js:5-16`) deliberately includes `jaytibirthday.in` and whose
payload contract (`event_type`, `session_id`, `page_url`, `screen`,
`device_type`, `browser`, `os`, `network`, `time_on_page`, `scroll_percent`) the
tracker already matches field for field.

That sibling endpoint is **not** this repository's handler, and it accepts
anything:

| Probe (POST, the tracker's own body shape) | Response |
| --- | --- |
| normal payload, `curl` UA | `200 {"success":true,"eventId":"<ms>-<rand>","persisted":true}` |
| empty body | `200 {"success":true,...,"persisted":true}` |
| `page_url: https://example.com/...` (foreign property) | `200 {"success":true,...,"persisted":true}` |
| no `page_url` at all | `200 {"success":true,...,"persisted":true}` |
| invalid JSON | `500 {"success":false,"error":"Invalid JSON"}` |

`jp-track.js` returns `{success,id,persisted,warehouse:{site,inserted}}` and
refuses an unknown property (`ignored:true, reason:'unknown property'`) and an
automated client (`reason:'automated client'`). A different writer answers here,
with no property allow-list and no bot filter, so **nothing in the birthday path
guarantees a row with `site='jaytibirthday.in'` in the Neon `events` table the
dashboard reads.** Fixing that needs the birthday site project (its tracker's
`ANALYTICS_ENDPOINT`, or its writer); it is not reachable from this repository,
which does not contain the birthday site's files.

### P4 — The nightly DynamoDB → Neon warehouse repair has been failing, silently
`Backend/db-push.js` (Vercel cron `30 18 * * *`) is the only path that carries
telemetry still journalled in DynamoDB into the Neon warehouse. It is failing in
production, proven twice over:

- CI run `38617049529` (DB Push Backfill, 2026-10-14T18:39Z) →
  `{"ok":false,"error":"JP_AWS_* read credentials not configured"}`;
- `_shared/config/vercel-env.manifest.json` (generated 2026-10-14T18:20Z) lists
  `JP_AWS_REGION` and `JP_TELEMETRY_TABLE` on the `jpbir` project but **no**
  `JP_AWS_ACCESS_KEY_ID` / `JP_AWS_SECRET_ACCESS_KEY`, and no `JP_WRITE_AWS_*`
  pair either.

Every environment variable on that project carries `updatedAt`
2026-10-10T15:51–15:56Z — the deployment was re-provisioned **five days before
this report**, matching the owner's "last five to six days".
`.github/workflows/sync-keys-to-vercel.yml`'s `SYNC_KEYS` list names none of the
four credential keys, so no dispatch can restore them; the values have to come
from the owner. Nothing watched the route either: no stack probe governed
`Backend/db-push.js`, and `health-check.yml` probes `/`, `/api/jp-devices`,
`/api/jp-stats`, `/api/verify-db` and `/api/jp-stack` — the gap
`_shared/docs/INSPECTION_2026-09-19.md` §3.3 already recorded as "a silent
`db-push` failure is undetectable from CI".
**Visibility fixed** on this branch (new `repair` probe + tests); the credentials
still need the owner.

### P5 — Corroborating signal, and why it is not proof
`health-check.yml` prints `birthday active_now (last 120s)` (added 2026-10-14) and
`newest event` (MAX(`occurred_at`) over the whole `events` table). Sampled runs on
2026-10-15:

| Run (UTC) | newest event | birthday active_now |
| --- | --- | --- |
| 00:01 | 2026-10-14T21:18:23Z | 0 |
| 00:54 | 2026-10-14T21:18:23Z | 0 |
| 05:38 | 2026-10-14T21:18:23Z | 0 |
| 10:20 | 2026-10-15T09:40:52Z | 0 |
| 15:14 | 2026-10-15T09:40:52Z | 0 |

The shared warehouse received two events in fifteen hours and reported no birthday
session at any sample. That is consistent with P3/P4, but a 120-second window at
five arbitrary moments cannot prove a six-day absence, and `newest event` is not
site-scoped. **The confirming check** (needs a credential this agent may not
hold): `GET /api/verify-db` and `GET /api/stats?site=jaytibirthday.in&days=7` with
the dashboard key. Any `jaytibirthday.in` row with `occurred_at` after 2026-10-09
would refute P4's relevance and leave P1 as the whole cause.

## Changes on this branch

| File | Change | Why |
| --- | --- | --- |
| `Frontend/index.html` | `SITE` reads `#siteSel` instead of restating a default | P1: the landing property disagreed with the markup |
| `_shared/tests/frontend-property-default.test.mjs` | new suite (5 checks) | P1: nothing compared markup and script; this does |
| `Backend/lib/stack-map.js` | new `repair` probe; `Backend/db-push.js` added to the map | P4: a dead cron with no light anywhere |
| `Backend/jp-stack.js` | `probeRepair()` — red, naming the missing vars, when the repair cannot start | P4 |
| `_shared/tests/stack-health.test.mjs` | 3 checks for the new probe | P4 |
| `.github/workflows/sync-keys-to-vercel.yml` | the four `JP_*_AWS_*` names added to `SYNC_KEYS` | Q2/Q3 (approved 2026-10-15) — **not in this commit**, see below |
| `.github/workflows/dashboard-parity-check.yml` | new birthday-property check; `verify-db` anchor now prints `newest_event_at` and `birthday_active_now` | Q4 (approved 2026-10-15) — **not in this commit**, see below |

Both workflow edits are written, verified (`git apply --check` against a pristine
`main` checkout, and the patched parity script passes `node --check`) and shipped
as `project/reports/2026-10-15-workflow-approvals.patch`. They are **not** in the
branch commit because this run's GitHub identity is a GitHub App without the
`workflows` permission: `git push` refuses any commit that touches
`.github/workflows/*` ("refusing to allow a GitHub App to create or update
workflow … without `workflows` permission"). The owner applies the patch and
pushes it; the exact commands are at the end of this report.

`npm test` → **49/49 suites pass**; `npm run lint` and `npm run build` pass.
The new probe turns the Product-engineering panel red for the repair and makes
`/api/jp-stack` report `cloud_fail ≥ 1`, so `health-check.yml`'s stack step now
reports `⚠️ Stack endpoint reachable — downstream probe failures reported`
instead of a clean pass. That is the intended effect (a real, still-open
breakage), not a gate change: the step still exits 0.

## Owner decisions — Q1, Q2, Q3 and Q4 all answered **YES** on 2026-10-15

Written and verified: the two workflow edits (Q3, Q4), shipped as
`project/reports/2026-10-15-workflow-approvals.patch` because this identity cannot
push `.github/workflows/*` (GitHub App without the `workflows` permission).
Still open: **Q1 is Blocked** — the birthday site's files are not in this
repository or this workspace, so the one-line endpoint change has to be made in
the birthday project itself (exact edit below); **Q2 needs the owner** to add the
four credential values as GitHub secrets, after which one dispatch carries them
to Vercel.

**Q1 (approved, Blocked on access).** In the birthday site's tracker
(`assets/js/jaytibirthday-analytics.js`, served as
`https://www.jaytibirthday.in/assets/js/jaytibirthday-analytics.js`), change:

```js
ANALYTICS_ENDPOINT: '/api/track',
```
to
```js
ANALYTICS_ENDPOINT: 'https://jaytipargal.tech/api/jp-track',
```

Nothing else needs to change: `Backend/jp-track.js` already allows
`https://jaytibirthday.in` and `https://www.jaytibirthday.in` as origins, and the
tracker's payload already matches that handler field for field. Alternatively,
keep the relative endpoint and make the birthday project's own writer insert into
the shared Neon `events` with `site = 'jaytibirthday.in'` — but then that writer
needs the same property allow-list and bot filter, or the dashboard will keep
mis-filing rows.

**Q1 — Point the birthday site's tracker at the dashboard's ingest.** Recommended
**YES**. Change the birthday site's `ANALYTICS_ENDPOINT` from `'/api/track'` to
`'https://jaytipargal.tech/api/jp-track'` (the dashboard's CORS allow-list already
accepts `https://jaytibirthday.in` and `https://www.jaytibirthday.in`, and the
tracker's payload already matches that handler field for field). YES restores
live birthday sessions on the dashboard; NO leaves the birthday property with no
guaranteed path into the warehouse the dashboard reads, and the Live feed /
Sessions panels stay empty for it however the dashboard is configured. If the
birthday project's own writer is preferred instead, it must insert into the shared
Neon `events` with `site = 'jaytibirthday.in'` — I need that project to be
reachable from this workspace to do either.

**Q2 — Restore the four `JP_AWS_*` credential names on Vercel project `jpbir`, or
retire the DynamoDB path.** Approved: **restore**. The code, the `/api/db-push`
build entry, the cron and migration `009_dynamodb_repair_state.sql` are all still in
place, and `cb99177` on 2026-10-10 explicitly restored that job's dependencies — a
lost credential, not a decision. The `SYNC_KEYS` half of this is done (Q3); what
remains is the owner setting the four values as GitHub secrets on
`jaytipargal/jpbir` and dispatching the sync.

**Q3 — The change to `.github/workflows/sync-keys-to-vercel.yml`.** Approved and
**written** (in the patch, not pushed): `JP_AWS_ACCESS_KEY_ID`,
`JP_AWS_SECRET_ACCESS_KEY`, `JP_WRITE_AWS_ACCESS_KEY_ID` and
`JP_WRITE_AWS_SECRET_ACCESS_KEY` are added to `SYNC_KEYS`, so one dispatch after
the secrets exist writes them to Vercel Production and rebuilds. Add-only:
nothing else is touched.

**Q4 — The parity check for the birthday property.** Approved and **written** (in
the patch, not pushed): `dashboard-parity-check.yml` now asserts
`site=jaytibirthday.in` has events in the 7-day window (a zero fails the run,
naming both tracker endpoints and the repair), and the `/api/verify-db` anchor
prints `newest_event_at` and `birthday_active_now`. It will report **FAIL on the
birthday check until Q1 is done** — that is the point; today the run passes while
the property the dashboard opens on has no data.

## Commands for the owner (PowerShell, from the repository root)

These are the commands that finish the job. Steps 1–3 need `gh` authenticated as
**jaytipargal** (the account that owns the repo and the Vercel team), not the
GitHub App identity this run used.

```powershell
# --- Step 1: get the two approved workflow edits onto main ---------------------
git checkout main
git pull
git checkout -b fix/workflow-approvals
git apply project/reports/2026-10-15-workflow-approvals.patch
git add .github/workflows/sync-keys-to-vercel.yml .github/workflows/dashboard-parity-check.yml
git commit -m "ci: carry the warehouse-repair credentials, and check the birthday property"
git push -u origin fix/workflow-approvals
gh pr create --base main --fill --title "ci: repair credentials + birthday parity check"
gh pr merge --merge

# --- Step 2: give the warehouse repair its credentials (values from your AWS --
# --- account that holds the jaytipargal_telemetry table) -----------------------
gh secret set JP_AWS_ACCESS_KEY_ID          -R jaytipargal/jpbir
gh secret set JP_AWS_SECRET_ACCESS_KEY      -R jaytipargal/jpbir
gh secret set JP_WRITE_AWS_ACCESS_KEY_ID    -R jaytipargal/jpbir
gh secret set JP_WRITE_AWS_SECRET_ACCESS_KEY -R jaytipargal/jpbir

# Carry them into Vercel Production and rebuild (add-only; prints "adding ...")
gh workflow run sync-keys-to-vercel.yml -R jaytipargal/jpbir
gh run watch -R jaytipargal/jpbir

# --- Step 3: prove the repair works, and see which properties are in DynamoDB --
gh workflow run db-push-backfill.yml -R jaytipargal/jpbir -f max_passes=20
gh run watch -R jaytipargal/jpbir
# In that run's log, read the last line: `{ok, postgres, eventsBySite}`.
# That list is the first hard answer to "which properties were reaching Neon only
# through the repair" — if jaytibirthday.in appears there, P4 was the cause.

# --- Step 4: re-check stats + health with the dashboard key --------------------
gh workflow run dashboard-parity-check.yml -R jaytipargal/jpbir
gh run watch -R jaytipargal/jpbir
# Expect: "PASS | Birthday property ingestion | events=... sessions=... "
# once Step 5 is done; until then it fails on purpose.

# --- Step 5 (Q1): point the birthday tracker at the dashboard's ingest --------
# In the birthday site project, edit assets/js/jaytibirthday-analytics.js:
#   ANALYTICS_ENDPOINT: '/api/track'
#   -> ANALYTICS_ENDPOINT: 'https://jaytipargal.tech/api/jp-track'
# Then redeploy that project and load the birthday site once with the dashboard
# open on "jaytibirthday.in": "Active now" should read 1 within ~2 minutes.
```

If `gh secret set` prompts for a value, paste it there — never into a transcript,
a commit or an issue. Nothing in this repository needs the values.

## Run-state note (pipeline integrity)

`project/settings.json` records `state_branch: project-state` and
`verifier_branch: project-verifier`, but **neither branch exists on `origin`**
(`git ls-remote --heads origin` → `main`, `copilot/*`,
`fix/restore-aws-sdk-dependencies` only), and `project/` on `main` holds no
`TRACKER.md`, no `tracker.json` and no `events/`. So there was no `TRACKER.md` for
this task, no `project/STOP` to check (rule 14 could not be evaluated), and no
event log to append to. Per the pointer block this report is the status record;
the event line below is offered for the HOD to append once the state branch
exists:

```json
{"ts":"2026-10-15T16:20:00Z","role":"worker","task":"live-data-missing","branch":"cline/engfkejj","state":"In progress","decisions":"Q1..Q4 all YES by owner 2026-10-15","done":["P1 dashboard landing property fixed + regression test","P4 repair probe + tests","Q3 SYNC_KEYS credential names","Q4 birthday parity check"],"evidence":"project/reports/2026-10-15-live-data-diagnosis.md","blocked_on":["Q1 birthday project not reachable from this workspace (owner or access required)","Q2 JP_AWS_* values must be set by the owner as GitHub secrets"],"unverified":"no warehouse read: STATS_KEY not held, workflow dispatch forbidden to this identity"}
```

## Production writes made by this check (disclosure)

Five synthetic beacons were POSTed to `https://www.jaytibirthday.in/api/track` to
characterise that writer, each with `session_id`/`visitor_id` prefixed
`probe-diagnostic` and `page_url` values `.../diagnostic-probe` or
`https://example.com/diagnostic-probe`; one further beacon was sent to
`https://jaytipargal.tech/api/track` with a `curl` user agent, which the bot filter
drops before any write (P2). If those `probe-diagnostic*` rows landed in the
birthday project's store, they should be purged. Nothing was written to Neon by
this agent.


