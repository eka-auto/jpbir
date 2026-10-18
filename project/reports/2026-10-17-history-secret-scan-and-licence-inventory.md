# Full-history secret scan and licence inventory — 2026-10-17

**Author:** automated session `tsk-01M532NH0WQD2YHSWJ1P14P7WY` (`cline-cloud[bot]`, recorded as `devops`) on branch `cline/1p14p7wy`.
**Subject:** `jaytipargal/jpbir` `main@c809ebae4f4a545b5a367c6da2dcf01dc73a1016`.

**Correction scope:** original scan totals remain historical observations. The reproduction, coverage qualification, current-tree wording and licence inventory below were corrected after review; no new completion or HOD approval is claimed.
**Why:** the repository is **public** and the 16 October report only scanned the tracked tree of one revision (§3.2). That check explicitly did not cover history. This report records historical findings relevant to Q4; it does not complete Q4 or replace the required CI and HOD evidence.

## 1. Scope and method

| | |
| --- | --- |
| Repository copy | `git clone --mirror` into a scratch directory, **all refs** — 1190 commits, 7879 objects, 14 MB |
| Blobs scanned | **4107** blobs, **92,038,990** bytes; 0 skipped (none exceeded the 8 MB cap) |
| Patterns | the repository's own high-confidence set from `_shared/tools/scan_secrets.py`, plus JWT-shaped strings and assignments to known secret variable names. **That set has no AWS secret-access-key pattern**, so the first pass could not have detected one — see §2a, which adds it |
| Value handling | **no secret value is included in this report.** Findings use fingerprints and lengths. A separate exposure in the original session output is recorded in §5 |
| Not covered | secrets outside the repository (Vercel, Firestore, AWS, WhatsApp stores); whether any value is still valid; the HOD's audit (this ran under the `devops` identity, not the verifier's, and stores no immutable proof) |

The original mirror captured the refs available at collection time. Removing a file from `main` does not remove historical objects. Current server-side reachability must be checked separately; a historical mirror is not evidence of a current ref count.

## 2. Findings

| # | What | Exposure | Verdict |
| --- | --- | --- | --- |
| A | `production` (a file with no extension, deleted): `VERCEL_OIDC_TOKEN="<1214 chars>"`, introduced by `0ca4c4e` | history only; no live ref, but reachable in the history of live branches | **Exposure.** Vercel OIDC tokens are short-lived, so this one is almost certainly expired — confirm in Vercel. The real problem is the practice: an environment dump was committed |
| B | `chrome_extraction/output/chrome_data_local_profile_1.db` (5,021,696 B) and `_2.db` (499,712 B), both SQLite | deleted; history only | **Exposure.** Committed Chrome profile databases carrying **26 JWT-shaped values** (5 and 21). These are cookie/session material. Treat every session in them as compromised |
| C | AWS access-key **IDs** in committed reports — `_shared/reports/DATABASE_SETUP_REPORT.md`, `_shared/reports/PRODUCTION_TEST_REPORT.md`, `app/shared/reports/*`: two distinct 20-char `AKIA…` values (hashes `e53e2b508c94`, `704fb8422b21`), in lines like "`JP_AWS_ACCESS_KEY_ID` \| Secret \| Production \| ✅ …" and "Deleted old access key (…)" | **historical mirror observation:** approximately 80 inspected pull-head trees carried the reports; current reachability is a separate check | **Needs owner verification.** An access-key ID alone is not a secret, but it should not be public, and it identifies which key to check. Verify both in IAM; the report text itself says one was deleted |
| D | `_shared/tests/ddb-client.test.mjs`: two `AKIA…` and one `ASIA…` assigned to `process.env.JP_AWS_*` | **history only** — the file exists in **no** current ref; corrected here from an earlier "live on `main`" claim, which was wrong | **Fixtures, but still fetchable** from `main`'s history. Replace with obviously fake values if the file ever returns |
| E | `Devices/sandbox/.env.example` **line 24 at the pinned subject revision** (public at that snapshot): `STATS_KEY=<36 chars>`, value hash `2d7cd44979bc` | removed from the current tree by merged PR #170; retained in history | **Verify credential status.** Cross-reference: the 14 October clean-gate report records "Removed leaked `channel-sandbox` `STATS_KEY` from Preview/Development", this file is the channel-sandbox suite's own template, and its comments describe that exact incident. A value of real length therefore cannot be assumed to be an example. If it is real: rotate it — see the remediation in §3 |
| F | `channel-sandbox/tests/fixtures/python_to_node.json` (deleted; history only): a PKCS#8 EC private key, base64 body **188 chars** — real key material, not a placeholder | history only | **Treat as a leaked key.** Test-scoped, but rotate if it was ever used for anything |
| G | `FIREBASE_SERVICE_ACCOUNT_JSON` private keys in `Devices/sandbox/.env.example`, `DASHBOARD_READY.md`, `channel-sandbox/COMPLETE_DEPLOYMENT_PACKAGE.md`, `channel-sandbox/DEPLOYMENT_VERIFICATION_CHECKLIST.md` | mixed | **Placeholders — no action.** Body length 2 (`"..."`) in every case; the header is present, the key is not |
| H | `"type": "service_account"` markers in docs and tests | mixed | **No action.** Structural marker with no key body |

