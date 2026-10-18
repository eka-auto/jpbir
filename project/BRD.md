# Business Requirements Document — jpbir, Release R1 ("Stabilize and Harden")

**Status:** DRAFT for owner review. This is the R1 business-requirements draft prepared for
Step 1 sign-off. The owner approves (with possible edits) at the T-06 scope-freeze review.

**How to read this document.** Every requirement has an ID (`BR-xxx`), a source tag, and
Given/When/Then acceptance criteria. Every statement is either:

- **owner-confirmed (D-n)** — recorded as an owner decision in `project/decisions.md`
  (decision D-1 through D-16); or
- **inferred-from-code** — read directly from the repository; cited to the section of the
  fact sheet `project/plans/r1-facts.md` that recorded it (written as "facts §n" below).

**Plain language.** Specialized words are explained in parentheses where they first appear.
The full plain-language glossary is at `r1-facts.md §9` — every glossed term below appears
there too.

**Secrets.** No secret, key, or token value is written anywhere in this document.
Configuration values are referred to by name only.

---

## 1. Release goal

**R1 = stabilize and harden. No new features.** — [owner-confirmed (D-16)]

The owner chose this direction on 2026-10-18. R1 fixes the inherited problems the product
already has and wires up the protections the pipeline needs. Production (the live website)
stays as it is.

**What "stable" means in owner language:**

- The dashboard at jaytipargal.tech keeps working the way it works today — the owner opens
  it, sees the three devices, and nothing has changed.
- When the owner (or an agent acting for the owner) records a change in the repository, the
  change actually reaches the live website. Today it does not — pushes do not reach the
  deployed site [owner-confirmed (D-12)].
- Nothing breaks when ordinary maintenance happens (cleanup, doc updates, code-style
  fixes).

**What "hardened" means in owner language:**

- The repository's safety rails are verified to be in place: rules that stop anyone from
  rewriting or erasing the project's history, checks that keep secret values out of the
  code, and the daily automated audit that confirms everything is still healthy.
- The documentation tells the truth. Anyone reading it today learns what is actually live
  and how the product actually works.
- The repository contains only what the product needs — the leftover clutter is either
  safely deleted, moved out, or fenced off so automated tools cannot sweep it in.

**Existing behavior is preserved.** The four daily user journeys in section 3 keep working
exactly as they do today. R1 does not change them.

**Sources for this section:** [owner-confirmed (D-16)] for the direction; [owner-confirmed
(D-12)] for the broken push-to-deploy; the current live state is recorded in the fact sheet
[facts §7].

---

## 2. In-scope fixes

The owner's scope decision D-16 names the inherited debt to fix in R1: bloated trees,
stale documentation, the disconnected deploy path, secret hygiene, and wiring of the
protections and controls. Each becomes one requirement below.

| ID | Fix (owner language) | Requirement | Source |
|---|---|---|---|
| BR-101 | Clean up the repository and close the ignore-rule gaps | The repository contains only what the product needs; everything else is deleted (only with owner approval), relocated, or fenced off so automation cannot sweep it in | [owner-confirmed (D-16) "bloated vendored trees"; facts §2, §1] |
| BR-102 | Make the documentation tell the truth | Every stale statement found in the fact sheet's docs audit is corrected; the live hosting identity is stated correctly | [owner-confirmed (D-16) "stale documentation"; facts §6] |
| BR-103 | Repair the broken deploy link | A push to the main branch reaches the live website within the agreed time; missing configuration is filled in | [owner-confirmed (D-16) "disconnected Vercel push-to-deploy"; owner-confirmed (D-12), (D-15); facts §3] |
| BR-104 | Keep secrets out of the repository | The secret scans pass with zero real-secret findings and the guard rules stay in force | [owner-confirmed (D-16) "secret hygiene"; facts §5] |
| BR-105 | Verify the baseline protections are wired and working | History protection, the pinned audit skill, the daily audit, and the verified backups are all checked and confirmed working | [owner-confirmed (D-16) "wiring of the protections and controls"; owner-confirmed (D-2), (D-5), (D-7), (D-13), (D-15); facts §7] |

