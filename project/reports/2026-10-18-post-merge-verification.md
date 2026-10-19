# Post-merge verification of `main` @ `fe2bec6` (2026-10-18)

Verified by the `devops` identity against the exact merged commit, after #173–#177 were merged.

## Merged and confirmed present in `main`

| PR | Change | Check on `fe2bec6` |
| --- | --- | --- |
| #173 | drop `DATABASE_URL`/`POSTGRES_URL*` from `SYNC_KEYS` | `grep -c DATABASE_URL` in the workflow = **0** |
| #176 | runner registers the `jp-agent-droplet` label | line 25 = `--labels jp-agent,droplet,deploy,jp-agent-droplet` |
| #174 | `eka-auto` recorded as a collaborator identity | `project/ACCESS.md` + `project/identities.json` |
| #177 | owner-directed merge authority recorded | `project/ACCESS.md` + `project/approvals/2026-10-18-merge-authority.md` |
| #175 | the sync-keys patch + block record | `project/reports/` |

## Pipeline checks reproduced on the merged commit

| CI job | Run locally with | Result |
| --- | --- | --- |
| `Lint & Test` → lint | `npm run lint` | **PASS** |
| `Lint & Test` → test | `npm test` | **49/49 suites passed** |
| `jp-agent (droplet) tests` | `node --test tests/*.test.mjs` | **13 pass, 0 fail** |
| `Validate workflow definitions` | `actionlint 1.7.12`, all 9 workflows | **clean, exit 0** |

Not reproducible here, so still unknown rather than clean: `S24 MCP compatibility (Python 3.12 / 3.14)`
and `Security Scan` (need those interpreters and the scanner image).

## Why GitHub's own checks are still red

Every failing check on `main` carries this annotation (`/check-runs/{id}/annotations`):

> **The job was not started because your account is locked due to a billing issue.**

So each GitHub Actions job is **Error — never a Pass** (contract rule 1), and the merges above are
recorded as *merged with gates that could not run*, not as clean passes. `Deploy to jp-agent Droplet`
stays **Queued** until a self-hosted runner is online; its label requirement is now satisfied by #176.

## Remaining, smallest first

1. Clear the billing lock (owner) — restores every `ubuntu-latest` check immediately.
2. Start the droplet runner (`Server/jp-agent/setup-runner.sh`) — drains the queued deploy job.
3. Cosmetic: the merged sync-keys workflow carries two overlapping comment lines (`# Every key the
   deployed code …`), because #173's variant was merged rather than the tidied one. This identity cannot
   push workflow files (the app lacks the `workflows` permission), so it needs either that permission or a
   one-line edit by the owner.
