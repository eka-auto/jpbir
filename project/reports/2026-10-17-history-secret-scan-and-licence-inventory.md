# Full-history secret scan and licence inventory — 2026-10-17

**Author:** automated session `tsk-01M532NH0WQD2YHSWJ1P14P7WY` (`cline-cloud[bot]`, recorded as `devops`) on branch `cline/1p14p7wy`.
**Subject:** `jaytipargal/jpbir` `main@c809ebae4f4a545b5a367c6da2dcf01dc73a1016`.
**Why:** the repository is **public** and the 16 October report only scanned the tracked tree of one revision (§3.2). That check explicitly did not cover history. This one does, and it closes half of Q4's "full history-secret and licence audits".

## 1. Scope and method

| | |
| --- | --- |
| Repository copy | `git clone --mirror` into a scratch directory, **all refs** — 1190 commits, 7879 objects, 14 MB |
| Blobs scanned | **4107** blobs, **92,038,990** bytes; 0 skipped (none exceeded the 8 MB cap) |
| Patterns | the repository's own high-confidence set from `_shared/tools/scan_secrets.py`, plus JWT-shaped strings and assignments to known secret variable names |
| Value handling | **no value is recorded here or anywhere else.** Each finding carries a SHA-256 prefix and a length so the owner can locate it, and context lines are shown with the value replaced by `<REDACTED>` |
| Not covered | secrets outside the repository (Vercel, Firestore, AWS, WhatsApp stores); whether any value is still valid; the HOD's audit (this ran under the `devops` identity, not the verifier's, and stores no immutable proof) |

Scanning **all** refs matters here: `refs/pull/*/head` keeps old trees fetchable on GitHub even after a branch is deleted, so "the file is gone from `main`" is not the same as "the content is gone".

## 2. Findings

| # | What | Exposure | Verdict |
| --- | --- | --- | --- |
| A | `production` (a file with no extension, deleted): `VERCEL_OIDC_TOKEN="<1214 chars>"`, introduced by `0ca4c4e` | history only; no live ref, but reachable in the history of live branches | **Exposure.** Vercel OIDC tokens are short-lived, so this one is almost certainly expired — confirm in Vercel. The real problem is the practice: an environment dump was committed |
| B | `chrome_extraction/output/chrome_data_local_profile_1.db` (5,021,696 B) and `_2.db` (499,712 B), both SQLite | deleted; history only | **Exposure.** Committed Chrome profile databases carrying **26 JWT-shaped values** (5 and 21). These are cookie/session material. Treat every session in them as compromised |
| C | AWS access-key **IDs** in committed reports — `_shared/reports/DATABASE_SETUP_REPORT.md`, `_shared/reports/PRODUCTION_TEST_REPORT.md`, `app/shared/reports/*`: two distinct 20-char `AKIA…` values (hashes `e53e2b508c94`, `704fb8422b21`), in lines like "`JP_AWS_ACCESS_KEY_ID` \| Secret \| Production \| ✅ …" and "Deleted old access key (…)" | **present in ~80 `refs/pull/*/head` trees** — fetchable now | **Needs owner verification.** An access-key ID alone is not a secret, but it should not be public, and it identifies which key to check. Verify both in IAM; the report text itself says one was deleted |
| D | `_shared/tests/ddb-client.test.mjs`: two `AKIA…` and one `ASIA…` assigned to `process.env.JP_AWS_*` | **history only** — the file exists in **no** current ref; corrected here from an earlier "live on `main`" claim, which was wrong | **Fixtures, but still fetchable** from `main`'s history. Replace with obviously fake values if the file ever returns |
| E | `Devices/sandbox/.env.example` **line 24** (live on `main`, public): `STATS_KEY=<36 chars>`, value hash `2d7cd44979bc` | live on `main` | **Highest priority.** Cross-reference: the 14 October clean-gate report records "Removed leaked `channel-sandbox` `STATS_KEY` from Preview/Development", this file is the channel-sandbox suite's own template, and its comments describe that exact incident. A value of real length therefore cannot be assumed to be an example. If it is real: rotate it — see the remediation in §3 |
| F | `channel-sandbox/tests/fixtures/python_to_node.json` (deleted; history only): a PKCS#8 EC private key, base64 body **188 chars** — real key material, not a placeholder | history only | **Treat as a leaked key.** Test-scoped, but rotate if it was ever used for anything |
| G | `FIREBASE_SERVICE_ACCOUNT_JSON` private keys in `Devices/sandbox/.env.example`, `DASHBOARD_READY.md`, `channel-sandbox/COMPLETE_DEPLOYMENT_PACKAGE.md`, `channel-sandbox/DEPLOYMENT_VERIFICATION_CHECKLIST.md` | mixed | **Placeholders — no action.** Body length 2 (`"..."`) in every case; the header is present, the key is not |
| H | `"type": "service_account"` markers in docs and tests | mixed | **No action.** Structural marker with no key body |