The measurable acceptance criteria for each fix are in section 4.

### BR-101 — Clean up the repository and close the ignore-rule gaps

**Problem (owner language).** The project folder holds a lot of material that is not the
product. The tracked part of the repository (what is actually stored in the project's
history) has 2,566 files, of which only roughly 350–400 are the live app — the rest is
mostly third-party editor/viewer code copied wholesale into the repository ("vendored"
code) plus generated build output [facts §1, §2]. On disk there is far more: a 25.5 GB
folder of past agent-run outputs (`runs/`), a 64,194-file copy of an external editor
extension (`vscode-office/`), an orphaned folder of downloaded libraries (`dashboard/`),
a duplicate checkout of this same project inside itself (`jpbir/`), and assorted debris.
The bigger risk: most of these trees are not fenced off in the repository's ignore rules,
so a careless automated "add everything" command could sweep them into the project
history — including 25.5 GB of run data and possibly sensitive exports [facts §2, §5].

**Requirement.** R1 does not delete anything without a recorded owner decision, and it
closes the ignore-rule gaps so nothing untracked can be swept in by accident. Deletion
of the obvious debris (the orphaned libraries folder, the all-cache Python folder, etc.)
happens only after the owner answers the questions in section 6.

**Tags.** The bloated/vendored trees are [owner-confirmed (D-16)] as named debt; the file
counts and tree inventory are [facts §1, §2].

### BR-102 — Make the documentation tell the truth

**Problem (owner language).** The two main project documents are stale in specific,
counted places. The README (the project's front-page guide) is wrong in four spots: it
says there is no build or lint step (both exist now), lists 5 of the 9 automation
workflows, describes a bug that no longer exists, and says every push automatically
deploys — which is currently broken [facts §6]. The engineer-facing companion document
(CLAUDE.md) is wrong in four spots too: it names the dead legacy hosting project instead
of the live one, and its file counts have drifted [facts §6; owner-confirmed (D-12)].

**Requirement.** Each listed stale statement is corrected or explicitly marked as
historical, and the live identity — team `jayti2`, project `jpbir`, domain
`jaytipargal.tech` — is stated correctly everywhere it matters [owner-confirmed (D-12);
facts §6].

### BR-103 — Repair the broken deploy link

**Problem (owner language).** The owner said the dashboard does not reflect pushes, and
the recorded cause is that the connector between GitHub (where the code lives) and Vercel
(the hosting service, where the site runs) — the "GitHub App" — is not linked for this
repository's main branch in the live team, so pushes never trigger a deploy. Some
configuration values ("environment secrets" — names like `BLOB_READ_WRITE_TOKEN`,
`S24_SYNC_PUBLIC_KEYS`, `WA_INGEST_KEY`; values are never written in documents) are also
missing on the live project and need populating. Both actions are owner-owned on
vercel.com; agents never receive the values [owner-confirmed (D-12), (D-15); facts §3].
Additionally, the local command-line tool's link files point at two dead legacy projects,
which is a foot-gun while the real link is being repaired [facts §3].

**Requirement.** The push-to-deploy path works end to end, the missing configuration
values are populated on the live project (owner action; agents never touch the values),
and the stale local link files are removed or re-pointed per the owner's choice in
section 6.

**Tags.** [owner-confirmed (D-12)] for the disconnected integration and missing secrets;
[owner-confirmed (D-15)] for the owner-owned re-link and secret actions; [facts §3] for
the local-link mismatch detail.

### BR-104 — Keep secrets out of the repository

**Problem (owner language).** The project's own hygiene scan (the fact sheet's section 5)
found no live secret in any tracked file at this commit — a clean baseline worth keeping.
The structural guards that prevent accidents (ignore rules for key files and environment
files, a deploy-time exclusion list, and repo-internal scanning tools) are all present
and must stay in force [facts §5].

**Requirement.** R1 keeps the clean baseline: the scan passes with zero real-secret
findings in tracked files, the guard rules remain in place, and the three on-disk
environment files recorded by the scan (root `.env.local`, `.vercel/.env.production.local`,
and one inside the duplicate checkout) are never read, printed, or committed [facts §5].

