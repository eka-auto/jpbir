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

### D-16: Release R1 scope direction (owner, 2026-10-18)
The owner chose "stabilize and harden" for release R1: no new features. R1 delivers the
inherited-debt fixes (bloated vendored trees, stale documentation, disconnected Vercel
push-to-deploy, secret hygiene), wiring of the protections and controls this pipeline needs,
and documentation - with production staying as it is. The formal scope freeze and BRD
approval happen in Step 1 (T-06); this decision sets the direction. BRD/TRD drafting starts
from this scope; remaining owner questions get batched there.

### D-17: Render is the single deployment target for jp-agent (owner, 2026-10-19)

Owner direction: *"remove railway, droplet vultr from entire github repo globally and render
is the final place for all now."*

- The jp-agent entry in `project/targets.json` is now `jp-agent-render`, a Render web service
  in the `jayti` workspace. The DigitalOcean droplet and the Railway service that briefly
  replaced it earlier the same day are both gone from the manifest; D-9's target list is
  superseded on the jp-agent question. D-13 (HOD control-change finding) is untouched.
- Deleted: `deploy.sh`, `deploy-local.sh`, `jp-agent.service`, `s24-mcp.service`,
  `nginx-jp-agent.conf`, `sync-auth-token.py` and its test, and `setup-runner.sh`. There is
  no deploy script, ssh path, systemd unit or nginx config for jp-agent any more, and none
  should be added - a second deploy path is how the old host was allowed to drift.
- `render.yaml` declares the service from the repository, so the deploy shape is reviewable
  in a diff instead of clicked into a dashboard.
- Tests that pinned the deleted deploy script were rewritten to guard what a git deploy must
  still get right (`s24-mcp-deploy.test.mjs`; one `deploy.sh` assertion removed from
  `s24-attestation.test.mjs`, whose neighbouring byte-identical-module assertion is
  unchanged).
- The three workflow files could not be changed from this identity - GitHub refuses workflow
  files from an App without the `workflows` permission - so they ship as
  `project/reports/2026-10-19-retire-jp-agent-droplet.patch`.
- Deliberately not touched, each for a stated reason: `Backend/eka_*.py` (verbatim drifted
  copies of `jayti/scripts`, which `CLAUDE.md` says to change in `jayti`),
  `_shared/docs/AGENT_DATABASE_ARCHITECTURE.md` (documents the Jayti Hub VPS, a different
  host this repo does not own), and the dated records under `project/reports/`. Editing any
  of them would falsify a record or re-introduce drift; ask and I will archive them out of
  the tree instead.
- **Verified live 2026-10-19** (probed from an agent shell, evidence in
  `project/reports/2026-10-19-render-live-verification.md`): `runner.jaytipargal.tech` and
  `jp-agent.onrender.com` resolve to `gcp-us-west1-1.origin.onrender.com` via Cloudflare;
  `GET /health` returns `200 {"ok":true,"service":"jp-agent","mcp":"in-process"}`, which is
  byte-for-byte the shape `server.mjs` emits, so the live service runs this code;
  `/sessions` answers 401 unauthenticated; TLS CN=`runner.jaytipargal.tech`, valid to
  2027-01-17. The workspace disk and the `S24_SERVICE_ACCOUNT_KEY` path are **not** proven by
  any of this and still need one real agent turn and one `s24-*` tool call.

### D-18: The source repository moved to `eka-auto`; the immutable ID did not (devops, 2026-10-22)

Reconciled for contract rule 11 before any push: every external action compares the
authenticated identity and the resolved resource IDs with `project/targets.json`.

- `jaytipargal/jpbir` now **redirects to `eka-auto/jpbir`**. GitHub's own redirect is the
  proof that this is the same repository and not a new one: `repos/1350770272` still answers
  with `id: 1350770272` and `owner.login: eka-auto`, and `gh repo view jaytipargal/jpbir`
  resolves to `eka-auto/jpbir`. The repository was **transferred**, not forked - `isFork` is
  false and `parent` is null, so the immutable repository ID in the manifest still identifies
  the same resource.
