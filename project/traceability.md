# Requirements Traceability — jpbir, Release R1 ("Stabilize and Harden")

**Status:** DRAFT — Step 1, Task 4 of the R1 Step 1 plan
(`project/plans/r1-step1-requirements.md`). Prepared 2026-10-19.

**What this is.** One row per requirement ID. It links each business requirement
(`BR-xxx` in `project/BRD.md`) and each technical requirement (`TR-xxx` in
`project/TRD.md`) to its source, the planned implementation slice (name only — the
work itself is planned and built in Step 4), and the check, test, or gate that will
verify it.

**How to read the table.**

- `Maps to` links a technical requirement to its 1:1 business requirement. NFR rows
  have no business-requirement partner and carry the
  `NFR-with-owner-confirmation-tag` marker instead.
- The BRD's sub-criteria (`BR-101-a`, `BR-102-b`, …) are the acceptance checks
  inside their parent requirement; they are listed in that requirement's
  `Verification method` column, not as separate rows — so every requirement ID
  appears here exactly once and none is orphaned.
- Sources cite decision IDs (`D-n` in `project/decisions.md`, D-1..D-16) and the
  fact sheet (`project/plans/r1-facts.md`, with line anchors).
- No secret values appear anywhere in this document — names only.

| ID | Type | Maps to | Source (decision / fact sheet) | Planned implementation slice (name only; built in Step 4) | Verification method |
|---|---|---|---|---|---|
| BR-101 | Business | TR-101 | D-16 ("bloated vendored trees"); D-10 (runs/ sensitivity class); r1-facts.md §1 (171-241), §2 (252-292) | `repo-cleanup` — close the ignore-rule gaps; owner-approved deletion of untracked debris | BRD §4: BR-101-a (`git status --porcelain` shows none of the listed untracked trees stageable; `git check-ignore` reports every remaining one as ignored), BR-101-b (every deletion traces to a recorded owner answer), BR-101-c (tracked vendored count unchanged unless the owner overrides Q-BRD-6) |
| BR-102 | Business | TR-102 | D-16 ("stale documentation"); D-12; r1-facts.md §6 (501-512) | `docs-truth` — correct or mark-as-historical the 8 recorded stale statements | BRD §4: BR-102-a (checklist maps each of the 8 statements to its correction; live identity `jayti2` / `jpbir` / `jaytipargal.tech` stated correctly), BR-102-b (stated counts equal a fresh listing or carry an "as of" date; workflow list matches the 9 actual workflows) |
| BR-103 | Business | TR-103 | D-12, D-15; r1-facts.md §3 (296-367) | `deploy-link` — Vercel GitHub App re-link and missing-secret population (owner actions); local link files per Q-BRD-5 | BRD §4: BR-103-a (push to `main` → change visible on jaytipargal.tech within the owner-confirmed window — Q-BRD-8), BR-103-b (no missing-configuration errors; parity check passes), BR-103-c (no local link file references a dead legacy project), BR-103-d (no command-line deploy re-added to workflows) |
| BR-104 | Business | TR-104 | D-16 ("secret hygiene"); r1-facts.md §5 (422-497) | `secret-hygiene` — keep the clean baseline; guards stay in force | BRD §4: BR-104-a (R1-end scan: zero real-secret findings in tracked files), BR-104-b (the three on-disk environment files are never read, printed, or committed), BR-104-c (guard-file diff shows no loosened rule) |
| BR-105 | Business | TR-105 | D-2, D-5, D-7, D-13, D-14, D-15; r1-facts.md §7 (516-577) | `controls-verify` — re-verify ruleset, pinned skill, scheduled audit, and backups; record results | BRD §4: BR-105-a (ruleset 25339138 re-confirmed or a rewrite attempt recorded as rejected), BR-105-b (SHA-256 compare of `project/audit/SKILL.md` against the recorded value), BR-105-c (scheduled-audit log shows selftest 35/35 and all checks passing), BR-105-d (both backup hashes match; OneDrive copy hash-identical) |
| TR-101 | Technical | BR-101 | D-16; r1-facts.md §2 (252-292) | `repo-cleanup` (same slice) — `.gitignore` covers every listed untracked tree; stray `Server/` workflow YAMLs relocated or removed per owner scope decision | TRD §2 checks: an equivalent "add everything" dry-run stages zero files from the listed trees; deletions only after Q-BRD-2 / Q-BRD-3 answers; the two tracked root skill copies handled per Q-BRD-3; HOD audit |
| TR-102 | Technical | BR-102 | D-12, D-16; r1-facts.md §6 (501-512) | `docs-truth` (same slice) — README 4 spots, CLAUDE.md 4 spots, live identity everywhere, QWEN.md / INTEGRATION.md per owner | TRD §2 checks: doc-review checklist against the fact sheet's recorded stale statements; `git grep` for the live identity in deployment/hosting docs |
| TR-103 | Technical | BR-103 | D-12, D-15; r1-facts.md §3 (296-367) | `deploy-link` (same slice) — App linked on `main` in team `jayti2`; secrets populated (names only); `.vercel/` link files deleted or re-pointed; CLI deploys stay removed | TRD §2 checks: owner-confirmed push-to-deploy acceptance test (Q-BRD-8 wording — push → visible within 10 minutes); `dashboard-parity-check.yml` dispatch run; workflow diff shows no re-added command-line deploy |
| TR-104 | Technical | BR-104 | D-16; r1-facts.md §5 (422-497) | `secret-hygiene` (same slice) — re-run the scan at the R1 completion commit; guards unchanged | TRD §2 checks: scan re-run (`_shared/tools/scan_secrets.py`, fact-sheet §5 method) reports zero live findings at the R1 completion commit; guards diff no-looser; CI-wiring feasibility per TR-108 |
| TR-105 | Technical | BR-105 | D-2, D-5, D-7, D-13, D-15; r1-facts.md §7 (516-577) | `controls-verify` (same slice) — on-demand re-verification pass with recorded results; paid-plan protection stays formally parked | TRD §2 checks: ruleset 25339138 active and configuration unchanged; pinned-skill hash compare; `jpbir-hod-audit` last-run log (35/35, all checks pass); both backup hashes and the OneDrive copy hash-identical |
| TR-106 | NFR | — (NFR-with-owner-confirmation-tag) | D-1, D-16; r1-facts.md §7 (537-541) | `targets-sign-off` — no implementation; targets carried forward unchanged, owner confirms at sign-off | Owner confirmation recorded as a decision at the T-06 sign-off; no runnable check in R1 (the targets describe unchanged production behavior) |
| TR-107 | NFR | — (NFR-with-owner-confirmation-tag) | D-1, D-2, D-15; r1-facts.md §7 (547-552) | `backup-refresh` — regenerate or re-verify the backup pair at R1 close so the backups reflect the post-R1 state | Hash-compare the fresh git bundle and untracked archive against newly recorded SHA-256 values; OneDrive copy re-synced and hash-identical; owner confirms the cadence at sign-off |
| TR-108 | NFR | — (NFR-with-owner-confirmation-tag) | D-10; r1-facts.md §1 (131-153), §5 (422-497) | `ci-security-scan` — verify `scan_secrets.py`; CI wiring and a dependency-scan step are subject to the owner's decision; the DPDP content-exclusion rule stays | Checks: scanner runs clean (see TR-104); if the owner opts in — the scan step is present in `.github/workflows/` and a trial run with a placeholder fixture fails as designed; the dependency-scan decision is recorded as a decision |

**Orphan check (acceptance).** The BRD defines {BR-101 … BR-105}; the TRD defines
{TR-101 … TR-108}. The table above contains exactly those 13 IDs, each exactly once —
no BRD/TRD requirement ID is missing from the table and no extra ID appears.

**Next step.** Implementation slices are planned and built in Step 4 (the R1 execution
plan), not here. Status changes for T-06..T-09 flow through the tracker — never through
this file.
