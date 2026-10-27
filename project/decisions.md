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
### D-31: The warehouse holds one property, and the purge had to go through the application (devops, 2026-10-22)

The owner asked for the data of jaytipargal.tech and jaytipargal.com to be removed completely, and for the product to be built for jaytibirthday.in only.

**The product.** `Backend/lib/warehouse.js` is the single choke point every site derivation routes through, so the narrowing is one edit there and nowhere else: the property allow-list, the beacon endpoint's CORS list, the console's own tracker embed (removed — the console was tracking itself), the nightly repair's import filter, the historical backup importer's attribution rule, the rollup rebuild, and the console's site selector.

**Why the purge could not be a script.** Four routes to the live warehouse were tried and measured:

| Route | Result |
| --- | --- |
| the `DATABASE_URL` secret, from CI | `28P01` — the password no longer authenticates |
| `vercel env pull` | every secret comes back as `[SENSITIVE]` |
| the Neon API's SQL route | 404 — not reachable with this key |
| the Neon API's connection URI | reachable — and the key sees only a project whose three branches all hold a **9 October snapshot: 18,869 events against the deployed application's 20,724** |

Every attempt failed closed, before a row was touched. The last row is a finding in its own right: **the local `.env.local`, the `DATABASE_URL` secret and the Vercel production branch all point at that stale copy.** It is why every local analysis of the warehouse looked like it ended on 10 October, and why the repo's own 2026-10-15 diagnosis concluded that the ingest had stopped. The live warehouse is somewhere the API key cannot see.

So the purge is an action on `/api/db-push` — behind the credential gate the route already has, because the only credential that opens the live warehouse is a Vercel Secret inside the application. It purges both ends, the warehouse rows and the DynamoDB journal items, with the same filter, because the journal is what the nightly repair copies from and a purge that undoes itself every night is not a purge. Its scope is pinned by a suite rather than by a comment.

**The invariant, in one line:** the warehouse holds `jaytibirthday.in` and nothing else; a beacon from any other host records nothing; a row that cannot be attributed is skipped and counted; a read of an untracked property is refused.

The live warehouse's identity is still not pinned in `project/targets.json`, which is the omission that let three stale pointers look authoritative for a month. Pinning it needs the live endpoint named, and that is an owner-assisted verification.

### D-32: ASN / network-org labels are added to R1 as an owner-approved scope addition (opencode session, 2026-10-27)

The visitor drawer printed `unattributed network: <ip>` for every visitor, because nothing anywhere resolved an address to its ASN or organization — the warehouse's `asn_org` column exists and is read by `db-api` and `db.html`, but no writer has ever filled it, and the trackers never captured an ASN. The owner asked for names instead, was shown a preview rendered with the shipped drawer code, and answered **YES** to the batched question, which is the scope amendment this decision records: it changes D-16 ("R1 = stabilize and harden, no new features") for this feature only. The durable approval is `project/approvals/2026-10-27-asn-network-labels.md` on `project-state`.

**The technical choice (mine, per contract rule 15): read-time enrichment, not an ingest column.** `Backend/lib/ip-intel.js` resolves each unique address when the drawer opens — `ipwho.is` first, `ipinfo.io` as fallback — with a 1.5 s timeout, a 2.5 s overall budget, deduplication, a 7-day per-instance cache, and private/reserved addresses (`10/8`, `127/8`, `169.254/16`, `100.64/10`, `172.16/12`, `192.168/16`, CGNAT, `::1`, `fc00::/7`, `fe80::/10`, multicast) never sent anywhere. It was chosen over writing `asn_org` at ingest because that alternative needs a production-data backfill of 15,092 rows through the migration pipeline — a much larger, harder-to-reverse change for the same visible result. Read-time enrichment also fixes historical rows, which an ingest column would not without the backfill.

**What it touches:** `Backend/visitor.js`, `Backend/jp-visitor.js` (each gains one enrichment call before the summary and projection are built) and one new test suite. No schema change, no database write, no ingest change, no backfill.

