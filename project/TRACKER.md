# Production tracker (R1)

## Tasks

| ID | Task | Step | Owner | State | Note |
| --- | --- | --- | --- | --- | --- |
| T-01 | Discover read-only and preserve existing work | 0 | orchestrator | Done |  |
| T-02 | Set profile, risk tier, compliance scope, budgets and recovery targets | 0 | orchestrator | Done |  |
| T-03 | Create the environment manifest and the target manifest | 0 | orchestrator | Done |  |
| T-04 | Baseline CI, branch protection and protected controls proven | 0 | devops | In progress | The baseline this task asks for is now fully proven, and the blocker recorded earlier is gone. CI/CD Pipeline and Code Quality Checks are green on main pushes and on pull requests, and the scheduled Endpoint Health Check has run green on every scheduled tick since PR #193 fixed the schedule verdict. The ruleset the owner hardened on 2026-10-22 (25339138) now requires eight status checks, one approving review, a code-owner review, a last-push approval and resolved review threads, with deletion and non-fast-forward and bypass never; the owner verified that a direct update to main is rejected. CODEOWNERS is merged through PR #193, covering /project/, /.github/ and /Backend/. The durable approval for the administrative operations is project/approvals/2026-10-22-bounded-release-admin.md. What remains is the HOD's verification and its mark of Done, which only the verifier can give - a devops event may move the task but may not mark it done. |
| T-05 | Appoint the HOD; scheduled audit verified running | 0 | orchestrator | Done |  |
| T-06 | BRD and TRD with measurable acceptance criteria and traceability | 1 | orchestrator | In progress | Scope direction confirmed by owner (D-16): R1 = stabilize and harden, no new features. BRD/TRD drafting for the stabilization scope is the next work item; owner questions will be batched with the draft. |
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
| T-22 | Full pipeline complete; standards gate passes | 5 | devops | In progress | A debugging pass over the evidence path, asked for as 'do debbing', with the two owner gates outstanding: the useful question was what would still keep the rows red AFTER they close. Each boundary was checked against the provider, the broker and the device bundle rather than against expectation. Boundary 1, device to panel: the broker stamps lastSeen and enrollment.lastSignedHeartbeatAt with the same string, so the attestation's exact comparison holds; keyType is android-keystore-p256; device_agent.py reports exactly the contract's release; live_daemon is an accepted source type - sound. Boundary 2, CI to deployment: the live production deployment is built from githubCommitSha 91e78dd6d4e89f262e86fba58b154dbdcee3efb1, which is main's HEAD, so the publisher's GITHUB_SHA and the runtime's VERCEL_GIT_COMMIT_SHA are the same commit - sound. Boundary 3, Firestore to panel: the publisher's encoder and the panel's decoder now run over one body in a suite, and the panel's own probes run over the result - proven, and it was the last untested seam. Two defects were found, both in the panel's REPORTING rather than in its checks: a 404 on the evidence document was reported as 'the CI evidence store is unreachable' when the store had answered perfectly and the document simply did not exist yet, and the revision check ran after the store check, so a deployment that could not name its own revision would have been reported as an unreachable store and the real blocker would have stayed invisible. The revision is checked first now, and a missing document is distinguished from an unreadable store. Live at 23:47Z: overall fail, ready false, 30 green, 6 failing (device rows), 2 unproven (evidence rows); PR #196 still REVIEW_REQUIRED. |
| T-23 | Automated tests green, including authorization and failure cases | 5 | qa | Pending |  |
| T-24 | Source security scanning clean | 5 | security | Pending |  |
| T-25 | Compliance and privacy controls mapped to evidence | 5 | security | Pending |  |
| T-26 | Release candidate built, scanned, signed and attested | 6 | devops | Pending |  |
| T-27 | Staging verified on the exact artifacts; restore drill passed | 7 | devops | In progress | The backup-and-restore path is drilled and green against the isolated environment, and the migration runner now runs inside the pinned environment at all. Remaining for this task: verifying the exact release artifacts on staging, which needs the owner-approved deploy. |
| T-28 | Performance, accessibility and DAST verified against the TRD | 7 | qa | Pending |  |
| T-29 | Monitoring and alerting verified end to end | 7 | devops | In progress | PR #192 merged and deployed at ea706b12: the live /api/jp-stack now answers with the strict readiness verdict, the schedule block and a native cron receipt carrying the notification outcome, and the schedule is alive (the native receipt is minutes old). The verdict is fail on the six device rows, which is the S24 still running the legacy collector. Two defects of mine were found by the branch's own CI run and are repaired in PR #193: jq's // treats false as absent, so the monitor read every healthy schedule as stale and announced a stopped scheduler every fifteen minutes; and the ledger reconciliation wrote its report to a container-only path and died with ENOENT before it could run. PR #193 was reviewed independently and approved, and the access register's citation to an approval record that did not exist was repaired during that review. |
| T-30 | Release approval | 7 | owner | Pending |  |
| T-31 | Release to production with automated halt rules | 8 | devops | Pending |  |
| T-32 | Post-release verification against service levels | 8 | devops | In progress | PR #196 merged at 00:09:25Z (1b340e3b) and the evidence-publish job on main SUCCEEDED for the first time. The live panel moved from 30 green and 2 unproven to 31 green, 6 failing and 1 unproven: the migration-tooling row is now GREEN on a signed, revision-bound receipt, and the runtime-contract row carries the honest remaining reason - 'the device has not attested the runtime contract (the S24 is fail)' - rather than the old misleading 'the CI evidence store answered HTTP 404'. The outside monitor is green on every scheduled run (22:57:20Z, 23:26:11Z, 23:55:13Z). The 24-hour observation window is still NOT started and must not be: readiness.ready is false because the six device rows are red. The S24 still reports s24-termux-https-worker-2026-07-27.1 over termux-direct-cloud with a heartbeat older than a day and five queued commands unclaimed, so the only remaining gate is the physical action on the phone. NOTE ON THE BRANCH: project-state was force-pushed to main's HEAD by the owner at about 00:14Z, which removed the run state from the branch. It is intact locally at 84b4d037 with this event on top; it is held back from the remote pending the owner's decision on whether to restore that state or to build a fresh one, because pushing it would re-create what was just reset. |
| T-33 | Handover pack and runbooks proven by a fresh session | 9 | documentation | Pending |  |
| T-34 | Owner handover accepted; operations and feedback loop live | 9 | orchestrator | Pending |  |

**Progress: 11%** `██░░░░░░░░░░░░░░░░░░` 4 of 34 applicable tasks done

Not required: 0 · Blocked: 0 · Awaiting: 0 · In progress: 6 · Pending: 24

By step: Step 0: 4/5 · Step 1: 0/4 · Step 2: 0/2 · Step 3: 0/2 · Step 4: 0/8 · Step 5: 0/4 · Step 6: 0/1 · Step 7: 0/4 · Step 8: 0/2 · Step 9: 0/2

Generated from tracker.json by project/audit/tracker.py. Do not edit by hand.