- The manifest therefore keeps `repository_id: 1350770272` and changes only the name, to
  `eka-auto/jpbir`. An ID that survives a transfer is the strongest possible binding; a name
  is not.
- **Visibility changed**: the repository is `public` (`private: false`, `visibility: public`).
  D-15 recorded the owner's choice to keep it private. The transfer changed that, so it is
  recorded here rather than left as a silent difference between the register and the world.
- **Access drift, recorded not used**: `project/ACCESS.md` registered `eka-auto` as a
  collaborator with `write` and `admin: false`. GitHub now reports `admin: true` on the same
  repository, because the repository itself now belongs to that account. Contract rule 11 says
  an identity that holds more access than recorded **stops that action**. So the extra
  privilege is not used: this work pushes a branch and opens a pull request, and does not
  merge to `main`, does not touch the ruleset and does not deploy. The register is corrected
  to the truth and the narrowed operating scope is kept in the scope column.
- The local git identity is the personal login `jaytipargal`; it holds `write`. It is not
  used for commits, because the register names automation identities and rule 11 forbids
  acting through a person's login. The push uses the registered `eka-auto` automation
  identity, within its recorded scope.

### D-19: A strict readiness verdict is separate from the panel's colour (devops, 2026-10-22)

The live panel answered `overall: "ok"` while six rows were failing and two had no evidence
at all. The cause was arithmetic, not a bad reading: `overall` was
`fail ? fail : warn ? warn : ok`, so *unknown* was not a state it could express, and a
snapshot with unproven rows and no failures was indistinguishable from a healthy one.

- `overall` is now the worst status any row carries, **unknown included**. A subsystem
  nobody could reach is not the same as a healthy one.
- `readiness` is a new, release-facing object: `ready`, `verdict` (`pass`, `warn`, `fail`,
  `unproven`), the reason, and the rows that are holding the gate up. `ready` is true only
  when every required row is proven green.
- A row whose status this code does not understand counts as unproven, not as a pass.
- The acceptance bar for this release is zero failures, zero warnings and zero unproven
  rows, so a warning keeps the gate closed too, and says which row.
- The navigation dot had the same defect (`s.ok ? 'ok'` painted green over eight unproven
  rows) and now ranks unknown above ok.

### D-20: The two rows with no live signal are proved from outside, not waved through (devops, 2026-10-22)

`Devices/S24/runtime_contract.json` and `Database/scripts/migrate.mjs` sat on a `static`
probe hard-coded to `unknown`: honest, permanently grey, and the reason "38 rows proven
green" was unreachable by construction.

- The proof no longer has to come from a request handler. A protected CI job runs the checks
  that can be run outside one - the migration runner against a **fresh** isolated database,
  the device bundle against the contract it pins, the shared production ledger against this
  repository's file list - and publishes a **signed receipt per revision**.
- The receipt is the only thing the panel accepts as evidence, and it is verified before the
  row may go green: the signature is recomputed, the digest is compared with the digest
  pinned in `Backend/lib/stack-subjects.js`, the producer must be a trusted workflow, the
  revision must be the one running, and the receipt must be unexpired. A missing, forged,
  expired, wrong-target or wrong-revision receipt leaves the row **unproven**, which keeps
  the release gate closed.
- Receipts are kept per revision. A receipt for revision Y says nothing about revision X,
  and one current document would have meant that preparing a new release silently
  invalidated the evidence of the revision still in production.
- The pinned digests are generated (`scripts/stack-subjects.mjs`) and CI runs the generator
  in `--check` mode, so a subject edited without re-pinning it fails the build instead of
  leaving a row permanently stale.
- The runtime-contract row additionally requires a **live attested device** reporting the
  contracted release. A contract file in a repository does not prove the phone runs it.