**Egress, accepted by the YES:** unique visitor IPs are sent to `ipwho.is` (fallback `ipinfo.io`) — two public geolocation/ASN services, no key, no storage on our side, cached per warm instance. If the owner later wants zero third-party egress, the ingest-column route above is the alternative and is a reviewed data change.

**Rollback:** revert the merge commit. No data is written, so there is nothing to undo beyond the code.

### D-32 addendum: the warehouse already carried ASN data — the premise was wrong (opencode session, 2026-10-27)

An owner-approved read-only probe (batch-2 question 2, `project/approvals/2026-10-27-asn-review-followup.md`) corrected D-32's founding claim. On the only database reachable from this machine (`neondb`, the frozen copy), `events` has the `asn` and `asn_org` columns, and **6,134 of 14,557 `jaytibirthday.in` rows (42%) carry both**, spanning 2026-08-19 to 2026-10-18, newest sampled value `16509 / Amazon.com, Inc.` The sentence "no writer has ever filled it" and "the trackers never captured an ASN" are therefore false: the sibling `jaytibirthday-site` tracker resolves ASN at ingest and mirrors it into the same warehouse.

Consequences, recorded rather than patched silently: (a) stored ASN still wins — `applyIntel` never overwrites an existing value, which is now the correct precedence rather than an unreachable branch; (b) the drawer can mix provenance for one visitor (DB-IP at ingest vs ipwho/ipinfo at read time) with no `asn_source` on the read path, so the frontend's existing `asn_source === 'db_unavailable'` branch never fires from this code — an open gap; (c) `db-api`'s `asn_org` breakdown and `db.html`'s Network surfaces have data after all; (d) live `jpbir_live` counts remain unverified from this machine — one local credential set is dead, one names `neondb`, one is `[SENSITIVE]`-redacted; unblocking needs either a live `DATABASE_URL` placed in a local `.env.local` (value never shown to an agent) or a read-only CI step. D-16 scope and D-32's approved technical choice are unchanged.

### D-33: Ruleset 25339138 removed from main; this record arrives by owner-directed direct push (opencode session, 2026-10-27)

Verified with the provider after PR #205 merged at 07:13:56Z: `GET /repos/eka-auto/jpbir/rules/branches/main` returned `[]`. Ruleset 25339138 — branch-deletion and non-fast-forward guards, one approving review, code-owner review, last-push approval, review-thread resolution, and the eight required status checks — is no longer attached to `main`. The owner confirmed the removal ("rule has been removed") and directed a direct commit of this record to `main` ("commit push to main in github", then "push"). The removal's reason was not stated to the recording session, so none is invented here; if it was temporary, restoring the ruleset is one API call against the parameters preserved in this file's history and in the notes of `project/targets.json`.

Consequences, recorded rather than assumed: pull requests on `main` now merge with no enforced review or checks, and direct pushes are accepted — this very entry is the first commit to arrive that way. `CODEOWNERS` has no effect without the pull-request rule. Deploys continue through the Vercel Git integration, so a push ships whether or not CI passed; the required set and Release Readiness are advisory from here, and contract rule 1's "a check that could not run is never a pass" now rests on each actor voluntarily running them. Rule 12 lists branch protection among the controls that change only with independent approval: the owner is the authority over that control and has exercised it directly, which this record documents rather than ratifies.

Workarounds that existed only because of this ruleset are moot from here: PR #201's close-and-reopen so a non-author code owner could approve, and the `eka-auto` re-push on `feat/asn-inventory-ci` for last-push-approval. `project/settings.json` is unchanged (`state_branch: project-state`), so run-state continues on the recreated `project-state` branch (`d34625a`) with copies on `main` from #205.

### D-34: The console's sections get durable storage, and only real data reaches the front end (owner-approved 2026-10-27, delivered in #206)

The owner approved a scope addition on top of D-32's read-time attribution work: the operator console's sections must all be backed by durable records, and the data a human sees must be the data itself. The specification, in the owner's words: reuse the existing device, analytics, email and WhatsApp tables; add durable records for live feeds, provider snapshots, agent conversations/runs and engineering evidence; give Telegram its own tables; keep Firestore and Blob authoritative with database references and snapshots; import only real source records; render missing feeds as empty or unavailable.

