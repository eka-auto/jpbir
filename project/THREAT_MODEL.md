# Threat model — jpbir R1 (STRIDE)

Input to the security task (T-09); requires HOD approval per the Step 1 plan. Sources: `project/plans/r1-facts.md` (cited as fact §n), `project/PROFILE.md`, `project/registry.md`, `project/targets.json`. Method: STRIDE (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) applied per trust boundary; every boundary carries at least one abuse case with a required control and a control owner; controls not yet verified in production are marked "verify in T-09".

## Risk tier

Risk tier: **Internal** (PROFILE.md; D-1, owner-confirmed). Calibration consequences:

- One agent may play every role; reviews may be labelled self-review — controls below are the minimum set for this tier, not a Regulated-tier programme.
- Department set for R1: QA, Security, DevOps, Documentation, Frontend, Backend, Database (PROFILE.md).
- Targets: availability 99.5%, p95 1 s, RPO 24 h, RTO 24 h (PROFILE.md; D-1).
- Compliance does not scale away: DPDP Act obligations apply to WhatsApp content, device telemetry and identifiers (D-10); WhatsApp content stays out of logs, traces, prompts and agent context.
- Compensating control accepted for T-04: the private repo on the free plan gets ruleset 25339138 (deletion + non-fast-forward protection) instead of required reviews (fact §7; D-15); revisit when the repo goes public or paid.

## Assets

| Asset | Where it lives | Sensitivity | Owner |
| --- | --- | --- | --- |
| Device telemetry and `commandQueue` (remote command channel) | Firestore `eka-agent` (project `intrepid-stage-495117-q1`) | High — controls devices | backend |
| Firestore device documents and `deviceKeys` enrollment keys | Firestore `eka-agent` | High | backend |
| Neon Postgres analytics (17 `s24_`/`wa_` tables, `warehouse_sync_state`) | Neon project `fancy-cloud-99501540` | High — contains WhatsApp message rows | database |
| WhatsApp media bytes | Vercel Blob stores `store_vxETiZ3lYBeN`, `store_y8X2dcvEtuqy` (fact §4) | Highest (D-10) | backend |
| Dashboard pages and key-gated APIs | Vercel team `jayti2`, project `jpbir` (fact §3) | Medium | frontend |
| API/admin keys (`STATS_KEY`, `DB_ADMIN_KEY`, `WA_INGEST_KEY`, cron auth) | Vercel env vars, GitHub repo secrets (names only, fact §3) | High | owner |
| Deploy pipeline (repo `jaytipargal/jpbir`, 9 workflows, self-hosted runner) | GitHub + DigitalOcean droplet (fact §1, §3 + targets.json) | High | devops |
| Droplet services (`jp-agent` 8790, `s24-mcp` 8792, systemd, nginx) | DigitalOcean `runner-jp-agent`, blr1 (targets.json) | High | devops |
| Device installer kits (SHA-256-pinned bundles) | Repository `Devices/` (fact §1) | Medium | backend |
| Backups (bundle + untracked archive + OneDrive copy; hashes in D-2) | Local machine + OneDrive (fact §7) | Medium | owner |

## Actors

| Actor | Nature | Notes |
| --- | --- | --- |
| Owner | Human; final authority | Sole operator for this tier (D-1) |
| Fleet devices | Three enrolled devices: `samsung-s24-ultra`, `g4g-lenovo-laptop`, `jayti-asus-vivobook` (fact §7; broker `HARDWARE_RULES`) | Authenticate with P-256 hardware attestation (fact §1) |
| Public visitors | Unauthenticated clients | Dashboard pages and public routes are reachable on the internet |
| Automated feeds | WhatsApp ingest, S24 export-sync workflow | Signed / key-gated (fact §1, §3) |
| Agent identities | `author`, `deployer`, `verifier` (ACCESS.md) | Verifier identity pending owner setup (D-15) |
| Providers | GitHub, Vercel, Neon, Firebase/Google, DigitalOcean | Console accounts are owner-held |
| Adversaries | Opportunistic scanners, credential attackers, malicious repo content | Internal tier bounds their impact; not eliminated |

## Trust boundaries

