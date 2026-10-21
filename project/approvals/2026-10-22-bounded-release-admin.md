# Owner direction — bounded release administration (2026-10-22)

The owner approved a bounded set of release-administration actions for this release only, and
then performed them. Recorded here because contract rule 11 stops any action that exceeds an
identity's recorded scope, and because `project/ACCESS.md` cites this file as the durable
approval for the widened scope.

The approval is quoted as the owner gave it: **"YES — approve bounded release access
(Recommended)"**, given in the owner's Codex session on 2026-10-22 and carried into
`project/ACCESS.md` in the same change that cites this file. The actions below were reported
back by the owner in the delivery session on 2026-10-22 and verified independently before the
approval was relied on.

## What is approved, and what was done

| Target | Approval | Evidence held |
| --- | --- | --- |
| `STACK_EVIDENCE_KEY` — configure the same generated value as a GitHub repository secret and as a Vercel production secret | Approved by the owner | The owner reported it configured on both sides with one value and no disclosure. The value is not recorded here, and must never be. The evidence-publish workflow signs receipts with it and the runtime verifies them with it; a mismatched pair leaves the two evidence-backed rows unproven rather than green |
| PR #192 — merge `fix/production-readiness-repair` into `main` | Approved by the owner | Merge commit `ea706b12`, whose second parent is the reviewed head `09c6a2f7d4985f599f9725bb8815756f64b48596` named in `project/ACCESS.md`. Verified with `git log --format="%h %p %s" -1 ea706b12` |
| Ruleset `25339138` — harden the default branch | Approved by the owner | Eight required status checks, `required_approving_review_count: 1`, `require_code_owner_review: true`, `require_last_push_approval: true`, `required_review_thread_resolution: true`, `require_extra_approval_for_unattributed_changes: true`, `current_user_can_bypass: never`, plus deletion and non-fast-forward. Read back from the provider on 2026-10-22 |
| Direct update to `main` — rejected | Approved by the owner | Verified by the owner on 2026-10-22. A ruleset without `required_approving_review_count` cannot express this, so the rejection is the enforcement being real rather than a setting |
| PR #193 — propose CODEOWNERS and the workflow repairs through a reviewed pull request | Approved by the owner | The pull request is reviewed before it merges; this file does not approve it in advance |

## Limits that stay in force

- The administrative grant is for the listed operations only, and expires no later than
  **2026-10-23T23:59:59+05:30**. It creates no ongoing privilege and no standing right to
  merge, deploy or write to a protected control.
- No direct product-code push to `main`; product code still merges through a reviewed pull
  request with the required checks green.
- No fabricated approval: this file records what the owner decided and what was verified, and
  nothing more. Where a claim could not be verified from the provider, it is not stated as
  verified.
- The personal CLI identity `jaytipargal` was not used for the secret and ruleset mutations;
  those were performed by the registered automation identity.