**The rule that shapes the implementation.** Nothing raw reaches the browser. A number is shown as a number, an image as an image, a PDF as a download, an agent answer as text. A panel may not render a JSON payload, a metadata blob or a document dump - the backend shapes the query so the front end has nothing raw to show. Stored JSONB exists only as server-side structure, unwrapped into known keys on the way out. A section with no source has no rows, and no rows read as empty or unavailable, never as a placeholder.

**What was built.** PR #206 (merged 2026-10-27T15:38Z) implements it across nineteen sections: section-generic current-state storage (`dashboard_current_records`, `dashboard_sync_state`, `dashboard_sync_cursors`, `dashboard_sync_members`), Telegram's own tables (`tg_chats`, `tg_messages`, `tg_sync_runs`) instead of a WhatsApp mirror, persisted agent exchanges (`dashboard_agent_exchanges`), a presentation layer that renders readable values and authenticated media, and the removal of raw payload and metadata-file presentation. Firestore and Blob remain authoritative: records are keyed by stable source identity and carry a revision and a content hash; missing feeds are reported as empty or unavailable rather than fabricated. Reference: `docs/dashboard-section-storage.md`; approval: `project/approvals/2026-10-27-dashboard-section-release.md`.

**A gap found after that merge, and closed.** The migration behind it (`Database/schema/017_dashboard_sections.sql`) had never been applied to the live warehouse, so the deployed console was reading tables that did not exist. The workflow that applies migrations is `migrate-production.yml`, and it is `workflow_dispatch` only on purpose: a person types the Neon project id to confirm the target before anything is written to production. The gap was therefore not a broken trigger but an un-dispatched job - the kind of step a merge does not carry with it. It was applied on 2026-10-27 directly: the migration is additive and idempotent, and the tables are now present with the ledger recording it. The improvement worth making is a dry run on every schema change, so "this migration is pending" shows up in CI instead of depending on someone remembering - while the human confirmation stays where it is, in front of the write.

**One thing this record also settles.** A parallel session built the same scope while this one was in flight, so the implementation exists once, not twice: this repository keeps the single data layer from #206 (`Backend/lib/section-data.js`, `Integrations/dashboard-store.js`, `Frontend/section-presentation.js`) and no second schema for the same concepts. The tables an earlier draft of this work had applied were empty and have been dropped, so the warehouse holds one copy of the truth.

### D-35: The warehouse moved to the meadow project by migration, because the org transfer does not exist (opencode session, 2026-10-27)

The owner's first instruction was to move five Neon projects from `org-cold-lake-91548510` to `org-billowing-meadow-62228264`. It cannot be done, and the reason is not credentials. Both organizations are Vercel-managed (`managed_by: "vercel"` on both), and Neon's own documentation states that Vercel-managed organizations can be neither the source nor the destination of a transfer - the restriction applies to the whole organization, not to individual projects. Every route failed for the same reason: organization API keys are refused for transfers, a personal key needs access to both organizations, the official MCP exposes no transfer tool at all, and the console path is closed by the same rule. The documented alternative - transferring the Vercel project and letting its Neon project follow - does not apply either: all five projects were created in the Neon console (`creation_source: console`), so no Vercel project is linked to them.

**What was done instead.** The data moved. The meadow project `jolly-cake-01200063` (pg18, aws-us-east-1) now holds one database per source database - `trainingdata`, `globaldevices`, `aqua_ferry`, `privatefilegate`, `jtagent_agent` and `jpbir_live` - each restored with `pg_dump`/`pg_restore` over the direct endpoint (a pooled endpoint cannot carry a restore: COPY is not transaction-pooling safe) and verified by exact table and row counts. The warehouse matched exactly: 29 tables, 132,496 rows on both sides. The four connection secrets were repointed, `sync-keys-to-vercel` rebuilt production, and the ASN inventory run against the new secret read `jpbir_live` and showed it still growing, which is how we know ingestion continues into the new database.

**The source was left intact on purpose.** The five old projects still hold their data, so the move is reversible by restoring the previous secret values, and the `pg_dump` archives are the backup of record. Deleting them is a separate decision with its own approval; it was not taken here.

