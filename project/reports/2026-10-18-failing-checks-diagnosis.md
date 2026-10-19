# Report — failing checks on `main@fe2bec6` (diagnosis, no code fix available)

**Date:** 2026-10-18 · **Subject:** the 11 checks on merge commit
`fe2bec6` ("Merge pull request #177 from jaytipargal/governance/cline-merge-grant")
· **Author:** devops role (Cline), on branch `cline/34rkyqre`
· **Identity verified:** `gh auth status` → `cline-cloud[bot]`;
`gh repo view` → `jaytipargal/jpbir`, default branch `main`.

## 1. Bottom line

Seven of the seven failing checks failed **before any step ran**. GitHub's own
annotation on every one of them is:

> The job was not started because your account is locked due to a billing issue.

This is an account/billing state, not a repository defect. **No change in this
repository can make those seven checks green.** The task is Blocked (contract
rule 1: cost — a billing state — makes a task Blocked, never Not required) and
escalates to the owner (rule 6: a missing permission escalates immediately).

The remaining four items are also not code failures: one is a self-hosted runner
that never picks the job up, one is a matrix sibling cancelled by the 3.12 leg,
one is a Vercel status that has since gone green, and the "successful" one is a
Vercel status.

## 2. Root cause A — GitHub account billing lock (9 of 11 check runs)

Evidence, per run, from `gh run view <id>` (each shows no steps at all — the
jobs never started — and the annotation above):

| Check | Run | First failure |
|---|---|---|
| CI/CD Pipeline (all 5 jobs) | `39177495317` | `39085806171` |
| Code Quality Checks (both jobs) | `39177495308` | `39085806171` |
| Endpoint Health Check ×3 (deployment_status) | `39177571784`, `39177536411`, `39177525948` | `39085806171` |

The lock is visible from the first failing run onwards:

- **Last green `main`:** `191cb326`, CI/CD Pipeline run `38993356638`,
  2026-10-17T02:02:42Z.
