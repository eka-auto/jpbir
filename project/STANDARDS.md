# Engineering Standards — jpbir, Release R1 ("Stabilize and Harden")

**Status:** DRAFT — Step 1, Task 5 of the R1 Step 1 plan. Prepared 2026-10-19,
calibrated against this repository.

**Source of the defaults.** The rules below are copied from the pinned skill
(`project/audit/SKILL.md` §Engineering standards, v2.2.0, lines 128-149) and then
calibrated for this repository: a Node 24 (ESM) serverless API plus a hand-written
static dashboard, with Python tooling for devices and support scripts. Every rule
names the tool or control that enforces it, or is marked **review-only** with the
reason where no tool exists in this environment (global constraint 7 — no fake
tooling). The only way past a rule is an exception recorded as a decision
(contract rule 13, `project/decisions.md`).

**Vendored control files.** `project/audit/` (pinned skill and tracker),
`project/CONTRACT.md`, and the pointer blocks in `AGENTS.md` / `CLAUDE.md` /
`GEMINI.md` / `QWEN.md` are vendored control files. Product formatters, linters,
spell-check, and duplication detection must exclude them — the current linter
(`scripts/lint.mjs`) scans only `Backend/`, `Integrations/`, `scripts/` and five
dashboard HTML files, never `project/` — and the audit checks them instead
(hash-pinning plus the scheduled audit).

## 1. One name for each meaning

**Default (skill):** one canonical name per concept per domain area, used in the
database, API, code, UI text, and docs. Language casing conventions are not aliases
(`command_id` in Python and `commandId` in JavaScript are one name). Mappings to
external names live in one tested adapter. Naming conventions are enforced by linter
rules. No synonyms, import aliases, or unglossed abbreviations; one spelling
convention (US English), spell-checked; identifiers checked against the glossary;
user-facing text localized through translation catalogs.

**Calibration:** canonical names live in `project/GLOSSARY.md`, which also records
the owner's words mapped to canonical names and the casing table. No naming-rules
linter and no spell-checker are configured in this environment.
`commandId`-style camelCase (JavaScript, API, Firestore) and `command_id`-style
snake_case (SQL) are the same name in different spellings, not two names.

**Enforcing tool:** review-only (no linter or spell-checker configured);
`project/GLOSSARY.md` is the reference used in review.

## 2. One of everything

**Default (skill):** no `_v2` / `_new` / `_copy` / backup files and no commented-out
code; versioned migrations never change once released; a language-aware duplication
detector fails the build on new duplicated logic; unused files, functions, exports,
and dependencies fail the integration check; one package manager, lockfile, logger,
HTTP client, date library, test framework, formatter, and linter per ecosystem;
configuration has one schema, one loader, one authoritative source per setting;
committed generated files are listed and checked by CI against fresh regeneration;
build outputs are never committed.

**Calibration:**
- Package manager: npm with a single tracked lockfile (`package-lock.json`) — one
  package manager, one lockfile, pinned with integrity hashes.
- Duplication detector and unused-code/unused-dependency checks: none installed.
  Review-only: checked in review at each change.
- Known existing debt (documented, NOT changed in R1 per D-16): duplicated vendored
  trees under `Frontend/` and `Backend/`, and tracked generated build output under
  `Frontend/assets/` (fact sheet §2). Any pruning is an owner decision (Q-BRD-6);
  R1 documents the live-code boundary only (TR-101).
- One logger / HTTP client / date library: first-party code is plain Node ESM with no
  such libraries; logging goes through the existing structured helpers (for example
  `slog` in `Backend/broker-command-claim.js`). Review-only.
- Migrations: numbered SQL files under `Database/schema/` applied by
  `Database/scripts/migrate.mjs`; released migrations are never edited.

**Enforcing tool:** `package-lock.json` (npm) enforces the one-package-manager and
pinning rules; every other rule in this group is review-only (no detector installed).

## 3. Code quality

**Default (skill):** zero linter and formatter warnings; strict type checking with
only narrow, justified unsafe escapes; typed stubs for untyped libraries; complexity
limits (cyclomatic 10, cognitive 15, 60 lines per function, 5 parameters); business
values in named constants; errors never swallowed — typed errors and structured
redacted logs; tracing appropriate to the workload; production code has no
placeholder behavior.

**Calibration:**
- Lint: `npm run lint` → `scripts/lint.mjs` — a Node syntax check (`node --check`)
  over `Backend/`, `Integrations/`, and `scripts/`, plus dashboard-surface guards on
  five HTML files (forbid `transition: all`, inline `onclick`, keys in media URLs,
  and key persistence in `localStorage`). Runs in CI in
  `.github/workflows/ci-cd.yml` and `code-quality.yml`.
- Formatter: none configured (hand-written style). Review-only.
- ESLint: `_shared/eslint.config.mjs` exists but is not invoked by any npm script or
  CI job; it is not the enforcing tool. Wiring it is a candidate for Step 4; until
  then, review-only.
- Type checking: first-party code is JavaScript, so strict-type rules do not apply;
  the TypeScript trees in the repository are vendored and out of scope.
- Complexity limits and named constants: no measuring tool; review-only at the
  listed limits.
