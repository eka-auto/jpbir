# Owner direction — push and merge: the Windows repoint fix (2026-10-27)

After PR #209 was opened and reported ready with every check green, the owner answered
**"push and merge to main"** to this session. This file is the written approval contract
rule 11 requires, in the same shape as `2026-10-18-merge-authority.md` and
`2026-10-27-asn-labels-proceed-merge.md`.

## What is approved

| Action | Approval |
| --- | --- |
| Push this approval record to `fix/warehouse-repoint-windows` and re-run the PR checks | Approved |
| Squash-merge PR #209 to `main` — squash, matching the repository's history (`#206`, `#208`) | Approved |
| Let the Vercel Git integration deploy from the merge | Approved; no agent shell deploys |

## What the change is, and is not

The change repairs the one command that
`project/approvals/2026-10-27-neon-estate-decisions.md` (question 1) asks the owner to run.
npm installs the Neon CLI as `neon.cmd` on Windows and Node will not spawn a `.cmd` without
a shell, so the command died with `spawnSync neon ENOENT` before it ever reached Neon. The
same change names the organization a credential must belong to when the key is scoped
elsewhere, because the mirror and the five retained source projects are in different ones.

It touches no secret, no migration, no workflow permission and no target. The secret repoint
itself is still **not** done: it needs a Neon API key for `org-billowing-meadow-62228264`,
which this session does not hold, and no credential was read, printed or written while
establishing that.

## Limits that stay in force

- Every check must be green on the PR before the merge; a check that could not run is Error,
  never Pass (contract rule 1).
- No direct push to `main`, no bypass, no protected-control change outside this reviewed PR.
- The four connection secrets are unchanged by this merge and still name the consolidated
  copy until the owner runs the repoint with a meadow key.
- Deploy stays with CI and the Vercel Git integration; verify the production deployment
  against `project/targets.json` afterwards and record the receipt.
