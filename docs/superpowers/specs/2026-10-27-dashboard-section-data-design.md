# Dashboard section data and current-state synchronization

The owner approved database coverage for every dashboard section and then specified that the UI must show actual values, readable text, images and documents rather than JSON or metadata files. Birthday website analytics retain historical events. Firestore-backed data represents the current source state: an update replaces the matching local record, and repeated syncs do not create copies. Every section needs an explicit, tested data contract.

## Migration and targets

The existing five source Neon projects have been copied into org-billowing-meadow-62228264. All eight source branches and eleven databases are included. The owner approved an additional Free project for txt_file_db because its original training branch exceeds the destination Free branch limit. The original databases are retained. Application mapping approved by the owner:

- jpbir: jaytibirthday-db main / jpbir_live.
- channel-sandbox: jaytibirthday-db main / neondb.
- jaytibirthday-site: birthday-isolated-20261010 / neondb, matching the existing local configuration.

Connection values and private records stay outside the repository. Migration evidence contains identifiers, counts and digests only.

## Section contracts

| Section | Existing authority and storage | Required display/persistence |
| --- | --- | --- |
| S24 Ultra | Canonical eka-agent Firestore device document; devices, device_telemetry and s24_* tables | Typed device values and current records; signed/fresh attestation remains the liveness authority |
| VivoBook | Existing fleet broker/Firestore records | Typed current device values; never label G4G-Laptop as a physically verified ASUS |
| Jteka | Existing fleet endpoint | Current fleet rows with observed times and unavailable/stale states |
| Live feed | Birthday events and current device/source records | Bounded ordered feed of real event text, numbers and media references |
| Firestore | Existing authenticated Firestore readers | Stable document identities, source revisions and current-state replacement; typed tables in UI |
| Database | Existing db-api allowlisted warehouse reads | Human-readable tables; no raw_payload, raw, payload or debug JSON views |
| Media | Existing wa_attachments and authenticated Blob/Firestore media references | Actual images/video/audio and PDF/document viewing; reject JSON/metadata attachments from presentation |
| Vercel | Existing provider reader | Latest provider/project/deployment snapshot, typed numeric metrics and status |
| Overview | events, visitors, sessions | Existing historical analytics and numeric aggregates |
| Audience | events, visitors | Existing historical aggregates with numeric values |
| Geography | events, visitors | Existing country/city aggregates; missing geography stays unavailable |
| Sessions | sessions, events | Existing historical session records and totals |
| Email opens | email_opens | Real opens, dates and counts; no raw payload shown |
| Device Dashboard | devices, device_telemetry, device_dataset_status | Typed device rows; historical rows do not imply current liveness |
| WhatsApp | wa_chats, wa_messages, wa_attachments, wa_sync_runs | Readable message bodies and actual media; encrypted/absent bodies are unavailable, not fabricated messages |
| Telegram | No real dataset presently exists; legacy migration 013 removed empty tables | Separate Telegram tables and reader; an honest empty state until real Telegram records arrive; never reuse WhatsApp data |
| Ask agent | Existing authenticated analytics query handler | Persist real user questions and returned answers with deduplicated request IDs; readable text |
| Jayti Agent | Existing authenticated retrieval service | Durable real conversations/runs and current runtime status; unavailable runtime remains unavailable |
| Product engineering | Existing evidence/probe reader | Latest real check results and evidence references; no manufactured green checks |

## Database changes

Use an additive, idempotent migration after the existing migration ledger. Reuse the current analytics, device and WhatsApp tables. Add a section/source registry, current-state source records and sync state, bounded live-feed projections, media references, Telegram chat/message/sync tables, agent conversations/messages/runs, and latest engineering/provider evidence. Internal JSON may preserve source structure, but public read models explicitly select display fields and never return raw records for rendering.

Do not re-run old destructive migrations on the copied historical database. The new migration must be separately planned against its actual ledger. A second application is a no-op. Keep credentials, personal data, dumps and generated evidence outside source control.

## Current-state sync

Identify a record by source system + collection/document identity, not by poll timestamp. Upsert only the newest source revision and replace the stored current value. Reject out-of-order updates. Derive child record identities from the parent and real child IDs. Reconcile removed children and source deletions only after a complete, successful authoritative snapshot. A partial read, rate limit or provider failure cannot erase existing records. Keep one sync-state row per source and bounded operational run history; unchanged polls must not grow data tables. Birthday analytics remain append-only in their existing historical tables.

Use pagination and bounded per-request work. A resumed sync continues from its cursor; it must distinguish a complete empty source from a failed or incomplete source. Source collections and device identities are allowlisted. No phone commands or messaging are part of this work.

## Backend and presentation

Keep the existing operator authentication and server-side provider credentials. Read-model queries return explicit text, numeric, timestamp, boolean and media fields. Missing values are null/unavailable, never invented zeros. No JSON.stringify/pre/code raw-record panel or metadata-file download appears in the product UI. Escape all source text. Render images, video/audio and PDF/document previews through existing authenticated media transport or a validated same-origin proxy, with a normal download/open option for supported real documents. Never proxy an arbitrary user-supplied URL.

Retain server-side raw data only where needed for source fidelity and debugging, with no raw-mode UI fallback. Provider failure should show the last successful observation with a stale indication, not silently relabel it live.

## Verification and delivery

Cover all section IDs in a machine-readable coverage report. Test repeated/updating/older/deleted/partial/empty syncs, preserve birthday analytics history, reject raw payload presentation and JSON/metadata media, test numeric types, HTML escaping, correct WhatsApp/Telegram separation, private-media authorization and URL allowlists, and persistence of actual agent responses. Run the repository's tests inside its declared environment. Use isolated synthetic fixtures in tests only.

Verify all source-to-destination table counts/content digests, sequences and application schema before cutover. Retain current destination-managed cloud_admin defaults and disabled Data API OpenAPI discovery as documented platform differences. Rebind Auth project/endpoint identity without changing user settings. Stop temporary replication after a successful cutover and retain the source for recovery. Verify the selected application deployments and their data reads; do not equate READY with every device being online.

Product code follows the repository's review and release controls. Do not edit AGENTS.md or silently change protected governance records, manufacture approval, mark unverified tracker tasks Done, or claim the complete product is operational solely from local tests.
