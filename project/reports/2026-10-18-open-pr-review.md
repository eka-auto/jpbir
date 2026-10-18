# Report — review of every open pull request (2026-10-18)

Role: `devops` (Cline automation identity). Scope of this report: **all open pull requests** on
`jaytipargal/jpbir`. Read-only on the Git host; no merge, no deploy, no push, no change to any
protected control was made.

## 0. Identity and target check (contract rule 11)

| Check | Result |
| --- | --- |
| Signed in as | `cline-cloud[bot]` — matches the `cline-agent` grant in `project/ACCESS.md` and the `devops` entry in `project/identities.json` |
| Repository | `origin` = `https://github.com/jaytipargal/jpbir.git`, id `1350770272` — matches `project/targets.json` (`source`) |
| Acting branch | `main` (default) checked out; work branch `cline/h4fhcfn8` created from it; nothing committed or pushed |
| Grant limits | push/PR on non-protected branches only; no merge, no deploy, no write to protected controls; expires 2026-11-15 |
| Verdict | **Pass** — identity, repository and branch all match the records |

## 1. What "all PR" resolves to

`gh pr list --state all` → **163 merged, 5 closed, 2 open**. The two open ones are the whole set under
review; both target `main`, neither is a draft, neither carries a review, and both are red.

| PR | Author | Head branch | Files | Mergeable | GitHub Actions |
| --- | --- | --- | --- | --- | --- |
| [#173](https://github.com/jaytipargal/jpbir/pull/173) `ci(sync-keys): drop database URLs from SYNC_KEYS…` | `jaytipargal` (owner) | `feat/jp-agent-droplet-runner` | 1 (`+3 −1`, `.github/workflows/sync-keys-to-vercel.yml`) | MERGEABLE / UNSTABLE | every job **Error** — see §2 |
| [#172](https://github.com/jaytipargal/jpbir/pull/172) `ci: pin GitHub Actions to existing major versions` | `eka-auto` | `claude/epic-brahmagupta-dkn43s` | **0** (empty diff) | MERGEABLE / UNSTABLE | every job **Error** — see §2 |

Neither PR is mergeable on evidence. The reason is shared, and it is not the PRs' content.

## 2. Headline finding — no runner is assigned, so no check has actually run

Every GitHub Actions job on this repository has failed in 2–4 s since roughly **2026-10-18 01:15 UTC**
with **`runner_id: 0`, `runner_name: ""`, `steps: []`** — the job dies before its first step, and the
log download 404s because no log was ever produced. Verified against the API, not inferred:

| Run | Commit | Outcome | Runner |
| --- | --- | --- | --- |
| [#483 / 38993356638](https://github.com/jaytipargal/jpbir/actions/runs/38993356638) `main@191cb32`, 2026-10-17T02:02Z | last green | all jobs **success**, 5–11 steps each | `runner_id` 1000005776–1000005780, real `runner_name` |
| [39085806171](https://github.com/jaytipargal/jpbir/actions/runs/39085806171) `main@511ca67`, 2026-10-18T03:12Z — **docs-only commit, no workflow change** | | **failure in 4 s**, 0 steps | `runner_id: 0` |
| [39174733371](https://github.com/jaytipargal/jpbir/actions/runs/39174733371) PR #173, 2026-10-18T23:01Z | | **failure in 2 s**, 0 steps | `runner_id: 0` |
| [39174908551](https://github.com/jaytipargal/jpbir/actions/runs/39174908551) PR #172, 2026-10-18T23:04Z | | **failure in 2 s**, 0 steps | `runner_id: 0` |

Consequences that decide this review:

- **The red CI on both PRs is not caused by either PR.** A documentation-only commit on `main` fails
  identically, and the last green run used the very same workflow files.
- **`main` is not green.** Scheduled jobs are failing too (`Endpoint Health Check` 4 s, `S24 Direct-Cloud
  Export Sync` 5 s). The standing rule "`main` is always green and deployable to staging" is broken
  right now.
- **Every required check reports Error, never Pass** (contract rule 1: a check that could not run is
  never treated as a pass). So there is no automated evidence for, or against, either PR's content.
- The only checks that genuinely ran are Vercel's (`Vercel – jpbir`, `Vercel – channel-sandbox`,
  `Vercel Agent Review`, `Vercel Preview Comments` — all pass). A preview deploying is not a code gate.
- The self-hosted deploy job
  [39085806155](https://github.com/jaytipargal/jpbir/actions/runs/39085806155) (`runs-on:
  [self-hosted, jp-agent-droplet]`) has been **queued since 2026-10-18T01:15:13Z** — 22 h at the time
  of writing — so `Deploy to jp-agent Droplet` currently has **zero successful runs ever**, and `main`
  and the services running on the droplet have no verified relationship. This is the known, still-open
  item from `project/reports/2026-10-16-host-and-job-diagnosis.md` §4 and owner answer Q5.

**Owner action (facts only you can check; I hold no billing or admin access — the API returns 403):**

1. GitHub → **Settings → Billing and licensing** → confirm the Actions spending limit is not reached and
   a valid payment method is on file.
2. Repo → **Settings → Actions → General** → confirm Actions is enabled for this repository.
3. Then re-run one workflow and it should dispatch normally — no repository change is needed.
4. Separately: restore the self-hosted runner on `jp-agent-droplet` (`Server/jp-agent/setup-runner.sh`)
   so the deploy queue drains (owner answer Q5, already approved).
## 3. PR #172 — `ci: pin GitHub Actions to existing major versions` — **recommend CLOSE, do not merge**

- **Empty diff.** Two commits on the branch: `abecd02` (the pin change) and `4827e74` *Revert "ci: pin…"*.
  The head is the revert, so the PR now changes 0 files / 0 lines relative to `main`. There is nothing to
  merge; it exists only as a stale conversation.
- **Its premise is factually wrong, and I checked it at the source.** The PR body claims
  `actions/checkout@v7`, `actions/setup-node@v7` and `actions/setup-python@v7` do not exist. They do —
  the tags are present in the upstream repositories today:

  ```
  gh api repos/actions/checkout/tags      → v7.0.1, v7.0.0, v7, v6.1.0 …
  gh api repos/actions/setup-node/tags    → v7.1.0, v7.0.0, v7, v6.5.0 …
  gh api repos/actions/setup-python/tags  → v7.0.0, v7, v6.3.0 …
  ```

  `main`'s pins are fine (19 × `@v7`, 2 × `@v5`); the version strings were never the problem. The PR's
  own follow-up comment reaches the same conclusion and states it is closing the PR — **but it is still
  open**, so it will keep showing up in every review.
- **Author identity `eka-auto` (Eka Automation) is not recorded** in `project/ACCESS.md` or
  `project/identities.json`. Under contract rule 11 an unrecorded identity may not push, and under rule
  12 a protected control (`.github/workflows/`, which is what the reverted commit touched) may not be
  changed by an unrecorded identity. Both pushes should be logged as incidents and the author either
  registered by the owner or blocked. **Recommend: close the PR, and have the owner decide whether
  `eka-auto` stays.**
- Review status: 0 reviews, 0 approvals. Checks: all Error (§2).

## 4. PR #173 — `ci(sync-keys): drop database URLs from SYNC_KEYS; keep jpbir_live prod DB pinned`

Content review (**content looks correct and low-risk — verified, not assumed**):

- The diff removes `DATABASE_URL DATABASE_URL_UNPOOLED POSTGRES_URL POSTGRES_URL_NON_POOLING` from
  `SYNC_KEYS` and adds a comment explaining why: the `jpbir_live` production database is pinned outside
  CI so the readable recovered chats stay intact.
- **Blast radius is smaller than it looks.** `.github/scripts/sync-keys-to-vercel.mjs` is *add-only* by
  design ("Nothing is updated or removed"). Dropping names from `SYNC_KEYS` therefore does **not** delete
  or rewrite any Vercel Production variable; the four existing DB URLs keep their current values on the
  live project. What is lost is only the ability of CI to *create* them on a future fresh project, plus
  the auto-redeploy trigger those keys used to arm. That trade-off is exactly what the added comment
  documents, and it protects a data-safety property — a defensible call.
- **No hidden breakage:** the script's one hard failure mode is
  `STATIC_ENV_FILES key … is not in SYNC_KEYS`, and no workflow sets `STATIC_ENV_FILES`, so the guard
  cannot fire. Nothing else in the repository keys off those four names in `SYNC_KEYS`.
- **Cleanliness nit:** the new comment is inserted directly above the pre-existing comment
  ("Every key the deployed code (Backend/, Integrations/) reads."), leaving two overlapping descriptions
  of the same list. Worth folding into one before merge.
- **Process flags that must be cleared before merge:**
  1. This PR edits `.github/workflows/sync-keys-to-vercel.yml` — a **pipeline definition, i.e. a protected
     control** (contract rule 12). It needs independent approval, not the author's own. There is **no
     `CODEOWNERS` file in the repository** (`find . -name CODEOWNERS` → nothing) even though
     `project/decisions.md` D-6 records it as created, so the protected-file approval path does not
     actually exist and nothing enforces it.
  2. Branch hygiene: the change rides on `feat/jp-agent-droplet-runner`, a branch created for the droplet
     runner and unrelated to sync-keys, alive since 2026-10-17 (rule: branches live at most two days),

## 5. Checks that could not run — reported as Error, not as passes

| Check | Verdict | Note |
| --- | --- | --- |
| Branch protection / required reviews on `main` | **Error** | `gh api repos/…/branches/main/protection` → 403 for this identity. Owner answer Q4 ("enable branch protection and required checks") is **approved but not executed** |
| `CODEOWNERS` present and enforcing | **Fail** | absent from the repository; D-6 records it as created |
| Self-hosted runner `jp-agent-droplet` online | **Error** | `gh api repos/…/actions/runners` → 403; inferred offline from the 22 h-queued job |
| Actions billing / enablement | **Error** | not visible to this identity; owner action in §2 |
| PR template / repo skeleton enforcement | **Fail** | no `.github/PULL_REQUEST_TEMPLATE*`, no `SECURITY.md`, no `CONTRIBUTING.md`, no `CHANGELOG.md` in the tree |
| `project-state` / `project-verifier` branches and `project/STOP` | **Error** | still absent from the remote (5 heads, neither present) — this review could not read the stop flag or record an event; unchanged open item from the 2026-10-17 reports |
| Pinned-control consistency | **Fail** | `project/audit/SKILL.md` is v2.4.0, SHA-256 `9d02631b…`, vs D-7's recorded v2.2.0 `A9C26385…`; owner answer Q3 (record the 2.4.0 upgrade) is approved but Blocked on the missing state branch |

## 6. Verdict and next steps

1. **Merge nothing yet.** Both PRs have Error-level gates; `main` is not green; branch protection is not
   in force. Merging today would land changes with no working verification.
2. **PR #172 → close it.** It is empty, its premise is disproved, and its author is unrecorded.
3. **PR #173 → keep, but it is Blocked on three things:** runner dispatch restored so the gates actually
   run; an independent approval recorded in `project/approvals/` (protected pipeline file); and the
   duplicate-comment tidy-up. Optionally move the commit to its own branch so the droplet-runner branch
   can be retired.
4. **Owner actions, in order:** (a) fix Actions billing/enablement, (b) restore the droplet runner,
   (c) execute the already-approved Q2/Q4 items — create the `project-state`/`project-verifier` branches
   and enable branch protection + required checks — since without them no PR in this repository can be
   verified or gated.
5. Evidence for this review: every run/job/runner fact above comes from the GitHub API
   (`/actions/runs/{id}/jobs`), not from any comment.

Nothing in this report was pushed. The file sits uncommitted on branch `cline/h4fhcfn8`, ready to commit
and open as a PR on request.

     and now carrying a merge of `main`. It is also the branch that triggers the stuck droplet deploy.
  3. No review, no approval, no passing gate (§2) — merging now would land a protected-control change
     with zero verified evidence.
- Review status: 0 reviews, 0 approvals; 1 comment (Vercel bot only). Checks: all Error (§2).

