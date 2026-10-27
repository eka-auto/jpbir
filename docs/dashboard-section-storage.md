# Dashboard section storage

`Integrations/dashboard-store.js` is the nineteen-section reader and storage registry. `/api/dashboard-sections?coverage=1` reports schema availability and whether actual rows have been observed. These are separate from physical device liveness and media byte verification.

Birthday analytics remain historical in `events`, `visitors`, `sessions`, `email_opens` and the existing related tables. Firestore mirrors are current-state records keyed by source, scope and native document identity. Source timestamps retain nanosecond precision. Repeated unchanged reads do not add rows. Current values replace old values, including fields removed by the source.

Firestore scans use one source read time across pages. Incomplete scans save a cursor and membership keys. Only the final authoritative page may reconcile deletions. Concurrent pages validate the expected cursor; late pages cannot regress it. Failed reads preserve previous values and mark the scope incomplete. The scheduled sync has a bounded execution budget and runs every fifteen minutes; device status continues to refresh from the existing authenticated live reader while its page is visible. Stored observations carry their source timestamp and are labelled stale after twenty minutes.

The new tables enable row security with no non-owner policies and revoke PUBLIC access. Backend owner connections retain the existing dashboard authentication. No new device commands or message sending are introduced.

Telegram has its own chat, message and sync tables. There is no Telegram capture configured by this change. Empty Telegram storage is an honest empty source; WhatsApp messages and media are never substituted. Agent exchanges persist actual questions/answers with conversation and request identities. Exact retries return the saved answer before calling the model; conflicting reuse returns 409.

Read models exclude raw payloads, metadata, credentials and debug fields. Numeric values remain readable, including exact large integers. Semantic structured values are rendered as labelled values. JSON/metadata files and active HTML/SVG attachments are excluded. Images, audio, video and PDF previews use authenticated attachment identities. A Firestore media record is linked to the existing attachment store by its exact stored identity/reference; a missing object is shown as unavailable. Arbitrary URLs are never used as a media proxy input. Blob continues to own the file bytes.

Apply only `017_dashboard_sections.sql` to the approved production warehouse after checking its ledger. Historical copies can intentionally lack migration 016; running all old migrations there would purge retained analytics. The organization migration preserved all eleven databases and does not authorize replaying historical destructive migrations.

The source organization remains available for recovery. The three former application databases are read-only after cutover. Restoring source writes is a rollback operation that must be coordinated with the application connection mapping to prevent divergent writers.