### D-21: Three receipts, not one: what ran, what it measured, what was delivered (devops, 2026-10-22)

The panel's "24x7 cron ran 2 minutes ago" line was written by whichever run touched the
document last, including one a person started by pressing "check now". A browser cannot
prove a schedule.

- Only a run the **platform scheduler** started writes the native receipt
  (`system/stackHealthNative`). A manual run writes the ordinary receipt and proves nothing
  about the unattended loop. The panel and the outside monitor read the native one.
- The run receipt carries the **notification outcome**, written with the run rather than
  before it: a receipt that says "the run happened" while the alert it triggered was never
  delivered is the same half-truth this whole change exists to remove.
- The alert state machine works on the **verdict**, not on "is it failing". `unproven`
  alerts (silence is the failure mode), `warn` does not wake anyone at 03:00, and the
  RECOVERED mail may only be sent when the verdict is a proven pass or warning - a failure
  that becomes `unproven` never produces "all checks passing again".
- The cron route answers 503 unless the verdict is a proven pass or warning, so its HTTP
  status is a truthful readiness signal instead of a 200 over a broken product.
- An expiring lock keeps two overlapping ticks from both deciding to alert; the persisted
  alert state is the real backstop against a duplicate mail.
- The outside monitor reads the native receipt's age and **fails when the schedule is
  stale**. A Vercel cron cannot report its own absence; GitHub can, because it runs
  somewhere else. The monitor never invokes `/api/stack-cron`, because that would update the
  receipt it is supposed to be inspecting.

### D-22: The S24 is judged by the shared attestation policy, on its own schedule (devops, 2026-10-22)

The live fleet on 2026-10-21: the two laptops reported within the minute, and the S24 had
last reported 8548 minutes earlier - about six days - running
`s24-termux-https-worker-2026-07-27.1` over `termux-direct-cloud`. That is the **legacy
collector**, not the signed broker daemon the runtime contract requires, so the device's
evidence is not the evidence the contract describes.

- The panel judges the S24 with `Backend/lib/s24-attestation.js`, the module the dashboard
  and the jp-agent already share, so the three can never disagree about whether the phone is
  alive. The panel is not a third liveness policy.
- The freshness **bound** is the device's own declared reporting period (its runtime
  contract schedules the broker daemon through Termux JobScheduler every 15 minutes), not
  the module's default five minutes. A phone that is exactly following its contract must
  not read as offline for two thirds of every cycle. The bound became an explicit input to
  the shared module; the default is unchanged, so the dashboard and the jp-agent behave
  exactly as before.
- A heartbeat dated in the **future** is a failure, not a fresh reading. The old arithmetic
  produced a negative age and every threshold below it was "not exceeded", so a writer that
  set its own timestamp to tomorrow read as perfectly alive.
- Every fleet device is judged even when it has no document at all, so a device that never
  enrolled cannot drop out of the denominator.
- **The device itself is not repaired from here.** There is no inbound listener by design,
  the phone has not reported in six days, and the command queue it would poll is unclaimed.
  A physical action is requested only when no verified remote execution path can perform
  the recovery; that is the case here. The smallest owner action is recorded in the report.

### D-23: The migration proof needs the isolated database, and the isolated database needed TLS (devops, 2026-10-22)

Running the proof found a real defect: `Integrations/postgres.js` passed
`ssl: { rejectUnauthorized: true }` to every pool, which is right for Neon and fatal for the
isolated Postgres in `project/environment`, so **the migration runner could not run in the
pinned environment at all**.

- node-postgres ignores a connection string's `sslmode` entirely once an `ssl` option is
  passed, so the register's "an explicit opt-out is not overridden" was true of the URL
  rewrite and false end to end.
- Now an **explicit** `sslmode=disable` is honoured, and nothing else is: a URL with no
  `sslmode`, or one that says `prefer`, `require` or `verify-ca`, still gets verify-full TLS
  with the certificate's hostname checked. The absence of the parameter still never means an
  unencrypted connection to production.
