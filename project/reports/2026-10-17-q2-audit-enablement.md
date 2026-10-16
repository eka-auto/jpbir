# Q2 enablement — proposal for the HOD (2026-10-17)

**Author:** automated session `tsk-01M532NH0WQD2YHSWJ1P14P7WY` (`cline-cloud[bot]`, recorded as `devops`) on branch `cline/1p14p7wy`.
**Subject:** `jaytipargal/jpbir` `main@c809ebae4f4a545b5a367c6da2dcf01dc73a1016`.
**Status:** **proposal only — nothing in it has been applied.** Every artefact here is a protected control (`project/audit/`, pipeline definitions, run-state branches and their protection), so rule 12 reserves the write to the HOD with independent approval. This session holds no such authority and took none.

## 0. Why Q2 is the keystone

| Item | Depends on Q2 because |
| --- | --- |
| Q3 — record the 2.4.0 pin | `tracker.py upgrade` acts on `project/tracker.json`, which only exists on `project-state` |
| Q4 — branch protection, audits | protection and the HOD's scheduled audit act on the two run-state branches |
| Every status change in this project | the pointer block requires events in `project/events/<role>.jsonl` **on `project-state`**; with no branch, no task can ever be marked Done |
| The owner's original item 3 (`jpbir-hod-audit`) | its script cannot do anything useful until the branches it audits exist |

Verified today: the remote has **no** `project-state` and **no** `project-verifier` branch, so `tracker.py audit` has nothing to read anywhere.

## 1. One correction to the local plan, before the steps

Contract rule 4 (pinned skill line 77) says evidence from automated checks comes from CI or from a runner/device farm/hardware rig **declared in the environment manifest**, and that *"a log from an agent's own machine never counts."* The Windows Task Scheduler task `jpbir-hod-audit` therefore can **never** produce audit evidence, whatever wrapper it runs. Consequences:

- the compliant mechanism is the two workflows in §4 — that is Q2's real deliverable;
- the local task is either retired, or kept as a non-evidence early-warning convenience, in which case the script it is missing is the wrapper in `project/reports/2026-10-17-q2-audit-enablement.patch` (see §5).

**Recommendation:** enable the CI workflows and stop treating the local task as *the* audit; keep or delete the task itself as the owner prefers (deleting a scheduled task is a host change for the owner).

## 2. Create the two run-state branches

