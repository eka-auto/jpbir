# Go-live registry — jpbir (run R1)

One row per capability from the Go-live registry of the pinned skill (`project/audit/SKILL.md`). Applicability is Mandatory or Not required (a Not required row carries a reason and a reviewer); status is Pending, Release-ready, Ready or Blocked, marked 2026-10-19 from `project/plans/r1-facts.md` ("fact §n") and `project/targets.json`. Release-ready = provisioned, accessible and smoke-verified for the release; Ready = every "Ready when" criterion met, with evidence, in production. The pipeline audit (`tracker.py registry_problems`) reads this table.

| ID | Capability | Applicability | Reason | Reviewer | Status | Evidence | Access |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-A1 | Client / Browser / Device | Mandatory | — | — | Release-ready | Live production verified 2026-10-12, deployment dpl_BzR5Z8UMxeBu2HDp4dDRpTG7JYpE READY (fact §3, §7; D-12); health checks every 15 min (fact §1) | Public entry point https://jaytipargal.tech (no credential) |
| R-A2 | DNS | Mandatory | — | — | Release-ready | jaytipargal.tech + www resolve and serve the READY production deployment (fact §3; targets.json vercel-jayti2); CAA / registrar lock not yet verified | Owner-held (registrar; served via Vercel team jayti2) |
| R-A3 | CDN / Edge | Mandatory | — | — | Release-ready | Frontend/ served as @vercel/static from the Vercel edge network; live 2026-10-12 (fact §3, §7; D-12) | Included in Vercel hosting (owner-held team jayti2) |
| R-A4 | Load balancer | Mandatory | — | — | Release-ready | Provided by the Vercel serverless platform (no LB objects provisioned); live traffic verified 2026-10-12 (fact §3, §7; D-12) | Included in Vercel hosting (owner-held team jayti2) |
| R-A5 | Web server / Reverse proxy | Mandatory | — | — | Pending | nginx + systemd units for droplet services committed in Server/jp-agent (fact §1); droplet runtime not recently smoke-verified (targets.json jp-agent-droplet) | — |
| R-A6 | Application runtime | Mandatory | — | — | Release-ready | 39 @vercel/node handlers building the live API (fact §3); /api/s24-public returning Firestore data confirmed live (fact §3; D-4) | ACCESS.md (deployer); Vercel team jayti2 |
| R-A7 | Database | Mandatory | — | — | Release-ready | Firestore eka-agent and Neon Postgres both live (fact §4; targets.json; D-4, D-9); migration tooling committed (fact §1) | Owner-held (Neon fancy-cloud-99501540; Firestore intrepid-stage-495117-q1) |
| R-B1 | Compute host / Server | Mandatory | — | — | Pending | Droplet runner-jp-agent provisioned, blr1, services 8790/8792 (targets.json; fact §7); current health not recently verified | — |
| R-B2 | Containerization | Not required | No container images built or shipped — production is Vercel serverless + static (fact §3); the D-8 Docker environment is development-only (fact §7) | orchestrator | — | — | — |
| R-B3 | Orchestration | Not required | No cluster or orchestrator; serverless platform plus one auxiliary droplet (fact §1, §3) | orchestrator | — | — | — |
| R-B4 | Infrastructure as code | Mandatory | — | — | Pending | No IaC files in the repo (fact §1-§3); production configured by hand — gap; scope decision carried to the Step-1 owner question batch | — |
| R-B5 | Process manager | Mandatory | — | — | Pending | systemd units jp-agent.service + s24-mcp.service committed (fact §1); droplet service state not recently verified (targets.json) | — |
| R-C1 | Environment variables / Secrets | Mandatory | — | — | Blocked | Missing env vars on jayti2/jpbir (fact §3; D-12: BLOB_READ_WRITE_TOKEN, S24_SYNC_PUBLIC_KEYS, WA_INGEST_KEY, etc.); unblocks when the owner sets them (D-15, owner action) | — |
| R-C2 | Open ports / Firewall | Mandatory | — | — | Pending | Only droplet ports 8790/8792 behind nginx declared for the auxiliary target (fact §1; targets.json); firewall state unverified | — |
| R-C3 | Object / File storage | Mandatory | — | — | Release-ready | Vercel Blob stores store_vxETiZ3lYBeN + store_y8X2dcvEtuqy live and wired in code (fact §4; targets.json; D-9) | Owner-held (Vercel Blob, team jayti2) |
| R-C4 | Cache | Not required | No cache provisioned; Internal low-traffic tool with no performance need identified (fact §7) | orchestrator | — | — | — |
| R-C5 | Queue / Background jobs | Mandatory | — | — | Pending | 4 Vercel cron jobs in production (fact §3); retries and dead-letter behavior not verified | — |
| R-C6 | Webhooks | Mandatory | — | — | Pending | Signature checks (P-256 s24 ingest) and replay guard in code (fact §1, §4); end-to-end retry/DLQ behavior unverified | — |
| R-D1 | SSL / TLS certificate | Mandatory | — | — | Release-ready | HTTPS live on jaytipargal.tech via Vercel-managed certificates; live 2026-10-12 (fact §3, §7; D-12) | Owner-held (Vercel team jayti2 — certificates) |
| R-D2 | Authentication & Authorization | Not required | No user accounts — static pages plus key-gated API routes (fact §1, §3); device identity via P-256 attestation (fact §1) | orchestrator | — | — | — |
| R-D3 | WAF / DDoS / Rate limiting | Not required | Risk tier Internal, low-risk single-owner tool (fact §7; D-1) | orchestrator | — | — | — |
| R-D4 | Dependency & image scanning | Mandatory | — | — | Pending | Secret scan in code-quality.yml (fact §1); no dependency or image scanning wired — gap | — |
| R-D5 | Build signing & provenance | Mandatory | — | — | Pending | No artifact signing, SBOM or provenance evidenced (fact §1-§3) — gap | — |
| R-D6 | Audit & compliance logging | Mandatory | — | — | Pending | DPDP obligations with personal data (fact §7; D-10); no audit-log facility evidenced (fact §4) — gap | — |
| R-D7 | Account ownership & access | Mandatory | — | — | Pending | ACCESS.md register exists but the verifier identity is pending owner setup (ACCESS.md); MFA and access review not evidenced (fact §7; D-15) | — |
| R-D8 | Vulnerability disclosure | Mandatory | — | — | Pending | No SECURITY.md or security.txt present (fact §6 docs table; repo file listing) — gap | — |
| R-D9 | Data retention & deletion | Mandatory | — | — | Pending | DPDP scope with device + WhatsApp data (fact §7; D-10); no retention or deletion jobs evidenced (fact §4) — gap | — |
| R-E1 | Source control (Git repo) | Mandatory | — | — | Blocked | Private repo jaytipargal/jpbir (targets.json); ruleset 25339138 enforcing deletion/non-fast-forward only — required reviews and status checks unavailable on free private plan (fact §7; D-15, T-04); unblocks by paid plan, going public, or owner acceptance | — |
| R-E2 | CI/CD pipeline | Mandatory | — | — | Blocked | ci-cd.yml runs lint + test (fact §1) but push-to-deploy is disconnected — GitHub App unlinked, missing secrets (fact §3; D-12, D-15); required checks blocked by T-04; unblocks via owner Vercel actions | — |
| R-E3 | Artifact / Container registry | Not required | Nothing pushed to a registry — Vercel builds serverless functions; device kits are committed bundles (fact §1) | orchestrator | — | — | — |
| R-F1 | Centralized logging | Mandatory | — | — | Pending | Platform logs only (Vercel); no log shipping, retention or levels configured in the repo (fact §1-§3) — later-step check | — |
| R-F2 | Monitoring & health checks | Mandatory | — | — | Pending | health-check.yml probes endpoints every 15 min (fact §1); no metrics or dashboards evidenced — later-step work | — |
| R-F3 | Error tracking | Mandatory | — | — | Pending | No error-tracking SDK in dependencies (fact §1) — gap | — |
| R-F4 | Alerting & on-call | Mandatory | — | — | Pending | No alert routing or on-call tooling evidenced (fact §1-§7); named responder not recorded — gap | — |
| R-F5 | Backups & disaster recovery | Mandatory | — | — | Pending | Repo bundle + untracked archive verified 2026-10-18, off-machine copy on OneDrive (fact §7; D-2, D-15); restore drill and data-store backup schedule not evidenced — later-step work | — |
| R-F6 | Cost monitoring & budgets | Mandatory | — | — | Pending | Owner removed the budget constraint for this run (fact §7; D-11) — no budgets or alerts configured; closure as Not required needs the owner as reviewer | — |
| R-G1 | Email / Notifications | Mandatory | — | — | Pending | nodemailer used by check-stale.js and stack-cron.js in production (fact §1 deps); sender verification and SPF/DKIM/DMARC unverified — later-step check | — |
| R-G2 | Analytics / Product tracking | Not required | No product-analytics SDK needed — device telemetry is the product itself (fact §1, §4) | orchestrator | — | — | — |
| R-G3 | Payments / Billing | Not required | Not commercial (fact §7) | orchestrator | — | — | — |
| R-G4 | Status page | Not required | Internal, single-owner user base (fact §7; D-1) | orchestrator | — | — | — |
| R-G5 | Feature flags | Not required | No gradual rollout or kill-switch need (fact §7; D-16) | orchestrator | — | — | — |
| R-G6 | Legal pages & consent | Mandatory | — | — | Pending | DPDP obligations (fact §7; D-10); no privacy policy or consent mechanism evidenced (fact §1, §6) — gap | — |
| R-G7 | Support channel | Not required | Internal tool; the owner handles support directly (fact §7; D-1) | orchestrator | — | — | — |
| R-H1 | Model / LLM API | Mandatory | — | — | Pending | Server/jp-agent uses @anthropic-ai/claude-agent-sdk (fact §1); key, fallback and timeout configuration unverified — later-step check | — |
| R-H2 | Vector database | Not required | No retrieval or semantic search in production (fact §4) | orchestrator | — | — | — |
| R-H3 | GPU compute | Not required | Hosted model API only (fact §1) | orchestrator | — | — | — |
| R-H4 | Token cost & rate guardrails | Mandatory | — | — | Pending | Agent SDK usage exists (fact §1); no token quotas or spend guardrails evidenced — gap | — |
| R-H5 | Model registry | Not required | No models trained or fine-tuned in-house (fact §1) | orchestrator | — | — | — |
| R-H6 | Data validation & orchestration | Mandatory | — | — | Pending | db-push cron and s24-export-sync workflow move data (fact §1, §3); no data-quality gates or lineage evidenced — later-step check | — |
| R-H7 | Evals & quality monitoring | Not required | Release unit is not an AI product; hosted API only, no model of ours to evaluate (fact §1, §3) | orchestrator | — | — | — |
| R-I1 | Code signing | Not required | Web/API only (fact §1) | orchestrator | — | — | — |
| R-I2 | App store accounts & listing | Not required | Not distributed through app stores (fact §1) | orchestrator | — | — | — |
| R-I3 | Beta distribution | Not required | No mobile or desktop app (fact §1) | orchestrator | — | — | — |
| R-I4 | Push notifications | Not required | No client app sends push messages (fact §1) | orchestrator | — | — | — |
| R-I5 | Crash reporting | Not required | No installed client app — browser pages only (fact §1) | orchestrator | — | — | — |
| R-I6 | Notarization & auto-update | Not required | No desktop app (fact §1) | orchestrator | — | — | — |
| R-I7 | Firmware over-the-air updates | Not required | No device firmware — device kits install user-space software bundles, not firmware images (fact §1) | orchestrator | — | — | — |
| R-I8 | Package registry publishing | Not required | Not a library, SDK or CLI tool (fact §1) | orchestrator | — | — | — |
| R-I9 | Remote config & forced update | Not required | No installed client app (fact §1) | orchestrator | — | — | — |