- **First red `main`:** `511ca678` ("docs(plan): jayti recovery + agent
  replacement implementation plan"), run `39085806171`, 2026-10-18T01:15:13Z.
  A docs-only commit cannot break Lint & Test, jp-agent tests, workflow lint or
  the MCP job — it failed with the same billing annotation, which is what dates
  the lock to the window 2026-10-17T02:03Z – 2026-10-18T01:15Z.
- Every run since carries the same annotation, on every branch.

Nothing was downloaded for these jobs because nothing ran — `gh run view
--log-failed` returns HTTP 404 for each. The failures carry **no signal about
the code**.

## 3. Root cause B — the deploy job can never match a runner

`Deploy to jp-agent Droplet / Deploy jp-agent to droplet` has been **queued**
(the check-run API reports `queued`, `conclusion: null`, `runner_name: ""`).

- `.github/workflows/deploy-droplet.yml` requires
  `runs-on: [self-hosted, jp-agent-droplet]`, and has since it was added in
  `b9573419` (2026-10-14).
- The same commit added `Server/jp-agent/setup-runner.sh`, which registered the
  runner as `--labels jp-agent,droplet,deploy` — i.e. the label the workflow
  requires **never existed on the runner**. `project/targets.json` records the
  same three labels.
- PR #176 (`aa851d33`, merged 2026-10-18) fixed the **script** to also register
  `jp-agent-droplet`. The runner itself on the droplet has not been
  re-registered, so the requirement is still unmet. This half must run on the
  droplet (it needs a fresh registration token, and `--replace` re-registers
  the existing runner).
- Consistent with that: **no run of this workflow has ever succeeded.** Every
  prior run is `cancelled` after sitting queued (2026-10-17 and earlier); the
  six runs on 2026-10-18 are still queued.

## 4. Not failures

- **`Vercel – jpbir`** — reported as Pending at the time of the paste. The
  commit-status API for `fe2bec6` now reads `success` for both
  `Vercel – jpbir` and `Vercel – channel-sandbox`. Nothing to do. (Per
  `CLAUDE.md`, if a `Vercel – <name>` context appears that team `jayti` does
  not own, the fix is on Vercel — remove the stray project — never a relaxed
  cron schedule.)
- **`S24 MCP compatibility (Python 3.14)` cancelled** — the matrix sibling was
  cancelled *because the 3.12 leg failed*, not on its own merits.

## 5. The repository is not at fault — reproduced locally

Run on this checkout (branch `cline/34rkyqre`, at `main@fe2bec6`, Node 24.15.0):

| Gate | Command | Result |
|---|---|---|
| Unit/integration suites | `npm test` | **49/49 suites passed** |
| Lint | `npm run lint` | passed (JS syntax + 5 security/accessibility surfaces) |
| jp-agent node tests | `node --test "tests/*.test.mjs"` in `Server/jp-agent` | **13 pass / 0 fail** |
| jp-agent python tests | `python3 -m unittest discover -s tests -p 'test_*.py' -v` | **2 tests OK** |
| Module graph | `node --check server.mjs`; `import('./s24-tools.mjs')` | both OK |
| Workflow definitions | `actionlint 1.7.12` (release binary, **with `shellcheck 0.11.0` on PATH**, as the CI image has) | **0 errors in 9 files** |

`git diff --stat 191cb326..HEAD` (last green `main` → the failing commit)
touches only three files, and none can fail a gate:

- `.github/workflows/sync-keys-to-vercel.yml` — comment + dropping the
  `DATABASE_URL*` names from `SYNC_KEYS` (PR #173/#175). Comments do not run.
- `Server/jp-agent/server.mjs` — `PORT`/`JP_AGENT_HOST` defaults are now
  env-overridable (Render posture); syntax and module graph verified above.
- `Server/jp-agent/setup-runner.sh` — the label change in §3.

Two gates could **not** be reproduced in this sandbox, and neither has any
evidence of a defect: the browser checks (`npx playwright install --with-deps`
needs root; chromium here aborts with `libglib-2.0.so.0: cannot open shared
object file`, an environment gap — all 17 e2e failures are that launch error,
not assertions), and the S24 MCP venv build (`pip` cannot reach PyPI through
this sandbox's proxy). Both passed on the last green `main`.

## 6. Two real, small defects found (both touch a protected control)

1. **Duplicated comment in `.github/workflows/sync-keys-to-vercel.yml`**, lines
   47–50: `# Every key the deployed code (Backend/, Integrations/) reads, except
   # database URLs (…)` was immediately followed by the older, unqualified
   `# Every key the deployed code (Backend/, Integrations/) reads.` The tidier
   #173 variant did not land, so the block read as two contradictory statements
   about one list. The stale duplicate line is deleted (1 deletion, CRLF
   preserved) on the owner's direction ("proceed", 2026-10-18) — but **the push
   was rejected**:

   > `! [remote rejected] cline/34rkyqre -> cline/34rkyqre (refusing to allow a`
   > `GitHub App to create or update workflow`
   > ``.github/workflows/sync-keys-to-vercel.yml`` `without 'workflows' permission)`

   So it is handed over as a patch,
   `project/reports/2026-10-18-sync-keys-duplicate-comment.patch`, which
   `git apply --check --reverse` confirms matches the working tree. It lands
   the moment any identity whose token carries the `workflows` **scope** commits it (scope, not a platform rule — `63174c33` applied this exact patch) — see §8.3.
2. **The label mismatch in §3** — still open, and it is not a worker-agent
   action either way: re-register the droplet runner (owner, on the host), or
   point `runs-on` at the labels the runner actually has
   (`[self-hosted, jp-agent, droplet, deploy]`).

Both are **pipeline definitions — a protected control** (contract rule 12), so
(2) waits for explicit approval while (1) was changed only because the owner
instructed it.

## 7. Governance gaps observed while doing this

- **`project-state` and `project-verifier` do not exist on the remote.**
  `git ls-remote --heads origin` lists only `main`,
  `copilot/cicd-devops-pipeline-test-run` and `copilot/jpbir-verified-facts`. So
  `project/TRACKER.md` cannot be read and `project/events/<role>.jsonl` cannot be
  written as `AGENTS.md` requires. The required STOP check was still performed:
  **no `project/STOP` exists, so no stop is in force.** Creating or protecting
  those branches is not a worker-agent action.
- **CI does not build or use the environment manifest.** The workflows run
  `npm ci` and a bare `actionlint` Docker image directly;
  `project/environment/run` is never invoked, against contract rule 3 ("every CI
  job … builds, tests and lints through it"). Already noted in `project/reports/`
  on 2026-10-17; it remains open, and it is why a hosted-runner outage stops
  every gate at once.

## 8. What would unblock this — owner

1. **Clear the GitHub account billing lock** (or tell me the intended CI
   posture). YES: all nine hosted-runner check runs can start, and every gate
   above can finally prove itself on `fe2bec6`. NO: they stay red for a reason
   unrelated to the code, and no merge can be shown to be gate-clean.
   *No repository change substitutes for this.*
2. **Re-register the droplet runner** (`Server/jp-agent/setup-runner.sh` on the
   droplet, with a fresh registration token) **or approve** repointing
   `deploy-droplet.yml` at the runner's existing labels. YES: the queued deploy
   can run. NO: it queues until cancelled, as it has since 2026-10-14.
3. **`workflows` permission for this identity, or apply the patch** —
   `project/reports/2026-10-18-sync-keys-duplicate-comment.patch` carries the
   §6(1) deletion, already verified against the tree, because GitHub refuses to
   let this App push workflow files. YES: it is committed and pushed as-is. NO:
   it stays a patch file and the duplicated comment stays in the workflow.

## 9. Do not do

- **Do not merge PR #172** ("ci: pin GitHub Actions to existing major versions").
  Its premise — that `actions/checkout@v7`, `setup-node@v7` and `setup-python@v7`
  do not exist — is **false here**: `gh api repos/actions/checkout/git/ref/tags/v7`
  resolves to commit `3d3c42e5…`, `setup-node`'s `v7` to `949feb24…`, and the
  pins were deliberately bumped on 2026-09-21 (`f0204a19`, `9b740af0`). CI was
  green on those pins for a month; merging #172 would silently downgrade
  `checkout` 7→4, `setup-node` 7→4 and `setup-python` 7→5 to no effect.
- **Do not make the board green by weakening checks** — no `continue-on-error`,
  no removal of jobs, no relaxed cron schedule. A check that cannot run is
  *Error*, never a pass (contract rule 1).