- The proof points at the isolated database with `sslmode=disable` deliberately. The
  production URL never carries it.

### D-24: The release controls protect main from deletion and force-push, and nothing else (devops, 2026-10-22)

Baseline for contract rule 11 and T-04, verified against the provider on 2026-10-22.

- Active ruleset `25339138` ("pipeline-protected-branch") applies to the default branch and
  enforces **deletion** and **non-fast-forward** only. `current_user_can_bypass: never`.
- It does **not** require status checks, pull-request reviews, linear history or code-owner
  review. There is no CODEOWNERS file in the repository. Any writer can push straight to
  `main` today.
- The GitHub billing lock recorded in T-04 is **gone**: `CI/CD Pipeline` and `Code Quality
  Checks` are green on `main` pushes and on pull requests (runs 39594539131,
  39594538771 and their predecessors on 2026-10-21), and the scheduled health check has been
  running green every ~15 minutes.
- Branch protection and code-ownership rules are protected controls. Changing them needs
  independent approval, so this work does **not** touch them. The remaining action is the
  owner's, and it is one click each in the repository settings.
- The new strict gate (`release-readiness.yml`) is added as a separate workflow rather than
  as a change to a protected control, so it can gate a release without anyone having to
  weaken or re-point an existing rule.
### D-25: The shared ledger has two writers, and the reconciliation must know the difference (devops, 2026-10-22)

PR #192 is merged and live at `ea706b12`. The strict readiness contract is now deployed and
working: `/api/jp-stack` answers with `readiness.verdict`, `readiness.reason` and
`schedule.present/stale/age_minutes`, and the native cron receipt carries `verdict`,
`notification` and `completed_at`. The verdict is `fail` for the six device rows, and the
schedule is alive — the native receipt is minutes old.

Receipt publication was blocked, and the reason was a real design error rather than a
transient fault.

- `schema_migrations` lives in one Neon database and **two** repositories write to it: this
  one and `jaytipargal/jaytibirthday-site`. The reconciliation asked "is every name in the
  production ledger explainable by THIS repository?" and answered no for eleven names. Ten
  of them belong to the sibling repository (verified against both of its local checkouts:
  `001_init.sql`, `002_enrich_events.sql`, `003_fix_city_decode.sql`,
  `007_site_api_enrichment.sql`, `008_slide_dwell_and_device_network.sql`,
  `009_device_telemetry.sql`, `010_normalize_event_telemetry.sql`, `010_session_duration.sql`,
  `011_web_vitals_and_client_probe.sql`, `012_reclean_whatsapp_senders.sql`). The eleventh,
  `010_telegram.sql`, was **ours**: applied by #189 on 2026-10-21 and retired the same day by
  #190, which replaced the Telegram stack with a copy of the WhatsApp client and added
  `013_drop_telegram.sql` to drop the tables it created. Its ledger row stays, because the
  migration did run.
- The alias map cannot carry this. It records migrations the two repositories **share**, and
  it changes what the runner does: a name listed there means "this file's SQL already ran
  under that name, skip it". Listing a foreign name there would make the runner skip a
  migration that still has to run — the sibling's `012_reclean_whatsapp_senders.sql` is a
  deliberate re-application of our `007_clean_whatsapp_senders.sql` under a new name, and
  treating the two as equivalents would stop ours from ever running.
- So the knowledge is kept in a separate reviewed manifest,
  `Database/schema/shared-ledger.json`: who else writes the ledger, which names are theirs
  (both the numbering they use now and the one they used earlier, because they renumbered
  without recording the equivalence in their own repository), and which of our own
  migrations are retired. The manifest changes only what the reconciliation BELIEVES; the
  alias map still decides what the runner does.