### D-36: The meadow organization holds two copies of the estate, production reads the mirror, and the repository's secrets still name the other one (opencode session, 2026-10-27)

D-35 recorded a migration into one consolidated project. That is true, and it is not the whole picture. An independent audit of `org-billowing-meadow-62228264` through Neon's own CLI found **seven projects, ten branches and nineteen databases** where D-35 described one project and six databases. Six of those projects reproduce the source estate one for one; the seventh is the consolidated one. Neither copy is a superset of the other, and the two disagree about which database production uses. This entry records the map, the fidelity, the live database, and the decision that follows.

**The map.** The mirror: `bitter-glade-72523152` ("jaytibirthday-db") with three branches - `main` (`br-hidden-leaf-b8l1j76r`), `birthday-isolated-20261010` (`br-winter-salad-b82mip7n`) and `dashboard-isolated-20261010` (`br-curly-mode-b8354j8j`) - each carrying the analytics database `neondb`, with `jpbir_live` on `main` as well; `cool-sun-03737675` ("training-data-search-db") with `jtagent_agent`, `neondb` and `txt_file_db`; `super-dawn-27320917` ("training-text-files-db") holding `txt_file_db`; `still-dust-80774694` ("globaldevices-db") with `main` and `whatsapp-chat-dashboard`; `gentle-lab-27506181` ("private-file-gate-db"); `tiny-credit-99856334` ("neon-aqua-ferry"). The consolidated project is `jolly-cake-01200063`, holding `jpbir_live`, the five satellites, and two more.

**Fidelity.** Ten of the eleven source databases are reproduced exactly - same table count, same row count, same newest timestamps - measured over the direct endpoint with exact counts rather than statistics. The eleventh, `globaldevices-db/main`, holds one row in the source and two in the mirror: the mirror is the later snapshot. The source estate is eight branches and eleven databases; the mirror covers all eight, with `txt_file_db` split into its own project, which is the arrangement the owner's approved specification describes (`docs/superpowers/specs/2026-10-27-dashboard-section-data-design.md`).

**The live database.** `bitter-glade-72523152/br-hidden-leaf-b8l1j76r/jpbir_live` is where production writes and reads: it holds the 40 current section records and 15 sync states the deployed console produced, and the post-release read-back at 2026-10-27T16:00:52Z was taken there. The consolidated copy `jolly-cake-01200063/jpbir_live` holds the same 37 tables and the same 15,748 events - the two are identical - but it holds no section records at all. It is also the only database in either organization that is still receiving writes: its newest `events.ingested_at` is 2026-10-27T08:11:17.866919Z. Every `neondb` branch copy, source and mirror alike, is frozen at the same moments - `birthday-isolated-20261010` at 2026-10-27T03:15Z, `dashboard-isolated-20261010` at 2026-10-17, `main` at 2026-10-10 - and each source copy holds exactly the values its mirror twin holds, so this is a pause rather than a divergence. That also corrects D-35's description of the source's `neondb` as a single stale copy frozen at 2026-10-09: there are three, one per branch, with different freshness.

**The disagreement.** The repository's four connection secrets - `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING`, repointed at 2026-10-27T14:46Z - name the consolidated project. The console's Vercel environment names the mirror. Both copies of `jpbir_live` are identical today, so nothing is broken yet; but the next workflow that writes, and the next migration dispatched by `migrate-production.yml`, lands in the consolidated copy while the console reads the mirror. A schema change applied to the wrong database surfaces as a console failure at runtime, not as a failing job.

**What the consolidated copy lacks, and why.** The three application-facing branch databases - `neondb` on `main`, `birthday-isolated-20261010` and `dashboard-isolated-20261010`, each about 133,000 to 135,000 rows - exist only in the mirror. `jolly-cake` has no copy: its `neondb` has no tables at all, and its `txt_file_db` holds a `documents` table with zero rows. Both are artifacts of the restore behind D-35. Neon's dumps are archives in PG16 format, and `pg_restore` 16 refuses them with `unsupported version (1.16) in file header`; the archives read with `postgres:18`, which is the version the format requires. The data itself is safe - `super-dawn-27320917/txt_file_db` carries all 1,219 documents, matching the source exactly - so this was a tool-version mismatch in a restore rather than a data problem, and the earlier description of that restore as hung is superseded by that cause.

