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

### Open items for the owner (Awaiting approval)
- Budgets per run and per month (contract rule 8): AI usage, Vercel, Neon, Firestore, Vercel Blob, droplet.
- Off-machine backup copy (3-2-1): upload the bundle to a second location.
- jp-agent-droplet account/region verification.
- GitHub Pro upgrade (or make repo public) to unblock T-04 branch protection.