- The manifest may not name a migration this repository ships or records as an alias. That
  guard is the point: if it could, an unrecorded **rename** of one of our files would be
  waved through as "that is the sibling's", and the runner would re-apply a migration that
  has already run. `assertManifestAgreesWithTree` refuses such a manifest, and a suite pins
  it.
- The reconciliation is still one-directional on purpose: production having applied fewer
  migrations than this repository ships is a pending deploy and is reported, not failed on.
  Production having applied a migration nothing explains is a divergence and fails closed.

### D-26: Two defects of mine were found by the CI run, and one of them was raising a false alarm (devops, 2026-10-22)

Moving the checks into the project environment is what made these visible; they were
invisible while the checks ran on the runner. PR #193 repairs the first two and the third.

- **jq's `//` treats `false` as absent.** The outside monitor read the schedule with
  `jq -r '.schedule.stale // true'`, so a healthy schedule (`stale: false`) evaluated to
  `true` and the monitor announced "the unattended scheduler has not run for 2 min (max 20
  min) — the schedule is stopped" every fifteen minutes, for a scheduler that had run two
  minutes earlier. That is a false alarm manufactured by the monitor, which is the exact
  failure this whole change exists to remove. The reading is now
  `.schedule.stale != false`: `false` stays `false`, and a missing field still fails closed.
- **A runner path that only exists in a container.** The ledger reconciliation step wrote
  its report to `/workspace/ledger.json` while running on the runner, where `/workspace`
  does not exist, and died with `ENOENT` before the reconciliation could run at all.
- **A millisecond race in a test fixture.** The attestation compares
  `enrollment.lastSignedHeartbeatAt` with `lastSeen` as exact strings, and the fixture built
  the two from two separate `Date.now()` calls, so a millisecond boundary between them would
  turn the S24 red intermittently. One `lastSeen` now feeds both.
### D-27: The device's remote wake path was exercised, and it did not answer (devops, 2026-10-22)

The plan asks for a physical action on the phone only when no verified remote execution path
can perform the recovery, so the remote path was tried rather than assumed to be impossible.

- The phone's collector holds a persistent outbound listener on an ntfy.sh topic and wakes on a
  push. The topic is derived deterministically from the project id and the device id, and the
  phone's own source records that the topic is not a secret and that a wake event triggers a
  heartbeat, never a command.
- A wake event was published to `eka-s24-26a3af13e6164634f00b` at 2026-10-21T21:36:56Z and
  confirmed present on the topic (`id: wF1CwQww6E1u`).
- The device did not answer: at 21:42:25Z and at 21:44:38Z the live projection still reported
  `lastSeenCoarse: ">1d"`, `live: false` and `commandQueueDepth: 5` — the same stored snapshot
  as before, with the five queued commands still unclaimed.
- So the phone's Termux process and its listener are not running, or it listens on an
  overridden secret topic. There is no verified remote path left, and the device has to be
  recovered by hand: power it on, open Termux, run `Devices/S24/install_s24.sh`. The installer
  registers the Termux boot package and the JobScheduler job, so the daemon reports as
  `s24-termux-broker-2026-09-21.2` over `signed-broker-v2` instead of the legacy collector.
- Nothing else in the product is needed for it. When the device reports, the six device rows
  and the runtime-contract row go green on their own.
### D-28: The report's shape was defined in two places that had never met (devops, 2026-10-22)

Receipt publication failed on every run since PR #192 merged, with "the check report has no
entry for runtime-contract", while every proof on the page was green.

