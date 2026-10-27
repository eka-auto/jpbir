# Dashboard section data implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every migrated database and give all nineteen dashboard sections real, readable data contracts with bounded current-state synchronization.

**Architecture:** Keep birthday analytics history in the existing warehouse tables. Reuse existing authenticated provider readers and project their responses into stable-key current-state storage, with explicit completion and version checks. Add dedicated Telegram and agent persistence, and shared safe presentation helpers for human values and actual media/documents.

**Tech Stack:** Node 24 ESM, PostgreSQL, existing pg pool and provider clients, static HTML/JavaScript, existing Vercel runtime and project test environment; no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-27-dashboard-section-data-design.md`

## Global Constraints

- Credentials, personal records, dumps and generated migration evidence stay outside source control.
- Birthday analytics remain historical; a source failure or partial snapshot never deletes current data.
- Firestore updates replace the same source identity. Older revisions cannot overwrite newer values.
- Numbers remain numbers, missing values remain unavailable, and source text is escaped.
- Actual images, audio, video and PDF/documents are presented; JSON and metadata attachments and raw-record dumps are not.
- S24/VivoBook liveness remains based on the existing attestation rules, never on migration or stored history.
- Telegram has a separate real dataset and does not show WhatsApp as Telegram.
- Reuse existing authentication and media URL restrictions. Never expose source credentials or proxy arbitrary URLs.
- Do not modify AGENTS.md, protected governance, or old destructive migrations. No fabricated approval or tracker completion.

## Review Focus

- A failed/incomplete page must not be mistaken for an authoritative empty snapshot: test no pruning on partial/failed reads.
- A late source response must not replace a newer document: test revision ordering and unchanged-record no-op behavior.
- A document named `.json`, a JSON MIME, or a missing media object must not become a misleading preview: test each rejection and actual PDF/image presentation.
- A structured value or absent number must not surface as JSON, `[object Object]`, or an invented zero: test typed field projection and rendering.
- A retry must not duplicate an agent answer or source record: test stable source keys and unique request IDs against real PostgreSQL.

## Task 1: Add the persistence model and reconcile current snapshots

**Files:** `Database/schema/017_dashboard_sections.sql`, `Integrations/dashboard-store.js`, `_shared/tests/dashboard-store.test.mjs`.

**Interfaces:** `SECTION_DEFINITIONS` defines the nineteen stable section IDs and storage policy. `reconcileSnapshot(client, snapshot)` accepts section/source/scope, a snapshot generation, source-keyed records, and an explicit `complete` flag; it returns inserted/updated/unchanged/removed counts. `readCurrentSection(sectionId, options)` returns bounded current rows without raw source fields.

- [ ] Write and run failing behavior tests for stable counts across repeated syncs, newer updates, late responses, complete source deletion/empty snapshots, and partial-source preservation.
- [ ] Add the additive migration and transactional reconcile functions; serialize the same source scope, compare revisions/hashes, and prune only a completed authoritative generation.
- [ ] Test the migration twice and verify a no-op rerun and preservation of existing events.

## Task 2: Connect existing authenticated readers and section status

**Files:** `Backend/lib/section-data.js`, `Backend/dashboard-sections.js`, `Backend/dashboard-sync.js`, `Backend/jp-devices.js`, `Backend/vercel-analytics.js`, `Backend/jp-stack.js`, `_shared/tests/section-data.test.mjs`, `vercel.json`.

**Interfaces:** `withCurrentSection(handler, definition)` captures a successful authenticated JSON response, stores its stable current projection, and returns an allowlisted display response. `dashboard-sections` reports coverage and last successful observation. A bounded scheduled sync calls only the existing allowlisted provider routes under existing server authentication.

- [ ] Add failing tests for unauthenticated rejection, explicit field projection, no raw/error-body leakage, complete/partial source distinctions, and truthful unavailable/stale states.
- [ ] Reuse the existing provider readers and strict device liveness calculation. Persist current documents/provider summaries with stable IDs; do not add analytics history copies.
- [ ] Keep visible polling responsive and use a bounded background schedule compatible with the Free database budget. Do not keep an idle compute permanently awake.

## Task 3: Restore proper Telegram storage and persist agent exchanges

**Files:** `Integrations/telegram-store.js`, `Backend/jp-telegram.js`, `Backend/jp-agent.js`, `Backend/jp-live-agent.js`, `_shared/tests/section-conversations.test.mjs`.

**Interfaces:** Telegram readers query only dedicated Telegram tables. Agent exchange persistence takes a validated conversation/request identity, real question, real answer and outcome; the same request/role is unique.

- [ ] Add failing tests proving Telegram never reads wa_* tables and shows an empty/unavailable state without actual records.
- [ ] Add failing tests for actual question/answer storage, retry deduplication, bounded inputs and authentication.
- [ ] Integrate only real handler results; no synthetic production records, fake Telegram messages, or invented agent success.

## Task 4: Render values and documents rather than raw records

**Files:** `Frontend/section-presentation.js`, `Frontend/index.html`, `Frontend/db.html`, `Frontend/s24.html`, `Frontend/vivobook.html`, `Frontend/jteka.html`, `Frontend/agent.html`, `Backend/jp-live-content.js`, `Backend/wa-media.js`, `_shared/tests/section-presentation.test.mjs`.

**Interfaces:** Shared presentation helpers escape text, preserve numeric zero, label null as unavailable, flatten only approved semantic fields, reject JSON/metadata attachments, and build authenticated media previews. Existing product pages keep their layout and navigation.

- [ ] Add failing tests for numbers/nulls, structured/raw fields, HTML injection, JSON/metadata file rejection, actual image/audio/video/PDF handling and URL safety.
- [ ] Remove raw payload/debug rendering on live product pages. Replace Telegram's WhatsApp alias with its own endpoint.
- [ ] Use authenticated media paths and inline PDF presentation where supported; keep a normal open/download action for actual supported documents and truthful missing-media states.

## Task 5: Verify, publish for review, and finish migration cutover

**Files:** Section coverage documentation plus focused source/test changes only; no credentials or generated evidence in Git.

- [ ] Run narrow tests through `project/environment/run`, then the full `npm test` suite and documented deployment checks.
- [ ] Exercise each of the nineteen sections with isolated fixtures, including numeric/table/media/document cases and absent live sources. Record actual results, not inferred green status.
- [ ] Apply additive schema only after a target/ledger dry run; never blindly reapply migration 016 to a copied historical database.
- [ ] Verify all eleven copies, approved application mappings, Auth identity remapping, deployment identities and live data reads. Remove temporary replication after cutover and retain sources for recovery.
- [ ] Inspect `git diff --check`, the exact reviewed file set, and staged diff; commit/push a focused branch and open a PR through the repository's required review path. Do not self-approve or mark independent review complete.

The owner has already approved the section scope and requested execution. Implementation proceeds natively in this session. A requested independent design reviewer could not run because its service usage limit was reached; perform a labelled self-review and retain independent release approval as a separate gate.