| Boundary | Crossing |
| --- | --- |
| TB-1 | Public internet → Vercel edge → dashboard pages and API routes |
| TB-2 | Vercel edge / serverless functions → data stores (Firestore, Neon, Blob) and environment secrets |
| TB-3 | Device fleet → Firebase (`eka-agent`) → server handlers (broker, `commandQueue`) |
| TB-4 | GitHub repo → CI workflows → deploy targets (Vercel project, droplet runner) |
| TB-5 | Owner workstation ↔ repository ↔ backups |
| TB-6 | External / automated feeds (WhatsApp, S24 sync) → ingest APIs |

### TB-1 Public internet → Vercel edge

| # | STRIDE | Abuse case | Required control | Control owner |
| --- | --- | --- | --- | --- |
| 1 | S | Forged or replayed key on admin/API routes (`STATS_KEY`, `DB_ADMIN_KEY`, `WA_INGEST_KEY`) | Fail-closed key checks; keys only as env vars, never in client code (media-auth / cron-auth pattern; fact §1, §3); rotate on exposure | backend |
| 2 | T | Malicious input through the `/api/(.*)` catch-all reaching unintended handlers | Per-handler input validation and allowlists; keep the catch-all surface reviewed as routes change (fact §3) | backend |
| 3 | I | Public endpoints (e.g. `/api/s24-public`) exposing more device data than intended | Define public payload fields; keep WhatsApp content and identifiers out per D-10; verify in T-09 (fact §3) | security |
| 4 | D | Volumetric flood on pages/APIs | Vercel platform protections; 15-minute external health probe detects outage (fact §1); alerting gap tracked as registry R-F4 | devops |
| 5 | E | Route misconfiguration exposing an unintended handler | Route-map review in T-09; deny-by-default keys on every non-public handler (fact §3) | security |
| 6 | R | Admin/ingest actions cannot be attributed (no audit log — registry R-D6) | Add minimal request audit logging (time, route, key id) stored beyond the app's reach; scope in T-09 | security |

### TB-2 Serverless functions → data stores

| # | STRIDE | Abuse case | Required control | Control owner |
| --- | --- | --- | --- | --- |
| 1 | I | Secret or WhatsApp content leaking into logs, errors or traces | Redaction tooling (`_shared/tools` scan/redact, fact §1); D-10 policy; log review in T-09 | backend |
| 2 | T | SQL injection in Postgres handlers | Parameterized queries everywhere; schema review (fact §4) | database |
| 3 | I | Over-privileged Firestore service-account key in Vercel env | Least-privilege scoping where Firebase supports it; rotation runbook; key only as env var (fact §3) | security |
| 4 | D | Neon outage or password-rotation incident breaking the dashboard (occurred before — fact §4) | Rotation runbook + health checks resumed; verify in T-09 | devops |
| 5 | S | Enumerating Blob media URLs | Serve media via the wa-media proxy with controlled URLs; verify in T-09 (fact §4) | backend |
| 6 | E | Env-var tampering through a compromised provider console account | MFA on provider accounts; access register (ACCESS.md); registry R-D7 work | owner |

### TB-3 Device fleet → Firebase → server

| # | STRIDE | Abuse case | Required control | Control owner |
| --- | --- | --- | --- | --- |
| 1 | S | Rogue device impersonating a fleet member | P-256 enrollment + hardware attestation; `HARDWARE_RULES` three-device whitelist — broker refuses any other id (fact §1, §7) | backend |
| 2 | T | Injecting bogus commands into `commandQueue` | Only broker routes write the queue; service-account access only; monitor for unexpected writers (fact §1, §4; D-9) | backend |
| 3 | I | `eka-agent` Firestore ruleset is known permissive in the shared device system (legacy `allow read, write` state per the workspace device-system notes) | App-level guards on this product's paths; raise rules tightening with the device-system owner; treat as a known cross-system risk (fact §4) | security |
| 4 | R | Device actions not attributable (no command audit trail) | Keep `commandId` + acknowledgement fields; retain acknowledgements for later audit (fact §1) | backend |
| 5 | D | Heartbeat flood or stale online-flag abuse | App-level liveness rules (freshness + auth checks) required by the device system; monitor in T-09 (fact §4) | devops |

