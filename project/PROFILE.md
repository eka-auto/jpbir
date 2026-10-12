# Profile — jpbir (Jayti Device Dashboard)

## Product
- **Name:** jpbir — Jayti Device Dashboard
- **What it does:** Real-time device monitoring, telemetry, and remote command for the machines behind jaytipargal.tech. A browser dashboard shows each enrolled device's status and analytics; a signed command broker lets the dashboard send work to those devices; a persistent agent runtime does longer-running jobs (shell, file edits, git, deploys) that a serverless function can't.
- **For whom:** the owner (Jayti Pargal) and the device fleet operators.
- **Live today:** yes, at https://jaytipargal.tech (Vercel). Confirmed this session: `/api/s24-public` returns 200 with Firestore device data.

## Profile combination
- **Product type:** SaaS / web app (static frontend + serverless API) — also carries a data/batch pipeline (telemetry sync) and an LLM/AI app component (the Anthropic agent in the device runtime).
- **Distribution:** web (Vercel).
- **Execution target:** serverless (Vercel Node functions) + a persistent agent runtime on the jp-agent droplet.
- **Statefulness:** stateful (Firestore, Neon Postgres, Vercel Blob).
- **Risk tier:** **Internal** (owner-confirmed 2026-10-12). Ceremony scales to the tier: one agent may play every role with reviews labelled self-review; availability target 99.5%, p95 1 s, RPO 24 h, RTO 24 h, restore drills before first launch then yearly.

## Default stack (what the owner already uses)
- **Hosting:** Vercel (static + serverless Node).
- **Data:** Firestore (project `intrepid-stage-495117-q1`, db `eka-agent`), Neon Postgres (`jaytibirthday-db` / `fancy-cloud-99501540`), Vercel Blob.
- **AI:** Anthropic API (the device-runtime agent).
- **Infra:** jp-agent droplet (runner.jaytipargal.tech) for the persistent agent runtime.

## Compliance scope
- **Jurisdiction:** India (owner is in India).
- **Data categories:** device telemetry, WhatsApp message content and media (the dashboard ingests WhatsApp), device identifiers, IP/fingerprint data.
- **Obligations:** India's DPDP Act (personal data). No PCI DSS, no HIPAA. WhatsApp content is the highest-sensitivity data class — it must stay out of logs, traces, prompts and agent context.

## Budgets
- **Removed by the owner (2026-10-12, decision D-11):** no budget ceilings, spend warnings, or cost-approval gates for this run (contract rule 8 not enforced). Owner accepts cost risk.

## Recovery targets (Internal tier defaults)
- Availability 99.5%, p95 latency 1 s, RPO 24 h, RTO 24 h, restore drills before first launch then yearly.

## Platform capability inventory (contract rule 2)
- **Separate agents:** this platform (Kilo/Claude Code) can run sub-agents, but the skill's orchestrator dispatches every agent itself (no nested agents).
- **Scheduler:** no persistent CI scheduler available on this machine (no GitHub Actions runner here). The owner chose the **no-CI fallback**: the orchestrator runs `tracker.py apply-events` and `tracker.py audit` locally. The scheduled-audit task (T-05) is therefore Blocked on a persistent scheduler unless the owner provides one (e.g. a GitHub Actions cron on the repo, or a local Task Scheduler entry).
- **Network:** egress to Vercel, Google (Firestore/OAuth), Neon, Anthropic confirmed working this session.
- **OS:** Windows 11 (PowerShell 5.1, Python 3.14.6, Node 24, git).

## Decisions recorded
- D-1: Risk tier = Internal (owner, 2026-10-12).
- D-2: Backup destination = local folder `C:\Users\abcom\.local\share\kilo\cicd-backups` (owner, 2026-10-12). Off-machine copy still needed for 3-2-1; recorded as a task.
- D-3: GitHub Apps = not created; using the no-CI fallback (orchestrator runs tracker + audit locally). App-dependent platform checks (branch protection, verifier-identity commits) are Blocked pending a CI/scheduler.
- D-4: Product is live at jaytipargal.tech (owner, 2026-10-12).
- D-11: Budget constraint removed by the owner (2026-10-12) — contract rule 8 not enforced this run.