The original scan reported no matches for its listed patterns in the examined data. Its initial pattern set did not include an AWS secret-access-key pattern. No absence or credential-validity claim follows from that result; the corrected reproduction and its coverage accounting are described below.

## 2a. Two checks added after review (2026-10-17)

**Byte identity against an immutable subject.** These are blob identifiers, not commit identifiers. The four blobs identified in the original mirror were compared against `c809ebae4f4a545b5a367c6da2dcf01dc73a1016:Devices/sandbox/.env.example`. Exactly one `STATS_KEY=` assignment is required in every comparison input; missing objects, missing assignments and duplicate assignments are errors.

| Blob version | Assignment-line comparison with the pinned subject |
| --- | --- |
| `6301da46ca` | byte-identical |
| `bbcf32e071` | byte-identical |
| `d844b0730b` | byte-identical |
| `07abf95fb6` | differs |

This establishes equality of stored assignment lines only. It establishes neither runtime use nor credential validity. A set/length diagnostic alone cannot establish that a running process uses the same value. PR #170 has since restored the placeholder on `main`, so comparing against moving `refs/heads/main` reverses these historical verdicts.

**AWS assignment-pattern check.** The earlier follow-up reported zero matches and claimed coverage of 4,111 blobs. Its published `awk 'NF==2'` filter omitted paths containing spaces, and suppressed Git errors prevented complete read accounting. That pipeline does not substantiate the claimed coverage. Its regex also missed quoted JSON property names and single-quoted values.

The replacement `_shared/tools/verify_history_report.py` enumerates reachable object IDs without filenames, identifies every blob by its Git type, and checks each blob read. The patterns cover literal AWS secret-key and session-token assignments with unquoted, JSON-quoted, and single-quoted forms. Comparisons remain in memory; no plaintext key-line files are created. A configurable memory bound produces an error rather than silently skipping history. A changed local ref snapshot also produces an error.

**Interpretation:** `no_pattern_matches` means those patterns matched none of the scanned blobs reachable from that local ref snapshot. It does not mean the repository contains only key IDs, contains no secrets, or holds no usable credentials. Unlabelled, multiline, split, encoded or runtime-assembled material, and anything outside the repository, remain outside this pattern check. Current IAM status still requires an authorized AWS inspection.

**Reproduce from a checkout containing the checker**, with Git and Python 3.10 or later. The mirror is created in a private temporary directory and removed on exit. No secret values or matching contexts are printed. The JSON result records the pinned subject, a digest of the local refs, full blob counts, bytes read, zero skipped blobs, and comparison verdicts. Counts can change when a new mirror captures changed refs; the original numeric totals are not asserted for future runs.

```bash
set -eu
umask 077
review_dir=$(mktemp -d "${TMPDIR:-/tmp}/jpbir-history.XXXXXXXX")
trap 'rm -rf -- "$review_dir"' EXIT HUP INT TERM
git clone --quiet --mirror https://github.com/jaytipargal/jpbir.git "$review_dir/repository.git"
python3 _shared/tools/verify_history_report.py \
  --repo "$review_dir/repository.git" \
  --subject c809ebae4f4a545b5a367c6da2dcf01dc73a1016 \
  --compare-blob 6301da46ca \
  --compare-blob bbcf32e071 \
  --compare-blob d844b0730b \
  --compare-blob 07abf95fb6
```

