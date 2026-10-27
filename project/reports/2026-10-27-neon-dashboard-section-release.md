# Neon organization migration and dashboard section release ΓÇö verification report

Verified 2026-10-27T15:53Z. Author: opencode-session (identity `jaytipargal`, id 313854821), devops role.

This report closes out the run that was interrupted by a usage limit at 2026-10-27T15:39:25Z.
Every statement below was read back from the provider or from CI on the exact merge commit.

## What was asked

The owner asked for the Neon temporary API key of `org-cold-lake-91548510` to be transferred to
`org-billowing-meadow-62228264`, and then answered "yes completev migration with all data".
Both organizations are Vercel-managed, so Neon's project-transfer feature cannot move projects
into or out of either organization. The sanctioned route was a full data copy into projects of
the destination organization, with the source left intact as the rollback.

The owner then approved a second scope in the same session: build the database behind every
console section, show real values instead of raw JSON and metadata, and keep the
Firestore-sourced data updating rather than accumulating.

## Migration outcome

11 of 11 databases across 8 branches were copied and verified, into 6 destination projects of
`org-billowing-meadow-62228264`. No paid upgrade was applied. The source projects still exist
and the three former application databases are read-only for recovery; temporary replication was
removed. The full source-to-destination mapping is in
`project/checkpoints/2026-10-27-neon-org-migration-receipt.json`.

Read back from the destination after the copy:

| Table | Rows |
| --- | --- |
| `dashboard_current_records` | 40 |
| `dashboard_sync_state` | 15 |
| `events` | 15,748 |
| `visitors` | 360 |
| `sessions` | 571 |
| `wa_messages` | 113,770 |
| `wa_chats` | 863 |
| `wa_attachments` | 33 |
| `email_opens` | 58 |
| `devices` | 4 |
| `device_telemetry` | 3 |

Eight private section tables were added and 28 historical data tables were preserved. A second
migration run applied 0 changes and the security/schema checks reported 0 drift warnings.

Three applications were cut over: `jpbir` to `bitter-glade-72523152/br-hidden-leaf-b8l1j76r/jpbir_live`,
`channel-sandbox` to `main/neondb`, and `jaytibirthday-site` to `br-winter-salad-b82mip7n/neondb`.
Fourteen Vercel environment secrets across the three projects, ten GitHub repository secrets and
one local `.env.local` were repointed.

## Live sync

The first Firestore pass completed 13 scopes and inserted 35 current records. The second pass
inserted no duplicates and updated two changed records. Telegram capture and prior agent history
do not exist, so those tables are empty by evidence rather than by omission.

## Release

PR #206 was approved by the owner and merged at 15:38:36Z as commit `1dfb2d6`. The Vercel Git
integration deployed it as `dpl_HedKAZ6LSTch8azmuW1M5wdpeuJp`, READY, production, built from that
same commit, carrying all five aliases.

CI on the merge commit: CI/CD Pipeline success, Code Quality Checks success, Publish Stack
Evidence success, Endpoint Health Check success, Release Readiness **failed**.

## Production verification

The Endpoint Health Check (`40533169017`, 33 seconds after the deployment was created) reported:

- Homepage OK
- Devices API and Stats API: HTTP 401 ΓÇö the unauthenticated request is refused, as designed
- **Neon answered with the full schema (31 tables)**
- Cloud probes all green; `cloud_fail: 0`
- Unattended scheduler ran 0 minutes ago

An independent read of the destination provider after the release showed `dashboard_sync_state`
`observed_at` advancing to 15:45:49ZΓÇô15:45:51Z ΓÇö after the deployment was created at 15:38:43Z.
The released application is actively refreshing the destination database from Firestore: 15
scopes, all complete. That is the owner's "keep it updated, replace the old data, do not
accumulate" requirement, observed in the database rather than asserted.

## The gate that is still open

Release Readiness failed, and it is reported here as a failure, never as a pass.

The panel reads 31 green, 0 warnings, 6 failing, 1 unproven across 38 rows. The six failing rows
are `Backend/device-heartbeat.js`, `Backend/device-enroll.js`, `Backend/device-commands-poll.js`,
`Backend/lib/s24-attestation.js`, `Backend/s24-ingest.js` and `Backend/check-stale.js`.

This is **not** caused by this change. Every scheduled run of that workflow on `main` has failed
since at least 2026-10-27T01:55:31Z ΓÇö eight consecutive runs, back to before the Neon migration
began ΓÇö with the identical six rows and the identical panel. `cloud_fail` is 0: every cloud-side
probe passes. The cause is the physical S24 Ultra not having attested the runtime contract, which
is a device-side action no cloud-side change can replace.

The strict gate therefore stays open on the S24. This release did not close it and did not widen it.

## Section coverage

All 19 sections in scope have their schema ready. 14 show real data. Five do not yet:
Vercel, Telegram, Ask agent, Jayti Agent and Product engineering ΓÇö they keep their existing
authoritative readers, and their new durable rows will be filled by actual calls now that the
code is released. No production fixture was inserted.

## Rollback

Revert commit `1dfb2d6`. For the database, the source projects were never deleted and the
previous secret values are recoverable.
