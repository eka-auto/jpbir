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

### D-13: jp-agent moves off the DigitalOcean droplet to Railway (owner, 2026-10-18) — superseded by D-14

Owner direction: *"remove droplet, now it's Railway jayti > Services."* jp-agent now
runs as the `jp-agent` Web Service (`srv-dbalg58m7kps739ap6gg`) in the `jayti` Railway
workspace, beside a Key Value service `jayti` (`red-dba01dbncjis73asg3tg`).

The droplet (`runner-jp-agent`, `runner.jaytipargal.tech`) is marked RETIRING in
`project/targets.json` rather than deleted, because it is still the live runtime for
Vercel's `/api/agent-run` and for `/mcp`. It is destroyed only after the cut-over in
`project/reports/2026-10-19-retire-jp-agent-droplet.md` §6 passes.

Removed from the repository now: `deploy-droplet.yml` (which never succeeded once),
`setup-runner.sh`, the self-hosted label list in `.github/actionlint.yaml`, and the
droplet wording in `ci-cd.yml` and `Server/jp-agent/package.json`. Kept as the rollback
path until the droplet is destroyed: `deploy.sh`, `deploy-local.sh`, both systemd units,
`nginx-jp-agent.conf`, `sync-auth-token.py`.

Not covered by the move, and therefore open: workspace persistence (Railway's
filesystem is ephemeral, and a surviving workspace is this service's whole purpose),
`S24_SERVICE_ACCOUNT_KEY` being a file path rather than inline JSON, a home for
`s24-mcp` (the droplet's second unit, `:8792`), and how `ANTHROPIC_AUTH_TOKEN` reaches
the SDK without the droplet's `~/.claude/settings.json` step.

This retirement also removes the repository's only self-hosted runner: with the hosted
runners still billing-locked, CI is left with no runner at all.

### D-14: Render is the single deployment target (owner, 2026-10-19)

Owner direction: *"remove railway, droplet vultr from entire github repo globally and
render is the final place for all now."*

- `project/targets.json` now declares one production target, `jp-agent-render` (Render web
  service `jp-agent`, workspace `jayti`). The DigitalOcean droplet and the Railway service
  it briefly used are gone from the manifest. D-9 and D-13 are superseded on the target
  question and left in place as the record of what was tried.
- Deleted from the repository: `deploy.sh`, `deploy-local.sh`, `jp-agent.service`,
  `s24-mcp.service`, `nginx-jp-agent.conf`, `sync-auth-token.py` and its test, and
  `setup-runner.sh`. There is no deploy script, ssh path, systemd unit or nginx config for
  jp-agent any more, and none should be added — a second deploy path is how the old host
  drifted.
- `render.yaml` declares the service from the repository, so the deploy shape is reviewable
  in a diff rather than clicked into a dashboard.
- Tests that pinned the deleted deploy script were rewritten to guard what a git deploy must
  still get right (`s24-mcp-deploy.test.mjs`; one `deploy.sh` assertion removed from
  `s24-attestation.test.mjs`, whose neighbouring byte-identical-module assertion is
  unchanged).
- Deliberately not touched, each for a stated reason: `Backend/eka_*.py` (verbatim drifted
  copies of `jayti/scripts`, which `CLAUDE.md` says to change in `jayti`),
  `_shared/docs/AGENT_DATABASE_ARCHITECTURE.md` (documents the Jayti Hub VPS, a different
  host this repo does not own), and the dated records under `project/reports/`. Editing any
  of them would falsify a record or re-introduce drift; ask and I will archive them out of
  the tree instead.

### Open items for the owner (Awaiting approval)
- Off-machine backup copy (3-2-1): upload the bundle to a second location.
- GitHub Pro upgrade (or make repo public) to unblock T-04 branch protection.
- Connect Vercel GitHub App for `jaytipargal/jpbir` in team `jayti2` settings to re-enable push-to-deploy.
- Populate unset secrets on `jayti2/jpbir` (BLOB_READ_WRITE_TOKEN, S24_SYNC_PUBLIC_KEYS, WA_INGEST_KEY, etc.).