- The workflow's merge step wrote a subject's checks under `checks`; the publisher looked for
  them at the **top level** of the report. Two definitions of one shape, in a workflow snippet
  and in a script, neither covered by a test — which is how they survived a review and a merge.
  The ledger reconciliation was the only thing standing in front of it, and once that passed
  (PR #194) the mismatch surfaced.
- The shape now lives in `scripts/stack-merge-checks.mjs`, and the publisher reads it through
  `subjectChecksFrom`. The workflow calls the script instead of embedding a `node -e` snippet.
- The publisher computes each subject's result from **that subject's** checks rather than
  taking the report's overall result, and refuses to publish a subject whose checks did not
  pass — failing closed before anything is written, instead of writing a receipt that says
  "fail".
- The publisher no longer publishes when it is imported: the suite imports it to read the
  shape, and a module that published on import failed that suite with "FIREBASE_SERVICE_ACCOUNT_JSON
  is not configured".
- `_shared/tests/evidence-publish.test.mjs` runs the merge script and feeds its output to the
  publisher's reader, so the two halves are pinned against each other. A change of shape now
  breaks a test instead of a publication.
- The four proof reports are git-ignored: they are evidence for one CI run, bound to that
  run's revision, and a stale receipt in the tree would look like a proof.

### D-29: A CDN edge broke the browser download, and a network fault is not a defect (devops, 2026-10-22)

The `Lint & Test` job failed on PR #196 with `ERR_TLS_CERT_ALTNAME_INVALID`:
`cdn.playwright.dev` was served an `*.azureedge.net` certificate, so the Chromium download
failed and with it the job. Nothing in this repository caused it.

- The download is a network fetch, so it is now retried with a bounded backoff: three
  attempts, twenty seconds apart, and the job still fails if the browser cannot be fetched.
  Operating contract rule 6 draws the line exactly here — a transient fault is retried, a
  code or configuration defect gets a repair attempt, and only the second counts against the
  attempt budget.
- The job passed on the next run with the retry in place.
### D-30: The last seam, and what the debugging found at each boundary (devops, 2026-10-22)

With the two owner gates outstanding, the useful question was what would still keep the rows
red AFTER those gates close. Each boundary of the evidence path was walked and checked
against the provider, the broker and the device bundle, rather than against expectation.

**Boundary 1 — the device to the panel.** The broker stamps `lastSeen` and
`enrollment.lastSignedHeartbeatAt` with the SAME string (`Backend/device-heartbeat.js`),
so the attestation's exact string comparison holds; the enrolled `keyType` for the S24 is
`android-keystore-p256`; `device_agent.py` reports `agentVersion`
`s24-termux-broker-2026-09-21.2`, which is exactly the contract's `release`; and the
contract's `sourceType` of `live_daemon` is in the shared module's accepted set. **Sound.**

**Boundary 2 — the CI run to the deployment.** The live production deployment is built from
`githubCommitSha 91e78dd6d4e89f262e86fba58b154dbdcee3efb1`, which is main's HEAD, so the
publisher's `GITHUB_SHA` and the runtime's `VERCEL_GIT_COMMIT_SHA` are the same commit and
the revision binding holds. **Sound.**

**Boundary 3 — Firestore to the panel.** The publisher's encoder and the panel's decoder now
run over one body in a suite: the panel accepts what the publisher wrote and still refuses a
receipt altered after publication. **Proven, and it was the last untested seam.**

Two defects were found in the panel's own reporting, and both sent the reader the wrong way:

- A 404 on the evidence document was reported as "the CI evidence store is unreachable". The
  store answered perfectly; the DOCUMENT does not exist, because no receipt has been
  published yet. The live panel's reason did not match the actual cause, and I read it
  without noticing — which is the point: a wrong reason is worse than no reason, because it
  sends the reader to a system that is working.
- The revision check ran AFTER the store check, so a deployment that could not name its own
  revision would still have been reported as an unreachable store, and the real blocker would
  have stayed invisible.

`evidencePrecondition` now checks the revision first and the store second, and
`evidenceBundleFromResponse` tells a missing document from an unreadable store.

The general lesson, and the one worth keeping: the two things that were wrong were not in
the checks, and not in the cryptography. They were in the REASON the panel gave, and in the
ORDER it gave it. A verdict without a precise reason is a verdict the operator has to
re-derive by hand.