**Tags.** [facts §5] for the scan method, findings, and structural guards;
[owner-confirmed (D-16)] for "secret hygiene" being in scope.

### BR-105 — Verify the baseline protections are wired and working

**Problem (owner language).** The protections the pipeline depends on are already in
place, but they need a verified pass in R1: the GitHub ruleset (a rule the hosting site
enforces on a branch) that blocks history rewrites and deletions is active [owner-confirmed
(D-15)]; the audit skill is pinned to one exact hash-verified version [owner-confirmed
(D-7), (D-13)]; the daily local audit runs on a repaired schedule [owner-confirmed (D-5),
(D-14)]; and both backup files (a single-file archive of the whole repository, plus an
archive of untracked files) hash-verify against their recorded fingerprints, with the
off-machine copy on OneDrive already satisfied [owner-confirmed (D-2), (D-15)].

**Requirement.** R1 re-verifies each of these on demand and records the results; nothing
new is invented. The one protection that stays formally parked is the paid-plan branch
protection the owner declined (see section 5) [owner-confirmed (D-15)].

**Tags.** [owner-confirmed (D-2), (D-5), (D-7), (D-13), (D-15)] for each control; [facts
§7] for the consolidated production state.

---

## 3. Critical user journeys (existing — preserved, not changed)

These are the four journeys the product already performs today. R1 must not change them.
Each is tagged with how it is known and cited to the fact sheet.

### J-1: Owner views the dashboard

The owner opens `jaytipargal.tech` in a browser and sees the device dashboard.

- **Source:** [owner-confirmed (D-4)] — the owner confirmed live that the device-data
  endpoint (`/api/s24-public`) answers correctly with Firestore device data; the product
  description and live domain are also [owner-confirmed (PROFILE.md; D-4)]. Cited: facts
  §7 ("Live", "Product") and facts §3 (deploy contract, routes, pages).
- **Acceptance criterion (Given/When/Then):** Given R1 work is in progress, When the owner
  opens `jaytipargal.tech` at any time, Then the dashboard loads as it does today (same
  pages, same data, same behavior).

### J-2: A device reports telemetry/status

The phone, and the two laptops, periodically send their readings and status (telemetry =
the readings and status a device reports about itself) to the backend, which stores them.

- **Source:** [inferred-from-code; facts §1 (Backend handlers: `broker.js`,
  `device-enroll.js`, `device-heartbeat.js`), facts §4 (Firestore `devices` and
  `deviceKeys` collections; Postgres tables)]. No owner statement covers this flow's
  mechanics, so it is inferred from the code and configs.
- **Acceptance criterion (Given/When/Then):** Given a device is running its daemon (a
  small always-running background program), When the device sends its heartbeat (its
  regular "I'm alive" message), Then the backend accepts it and the dashboard reflects
  the device state as it does today.

### J-3: Owner sends a remote command

The owner sends a command to a device (for example "run this task"), the device picks it
up, runs it, and reports back.

- **Source:** [inferred-from-code; facts §1 (Backend handlers: `device-commands-poll.js`,
  `broker-command-claim.js`, `broker-command-complete.js`), facts §4 (the Firestore
  `devices` document carries the command queue that device daemons poll)]. This flow is
  visible only in code and configs, so it is inferred from the code.
- **Acceptance criterion (Given/When/Then):** Given a device is online, When the owner
  queues a command through the existing mechanism, Then the device claims it, executes
  it, and reports completion as it does today.

### J-4: WhatsApp media ingestion

WhatsApp messages and their media (photos, video, voice notes) arrive through the
ingestion flow and are stored: message text in the database, media bytes in Vercel's
file storage, reachable via the media proxy endpoint.

- **Source:** [inferred-from-code; facts §1 (Backend handlers: `wa-ingest.js`,
  `wa-media.js`, `wa-blob-upload.js`; WhatsApp tables in the schema), facts §4 (Vercel
  Blob stores hold the WhatsApp media bytes)]. The pipeline is visible in code, so it is
  inferred from the code. Note: the sensitivity rule for this data — WhatsApp content is
  the highest-sensitivity class and is kept out of logs, traces, prompts, and agent
  context — is [owner-confirmed (D-10)].