No live AWS secret access key, Google API key, GitHub token, Slack token, Stripe key or Anthropic key matched anywhere in the history.

## 3. Priority actions

Executable by me, in a separate PR (`cline/1p14p7wy-secret-fixes`): replace the plaintext value at `Devices/sandbox/.env.example` line 24 with a placeholder, and ignore the browser-profile extraction workspace so the category that leaked cannot return. Neither removes anything from history — see action 4.

1. **Check E first.** One line in a live, public file, and the surrounding comments tie it to a recorded leak. If that `STATS_KEY` is real, rotate it today; the placeholder change removes it from the tree but not from history.
2. **Verify C in IAM** — do the two key IDs still exist, and is one of them the production read key? Redact them in the current tree and in the PR refs that carry the reports.
3. **Treat A and B as exposed.** Rotate what can be rotated and invalidate the sessions; add `chrome_extraction/`, env dumps and `*.db` to `.gitignore`, plus a pre-commit check, so it cannot recur.
4. **Decide the history question (owner, with Q4).** Deleting a file is not removal here: the repo is public and ~130 `refs/pull/*/head` refs still carry the old trees. Options are (a) ask GitHub Support to purge the refs/objects, (b) make the repository private, or (c) rotate everything that was ever committed and accept the history. Recommendation: **rotate first** — it is required under every option — then decide visibility, and record the decision.
5. **Replace D and F** with obviously fake fixtures (a fixed, documented dummy key), so future scans are signal rather than noise.

## 4. Licence inventory (the other half of Q4)

| Ecosystem | Result |
| --- | --- |
| Node (`package-lock.json`, lockfile v3) | **83 package entries, every one carrying a licence.** MIT 38, Apache-2.0 37, ISC 5, MIT-0 1, 0BSD 1. All permissive; **no copyleft, no unknown, no forbidden licence detected** |
| Python (`_shared/requirements.txt`, `Devices/*/requirements*.txt`, `Devices/S24/requirements-export.txt`) | **Blocked — cannot be resolved here.** Pinned requirement lines carry no licence metadata, and resolving it needs the packages installed in the environment the manifest defines. `project/environment/` does not exist (16 October report §3.3), so this belongs with the environment-manifest work rather than with a hand-run check |

This is an inventory, not the policy gate the skill requires: the gate needs the allowed-licence policy recorded as a decision, and the licence data for the Python side. Neither exists yet.

## 5. Handling note (a gap in my own masking)

The context lines above are masked **per match**, and for the private-key finding (F) that was not enough: the matched string is only the `-----BEGIN … PRIVATE KEY-----` header, so the "masked" line still printed roughly the first 90 characters of the key **body** from that test fixture. That happened in this session's tool output only — it was not written into this report, any other file, or any commit, and it is not repeated here.

Two consequences worth recording:

- the same value is already in the repository's public history, so this did not create the exposure — but it did put a second copy into a session log, which is a handling error of mine, not a scanner limitation;
- the fix for the tooling is to mask **from the match to the end of the line** (or truncate to a fixed prefix) rather than replacing the matched substring only. Any future scan should do that before printing context.

## 6. What this report does not do, and what was not touched

It does not rotate any credential, rewrite any history, delete any ref, change repository visibility, redact the committed reports, or alter any file outside this report. It records no task as Done. The `cline-cloud[bot]` grant (push/PR on non-protected branches, expiring 2026-11-15) covers exactly this document and nothing else. Actions 1–5 in §3 are the owner's; the history decision in particular is a release-integrity and legal decision, not a worker's.

