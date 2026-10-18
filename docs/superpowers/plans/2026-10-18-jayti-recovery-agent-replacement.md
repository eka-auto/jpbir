# Jayti Recovery & Agent Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the suspended Vultr Jayti Hub's function on the existing Vercel Pro subscription (jayti2/jpbir) with no new payment, repair verified dashboard defects, and make recovered-media provenance honest.

**Architecture:** Three workstreams: (B) dashboard defect repairs on jpbir via the established deployer route; (C) a new isolated Vercel project `jtagent` running a Python retrieval function over a block-compressed copy of the validated local FAISS corpus, proxied from jpbir via `AGENT_API_URL`; (D) cutover, re-verification and records update.

**Tech Stack:** Vercel Functions (Python 3.14, Fluid, large-functions beta), faiss-cpu 1.15.1, sentence-transformers (all-MiniLM-L6-v2), bounded 1 MiB gzip blocks, Neon Postgres, Playwright (verification), Render Key Value (optional cache only).

**Spec:** Session evidence in `%TEMP%\opencode\readable\`: `vercel_readiness_gate.json`, `hub_rebuild_readiness.json`, `vercel_packaging_report.json`, `index_numeric_report.json`, `inspection_findings.json`; plus `project/CONTRACT.md` and the `project-state` tracker.

## Global Constraints

- No new subscriptions; existing Vercel Pro (jayti2) + Render Free only. No card verification flows.
- jpbir deploys use the deployer identity route already recorded in `project/ACCESS.md` (Vercel jayti2/jpbir deploy identity), as used throughout this session.
- Corpus assets live only inside the `jtagent` function bundle — never on public static routes.
- Secrets never printed, logged or committed. `project/STOP` honored.
- No new WhatsApp media imports until message↔file provenance is provable.

## Review Focus

1. Compressed-block offset drift returns the wrong document → block-boundary + doc-spanning-two-blocks roundtrip test (Task C6).
2. Memory blowup loading 1.77 GB index + MiniLM under concurrency → preview load test against 4 GB (Task C9).
3. 2,559 trailing unindexed docs silently invisible → count assertion + explicit `unindexed_trailing` in `/health` (Task C6/C8).
4. Auth bypass on retrieval/proxy → 401-without-key and 200-with-key tests (Task C8).
5. Vercel team/scope mismatch (jayti vs jayti2) empties panels → teamId-assertion verification (Task B2).

---

### Task P0: Plan committed

- [x] Write this file; commit to main via the authenticated repo identity.

### Task B1: db-api files/snapshots sections

**Files:** Modify `Backend/db-api.js` (section allowlist + sectionSql branches + per-section columns), `Frontend/db.html` (s24 column builders), Test `_shared/tests/db-api-s24-sections.test.mjs`.

**Interfaces:** Produces db-api `view=s24&section=files|snapshots` returning `section:"files"|"snapshots"` with rows from `s24_files` / `s24_device_snapshots`; db.html renders them.

- [ ] Step 1: failing contract test asserting the allowlist contains files and snapshots and that `overview` is not returned for them.
- [ ] Step 2: run test (fails).
- [ ] Step 3: implement sections + columns.
- [ ] Step 4: test passes.
- [ ] Step 5: live verification after deploy: `/api/db-api?view=s24&section=files` returns `section:"files"`.

### Task B2: VERCEL_TEAM_ID fix

- [ ] Step 1: inspect current env value/targets for `VERCEL_TEAM_ID` on jpbir.
- [ ] Step 2: set `jayti2` (all targets) via deployer identity.
- [ ] Step 3: redeploy; verify `/api/vercel-analytics` panels return `ok:true` with the dashboard key; if the function token lacks jayti2 scope, record the exact blocker instead of guessing.

### Task B3: size backfill

- [ ] Step 1: compute byte sizes for the 33 local PTT files; before/after counts.
- [ ] Step 2: idempotent UPDATE `wa_attachments.size_bytes` keyed by `att_id='recovered-audio:<file>'`; assert 33 rows matched.

### Task B4: provenance marking

- [ ] Step 1: recompute chat-candidate counts per file including `ptt` rows; classify single-chat vs ambiguous (expect 13/20).
- [ ] Step 2: idempotent UPDATE of `raw` JSONB: `provenance:"date-unique-single-chat"` or `"date-only-multi-chat-unverified"`; assert 33 rows updated.

### Task C5: corpus packer

- [ ] Step 1: `tools/agent-corpus/build_blocks.py` → writes to `D:\02_AI_Models_Training_HF\vercel-corpus-build\`: blocks/1 MiB gzip blocks of doc_store.jsonl, block_index.json (per-doc: block id, intra-block start/end), copies of faiss_index.bin, doc_offsets.bin, index_meta.json, manifest with SHA-256s + counts (docs 1,152,509; vectors 1,149,950; trailing 2,559).
- [ ] Step 2: verify manifest hashes; verify every doc reconstructs by concatenating its block slices.

### Task C6: reader

- [ ] Step 1: `reader.py` with `get_doc(i)`, `get_docs(ids)`; unit tests: first doc, last indexed doc, a doc spanning a block boundary, trailing unindexed range raises/reports.

### Task C7: native faiss verify (local)

- [ ] Step 1: `pip install faiss-cpu==1.15.1` (and sentence-transformers CPU if feasible within time).
- [ ] Step 2: load index, run the NumPy-scan query set, assert top-1 ids match the read-only NumPy audit; record.

### Task C8: retrieval function

**Files (new project dir `C:\Users\abcom\jtagent-vercel\`):** `app.py` (FastAPI: /health, /retrieve, /state, /query per jtagent_server contract), `reader.py`, `requirements.txt`, `vercel.json` (functions includeFiles corpus/**), `corpus/` (built assets), tests.

- [ ] Step 1: implement app + auth (Bearer `JTAGENT_API_KEY`; /health unauthenticated).
- [ ] Step 2: `/health` reports vectors, docs, unindexed_trailing, model, memory hints.
- [ ] Step 3: tests pass locally (auth, hit shape, trailing count).

### Task C9: preview deploy

- [ ] Step 1: create Vercel project `jtagent` (team jayti2), set `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`, `JTAGENT_API_KEY`, `VERCEL_PYTHON_VERSION` as needed; preview deploy from the project dir.
- [ ] Step 2: verify bundle eligibility; measure cold start, warm /retrieve latency, memory; 4 concurrent load probe; record results.
- [ ] Step 3: if bundle/memory fails, fall back to Blob-backed block streaming design (record decision).

### Task C10/D: cutover + re-verify

- [ ] Step 1: set jpbir `AGENT_API_URL` (prod) to the jtagent prod URL + `AGENT_API_KEY`; redeploy jpbir via deployer route.
- [ ] Step 2: `/agent` page live check: health/state 200, Ask-agent answer path works (uses existing jp-agent? no — /agent page uses /agent/state + /agent/query via jp-live-agent).
- [ ] Step 3: full Playwright re-verification of all sections; update `project/targets.json`, `ACCESS.md`, runbooks; record decisions.

### Parked (with reasons)

- Vultr Hub DB recovery (owner declined payment) → replacement DB starts empty; device re-registration needed later.
- Remaining media imports (needs provenance joins), device liveness fixes (physical access), S24 sync workflows (CI route).