- **Acceptance criterion (Given/When/Then):** Given a WhatsApp message with media is
  received by the existing ingestion flow, When the message is processed, Then the text
  is stored in the database and the media bytes are stored in Vercel Blob exactly as
  today, with WhatsApp content still excluded from logs, traces, prompts, and agent
  context [owner-confirmed (D-10)].

**Preservation rule.** If any R1 task would change one of these journeys' behavior, that
task must stop and record the change as a decision for the owner before proceeding. R1
fixes are hygiene and wiring only; the journeys' visible behavior must not change.

---

## 4. Measurable acceptance criteria (Given/When/Then) per in-scope fix

### BR-101 — Repository cleanup and ignore-rule gaps

- **BR-101-a** — Given the repository's ignore rules as recorded in the fact sheet (only
  some untracked trees fenced off; `.git/info/exclude` hiding only two folders on this
  one machine) [facts §2], When the ignore-rule work completes, Then every untracked
  workspace tree listed in the fact sheet (`runs/`, `vscode-office/`, `jpbir/`,
  `scratch/`, `personal_folder_agent/`, `permanent_agent/`, `eka-runner/`,
  `eka-runner-private/`, `jayti/`, `dashboard/`, `Sandbox/`, `venv/`, `tools/`, `data/`,
  `logs/`, and the root log file) is either deleted, relocated outside the workspace, or
  covered by `.gitignore`, so that a plain "add everything" command cannot stage any of
  them.
  - **Verify:** run `git status --porcelain` after the change; no untracked tree listed
    above appears, and `git check-ignore` reports each remaining one as ignored.
- **BR-101-b** — Given the removal candidates in the fact sheet's section 2 list, When
  any deletion is proposed in R1, Then it happens only after the owner answers the
  matching question in section 6 and the answer is recorded as a decision.
  - **Verify:** each deletion traces to a recorded owner answer; nothing is deleted
    without one.
- **BR-101-c** — Given the question about tracked vendored code (section 6, question
  about the ~1,700 vendored files), When the owner chooses "document only, prune later"
  (the recommendation), Then R1 writes the live-code boundary into the technical
  requirements document and does not remove any tracked vendored file in R1.
  - **Verify:** tracked-file count in the vendored trees is unchanged at R1 end (unless
    the owner chose a different option).

### BR-102 — Documentation truthfulness

- **BR-102-a** — Given the four stale statements in the README and the four in the
  engineer-facing doc recorded in the fact sheet [facts §6], When the docs task
  completes, Then every one of them is either corrected to match the code and the live
  hosting identity, or explicitly rewritten as historical with a pointer to the current
  truth.
  - **Verify:** a checklist maps each of the 8 statements to its correction; the live
    identity (team `jayti2`, project `jpbir`, domain `jaytipargal.tech`) is stated
    correctly in both documents.
- **BR-102-b** — Given the remaining docs in the fact sheet's staleness table (the
  integration-state document, the workflow-count list), When the docs task completes,
  Then the integration-state document's counts either match the current tree or carry a
  visible "as of" date, and the workflow list matches the actual 9 workflows.
  - **Verify:** stated counts equal counts from a fresh listing, or the document carries
    the "as of" date.

### BR-103 — Deploy link repaired (push-to-deploy works)

**This is the fix the owner must confirm precisely.** The stated target behavior is:

- **BR-103-a** — Given a push to the `main` branch with a functional change, When the
  owner opens `jaytipargal.tech` within 10 minutes of the push, Then the dashboard
  reflects the pushed change.
  - This timing (10 minutes) and the exact meaning of "reflects the pushed change" are
    the owner's to confirm at sign-off — see section 6, question about the deploy
    target. The current reality is that pushes never reach the deployed site
    [owner-confirmed (D-12)].
