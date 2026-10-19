# Profile - jpbir (run R1)

Assembled 2026-10-18 from the owner-confirmed decisions D-1 to D-12 during the
run resume. Every statement here traces to a decision in project/decisions.md.

## Product

**jpbir** ("Jayti Device Dashboard"): real-time device monitoring, telemetry and
remote command for the machines behind [jaytipargal.tech](https://jaytipargal.tech).
Browser dashboard (static HTML) + Vercel serverless API + Neon-backed analytics;
device data in Firestore (eka-agent db), Postgres (Neon), WhatsApp media in
Vercel Blob.

## Profile type

SaaS / web app (container for builds, provider runtime for hosting).
Release unit: the deployed Vercel project. **Production = jaytipargal.tech**,
served by Vercel team `jayti2`, project `jpbir` (verified 2026-10-12, D-12,
deployment `dpl_BzR5Z8UMxeBu2HDp4dDRpTG7JYpE` at commit `f6e21fc`, READY).

## Risk tier: Internal (owner-confirmed, D-1)

Ceremony scales to the tier: one agent may play every role, reviews labelled
self-review. Targets: availability 99.5%, p95 1 s, RPO 24 h, RTO 24 h, restore
drill before first launch then yearly.

## Compliance scope (D-10)

Jurisdiction: India; obligation: India's DPDP Act. Data categories: device
telemetry, WhatsApp content/media (highest-sensitivity class - kept out of
logs, traces, prompts and agent context), device identifiers, IP/fingerprint.

## Budgets (D-11, owner decision 2026-10-12)

The owner removed the budget constraint: contract rule 8 (hard budget) is NOT
enforced for this run - no ceilings, no spend warnings or pauses, no per-task
AI usage budget, no cost-estimate approval gate. The owner accepts cost risk.

## Backup and recovery (D-2)

Backup destination: `C:\Users\abcom\.local\share\kilo\cicd-backups`:
git bundle `jpbir-20261012-072232.bundle` (133.63 MB, SHA-256
`8018DA68AE3A9FB59F5DDB8B250EA5168152613E99FC923EB73F1FC48805E4CA`) and
untracked archive `jpbir-untracked-20261012-072820.zip` (SHA-256
`124A6EE2842D663DF554CFEEDF5B4629747684439079BDBA6D6541499678BFB4`).
Both hashes re-verified 2026-10-18 during the run resume. An off-machine
second copy (3-2-1) is still owed - owner decision pending.

## Environment manifest (D-8)

`project/environment/Dockerfile` (`node:24.16.0-bookworm-slim`, digest pinned at
first build), `project/environment/compose.yaml` (dev service + pinned
`postgres:16.4-bookworm`), entry point `project/environment/run`. Python 3.14.6
(`C:\Users\abcom\AppData\Local\Python\bin\python.exe`) for tracker.py.

## Departments for this profile

Skill defaults (QA, Security, DevOps, Documentation) plus Frontend, Backend,
Database. No Design department for this release: the dashboard is hand-written
static HTML with no new design scope (per CLAUDE.md; revisit if the release
scope changes).