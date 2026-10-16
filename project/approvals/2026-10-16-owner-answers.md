# Owner answers — batch 1 (2026-10-16)

Recorded here because `project/approvals/` and the `project-state` branch do not exist yet (report §3.3). This file is committed on branch `cline/1p14p7wy` and becomes the durable record when that branch is merged. Answers were given in the Cline session chat, by question number.

| # | Question | Answer | Scope as the owner gave it |
| --- | --- | --- | --- |
| 1 | Record the `cline-cloud[bot]` automation identity | **YES** | `devops` role only; 30-day expiry; push/PR limited to non-protected branches |
| 2 | HOD adds the audit files and protects the run-state branches | **YES** | HOD adds `project/audit/run-hod-audit.cmd`, `tracker.yml`, `hod-audit.yml`; protects `project-state` and `project-verifier` |
| 3 | Pinned-control mismatch (skill/tracker 2.4.0 vs D-7's 2.2.0) | **YES** | Keep 2.4.0; record the upgrade using the reviewed hashes |
| 4 | Repository visibility and its follow-ups | **YES** | Keep the repository public if that is what is required; enable branch protection and required checks; complete the secret and licence audits |
| 5 | Restore the droplet runner and reconcile to `main` | **YES** | "If needed", once host access is available |
| 6 | Host items 1, 2, 5 and 6 (Intel driver, `cua-driver-serve`, port 26463, AzureAiProxy) | **YES** | Run the commands on that machine and return the output |

## What each answer authorises, who can perform it, and its state

| # | Authorised | Must be performed by | State after this batch |
| --- | --- | --- | --- |
| 1 | The access grant in `project/reports/2026-10-16-identity-record-proposal.patch` | A recorded identity — owner or HOD. **Not** `cline-cloud[bot]`: an unrecorded identity may not push at all (rule 11), so it cannot land the change that records it | **Owner-approved, not applied.** Applying the patch to `main` is the single step that unblocks every Git-host action |
| 2 | The audit script, the two workflows and branch protection | The HOD (protected controls, rule 12) | **Approved, waiting on the HOD.** `tracker.yml`/`hod-audit.yml` are in the pinned skill at lines 2116–2241 |
| 3 | Recording the 2.4.0 pin | The orchestrator/HOD, via `tracker.py upgrade` | **Approved, Blocked** — `upgrade` acts on `project/tracker.json` on the state branch, which does not exist; it follows question 2 |
| 4 | Branch protection, required checks, full secret and licence audits | A recorded identity on the Git host (rule 11), and the HOD for the audits | **Approved, Blocked** on question 1. The bounded secret scan in report §3.2 already found no live credential in the tracked tree |
| 5 | Restoring the runner from `Server/jp-agent/setup-runner.sh` and reconciling the droplet | The owner (host access) | **Approved, Blocked** — no host access from this session |
| 6 | Settling the four host findings | The owner, on that machine, or a run with access to it | **Approved, Blocked** — the commands are in report §5; this session cannot reach that machine |

**Keystone: question 1.** Every blocked item above except 5 and 6 depends on a Git-host write, and rule 11 stops all of them until `cline-cloud[bot]` is recorded. Nothing in this batch was acted on by itself: no push, no remote branch, no PR, no branch-protection change, no control modified.