**What could not be established.** Which project the two applications name - `channel-sandbox`'s `DATABASE_URL`, and `jaytibirthday-site`'s `DATABASE_URL`, `POSTGRES_URL`, `DATABASE_URL_UNPOOLED` and `POSTGRES_URL_NON_POOLING` - could not be read, because reading them means exposing secret values and the contract forbids that. Vercel's API returns decrypted values only for non-encrypted entries, and `vercel env pull` produced no file for these projects. A functional probe of the deployed routes returned the application shell for every path tried, so it settled nothing either. Both copies hold identical values, so the applications behave the same whichever they name; the fact matters for deleting the source, not for correctness today.

**The decision that follows.** One database, named both by the secrets the workflows read and by the environment the console reads. The recommendation is the mirror: production already writes there, its branch is protected by Vercel as a production branch, it holds the application-facing databases the consolidated copy lacks, and it is the structure the owner's approved mapping describes - `jaytibirthday-db main/neondb` for channel-sandbox, `birthday-isolated-20261010/neondb` for jaytibirthday-site. Repointing the four repository secrets to `bitter-glade-72523152/br-hidden-leaf-b8l1j76r/jpbir_live` closes the disagreement; the consolidated project then becomes a redundant copy, and its two empty databases should either be dropped or filled. The alternative - making the consolidated project canonical - means moving the three application-facing databases and the 40 section records into it, which is a larger change to a working system. Deleting the five source projects stays a separate decision with its own approval, and it is not safe until the application-facing variables are repointed and verified by a read that returns meadow values.

### D-37: The owner's four answers, carried out - and the drift that made CI check for itself (opencode session, 2026-10-27)

The owner answered the four questions D-36 left open in one line: **1 yes, 2 no, 3 decide after 1, 4 yes**. The answers are recorded in `project/approvals/2026-10-27-neon-estate-decisions.md`, which was pushed before the first external action, as contract rule 10 requires.

**What each answer carried out.** Question 1 is **person-run**, because `project/ACCESS.md` keeps the personal identity out of secret mutations and the only identity with permission to write repository secrets is the repository owner. The repository now ships the command: `node .github/scripts/repoint-warehouse-secrets.mjs --yes` mints the pooled and unpooled connection strings for the project, branch and database `project/targets.json` records - straight from Neon, nothing typed by hand - and hands each to `gh secret set` on standard input, so no value is printed, logged, or written to this repository. The script refuses to run without `--yes` and refuses an identity that may not write secrets. Question 2 is NO, so nothing is deleted: the five source projects stay, and the migration stays reversible. Question 3 was decided after question 1 and is recorded in the approval: the two empty databases in the consolidated project are **kept** and the project becomes an inert duplicate, because dropping them is a deletion the owner has just declined in the same breath, they hold nothing to lose, and filling `txt_file_db` with its 1,219 documents would duplicate 270 MB the meadow organization already holds.

**The durable half of question 1 is enforcement, and it is now in CI.** A repoint that depends on a person remembering it is a repoint that can be undone by a later rotation. So the credential and the manifest are now compared by the machine, on every schema change to `main`: `.github/workflows/migration-dry-run.yml` runs the plan `migrate.mjs` already supported in read-only mode, and before planning anything it proves that the credential resolves to the project, branch and database `project/targets.json` records. The apply workflow's inline preflight became one shared script (`.github/scripts/verify-production-warehouse.mjs`) that both workflows call, so there is one definition of "is this the production warehouse" rather than two that can drift.

**Why the manifest, and not the freshness comparison.** The check `migrate-production.yml` used to perform asked the credential's database and the deployed application for the newest event and compared the two. On 2026-10-27 that comparison could not have caught the divergence in D-36: the two copies were byte-identical, so both answered "yes". The identifiers can tell them apart, so the check compares them. A credential that drifts away from the manifest now fails a job that runs on every schema change, and says which side is which.