- Errors and logging: handlers return structured error responses (for example
  `sendError(res, 400, 'malformed commandId', 'claim-schema-rejected')` in
  `Backend/broker-command-claim.js`) and log through redacted structured helpers.
  Review-only.

**Enforcing tool:** `npm run lint` (`scripts/lint.mjs`) in CI for syntax and the HTML
guards; all other quality rules are review-only (no formatter, complexity, or type
tooling configured).

## 4. Tests

**Default (skill):** at least 80% line and 80% branch coverage for first-party code
and for each change's new code; no change may lower coverage; critical paths are
tagged, each needing automated BRD acceptance scenarios, 90% branch coverage, and a
70% mutation score; every critical scenario and security invariant has a test
(denials, failures, retries, races, rollback); QA writes acceptance tests from the
BRD criteria without seeing the implementation; a flaky test is quarantined within
24 hours and never counts toward a critical path; never re-run a test until it
happens to pass.

**Calibration:**
- Runner: `npm test` → `_shared/tests/run-all.mjs` (Node's built-in test runner;
  53 test files). Runs in CI (`ci-cd.yml`, `npm test --if-present`).
- Browser end-to-end: Playwright (`npm run test:browser`, one tracked spec under
  `e2e/`); currently not run in CI.
- Python: the device-sandbox kit tests run via pytest in
  `device-sandbox-tests.yml`.
- Coverage measurement: available with Node 24 (`node --experimental-test-coverage`)
  but not wired into any script or CI job; review-only until wired (Step 4
  candidate).
- Critical paths for R1: the four BRD §3 journeys (dashboard view, device telemetry,
  remote command, WhatsApp ingestion) plus device enrollment and attestation. These
  have existing coverage in `_shared/tests/`; the per-journey gap analysis belongs
  to the R1 verification slices (Step 4), not this document.
- Flaky-test quarantine: policy stands as written; enforcement is by tracking
  (review-only), as no flake detector is configured.

**Enforcing tool:** `npm test` (Node test runner) and pytest in CI; coverage,
mutation, and QA-workflow rules are review-only (no tooling wired).

## 5. Accessibility and localization

**Default (skill):** web content meets WCAG 2.2 AA; automated scans run in CI plus a
manual keyboard and screen-reader pass over critical journeys before each release;
an accessibility statement is published where the European Accessibility Act
applies; translations live in catalogs supporting plurals, locale formats, and
right-to-left text.

**Calibration:**
- The dashboard is static HTML with vanilla JavaScript; four automated accessibility
  and safety guards on five HTML files live in `scripts/lint.mjs` (see §3). A full
  WCAG scanner (for example axe or Lighthouse) is not installed; review-only.
- Manual keyboard and screen-reader pass over the four journeys: review-only,
  performed before a release; not automated.
- Localization: the product is English-only with no translation catalogs; the
  plurals/locales/RTL rules do not apply in R1 (no new user-facing text; D-16).

**Enforcing tool:** `scripts/lint.mjs` HTML guards (partial); the WCAG scan and the
manual pass are review-only (no scanner installed).

## 6. Security and correctness

**Default (skill):** a STRIDE threat model maps assets, actors, trust boundaries,
and abuse cases to tests and owners, and is reassessed when architecture or exposure
changes; authentication and authorization are separate requirements; every protected
action is checked on the server, denying by default, with cross-user/tenant tests;
validate every input, parameterized queries only, validate uploads and outbound
requests; write down transaction boundaries and invariants; bound timeouts, retries,
queue depth, and fan-out; verify callback signatures and reject replays; personal
data is inventoried, classified, kept out of logs/traces/prompts/agent context,
exportable and deletable, and stored in the declared region; AI features follow the
OWASP Top 10 for LLM applications with pinned models and budgets enforced outside
the model.

**Calibration:**
- Threat model: `project/THREAT_MODEL.md` (Task 7, STRIDE), approved via T-09 by the
  HOD. Risk tier is Internal (`project/PROFILE.md`, D-1), so no external penetration
  test is required.
- Device authentication: P-256 enrollment and hardware attestation enforced in the
  broker handlers (`Backend/broker.js`, `device-enroll.js`,
  `broker-command-claim.js`, `broker-command-complete.js`), including server-side
  shape validation of `commandId` and deny-by-default error paths. Covered by the
  existing Node test suite; review-only plus tests.
- Secrets: CI runs trufflehog (`.github/workflows/code-quality.yml`); local scans use
  `_shared/tools/scan_secrets.py` with the fact sheet §5 method; guard rules live in
  `.gitignore` and `.vercelignore` (BR-104 / TR-104).
- Personal data: DPDP Act scope is recorded (D-10). The rule that WhatsApp content
  is kept out of logs, traces, prompts, and agent context is review-enforced at
  runtime; the audit checks the documents.
- AI features: the droplet's jp-agent runtime uses an agent SDK; OWASP-LLM controls
  apply as review-only. No AI feature changes in R1 (D-16).

**Enforcing tool:** the existing Node test suite plus trufflehog and the other CI
scanners; policy-level items (threat model, data classification, AI rules) are
review-only, backed by `project/THREAT_MODEL.md` and the audit.