- **BR-103-b** — Given the missing configuration names recorded in the owner-confirmed
  decision (`BLOB_READ_WRITE_TOKEN`, `S24_SYNC_PUBLIC_KEYS`, `WA_INGEST_KEY`, and any
  others on the manifest list) [owner-confirmed (D-12); facts §3], When the owner
  populates them on the live project (owner action on vercel.com; agents never receive
  or enter the values), Then the affected features work without errors caused by missing
  configuration.
  - **Verify:** the dashboard's data pages and the scheduled jobs run with no
    missing-configuration errors; a parity check (comparing live behavior with what the
    repository expects) passes.
- **BR-103-c** — Given the local link files point at two dead legacy projects [facts §3],
  When the owner chooses an option in section 6 (recommendation: delete them — they are
  regenerable), Then the local state no longer contains any pointer to a dead project.
  - **Verify:** no local link file references the legacy team or legacy project IDs.
- **BR-103-d** — Given the repo's rule that command-line deploys from CI (automated
  checks on code changes) were deliberately removed and must not be re-added [facts §3],
  When the deploy-link repair is designed, Then it uses the GitHub-to-Vercel connector
  only, with no command-line deploy re-introduced.
  - **Verify:** no new deploy step appears in the automation workflows.

### BR-104 — Secret hygiene baseline held

- **BR-104-a** — Given the clean scan baseline in the fact sheet (zero live-secret
  findings in tracked files) [facts §5], When the repo's secret-scan tools run at the end
  of R1, Then they report zero real-secret findings in tracked files (test fixtures and
  placeholder samples are expected and allowed).
  - **Verify:** the scan output lists only the known placeholder/fixture files, matching
    the fact sheet's table.
- **BR-104-b** — Given the three on-disk environment files recorded by the scan (root
  `.env.local`, the one inside `.vercel/`, and the one inside the duplicate checkout)
  [facts §5], When any R1 work happens, Then none of their values is ever read, printed,
  logged, or committed.
  - **Verify:** the repository's rules that exclude these file patterns remain in place;
    the audit confirms no such value entered the history.
- **BR-104-c** — Given the structural guards (ignore rules for key files and environment
  files, the deploy-time exclusion list) [facts §5], When R1 changes any of those files,
  Then the guard rules stay at least as strict as before the change.
  - **Verify:** a diff of the guard files shows no loosened rule.

### BR-105 — Baseline protections verified

- **BR-105-a** — Given the GitHub ruleset "pipeline-protected-branch" (rule id 25339138)
  that blocks history rewrites and deletions on the default branch [owner-confirmed
  (D-15)], When someone attempts such a change during R1, Then the hosting site rejects
  it.
  - **Verify:** a recorded test attempt is rejected (or the ruleset's configuration is
    re-confirmed unchanged on the repository settings page).
- **BR-105-b** — Given the pinned audit skill (fixed to one exact, hash-verified version)
  [owner-confirmed (D-7), (D-13)], When any R1 task runs, Then the skill file's recorded
  fingerprint still matches the recorded value.
  - **Verify:** the hash comparison passes against the recorded value.
- **BR-105-c** — Given the daily scheduled audit (a Windows scheduled task, repaired with
  durable paths) [owner-confirmed (D-5), (D-14)], When it runs at any point during R1,
  Then the self-test passes all checks and the audit reports all checks passing.
  - **Verify:** the last run's log shows the recorded pass counts.
- **BR-105-d** — Given the two backup files (repository archive and untracked archive)
  with recorded fingerprints [owner-confirmed (D-2), (D-15)], When the owner requests a
  fresh verification, Then both fingerprints match the recorded values and the
  off-machine copy on OneDrive is present and hash-identical.
  - **Verify:** both hashes match; the OneDrive copies match the local ones.

---

## 5. Out of scope for R1 (owner can veto any of these at sign-off)

D-16 says R1 is "stabilize and harden — no new features" [owner-confirmed (D-16)]. This
section lists what is explicitly NOT in R1 so the owner can strike any line before
signing. If the owner wants one of these in R1 instead, that is a scope change recorded
as a decision.

1. **No new dashboard features, pages, or endpoints.** The 8 live pages and the current
   set of API addresses stay exactly as they are [facts §1].
