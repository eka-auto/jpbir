# Receipt — every workflow job, run for real (2026-10-19)

**Author:** devops role (Cline), `cline-cloud[bot]` · **Base:** `main@f73f899`

## The constraint, stated first

**No GitHub-hosted job can be green right now, and no repository change can fix it.**
Every one dies before its first step with GitHub's own annotation:

> The job was not started because your account is locked due to a billing issue.

There is also no self-hosted runner left: the droplet carried the only one, and it is
gone. So "green" here means *every step of every job reproduced locally, on this code* —
which is the only evidence available until the billing lock clears.

## Jobs reproduced, step by step

| Workflow / job | Result |
|---|---|
| `ci-cd` / Lint & Test | `npm ci` ok · `npm run lint` ok · `npm test` **49/49 suites** · `npm run test:browser` **17/17** |
| `ci-cd` / S24 MCP compatibility | venv + pinned deps installed · `smoke_test.py` **PASS** (real MCP initialize, tools/list, fail-closed ping). Ran on Python 3.11; the matrix uses 3.12/3.14 |
| `ci-cd` / Validate workflow definitions | `actionlint 1.7.12` + `shellcheck 0.11.0` → **0 errors in 8 workflows** |
| `ci-cd` / jp-agent tests | `npm ci` ok · `node --test` **13 pass / 0 fail** · `node --check server.mjs` ok · module-graph import ok |
| `code-quality` / Code Quality | `npm ci` ok · lint ok · sensitive-file step exits 0 |
| `code-quality` / Security Scan | `npm audit --audit-level=moderate` → **0 vulnerabilities** |

## Jobs that cannot be reproduced here, and why

| Job | Blocker |
|---|---|
| `s24-export-sync` | Needs a Firestore service-account key, a P-256 signing key and a reachable phone; it also writes to production |
| `db-push-backfill` | Needs the Neon connection string and the `JP_AWS_*` read pair |
| `sync-keys-to-vercel` | Needs `VERCEL_TOKEN` and writes Vercel production env |
| `dashboard-parity-check` | Needs production credentials for the parity probes |
| `device-sandbox-tests` | Needs Java plus the Firestore emulator; no JDK here |
| `health-check` | Probes production (`HEALTH_CHECK_KEY`); a green run there proves the live site, not this diff |

Each of the six needs a credential or a device I must not hold. They are *Error* (never a
pass) until CI can run them.

## Two gates that were decoration, now one fewer

- **`Run token-sync tests`** (jp-agent job) discovered 0 tests and exited 0 once its subject,
  `sync-auth-token.py`, was deleted with the droplet. A step that can only pass is not a
  gate; it is removed in `2026-10-19-retire-jp-agent-droplet.patch`. Measured before
  removal: `Ran 0 tests ... OK`.
- **`Check for sensitive files`** (Code Quality) still can never fail: the `if find ...`
  branch `exit 0`s either way, and it matched `_shared/tools/redact_secrets.py` and four
  report filenames containing "secret"/"key". Left as-is, because changing it to fail
  would turn four true-but-harmless matches into a red build; worth a real gate later.

## What changed to get here

- `deploy-droplet.yml` deleted on `main` (`57eff98`) — its `runs-on: [self-hosted,
  jp-agent-droplet]` could never match a runner, so every run queued until cancelled. This
  is also why a "Deploy to jp-agent Droplet" check kept appearing on unrelated commits.
- The four self-hosted labels removed from `.github/actionlint.yaml` (`f73f899`).
- `ci-cd.yml` job rename + dead-step removal: **still blocked** on the `workflows`
  permission, shipped as a patch (see the retirement report). Note the asymmetry this
  exposed: the Contents API permits workflow *deleting* but refuses *create or update* from
  an App without `workflows`.

## Independent verification on a fork, with real GitHub runners (2026-10-19)

Upstream checks stay locked, so the gates were proven on a fork that bills to a different
account. Verified from here rather than taken from the hand-off:

| Item | Result |
|---|---|
| `eka-auto/jpbir` main tree vs `jaytipargal/jpbir` main tree | **identical** — `6c271ab23e9c…` on both |
| CI/CD Pipeline run `39184766541` | **success**, actor `eka-auto`, `workflow_dispatch` |
| — Lint & Test / S24 3.12 / S24 3.14 / Validate workflow definitions / jp-agent | 35 s / 18 s / 17 s / 14 s / 10 s — all success |
| Code Quality Checks run `39184768836` | **success** — Code Quality 14 s, Security Scan 16 s |

First time these gates have executed on GitHub's runners for this tree, and they agree with
the local reproduction above.

### Two corrections this surfaced

- **The token-sync step would have failed CI, not passed.** I measured `Ran 0 tests ... OK`
  — on Python **3.11**. From 3.12 onward `unittest` exits **5** when no tests are found, and
  the matrix runs 3.12/3.14, so the step would have failed the job. Removing it was
  necessary, not tidiness. It is already gone on `main` (`f15a14f`).
- **The fork's job still reads `jp-agent (droplet) tests`**, because `main` has the dead step
  removed but not the rename. `2026-10-19-retire-jp-agent-droplet.patch` now carries exactly
  that remaining delta.

A PR from the fork to upstream would run `pull_request` checks in the upstream repo and hit
the lock again: the fork runs are the proof, the upstream badge stays *pending payment*.
