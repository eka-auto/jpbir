# Production tracker (R1)

## Tasks

| ID | Task | Step | Owner | State | Note |
| --- | --- | --- | --- | --- | --- |
| T-01 | Discover read-only and preserve existing work | 0 | orchestrator | In progress | Discovery complete: git bundle backup (133.63 MB, 22 refs, SHA-256 8018DA68...), untracked archive (eka-runner-private, eka-runner, jayti). Secret patterns excluded. |
| T-02 | Set profile, risk tier, compliance scope, budgets and recovery targets | 0 | orchestrator | In progress | Owner decision D-11: budget constraint REMOVED. Contract rule 8 (hard budget) is not enforced for this run: no per-run or monthly budget ceilings, no 50/80/100 percent spend warnings or pauses, no per-task AI usage budget, no cost-estimate approval gate. Owner accepts cost risk. All other contract rules remain in force. Budgets open item closed as decided. |
| T-03 | Create the environment manifest and the target manifest | 0 | orchestrator | In progress | Environment manifest (Dockerfile node:24.16.0-bookworm-slim, compose.yaml with pinned postgres:16.4, run entry point) and target manifest (5 targets) written. |
| T-04 | Baseline CI, branch protection and protected controls proven | 0 | devops | Blocked | CODEOWNERS created and CI workflows (tracker.yml, hod-audit.yml) added, but branch protection on the private repo requires GitHub Pro (HTTP 403). The binding protected-control check (branch protection + required reviews) cannot be proven without a paid plan. — needs owner |
| T-05 | Appoint the HOD; scheduled audit verified running | 0 | orchestrator | In progress | HOD appointed. Persistent scheduler verified: Windows Task Scheduler task 'jpbir-hod-audit' (daily 08:47 IST = 03:17 UTC) runs project/audit/run-hod-audit.cmd which executes tracker.py selftest + audit. Verified locally: selftest 35/35 PASS, all audit checks PASS, exit 0. HOD runs in its own session from a fresh context (no-CI fallback). GitHub Actions workflows (tracker.yml, hod-audit.yml) also added for when a CI runner is available. |
| T-06 | BRD and TRD with measurable acceptance criteria and traceability | 1 | orchestrator | Pending |  |
| T-07 | Write STANDARDS.md and GLOSSARY.md for this stack | 1 | orchestrator | Pending |  |
| T-08 | Mark every go-live capability (applicability and status) | 1 | orchestrator | Pending |  |
| T-09 | THREAT_MODEL.md approved by the HOD | 1 | security | Pending |  |
| T-10 | Reconcile both codebases and live production on a named integration branch | 2 | orchestrator | Pending |  |
| T-11 | Baseline of inherited violations and characterization tests on the integration branch | 2 | qa | Pending |  |
| T-12 | Lock shared contracts and plan the slices | 3 | orchestrator | Pending |  |
| T-13 | Assign department agents | 3 | orchestrator | Pending |  |
| T-14 | Department preflight for development | 4 | orchestrator | Pending |  |
| T-15 | Infrastructure as code for every environment, with drift detection | 4 | devops | Pending |  |
| T-16 | Walking skeleton live on staging through the real pipeline | 4 | devops | Pending |  |
| T-17 | Database: schema, tables and migrations complete | 4 | database | Pending |  |
| T-18 | Backend complete | 4 | backend | Pending |  |
| T-19 | Frontend complete | 4 | frontend | Pending |  |
| T-20 | Design complete | 4 | design | Pending |  |
| T-21 | All slices integrated on main, green | 4 | orchestrator | Pending |  |
| T-22 | Full pipeline complete; standards gate passes | 5 | devops | Pending |  |
| T-23 | Automated tests green, including authorization and failure cases | 5 | qa | Pending |  |
| T-24 | Source security scanning clean | 5 | security | Pending |  |
| T-25 | Compliance and privacy controls mapped to evidence | 5 | security | Pending |  |
| T-26 | Release candidate built, scanned, signed and attested | 6 | devops | Pending |  |
| T-27 | Staging verified on the exact artifacts; restore drill passed | 7 | devops | Pending |  |
| T-28 | Performance, accessibility and DAST verified against the TRD | 7 | qa | Pending |  |
| T-29 | Monitoring and alerting verified end to end | 7 | devops | Pending |  |
| T-30 | Release approval | 7 | owner | Pending |  |
| T-31 | Release to production with automated halt rules | 8 | devops | Pending |  |
| T-32 | Post-release verification against service levels | 8 | devops | Pending |  |
| T-33 | Handover pack and runbooks proven by a fresh session | 9 | documentation | Pending |  |
| T-34 | Owner handover accepted; operations and feedback loop live | 9 | orchestrator | Pending |  |

**Progress: 0%** `░░░░░░░░░░░░░░░░░░░░` 0 of 34 applicable tasks done

Not required: 0 · Blocked: 1 · Awaiting: 0 · In progress: 4 · Pending: 29

By step: Step 0: 0/5 · Step 1: 0/4 · Step 2: 0/2 · Step 3: 0/2 · Step 4: 0/8 · Step 5: 0/4 · Step 6: 0/1 · Step 7: 0/4 · Step 8: 0/2 · Step 9: 0/2

Generated from tracker.json by project/audit/tracker.py. Do not edit by hand.