A recorded identity (owner, or the HOD's verifier identity) runs these; this session did not. Do it in a scratch clone so the working checkout is untouched.

```bash
git clone -b main https://github.com/jaytipargal/jpbir.git /tmp/jpbir-state && cd /tmp/jpbir-state

# project-state: the project folder only, on its own branch
git checkout -b project-state main
git rm -r --cached . >/dev/null
for p in *; do [ "$p" = project ] || rm -rf "$p"; done
git add -A
git commit -m "chore(project): create the project-state run-state branch"
git push origin project-state

# project-verifier: same shape, for the HOD's own events file only
git checkout -b project-verifier main
git rm -r --cached . >/dev/null
for p in *; do [ "$p" = project ] || rm -rf "$p"; done
git add -A
git commit -m "chore(project): create the project-verifier branch"
git push origin project-verifier
```

The state branch needs at least `project/tracker.json`, `project/TRACKER.md` and `project/events/`; carrying the whole `project/` folder is the simplest shape and matches the pointer block.

## 3. Initialise the tracker on `project-state`

`init` reads the pinned skill from the **default branch's** project folder and writes into the **state** folder, so run it from a `main` checkout while pointing `--state` at the state branch's `project/` directory:

```bash
# main checkout at the pinned revision
python3 project/audit/tracker.py init --project project --state /tmp/jpbir-state/project
# -> creates tracker.json, TRACKER.md and events/ in the state folder; refuses if tracker.json already exists
cd /tmp/jpbir-state && git add project && git commit -m "chore(project): initialise the tracker from the pinned skill" && git push
```

Then record the owner's six answers as orchestrator events (`project/events/orchestrator.jsonl` on `project-state`) and apply them with `tracker.py apply-events --project project --state /tmp/jpbir-state/project --verifier-state /tmp/jpbir-verifier/project`. This is the step that turns `project/approvals/2026-10-16-owner-answers.md` into tracker state instead of prose.

## 4. The two workflows (Q2's compliant mechanism)

Source of truth: the pinned skill carries both workflows verbatim at `project/audit/SKILL.md` lines 2116–2241. Copy them from there, change nothing in their logic, and apply these concrete adaptations:

| Adaptation | Value / decision |
| --- | --- |
| `PROJECT_FOLDER` | `project` (already the skill's default; matches `settings.json`) |
| `DEFAULT_BRANCH` / `STATE_BRANCH` / `VERIFIER_BRANCH` | `main` / `project-state` / `project-verifier` (already the skill's defaults) |
| `GITHUB_REPOSITORY_ID` | **must be defined** — the snippets use `$GITHUB_REPOSITORY_ID`, which GitHub does not provide by default. This project's value is `1350770272` (`project/targets.json`); set it as a repository variable and pass it in `env:` |
| `actions/checkout`, `actions/create-github-app-token` | pin each to the **full commit hash** of its current release, as the skill requires; the snippets carry placeholders |
| `hod-audit.yml` credential | **no GitHub App is needed for this one.** It declares `permissions: contents: read`, never pushes, and its `create-github-app-token` step's token is not referenced by any later step in the skill's snippet. On a public repository the default token can check out all three branches, so this workflow can ship now |
| `tracker.yml` credential | **needs a decision.** It commits and pushes to `project-state`, so it needs a write credential: a GitHub App (what the skill assumes: `vars.AUTHOR_APP_ID` + `secrets.AUTHOR_APP_PRIVATE_KEY`), or a fine-grained PAT / deploy key scoped to that branch. D-3 recorded "no GitHub Apps", which is the only thing standing in the way |
| `hod-audit.yml` schedule | the skill's `cron: "17 3 * * *"` matches D-5's local 08:47 IST — keep them aligned |

## 5. The local wrapper (only if the task is kept)

`project/reports/2026-10-17-q2-audit-enablement.patch` adds `project/audit/run-hod-audit.cmd` (70 lines): it fetches both run-state branches, materialises them as temporary `git worktree`s, runs `tracker.py selftest` then `tracker.py audit`, logs to `%LOCALAPPDATA%\jpbir-hod-audit`, and exits `0` pass / `1` check failed / `2` precondition missing (so a broken setup shows as a non-zero task result instead of a silent pass).

Verified here: the patch applies strictly (`git apply --check`, no fuzz) and round-trips to exactly 70 lines. **Not verified:** the batch logic itself — this session has no Windows, so the HOD must dry-run it once with both branches present before relying on it. It is deliberately placed in `project/audit/`, a protected control, which is why it is a patch for the HOD and not a commit from this session.

## 6. Protection, and the test that proves it works

```bash
# refuse force-pushes and deletion on both branches (public repo, so this is available now)
for b in project-state project-verifier; do
  gh api -X PUT "repos/jaytipargal/jpbir/branches/$b/protection" \
    -H "Accept: application/vnd.github+json" \
    -f "enforce_admins=true" -F "allow_force_pushes=false" -F "allow_deletions=false" \
    -F "required_pull_request_reviews=" >/dev/null && echo "$b protected"
done

# project-verifier accepts pushes only from the verifier identity (restrictions);
# project-state only from the identities in identities.json and the owner.
# Confirm each response — plan/visibility rules for restrictions differ.
```

Rule 12 requires the enforcement itself to be tested: push a deliberately failing change to each branch and confirm it is **blocked**, then record the receipt. A protection setting that has never rejected anything is an untested control.

## 7. Verification checklist for the HOD

1. `gh api repos/jaytipargal/jpbir/branches --jq '.[].name'` lists both run-state branches.
2. `python3 project/audit/tracker.py --state <state>/project --verifier-state <verifier>/project audit` exits 0 on the default branch (this is the check that has never once run in this project).
3. Dispatch `hod-audit.yml` and confirm the run is green on the exact revision; that run is the first piece of audit evidence that counts.
4. `run-hod-audit.cmd` (if kept) returns 0 with the branches present and 2 with them absent.
5. The failing-change test in §6 was blocked on both branches.
6. `project/approvals/2026-10-16-owner-answers.md` answers are recorded as orchestrator events and applied, so the tracker stops depending on prose.

## 8. What this proposal does not do

It does not create or protect any branch, does not add `run-hod-audit.cmd`, `tracker.yml` or `hod-audit.yml`, does not initialise the tracker, and does not touch any other protected control. It records no task as Done. The `cline-cloud[bot]` grant (push/PR on non-protected branches, expiring 2026-11-15) does not extend to any of it.

