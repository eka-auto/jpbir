# Restoring preserved visitor history

The birthday collector and dashboard diverged after isolated Neon branches were
created on October 10, 2026. The dashboard's `jpbir_live` database retained the
older snapshot and newer direct-ingest visits, while the original branch held
additional birthday history. Changing the dashboard's date filter cannot reveal
events absent from its warehouse.

`Database/scripts/lib/restore-visitor-events.mjs` provides a bounded repair for
preserved `jaytibirthday.in` event rows. It does not replay browser beacons: doing
so could assign current timestamps or new IDs to historical visits.

Before using the helper:

1. Verify source and target identities through their provider and live services.
   Match the target's event count and complete session-ID set to the live
   `/api/stats?site=jaytibirthday.in&days=90` response. A local `.env.local` is not
   proof of the current production destination.
2. Compare event column order and types. Both tables must have the same complete
   schema and no generated columns. Export source rows with `to_jsonb(events)`
   inside a read-only transaction, retaining original IDs and timestamps.
3. Supply an explicit site and half-open time window to `planVisitorRestore`.
   The default limit is 5,000 rows and the payload limit is 20 MiB. It rejects
   duplicate source IDs, conflicting event identities, and out-of-scope rows.
4. Record only `restoreSummary(plan)`, target identity and the owner's approved
   execution scope. The plan's `rows` contain private visitor data and must not
   be logged, committed, or put in CI artifacts.
5. Apply through an approved executor. `applyVisitorRestore` rechecks the plan,
   briefly serializes analytics writes, inserts missing IDs without overwriting
   existing rows, and rebuilds only affected visitor/session aggregates. Ordinary
   reads remain available. Historical session starts and entry pages are included.
6. Use the `beforeCommit` callback to encrypt and durably save the supplied
   preimages, postimages and inserted IDs. A callback failure rolls back the
   entire transaction. Reconcile later writes before using rollback preimages;
   never overwrite a postimage that has changed since the repair.
7. Reconcile the source IDs against production, verify the missing sessions in
   the live API, then plan and apply again. The second execution must insert zero
   rows. A changed plan is a reconciliation failure, not permission to retry
   blindly.

The real PostgreSQL regressions run through `project/environment/run` in
`_shared/tests/visitor-restore.test.mjs`. They refuse any hostname other than the
isolated `db` service and cover rollback, idempotence, session starts, failed
backup persistence, and a concurrent ordinary ingestion rollup.