### TB-4 GitHub → CI → deploy targets

| # | STRIDE | Abuse case | Required control | Control owner |
| --- | --- | --- | --- | --- |
| 1 | S | Unauthorized change merged and deployed | Ruleset 25339138 blocks deletion/non-fast-forward; required reviews closed by T-04 (free private plan) with ruleset as the accepted compensating control (fact §7; D-15); revisit when unlocked | owner |
| 2 | I | Workflow edit exfiltrating repo secrets (`EKA_SERVICE_ACCOUNT_JSON`, `S24_SYNC_PRIVATE_KEY_PEM`, `DB_ADMIN_KEY`) | Secret scan in code-quality.yml (fact §1); keep secrets scoped and rotated; review any workflow change closely (single maintainer) | security |
| 3 | T | Compromised self-hosted runner executing the deploy workflow | Keep the droplet runner purpose-limited to deploy jobs; patch the droplet; verify isolation in T-09 (fact §1, §3; targets.json) | devops |
| 4 | S | Forged scheduled ingest triggers (s24-export-sync) | P-256-signed payloads + repo secrets; missing env vars tracked as registry R-C1 Blocked (fact §1, §3) | security |
| 5 | T | Supply-chain tampering of third-party actions | Pin actions to full commit hashes (pipeline standard); review pull requests touching `.github/` (fact §1) | devops |

### TB-5 Owner workstation ↔ repository ↔ backups

| # | STRIDE | Abuse case | Required control | Control owner |
| --- | --- | --- | --- | --- |
| 1 | I | Local env dumps (`.env.local`, `.vercel/`) or the excluded duplicate-checkout env file swept into git or backups (fact §5) | `.gitignore` / `.vercelignore` guards; secret scans; verify the untracked backup archive contents before off-machine copies (fact §5, §7) | owner |
| 2 | T | Unrecorded local tampering with project controls (precedent: pinned skill replaced unnoticed — D-13) | Pinned-skill hash verification; audit-tool selftest; commit review | hod |
| 3 | S | Identity misuse across author/verifier roles on one workstation | ACCESS.md identity separation; verifier identity setup pending (D-15) — required before release | owner |
| 4 | I | Secret values surfaced into agent context during local runs | "Never read, print, log or commit secret values" rule; scanners in repo tooling (fact §5) | orchestrator |

### TB-6 External feeds → ingest APIs

| # | STRIDE | Abuse case | Required control | Control owner |
| --- | --- | --- | --- | --- |
| 1 | S | Forged WhatsApp/S24 ingest (`WA_INGEST_KEY` missing on `jayti2/jpbir` — registry R-C1) | Set the missing env vars (owner; D-12/D-15); verify every ingest route requires a key or signature | backend |
| 2 | T | Replayed or duplicated ingest payloads | `s24_ingest_seen` idempotency table; apply the same guard on WhatsApp routes (fact §1, §4) | database |
| 3 | I | Media bytes reachable without authorization | wa-media proxy auth (fact §1); verify in T-09 | backend |
| 4 | D | Silent sync failures (scheduled workflow) | Health checks; alerting gap tracked as registry R-F4; add failure alerts in later steps | devops |

## Residual risks carried to T-09

- Registry R-C1 Blocked: missing env vars on `jayti2/jpbir` — owner action (D-12/D-15).
- Registry R-E1 / R-E2 Blocked: T-04 review gap; push-to-deploy disconnected — owner Vercel actions.
- Registry R-D6 (audit logging) and R-D9 (retention/deletion) gaps.
- Permissive `eka-agent` Firestore ruleset (cross-system, TB-3 row 3).
- DynamoDB legacy store still visible in code (facts Q-1) — credential surface to confirm or retire.
- Local `.vercel/` links point at legacy projects (facts Q-5) — operator foot-gun.
- Backup archive content not yet verified (TB-5 row 1).
- Droplet firewall / TLS state not yet verified (registry R-C2).
- Untracked data trees (`runs/`, 25.5 GB) hold recovered-data exports (fact §1, §2; D-10 class) — keep them out of every publish path.

This model is the input to T-09; the HOD verifies it before the security controls are built.