## 7. APIs and data

**Default (skill):** contract-first with the right contract type, checked in CI with
consumer tests and breaking-change detection; for existing code, generate the
contract from the code first, then lock it; explicit public models; version breaking
changes with a deprecation policy (90 days' notice, `Sunset` header); one error
format per protocol (RFC 9457 for HTTP); UTC instants in ISO 8601, with IANA time
zones where scheduling depends on them; money in minor units, never binary floating
point; new identifiers default to UUIDv7.

**Calibration:**
- No OpenAPI or GraphQL contract is committed. `vercel.json` is the authoritative API
  surface (routes and builds) and `_shared/config/vercel-env.manifest.json` is the
  authoritative inventory of configuration names. Generating a locked contract from
  the code is a Step 4+ candidate; review-only in R1.
- Error format: handlers use a consistent structured error shape (code, short
  message, reason tag such as `claim-schema-rejected`); RFC 9457 is not adopted.
  Review-only.
- Instants: stored and exchanged as ISO 8601 UTC strings. Review-only.
- Money: not applicable — the product stores no monetary data.
- Identifiers: existing formats stay (R1 adds no new identifiers; D-16).

**Enforcing tool:** review-only (no contract checker in this environment);
`vercel.json` and the environment manifest are the reference surfaces.

## 8. Infrastructure, supply chain, licenses, compliance

**Default (skill):** all infrastructure is reviewed code with plans and cost
estimates posted; state remote, locked, and encrypted; daily drift detection; config
exports and runbooks where no API exists; an infrastructure scan blocks over-broad
permissions, public storage, and unencrypted data; dependencies are pinned with
lockfiles and integrity hashes; a new dependency must exist in the official
registry, be at least 90 days old and maintained, carry an allowed license, pass a
malware scan, and be recorded in `decisions.md`; automated update pull requests
arrive weekly with a minimum release age; every component and asset is inventoried
with source and license under a policy gate; compliance obligations are mapped to
controls, evidence, retention, and an accountable person.

**Calibration:**
- Infrastructure: Vercel configuration is code (`vercel.json`, committed and reviewed
  through the normal pipeline); droplet configuration and units live in the repo
  (`Server/jp-agent/`, `Server/*.sh`). There is no Terraform/Pulumi, so plan/state
  and drift-tool rules do not apply in this environment; review-only.
- Dependencies: pinned through the tracked `package-lock.json` (integrity hashes
  included); `package.json` keeps caret ranges with the lockfile as the pin. The
  new-dependency rules (age, license, malware scan) and a license policy gate are
  not automated; review-only, and new dependencies are recorded in
  `project/decisions.md`.
- Update pull requests: no Renovate or Dependabot configured; review-only (gap
  noted).
- Licenses: the project's own license is `UNLICENSED` (proprietary), recorded in
  `package.json`. A full third-party license inventory is not built; vendored-tree
  provenance is documented in the fact sheet §2. Review-only.
- Compliance: the DPDP mapping is recorded (D-10, TR-108); the pipeline never claims
  regulatory compliance from a passing check.

**Enforcing tool:** `package-lock.json` (npm) for dependency pinning; all other
rules in this group are review-only (no infrastructure, license, or update tooling
in this environment).

## 9. Repository and history

**Default (skill):** the repo skeleton is README, CHANGELOG, CONTRIBUTING,
CODEOWNERS, `.editorconfig`, `.gitignore`, a pull-request template, a license
declaration as the owner decides, and `SECURITY.md`; large binaries go through Git
LFS; agent scratch files, memory, logs, and local state are ignored; commit style,
branch naming, merge strategy, and version scheme are recorded policy (Conventional
Commits and short-lived branches by default; `main` always green); significant
decisions become decision records in `project/decisions.md`.

**Calibration:**
- Present: `README.md`; `.gitignore`; the license declaration (`UNLICENSED` in
  `package.json`); Conventional Commit-style messages (observed history); decision
  records in `project/decisions.md`.
- Missing (gaps recorded; adding any of these is an owner or Step 4 scope decision —
  R1 adds none): `CHANGELOG`, `CONTRIBUTING`, `CODEOWNERS`, `.editorconfig`, a
  pull-request template, `SECURITY.md`.
- `CODEOWNERS` enforcement specifically needs the paid GitHub plan the owner
  declined (D-15 / T-04); GitHub ruleset 25339138 remains the active compensating
  control on the free plan.
- Branch life: this run's workspace branch `feat/jp-agent-droplet-runner` is
  long-lived by design (the run's own workspace, per the plan); normal feature
  branches stay short-lived as the default says.
- Binary handling: no Git LFS in use; the committed data dumps under
  `Database/backups/` are small JSON files kept deliberately; large trees stay
  untracked and are fenced off by ignore rules in R1 (TR-101).

**Enforcing tool:** review-only (policy recorded here and in the run plan); the
audit checks the vendored control files' pinning, and GitHub enforces the ruleset.

---

**Rule exceptions.** Any exception to a rule in this document is recorded as a
decision in `project/decisions.md` (contract rule 13) before the change lands.
