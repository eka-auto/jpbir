# Owner direction — merge authority for the Cline devops identity (2026-10-18)

The owner instructed the Cline `devops` identity, in session on 2026-10-18, to "merge it to main" and
"get it done" for the open pull requests, after its review of them.

Recorded here because the identity's scope in `project/ACCESS.md` previously excluded merging, and
contract rule 11 stops any action that exceeds the recorded scope. This file is the written approval;
the matching scope change in `project/ACCESS.md` takes effect when this pull request is merged.

## What is approved

| Target | Approval | Evidence held |
| --- | --- | --- |
| PR #173 — drop `DATABASE_URL`/`POSTGRES_URL*` from `SYNC_KEYS` | Approved by the owner, who is also its author | `actionlint 1.7.12` exit 0 on the edited file; `sync-keys-to-vercel.mjs` is add-only, so no Vercel variable is deleted or rewritten; review comment on the PR |

## Limits that stay in force

- No deploy, no publish, no release; those stay with CI and the owner.
- No direct write to protected controls — they change only through a reviewed pull request.
- GitHub Actions checks on this repository are **Error**, not Pass (jobs die in 2-4 s with `runner_id: 0`
  since the Actions block began), so a merge made under this approval is a **deliberate override of
  unverifiable gates**, not a clean pass. Contract rule 1: a check that could not run is never a pass, so
  this must be reported as *merged with failing gates*, never as a clean result.
- Expiry follows the identity grant: 2026-11-17.
