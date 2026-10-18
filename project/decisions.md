# Decisions — jpbir (cicd-devops-pipeline run R1)

## Step 0 (2026-10-12)

### D-1: Risk tier = Internal (owner-confirmed)
Owner chose Internal. Ceremony scales to the tier: one agent may play every role with reviews labelled self-review. Targets: availability 99.5%, p95 1 s, RPO 24 h, RTO 24 h, restore drills before first launch then yearly.

### D-2: Backup destination = local folder
`C:\Users\abcom\.local\share\kilo\cicd-backups`. Git bundle (133.63 MB, 22 refs, SHA-256 8018DA68AE3A9FB59F5DDB8B250EA5168152613E99FC923EB73F1FC48805E4CA) + untracked archive (SHA-256 124A6EE2842D663DF554CFEEDF5B4629747684439079BDBA6D6541499678BFB4). Off-machine copy still needed for 3-2-1 (task).

### D-3: No GitHub Apps — no-CI fallback (owner-confirmed)
Owner chose the no-CI fallback: the orchestrator runs `tracker.py apply-events` and `tracker.py audit` locally. App-dependent platform checks (branch protection, verifier-identity commits) are Blocked pending a CI/scheduler. GitHub Actions workflows (tracker.yml, hod-audit.yml) are added for when a CI runner is available.

### D-4: Product is live at jaytipargal.tech (owner-confirmed)
Confirmed this session: `/api/s24-public` returns 200 with Firestore device data.

### D-5: Persistent scheduler = Windows Task Scheduler
No CI runner on this machine. Registered Windows Task Scheduler task `jpbir-hod-audit` (daily 08:47 IST = 03:17 UTC) running `project/audit/run-hod-audit.cmd` (tracker.py selftest + audit). Verified locally: selftest 35/35 PASS, all audit checks PASS, exit 0.

### D-6: Branch protection blocked on GitHub Pro (T-04)
`gh` is authenticated as jaytipargal with admin:true on jaytipargal/jpbir, but setting branch protection on the private repo returns HTTP 403 "Upgrade to GitHub Pro or make this repository public." CODEOWNERS created; the binding branch-protection check is Blocked on the owner upgrading the plan or making the repo public.

### D-7: Pinned skill v2.2.0
Skill pinned at `project/audit/SKILL.md` (SHA-256 A9C2638531A0871E44B09CCC2398A99FA738A91B1C9ED1977576721759B1EBA3). tracker.py extracted (SHA-256 73E41A070C1455471A163FC33B1B226CED311BF181A4A211B2F7C9F73E324AED). selftest 35/35 PASS.

### D-8: Environment manifest
Dockerfile `node:24.16.0-bookworm-slim` (digest placeholder — pin at first build), compose.yaml with pinned `postgres:16.4-bookworm`, entry point `project/environment/run`. Python 3.14.6 for tracker.py (stdlib-only).

### D-9: Target manifest (5 targets)
vercel-jayti2 (team_gcqCiU4UgkhcUJGRGLZYaQiW), firestore-eka-agent (intrepid-stage-495117-q1, db eka-agent, SA kid 95f094fa2830...), neon-jaytibirthday-db (fancy-cloud-99501540), vercel-blob (store_vxETiZ3lYBeN, store_y8X2dcvEtuqy), jp-agent-droplet (runner.jaytipargal.tech — account/region to be verified by owner).

### D-10: Compliance scope
Jurisdiction: India. Data: device telemetry, WhatsApp content/media, device identifiers, IP/fingerprint. Obligation: India's DPDP Act. WhatsApp content is the highest-sensitivity class — kept out of logs, traces, prompts and agent context.

### D-11: Budget constraint removed (owner, 2026-10-12)
The owner removed the budget constraint. Contract rule 8 (hard budget) is NOT enforced for this run: no per-run or monthly budget ceilings, no 50%/80%/100% spend warnings or pauses, no per-task AI usage budget, no cost-estimate approval gate. The owner accepts cost risk. All other contract rules remain in force. The "Budgets" open item is closed as decided.

### D-12: Migration audit reconciliation — Live ownership confirmed in team jayti2 (2026-10-12)
Independent hosting and dashboard audit reconciled:
- **Live Ownership Confirmed**: The live domain `jaytipargal.tech` (and aliases `www.jaytipargal.tech`, `jpbir.vercel.app`) is active and served by project `jpbir` under team **`jayti2`** (`team_gcqCiU4UgkhcUJGRGLZYaQiW`) on production deployment `dpl_BzR5Z8UMxeBu2HDp4dDRpTG7JYpE` (`f6e21fc`, READY).
- **Legacy Context**: The prior blocked reference to `team_pbbZItTCyIkGsw6LeGrcWx0c` pertained to the legacy, billing-blocked (HTTP 402) `jayti-dashboard` project (`prj_ert0BAxafhopYg8tjtbOMcfjDI9r`). Because `jaytipargal.tech` has already been cut over to `jayti2/jpbir`, the team-boundary blocker does not restrict live hosting.
- **Issue #140 Reconciled**: Reopened with the verified hosting ownership confirmed under `jayti2`.
- **Remaining Open Items**: (1) Browser OAuth re-link of the Vercel GitHub App for `jaytipargal/jpbir` on branch `main` to restore push-to-deploy; (2) Populating missing environment secrets on `jayti2/jpbir`.