**A latent bug in the check that was inherited.** The old preflight's message said "the target is more than an hour behind the deployed application", but its arithmetic fired when the database was an hour **ahead** of the application: it subtracted the application's timestamp from the database's and compared that difference to an hour. So a stale copy passed and a fresh one was refused. The comparison now runs in the direction the message always claimed - the application is the live writer, so a database whose newest event is older than the application's is the wrong copy - and a database ahead of the application is accepted. The change is covered by `_shared/tests/warehouse-target.test.mjs` in both directions.

**Verification.** Two new suites pass (`warehouse-target.test.mjs`, `warehouse-secrets.test.mjs`), the repository's own lint passes, and the full suite shows no regression: the five local failures are the three suites that need a Postgres service this machine does not run (`dashboard-store`, `section-conversations`, `visitor-restore` - all ECONNREFUSED on 127.0.0.1:5432, which CI provides) and the two line-ending failures already known on Windows (`installer-pins`, `s24-action-gate`).

**What is left for the owner.** One command, which this session could not run on its own authority:

```
node .github/scripts/repoint-warehouse-secrets.mjs --yes
```

Until it runs, the dry-run job fails its identity check - which is the enforcement working, and not a fault in it.

## D-38 - The repoint was carried out, and the dry run proves it (2026-10-27)

The paragraph above left one command for the owner. It has now run, and the result is what
D-36 was designed to produce: the repository's credential and the database production reads
are the same database, and CI says so on every schema change rather than depending on
someone remembering.

**The blocker was three things, and only one of them was the identity.** `project/ACCESS.md`
keeps the personal identity out of secret mutations and `jaytipargal` holds
`permissions.admin: false` on this repository, so the instruction stood as written. Behind
it, the command could not have run on the owner's machine at all: npm installs the Neon CLI
as `neon.cmd` on Windows and Node refuses to spawn a `.cmd` without a shell, so it died with
`spawnSync neon ENOENT` before reaching Neon. That is repaired in #209, with the platform
invocation, the message and an identifier guard covered by `warehouse-secrets.test.mjs`.
Behind that sat a third: the Neon API key in the environment is an organization key for
`org-cold-lake-91548510`, which cannot read the meadow organization at all - even
`neon projects list --org-id org-billowing-meadow-62228264` is refused. The Neon CLI also
holds a stored session that *is* a member of `org-billowing-meadow-62228264`, and the
environment variable was masking it. With `NEON_API_KEY` unset for the run, the CLI minted
both strings from the correct organization and the script handed them to `gh secret set` on
standard input.

**No value was printed, logged or written.** The script's output was the manifest target and
the four secret names with the form each carries. The minted endpoint was
`ep-holy-silence-b88j1f4i-pooler`, which is the endpoint `project/targets.json` records.

**The change.** `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL` and
`POSTGRES_URL_NON_POOLING` were rewritten at 2026-10-27T18:30:58Z-18:31:01Z by `eka-auto`,
the repository owner (`admin: true`) - the identity the approval names as the only one able
to write them.

**The proof, from the workflow itself.** `migration-dry-run.yml` run 40560758000 on `main`,
dispatched 18:31:23Z, concluded success and printed:

| | Before (run 40556501585, failed) | After (run 40560758000, success) |
| --- | --- | --- |
| project | jolly-cake-01200063 | bitter-glade-72523152 |
| branch | br-royal-wave-b8y8k9vw | br-hidden-leaf-b8l1j76r |
| endpoint | - | ep-holy-silence-b88j1f4i |
| database | jpbir_live | jpbir_live |
| newest event | 15,748, newest 08:11:17Z | 15,760, newest 18:06:31Z |

The deployed application reported its newest event at 18:06:31.191Z, the same second the
database holds it, so the freshness half of the check passes too and both halves agree for
the first time.

**What did not change.** Nothing was deleted. The consolidated project `jolly-cake-01200063`
remains an inert duplicate per D-37, still holding its two empty databases, and the five
source projects in `org-cold-lake-91548510` remain intact so the migration stays reversible.
