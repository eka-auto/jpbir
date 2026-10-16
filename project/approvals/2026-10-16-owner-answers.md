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
| 1 | The access grant in `project/reports/2026-10-16-identity-record-proposal.patch` | A recorded identity — owner or HOD. **Not** `cline-cloud[bot]`: an unrecorded identity may not push at all (rule 11), so it cannot land the change that records it | **Applied on `main` 2026-10-16** by the owner: `3ac6404` (`identities.json`) and `eb97581` (`ACCESS.md`). Re-verified from the remote: 2 files, 2 insertions, 1 deletion, nothing else. Rule 11 now passes — `tracker.py verify --identity devops --email cline-cloud[bot]@users.noreply.github.com` exits 0 |
| 2 | The audit script, the two workflows and branch protection | The HOD (protected controls, rule 12) | **Approved, waiting on the HOD.** `tracker.yml`/`hod-audit.yml` are in the pinned skill at lines 2116–2241 |
| 3 | Recording the 2.4.0 pin | The orchestrator/HOD, via `tracker.py upgrade` | **Approved, Blocked** — `upgrade` acts on `project/tracker.json` on the state branch, which does not exist; it follows question 2 |
| 4 | Branch protection, required checks, full secret and licence audits | A recorded identity on the Git host (rule 11 — now satisfied), and the HOD for the audits | **Approved, unblocked** by question 1 landing. The bounded secret scan in report §3.2 already found no live credential in the tracked tree |
| 5 | Restoring the runner from `Server/jp-agent/setup-runner.sh` and reconciling the droplet | The owner (host access) | **Approved, Blocked** — no host access from this session |
| 6 | Settling the four host findings | The owner, on that machine, or a run with access to it | **Approved, Blocked** — the commands are in report §5; this session cannot reach that machine |

**Keystone: question 1 — now cleared (2026-10-16).** The owner applied the grant on `main` as `3ac6404` and `eb97581`, and the pre-push check passes (`target: PASS`, `identity exit=0`, signed in as `cline-cloud[bot]`, repository `jaytipargal/jpbir` id `1350770272` as the platform reports it). Items 2, 5 and 6 remain with the HOD and the owner; item 3 follows item 2. No push, branch-protection change or control modification was made by this session before the grant landed.

**Expiry:** the grant expires **2026-11-15**. After that, rule 11 stops every push again until the owner renews it. **Scope limit:** push/PR on non-protected branches only — merging, deploying and writing to protected controls stay with the owner and the HOD.

**Still missing, unchanged by this grant:** the `project-state` and `project-verifier` branches do not exist on the remote (re-checked after the fetch: 3 heads), so `project/STOP` cannot be read from a state branch and the tracker/audit jobs still have nowhere to write. That is item 2.