### Open items for the owner (Awaiting approval)
- Off-machine backup copy (3-2-1): upload the bundle to a second location.
- jp-agent-droplet account/region verification.
- GitHub Pro upgrade (or make repo public) to unblock T-04 branch protection.
- Connect Vercel GitHub App for `jaytipargal/jpbir` in team `jayti2` settings to re-enable push-to-deploy.
- Populate unset secrets on `jayti2/jpbir` (BLOB_READ_WRITE_TOKEN, S24_SYNC_PUBLIC_KEYS, WA_INGEST_KEY, etc.).

### D-13: Unrecorded control change reverted (2026-10-18, HOD-role finding)
Commit 286b1645 replaced the pinned skill (v2.2.0 -> a self-described "2.4.0" variant) and
tracker.py (35-check canonical -> 67-check extended tool requiring a --verifier-state argument)
without a decision record, review, or tracker upgrade - discovered during the 2026-10-18 resume
(the extended tool rejected the canonical audit invocation; selftest counted 67 vs the 35/35
recorded in D-7). Action: restored the canonical SKILL.md byte-for-byte from the owner's
installed skill (SHA-256 D6791D5AEC3C3CCD7462BFDF04E949E8A52302627FFD755839A0BC92F2C24D1A) and
re-extracted the canonical tracker.py from it per the skill's documented command. The 2.4.0
variant remains preserved in git history at commit 286b1645 for owner review; adopting any
extended variant must go through a reviewed upgrade (skill conformance), never a silent
replacement. The platform pointer blocks were also non-conforming (custom variant text);
normalized to the skill's exact block, with the local guidance kept outside the block.
Labelling: performed by the resume agent playing the HOD role (no-CI fallback per D-3;
single-identity mode per project/identities.json) using deterministic checks - this is
self-review, not independent human approval.

### D-14: Resume session 2026-10-18 - state repair
- Durable project-state checkout recreated at C:\Users\abcom\jpbir-project-state (the previous
  Temp worktree had been pruned; git worktree prune + fresh add at run tip 69ec45a7).
- project/audit/run-hod-audit.cmd recreated (lost with the pruned Temp worktree and never
  committed) using durable paths only; scheduled task re-verified live: LastTaskResult 0,
  log at C:\Users\abcom\jpbir-project-state\hod-audit-last.log.
- project/environment/ (Dockerfile, compose.yaml, run) recreated per D-8.
- project/targets.json completed to the six targets of D-9 plus source: added vercel-jayti2,
  firestore-eka-agent, neon-jaytibirthday-db, vercel-blob (the committed file held only
  source and jp-agent-droplet).
- project/PROFILE.md assembled from owner-confirmed decisions D-1, D-10, D-11 (+ D-2, D-4,
  D-8, D-12).
- Backup integrity re-verified: both SHA-256 hashes match D-2 exactly (bundle 8018DA68...,
  untracked archive 124A6EE2...).
- Canonical audit after repair: selftest 35/35 PASS, all audit checks PASS (tracker rules,
  STOP, append-only events, events applied, HOD-event match, TRACKER.md current, CONTRACT,
  pinned skill, pointers, targets).

### D-15: Owner decisions on resume (2026-10-18)
- **Branch protection**: the owner chose to keep the repository private and not upgrade a plan
  ("keep it private and skip this step no issue"). Per contract rule 1 an owner's refusal parks
  T-04 as Blocked - it is never Not required, because protected controls cannot be waived.
  Compensating control found and ACTIVATED: GitHub repository ruleset 25339138
  ("pipeline-protected-branch") enforces deletion + non-fast-forward protection on the default
  branch - this works on the free plan. Remaining gap on the free plan: required reviews,
  required status checks and CODEOWNERS enforcement; the Step 0 gate stays formally open on
  T-04 until the owner upgrades to GitHub Pro/Team or makes the repository public. Downstream
  work that does not depend on T-04 continues (Step 1).
- **Off-machine backup (3-2-1)**: owner approved OneDrive. Both backup files copied to
  C:\Users\abcom\OneDrive\cicd-backups\jpbir\ and hash-verified byte-identical
  (bundle 8018DA68..., untracked archive 124A6EE2...). The off-machine copy obligation from
  D-2 is satisfied via OneDrive sync.
- **Vercel**: the owner will re-link the GitHub App and set the missing secrets on vercel.com
  themselves (D-12 open item stays owner-owned; agents never receive the values).
- Droplet-record confirmation and PROFILE confirmation were not given this session; they stay
  listed as open items in the tracker decisions list.