Exit **0** means complete reads and no supported pattern matches; **1** means complete reads with one or more matching blobs; **2** means an incomplete/error result, never a clean scan. The default memory bound is 256 MiB of blob content; larger histories require an explicit `--max-bytes` value. These exit codes are not a security sign-off or a Q4 completion gate.

Regression checks use constructed dummy values and temporary repositories only:

```bash
python3 -m unittest discover -s tests -p test_verify_history_report.py -v
```


## 3. Priority actions

PR #170 has merged the placeholder and browser-extraction ignore changes. Those tree changes are separate from credential rotation, runtime verification and history cleanup; none establishes that an exposed credential was revoked.

1. **Check E first.** The assignment was public at the pinned subject revision. Verify whether the historical value is used by any service, and rotate it if so. PR #170 removes it from the current tree, not from history or service configuration.
2. **Verify C in IAM** — do the two key IDs still exist, and is one of them the production read key? Redact them in the current tree and in the PR refs that carry the reports.
3. **Treat A and B as exposed.** Rotate what can be rotated and invalidate the sessions; add `chrome_extraction/`, env dumps and `*.db` to `.gitignore`, plus a pre-commit check, so it cannot recur.
4. **Decide the history question (owner, with Q4).** Deleting a file is not removal here: the original mirror retained old objects and pull-head trees. Neither the historical ~80 report-path observation nor the earlier ~130 broad-ref figure establishes a current reachability count. Options are (a) ask GitHub Support to purge the refs/objects, (b) make the repository private, or (c) rotate everything that was ever committed and accept the history. Recommendation: **rotate first** — it is required under every option — then decide visibility, and record the decision.
5. **Replace D and F** with obviously fake fixtures (a fixed, documented dummy key), so future scans are signal rather than noise.

## 4. Licence inventory (the other half of Q4)

| Ecosystem | Result |
| --- | --- |
| Node (`package-lock.json`, lockfile v3) | **83 entries: 82 dependency entries plus the root package.** Dependencies: MIT 38, Apache-2.0 37, ISC 5, MIT-0 1, 0BSD 1 (82 total). The root entry is `UNLICENSED`, which is not a permissive licence and must be reported separately. No copyleft identifier was observed in those dependency metadata entries; the project licence and allowed-licence policy remain separate review items |
| Python (`_shared/requirements.txt`, `Devices/*/requirements*.txt`, `Devices/S24/requirements-export.txt`) | **Blocked — cannot be resolved here.** Pinned requirement lines carry no licence metadata, and resolving it needs the packages installed in the environment the manifest defines. `project/environment/` does not exist (16 October report §3.3), so this belongs with the environment-manifest work rather than with a hand-run check |

This is an inventory, not the policy gate the skill requires: the gate needs the allowed-licence policy recorded as a decision, and the licence data for the Python side. Neither exists yet.

## 5. Handling note (a gap in my own masking)

The context lines above are masked **per match**, and for the private-key finding (F) that was not enough: the matched string is only the `-----BEGIN … PRIVATE KEY-----` header, so the "masked" line still printed roughly the first 90 characters of the key **body** from that test fixture. That happened in this session's tool output only — it was not written into this report, any other file, or any commit, and it is not repeated here.

Two consequences worth recording:

- the same value is already in the repository's public history, so this did not create the exposure — but it did put a second copy into a session log, which is a handling error of mine, not a scanner limitation;
- the fix for the tooling is to mask **from the match to the end of the line** (or truncate to a fixed prefix) rather than replacing the matched substring only. Any future scan should do that before printing context.

## 6. What this report does not do, and what was not touched

It does not rotate any credential, rewrite any history, delete any ref, change repository visibility, redact the committed reports, or alter any file outside this report. It records no task as Done. The `cline-cloud[bot]` grant (push/PR on non-protected branches, expiring 2026-11-15) covers exactly this document and nothing else. Actions 1–5 in §3 are the owner's; the history decision in particular is a release-integrity and legal decision, not a worker's.