2. **No redesign or code rewrite.** The pages stay hand-written HTML with plain
   JavaScript; no framework is introduced [facts §1].
3. **No new devices.** The three-device fleet stays three; the broker (the middleman
   service devices check in with) keeps refusing any other identity [facts §1, §7].
4. **No device-installer changes.** The per-device installer kits stay byte-identical,
   checksum-pinned packages; they are not touched in R1 [facts §1].
5. **No tracked-vendored-code pruning** (unless the owner overrides the recommendation
   in section 6). The recommendation is to document the live-code boundary in R1 and
   prune in a later release with live verification [facts §2, Q-6 recommendation].
6. **No provider migration.** Vercel hosting, Neon Postgres, Firestore, and Vercel Blob
   all stay as they are [facts §3, §4; owner-confirmed (D-9)].
7. **No WhatsApp-pipeline changes.** The ingestion flow keeps its current behavior; the
   sensitivity rule (WhatsApp content kept out of logs, traces, prompts, agent context)
   is preserved [owner-confirmed (D-10)].
8. **No budget changes.** The budget constraint was already removed by the owner; R1 does
   not re-introduce one [owner-confirmed (D-11)].
9. **No paid-plan branch protection.** The owner chose to keep the repository private and
   not upgrade, so the paid-plan-only protections (required reviewers, required status
   checks) stay formally parked; the free-plan ruleset that blocks history rewrites and
   deletions remains the active compensating control [owner-confirmed (D-15)].
10. **No deletion of the 25.5 GB `runs/` recovered-data exports** without a separate,
    explicit owner decision — that data has the highest sensitivity classification
    [facts §2; owner-confirmed (D-10)].
11. **No retirement of the DynamoDB migration machinery** unless the owner confirms the
    migration is complete (section 6, first question). Nothing is deleted before the
    store is proven empty [facts §4; facts §8].

---

## 6. Risks & open questions for the owner

Each question is phrased so it can be answered YES or NO, with the options spelled out
and a recommendation. Answering these finalizes the R1 scope at the T-06 sign-off.

**Q-BRD-1: Is AWS DynamoDB still a live data store, or already retired?**
Why it matters: some code and one scheduled job still copy data out of it, but the
target manifest has no AWS entry and the profile never mentions it [facts §4, §8].
- YES (still live) → add it to the target manifest and document it.
- NO (migration finished) → retire the copy job, the backfill workflow, and the
  AWS code-library dependencies in R1.
- UNSURE → run a read-only check first (recommended before any retirement).
**Recommendation:** verify read-only first, then act; do not delete anything before the
store is proven empty [facts §8 Q-1].

**Q-BRD-2: Should the obvious untracked debris be deleted now?**
Candidates: the orphaned `dashboard/` libraries folder, the all-cache `venv/` folder,
`personal_folder_agent/` leftovers, and the compiled `Sandbox/` debris [facts §2].
- YES → delete these four now, and add ignore rules for every remaining untracked tree.
- NO → only add ignore rules now; deletions move to a later release.
**Recommendation:** YES for these four (they are pure debris, regenerable or inert), plus
gitignoring everything; keep `runs/` deletion as a separate explicit decision
[facts §8 Q-2 recommendation].

**Q-BRD-3: Should the two tracked root skill-review copies be removed?**
(`SKILL (11).md` and `CICD_DevOps_Pipeline_Skill_v2.2_for_review (3).md` — stray copies
of the pinned audit skill) [facts §2, §6].
- YES → delete them from tracking.
- NO → move them to `archive/` (the repository's designated cold storage).
- NO → keep them where they are.
**Recommendation:** move to `archive/` — history stays inspectable and the root stays
clean [facts §8 Q-3 recommendation].

**Q-BRD-4: Is the `channel-sandbox` project still wanted, and in the live team?**
It deploys from this repository (from `Devices/sandbox/`) but is missing from the target
manifest, and its configuration values were left as an owner action [facts §3, §8].
- YES (wanted, in live team) → verify on vercel.com and add it to the target manifest.
- NO (no longer wanted) → delete the project and its `Devices/sandbox` config — but note
  it is used by an automation test, so a replacement plan is needed first.
**Recommendation:** YES — verify and record; do not delete without a replacement plan
[facts §8 Q-4 recommendation].

**Q-BRD-5: Should the local link files pointing at dead legacy projects be deleted?**
[facts §3]
- YES → delete them (they are regenerable, and no deploy script uses them).
- NO → owner re-points them at the live project while doing the GitHub App re-link.
- NO → leave them as they are (not recommended — foot-gun risk).
**Recommendation:** YES — delete them [facts §8 Q-5 recommendation].

**Q-BRD-6: Prune the tracked vendored code (~1,700 files) in R1, or only document?**
[facts §2, §8]
- YES (prune in R1) → delete unreachable vendored files and verify with tests, a deploy,
  and parity checks — but this changes what the deployed repository contains and goes
  beyond "production stays as it is" [owner-confirmed (D-16)].
- NO (document only) → write the live-code boundary into the technical requirements
  document; pruning moves to a later release.
**Recommendation:** NO — document only in R1, given the "production stays as it is"
direction [facts §8 Q-6 recommendation].

**Q-BRD-7: Confirm the droplet record and the product profile are still accurate?**
The droplet target (`runner.jaytipargal.tech`, its region, its size) and the product
description in the profile are recorded but were never re-confirmed by the owner
[owner-confirmed (D-15) "not yet given"; facts §7].
- YES → confirmed as recorded.
- NO → the owner corrects the specific fields.
**Recommendation:** YES — no code evidence contradicts them [facts §8 Q-7 recommendation].

**Q-BRD-8: Confirm the deploy acceptance criterion (the one the owner must calibrate).**
The proposed criterion: "Given a push to `main` with a functional change, When the owner
opens `jaytipargal.tech` within 10 minutes, Then the dashboard reflects the pushed
change" [owner-confirmed (D-12) that it is broken today; facts §3].
- YES → 10 minutes and this wording are accepted as the R1 target.
- NO → the owner states the timing and the exact meaning of "reflects the pushed
  change" (for example: a changed number on the dashboard, a new page, or any visible
  difference).
**Recommendation:** YES — 10 minutes is a reasonable target given the connector's normal
behavior; the owner can tighten or loosen it.

**Risks (with mitigations):**

- **Risk: cleanup touches something live.** Mitigation: the recommendation is to prune
  only untracked debris in R1 and document the tracked-vendored boundary instead
  (Q-BRD-6); production stays as it is [owner-confirmed (D-16)].
- **Risk: the ignore-rule work is done before the owner answers Q-BRD-2/Q-BRD-3, and a
  later decision contradicts it.** Mitigation: ignore rules only fence things off; they
  delete nothing, and any deletion is a separate recorded decision.
- **Risk: the DynamoDB machinery is retired while the store is still live.** Mitigation:
  nothing is deleted before a read-only check proves it empty (Q-BRD-1) [facts §8 Q-1].
- **Risk: BR-103 cannot finish because the owner-owned Vercel actions wait.** Mitigation:
  the re-link and secret population are recorded owner actions [owner-confirmed (D-15)];
  every other R1 task proceeds without them, and BR-103 completion is verified after the
  owner acts.
- **Risk: the `runs/` tree is deleted as "debris" by mistake.** Mitigation: it is
  excluded from any blanket deletion and listed out of scope (section 5, line 10)
  [owner-confirmed (D-10) sensitivity class].

---

## Sign-off checklist for the owner (at T-06)

- [ ] Approve the release goal (section 1).
- [ ] Approve each in-scope fix BR-101..BR-105 (section 2) and its acceptance criteria
      (section 4).
- [ ] Confirm the four journeys (section 3) are complete and correctly described — add
      any missing journey before signing.
- [ ] Confirm the deploy criterion wording and timing (Q-BRD-8).
- [ ] Answer Q-BRD-1 through Q-BRD-7.
- [ ] Review the out-of-scope list (section 5) and veto any line that should be in R1.
