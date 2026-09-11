# Implementation Plan: Broker v2 Device Enrollment Control Plane

## Overview

The server-side broker code largely exists across `jayti-dashboard/lib/broker.js` and its
API handlers, and the Python client code exists in `channel-sandbox/`. This plan focuses on:

1. Reconciling the three uncommitted handler edits that may have dropped security controls
2. Hardening `lib/broker.js` pure functions with property-based tests
3. Verifying and completing each handler with unit tests
4. Property-based testing of the Python client (signer, key derivation, envelope)
5. Integration tests for multi-document atomicity and CAS retry behaviour
6. Deployment verification (Lenovo daemon cutover, VivoBook/S24 enrollment prep)

All JS tests live in `jayti-dashboard/test/`. All Python tests live in
`channel-sandbox/tests/`. JS property-based tests use `fast-check`. Python
property-based tests use `hypothesis`.

---

## Tasks

- [ ] 1. Reconcile uncommitted endpoint edits — restore dropped security controls
  - [ ] 1.1 Audit `api/device-heartbeat.js` for missing `TELEMETRY_WHITELIST`
    - Verify `TELEMETRY_WHITELIST` is still exported as the fixed 10-key array
    - Re-add the constant and the filtering loop if either was removed in the working-tree edit
    - Ensure the telemetry write loop iterates `TELEMETRY_WHITELIST` and skips absent keys silently
    - _Requirements: 13.1, 13.2, 13.3_
  - [ ] 1.2 Audit `api/broker-command-claim.js` for missing `canonicalClaimPath` export
    - Verify `canonicalClaimPath(commandId)` is exported from the file
    - Re-add the export if missing; the function must return `/api/device-command-claim/${commandId}`
    - _Requirements: 13.5_
  - [ ] 1.3 Audit `api/broker-command-complete.js` for missing `canonicalCompletePath` export
    - Verify `canonicalCompletePath(commandId)` is exported from the file
    - Re-add the export if missing; the function must return `/api/device-command-complete/${commandId}`
    - _Requirements: 13.5_
  - [ ]* 1.4 Write regression tests for the three reconciled exports
    - Assert `TELEMETRY_WHITELIST` import from `device-heartbeat.js` is a 10-element array containing exactly the required keys
    - Assert `canonicalClaimPath('test')` returns `'/api/device-command-claim/test'`
    - Assert `canonicalCompletePath('test')` returns `'/api/device-command-complete/test'`
    - These tests already partially exist in `test/broker.test.mjs`; extend the file rather than creating a duplicate
    - _Requirements: 13.1, 13.4, 13.5_

- [ ] 2. Harden `lib/broker.js` pure functions with unit and property-based tests
  - [ ] 2.1 Verify `parseEnvelope` rejects all malformed headers before any Firestore call
    - Confirm: wrong proto version → 400, non-32-hex keyId → 400, non-numeric seq → 400, timestamp outside 5-min window → 401, absent signature → 400
    - `parseEnvelope` must return an error object (not throw) for all these cases
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [ ]* 2.2 Write property test for `parseEnvelope` malformation rejection (Property 1)
    - **Property 1: Envelope malformation always rejects before Firestore**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
    - Use `fast-check` arbitraries to generate envelopes with at least one malformed field; assert `parseEnvelope` returns `{ error: string, httpStatus: number }` for all such inputs
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 1`
  - [ ] 2.3 Verify `canonicalString` and `verifyP256` round-trip
    - For a freshly-generated P-256 key pair, sign the canonical string and verify it returns `true`
    - Confirm two distinct envelopes always produce distinct canonical strings
    - _Requirements: 1.5, 1.9, 1.10_
  - [ ]* 2.4 Write property test for canonical string injection (Property 2)
    - **Property 2: Canonical string construction is a pure injection**
    - **Validates: Requirements 1.5, 1.9, 1.10**
    - Use `fast-check` to generate pairs of distinct envelope field sets; assert canonical strings differ; assert sign-then-verify round-trip succeeds
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 2`
  - [ ]* 2.5 Write property test for hardware fingerprint pattern matching (Property 5)
    - **Property 5: Hardware fingerprint pattern matching is correct**
    - **Validates: Requirements 3.5, 11.1, 11.2**
    - Generate arbitrary `{manufacturer, model, serialHash}` objects and rule sets; assert `verifyHardwareFingerprint` returns `null` iff every rule matches, non-null otherwise
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 5`
  - [ ]* 2.6 Write property test for enrolled hardware verification (Property 6)
    - **Property 6: Enrolled hardware verification rejects changed fields and ignores extras**
    - **Validates: Requirements 11.4, 11.5, 11.6**
    - Generate arbitrary enrolled and presented fingerprints; assert `verifyEnrolledHardware` returns `null` iff all enrolled fields are present with equal values in the presented object
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 6`
  - [ ]* 2.7 Write property test for hardware fingerprint normalisation (Property 7)
    - **Property 7: Hardware fingerprint normalisation preserves semantics and enforces limits**
    - **Validates: Requirements 11.3**
    - Generate arbitrary hardware objects with random whitespace and field lengths; assert `normalizeHardwareFingerprint` trims, caps manufacturer/model at 128 chars, caps serialHash at 256 chars, and omits absent fields
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 7`
  - [ ]* 2.8 Write property test for telemetry whitelist filtering (Property 8)
    - **Property 8: Telemetry write is exactly the TELEMETRY_WHITELIST intersection**
    - **Validates: Requirements 4.6, 13.1, 13.2, 13.3**
    - Generate arbitrary telemetry objects (mix of whitelisted and non-whitelisted keys); simulate the heartbeat telemetry-write logic; assert only the intersection is written
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 8`
  - [ ]* 2.9 Write property test for idempotent replay (Property 14)
    - **Property 14: Idempotent replay returns the original response**
    - **Validates: Requirements 6.6, 7.8, 8.5**
    - Generate arbitrary result records; assert `findIdempotentResult` returns the stored response on exact replay and `{ error: ... }` on requestId reuse with differing fields
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 14`
  - [ ]* 2.10 Write property test for rate limiting (Property 15)
    - **Property 15: Rate limit enforces exactly 30 requests per 60-second window per keyId**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
    - Generate arbitrary keyId strings; call `rateLimitOk` 30 times and assert all return `true`; call a 31st time and assert it returns `false`; assert failed-envelope requests don't increment the counter
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 15`

- [ ] 3. Checkpoint — run existing JS tests
  - Ensure all tests in `test/broker.test.mjs` and `test/stale.test.mjs` pass, ask the user if questions arise.

- [ ] 4. Verify and complete the enrollment handler (`api/device-enroll.js`)
  - [ ] 4.1 Verify all 12 enrollment acceptance criteria are exercised
    - Confirm: each rejection code (`code-revoked`, `code-consumed`, `code-expired`, `code-attempts-exhausted`, `deviceId-mismatch`, `keyType-mismatch`) is reachable in the handler
    - Confirm: `software-not-permitted` rejection when `allowSoftware !== true`
    - Confirm: duplicate key → HTTP 409
    - Confirm: `attempts` is NOT incremented when the envelope is malformed (requirement 3.12)
    - Confirm: transaction rolls back atomically on Firestore conflict (requirement 3.11)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.11, 3.12_
  - [ ]* 4.2 Write unit tests for enrollment rejection paths
    - One test per rejection reason code from criterion 3.2
    - One test for `software-not-permitted`
    - One test for duplicate key (HTTP 409)
    - One test asserting `attempts` is not incremented when body is missing (requirement 3.12)
    - _Requirements: 3.1, 3.2, 3.4, 3.8, 3.12_
  - [ ] 4.3 Verify key expiry computation is exactly enrolledAt + 180 days
    - Confirm `expiresAt` is set to `enrolledAt + 180 × 24 × 3600 × 1000` milliseconds
    - _Requirements: 10.1_
  - [ ]* 4.4 Write property test for key expiry (Property 16)
    - **Property 16: Key expiry is always enrolledAt + 180 days**
    - **Validates: Requirements 10.1**
    - Generate arbitrary enrollment timestamps; assert `expiresAt` is exactly 180 days later
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 16`

- [ ] 5. Verify and complete the heartbeat handler (`api/device-heartbeat.js`)
  - [ ] 5.1 Verify all 8 heartbeat acceptance criteria are exercised
    - Confirm: seq replay → HTTP 401 + `heartbeat-seq-replay` log
    - Confirm: requestId replay → HTTP 401 + `heartbeat-reqid-replay` log
    - Confirm: hardware mismatch (static rules) → HTTP 403 + audit entry
    - Confirm: enrolled hardware mismatch → HTTP 403 + audit entry
    - Confirm: key expiry check is present (requirement 4.1 via 10.2)
    - Confirm: `TELEMETRY_WHITELIST` filtering loop is in place and only those fields are written
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [ ]* 5.2 Write unit tests for heartbeat rejection paths
    - Test seq replay rejection
    - Test requestId replay rejection
    - Test hardware mismatch (static + enrolled) rejections
    - Test that `lastSeen` is NOT updated on hardware mismatch
    - _Requirements: 4.2, 4.3, 4.4_

- [ ] 6. Verify and complete the poll handler (`api/device-commands-poll.js`)
  - [ ] 6.1 Verify command visibility filter matches the spec exactly
    - Confirm: only `status === 'pending'` and `status === 'claimed' && leaseUntil < now` are returned
    - Confirm: `completed`, `rejected`, `failed`, `dead-letter` commands are excluded
    - Confirm: empty queue returns `{ success: true, deviceId, commands: [] }`
    - _Requirements: 5.1, 5.3_
  - [ ]* 6.2 Write property test for command visibility filtering (Property 10)
    - **Property 10: Command visibility filtering is exact**
    - **Validates: Requirements 5.1, 5.3**
    - Generate arbitrary `commandQueue` objects with arbitrary statuses and `leaseUntil` values; assert the returned set equals exactly the pending/lease-expired subset
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 10`

- [ ] 7. Verify and complete the claim handler (`api/broker-command-claim.js`)
  - [ ] 7.1 Verify all claim state-machine paths are present
    - Confirm: `pending` → claim granted (HTTP 200, claimToken, leaseUntil)
    - Confirm: `claimed` with expired lease and `attempt < MAX_CLAIM_ATTEMPTS` → re-claim granted
    - Confirm: `claimed` with expired lease and `attempt >= MAX_CLAIM_ATTEMPTS` → dead-letter + HTTP 409
    - Confirm: `claimed` with active lease → HTTP 409 `"command lease is active"`
    - Confirm: final states (`completed`, `rejected`, `failed`, `dead-letter`) → HTTP 409
    - Confirm: commandId not found → HTTP 404
    - Confirm: idempotent replay from `enrollment.recentResults`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  - [ ]* 7.2 Write property test for claim state machine (Property 11)
    - **Property 11: Claim is grantable if and only if the command is in a claimable state**
    - **Validates: Requirements 6.1, 6.4, 6.5**
    - Generate arbitrary command entries; assert claim returns HTTP 200 iff the entry is in a claimable state; assert all other states return HTTP 409
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 11`
  - [ ]* 7.3 Write property test for claim token format and lease window (Property 12)
    - **Property 12: Claim token is always a valid 32-hex string with a 120-second lease**
    - **Validates: Requirements 6.2**
    - Generate successful claim calls; assert `claimToken` matches `/^[a-f0-9]{32}$/` and `Date.parse(leaseUntil) - Date.now()` is within `[119_000, 121_000]` ms
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 12`

- [ ] 8. Verify and complete the complete handler (`api/broker-command-complete.js`)
  - [ ] 8.1 Verify all completion acceptance criteria are exercised
    - Confirm: `result.status` not in `{ok, rejected, failed, error}` → HTTP 400
    - Confirm: `result` object over 32 KB → HTTP 413
    - Confirm: claimToken mismatch → HTTP 409 (not HTTP 403 — check the handler matches the spec)
    - Confirm: lease expired → HTTP 409 `"claim lease expired; re-claim required"`
    - Confirm: command not in `claimed` state → HTTP 409
    - Confirm: status mapping: `ok→completed`, `rejected→rejected`, `failed→failed`, `error→failed`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [ ]* 8.2 Write property test for result status mapping (Property 13)
    - **Property 13: Result status mapping is a total function over valid inputs**
    - **Validates: Requirements 7.4, 7.6**
    - Generate all valid `result.status` values and assert mapping; generate invalid values and assert HTTP 400
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 13`

- [ ] 9. Checkpoint — run all JS tests
  - Ensure all tests in `test/broker.test.mjs` and `test/stale.test.mjs` pass with the new fast-check property tests included, ask the user if questions arise.

- [ ] 10. Verify and complete the stale monitor (`api/check-stale.js` + `lib/stale.js`)
  - [ ] 10.1 Verify `lib/stale.js` `evaluate` function matches design Property 17
    - Confirm: `(nowMs - Date.parse(lastSeen)) > thresholdMs` AND `staleAlertState !== 'alerted'` → `{changed: true, action: 'down', newState: 'alerted'}`
    - Confirm: `(nowMs - Date.parse(lastSeen)) <= thresholdMs` AND `staleAlertState === 'alerted'` → `{changed: true, action: 'recovered', newState: 'healthy'}`
    - Confirm: missing/null/unparseable `lastSeen` → `{action: 'none', newState: null, changed: false}` (device is skipped, not treated as stale)
    - Confirm: missing/invalid `staleAlert.state` is treated as `'healthy'`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  - [ ]* 10.2 Write property test for stale evaluation (Property 17)
    - **Property 17: Stale evaluation is a pure function of device state and current time**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.5**
    - Generate arbitrary `lastSeen` ISO strings, `staleAlertState` values, `nowMs`, and `thresholdMs`; assert `evaluate` output matches the property's three cases exactly
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 17`
  - [ ] 10.3 Verify `check-stale.js` sends email before Firestore write
    - Confirm: the handler calls `sendAlert` then patches Firestore in that order
    - Confirm: if `sendAlert` throws, the Firestore patch is not called
    - Confirm: `GMAIL_APP_PASSWORD` absent → HTTP 500 before Firestore reads
    - Confirm: `ALERT_RECIPIENTS` absent → HTTP 500 before Firestore reads (requirement 12.10)
    - _Requirements: 12.6, 12.7, 12.8, 12.10_
  - [ ]* 10.4 Write unit tests for stale monitor guard conditions
    - Test `GMAIL_APP_PASSWORD` absent → HTTP 500 without Firestore read
    - Test unauthorised request → HTTP 401
    - Test email-before-write ordering with a mock transport
    - _Requirements: 12.8, 12.9, 12.6_

- [ ] 11. Structured log and `commandId` validation
  - [ ] 11.1 Verify `slog` never emits sensitive fields
    - Confirm the `slog` filter list in `lib/broker.js` excludes `signature`, `code`, `publicKeyPem`, `body`
    - Confirm every error response path calls `slog` / `sendError` before returning
    - _Requirements: 17.1, 17.2, 17.3_
  - [ ]* 11.2 Write property test for structured log redaction (Property 18)
    - **Property 18: Structured logs never contain sensitive fields**
    - **Validates: Requirements 17.1, 17.2, 17.3**
    - Generate arbitrary fields objects containing subsets of `{signature, code, publicKeyPem, body}` plus benign fields; assert the JSON string written by `slog` contains none of the sensitive keys; assert `at` and `event` are always present
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 18`
  - [ ] 11.3 Verify `commandId` validation fires before header reads
    - Confirm `broker-command-claim.js` and `broker-command-complete.js` both validate `req.query.commandId` against `/^[A-Za-z0-9_-]{1,128}$/` as the very first step, before calling `parseEnvelope`
    - _Requirements: 13.5, 13.6_
  - [ ]* 11.4 Write property test for `commandId` validation (Property 19)
    - **Property 19: commandId validation rejects all non-conforming strings**
    - **Validates: Requirements 13.5, 13.6**
    - Generate conforming strings (assert pass) and non-conforming strings (assert reject without header read)
    - Add comment: `// Feature: broker-v2-device-enrollment, Property 19`

- [ ] 12. Python client — signer and key-derivation property tests
  - [ ] 12.1 Add `fast-check`-equivalent `hypothesis` tests for `key_id_from_pem` cross-language consistency
    - Write `test_key_id_cross_language` in `channel-sandbox/tests/test_broker_client.py`
    - Generate a P-256 key pair in Python, write the PEM to a temp file, run the Node fixture generator and compare the derived keyId
    - _Requirements: 3.3_
  - [ ]* 12.2 Write property test for keyId round-trip (Property 9)
    - **Property 9: keyId derivation round-trips from any P-256 key pair**
    - **Validates: Requirements 3.3**
    - Use `hypothesis` to generate arbitrary P-256 key pairs (via `ec.generate_private_key`); assert `key_id_from_pem(pem)` equals `sha256(DER(SPKI))[:32]` in both the Python and Node implementations
    - Add comment: `# Feature: broker-v2-device-enrollment, Property 9`
  - [ ]* 12.3 Write property test for sequence monotonicity on the client (Property 3)
    - **Property 3: Sequence monotonicity is enforced across all endpoints**
    - **Validates: Requirements 1.7, 4.2, 8.1**
    - Use `hypothesis` to generate sequences of request calls; assert `X-Device-Seq` in each signed envelope is strictly greater than the previous one; assert state file is persisted after each call
    - Add comment: `# Feature: broker-v2-device-enrollment, Property 3`
  - [ ]* 12.4 Write property test for requestId uniqueness per envelope (Property 4)
    - **Property 4: Request ID replay is rejected across all endpoints**
    - **Validates: Requirements 4.3, 8.2, 8.3**
    - Use `hypothesis` to generate N independent `_request` calls; assert all `X-Request-Id` values are distinct UUIDs; assert retry calls reuse the same requestId (idempotency)
    - Add comment: `# Feature: broker-v2-device-enrollment, Property 4`
  - [ ] 12.5 Verify device agent key lifecycle exit-code-3 behaviour
    - Confirm `device_agent.py` exits with code 3 on `BrokerAuthError` with lifecycle messages (`"key expired"`, `"revoked"`, `"suspended"`, `"not the active device key"`)
    - _Requirements: 10.5_
  - [ ]* 12.6 Write unit test for device agent exit-code-3 on key lifecycle errors
    - Mock `BrokerClient.heartbeat` to raise `BrokerAuthError` with each lifecycle message
    - Assert `sys.exit(3)` is called
    - Assert no further retry attempts are made
    - _Requirements: 10.5_

- [ ] 13. Checkpoint — run all Python tests
  - Run `pytest channel-sandbox/tests/` and ensure all tests pass, ask the user if questions arise.

- [ ] 14. Integration tests — multi-document atomicity and CAS retry
  - [ ] 14.1 Write integration test for enrollment transaction atomicity
    - Use a mock Firestore where `fsCommit` succeeds on attempt N; assert all three documents (`enrollmentCodes`, `deviceKeys`, `devices`) are written only on success and not partially on prior attempts
    - _Requirements: 3.7, 14.1, 14.2_
  - [ ]* 14.2 Write integration test for CAS retry loop exhaustion
    - Mock `fsPatch` to return `conflict` errors for 4 attempts then succeed; assert the handler retries up to 5 times; assert HTTP 409 is returned on 5 consecutive conflicts
    - _Requirements: 4.5, 14.3_
  - [ ]* 14.3 Write integration test for stale monitor email-before-write ordering
    - Mock `sendAlert` and the Firestore PATCH; assert `sendAlert` is called before the PATCH; assert state is not updated when `sendAlert` throws
    - _Requirements: 12.6_
  - [ ]* 14.4 Write integration test for `CANONICAL_PATH` exports
    - Assert `CANONICAL_PATH` from `device-heartbeat.js` is `'/api/device-heartbeat'` (non-empty string)
    - Assert `CANONICAL_PATH` from `device-commands-poll.js` is `'/api/device-commands-poll'`
    - _Requirements: 13.4_

- [ ] 15. Checkpoint — run full JS test suite
  - Ensure all JS tests pass including fast-check PBTs and integration mocks, ask the user if questions arise.

- [ ] 16. Deployment verification — Lenovo daemon cutover
  - [ ] 16.1 Verify `channel-sandbox/deploy/lenovo/broker_client.py` and `device_agent.py` are in sync with `channel-sandbox/` root copies
    - Diff the Lenovo deploy kit files against the root source; update the deploy copies if they differ
    - _Requirements: 15.1, 15.2_
  - [ ] 16.2 Verify `channel-sandbox/devices.json` has `heartbeat_interval_seconds` and `command_poll_interval_seconds` for all three devices
    - If `heartbeat_interval_seconds` is absent or ≤ 0 for any device, confirm the agent defaults to 60 seconds
    - _Requirements: 4.7_
  - [ ]* 16.3 Write unit test for heartbeat interval default
    - Assert `device_agent.py` uses 60-second heartbeat interval when config value is absent or ≤ 0
    - _Requirements: 4.7_

- [ ] 17. Deployment verification — VivoBook and S24 enrollment prep
  - [ ] 17.1 Verify `channel-sandbox/deploy/vivobook/` and `deploy/s24/` deploy kits contain current broker and signer files
    - Diff against root source; update if needed
    - _Requirements: 15.1_
  - [ ] 17.2 Verify `mint_enrollment_code.py` enforces all three canonical deviceIds
    - Confirm the admin tool rejects unknown deviceIds with a non-zero exit code and no Firestore write
    - _Requirements: 2.6_
  - [ ]* 17.3 Write unit test for mint enrollment code deviceId validation
    - Assert `mint_enrollment_code.py` prints an error and exits non-zero for unknown deviceIds
    - Assert the tool does not write to Firestore when deviceId is invalid
    - _Requirements: 2.6, 2.7_
  - [ ] 17.4 Verify `TermuxKeystoreSigner` in `signer.py` raises on `inside_secure_hardware !== True`
    - Confirm `_ensure_key` raises `SignerError` when the key metadata reports `inside_secure_hardware: False`
    - _Requirements: 15.7_
  - [ ]* 17.5 Write unit test for TermuxKeystoreSigner secure hardware enforcement
    - Mock `termux-keystore list -d` to return a key with `inside_secure_hardware: false`; assert `SignerError` is raised
    - _Requirements: 15.7_

- [ ] 18. Final checkpoint — run all tests
  - Ensure `pytest channel-sandbox/tests/` and the Node test suite both pass. Confirm no regressions in existing tests. Ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; the core reconciliation tasks (1.1–1.3) are mandatory and must run first.
- The stale monitor `lib/stale.js` uses `'healthy'`/`'alerted'` state names and `action: 'recovered'`. This is intentional and the spec has been updated to match. Devices with null/missing `lastSeen` are skipped (not treated as stale) — this protects `jayti-asus-vivobook` and `samsung-s24-ultra` from spurious DOWN alerts before they enroll.
- `fast-check` must be installed as a dev dependency before writing JS property tests: `npm install --save-dev fast-check`.
- `hypothesis` is already installed per `.hypothesis/` directory in the workspace root.
- Fixture file at `channel-sandbox/tests/fixtures/python_to_node.json` is consumed by `test/broker.test.mjs`; do not delete or rename it.
- All property tests must include a comment of the form `// Feature: broker-v2-device-enrollment, Property N: <property_text>` (JS) or `# Feature: broker-v2-device-enrollment, Property N` (Python).
- Each property test must run a minimum of 100 iterations (fast-check default; hypothesis `@settings(max_examples=100)`).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "2.1", "2.3", "4.3", "6.1", "7.1", "8.1", "11.1", "11.3"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "4.1", "5.1", "10.1", "10.3"] },
    { "id": 3, "tasks": ["4.2", "4.4", "5.2", "6.2", "7.2", "7.3", "8.2", "10.2", "10.4", "11.2", "11.4"] },
    { "id": 4, "tasks": ["12.1", "12.5", "14.1"] },
    { "id": 5, "tasks": ["12.2", "12.3", "12.4", "12.6", "14.2", "14.3", "14.4"] },
    { "id": 6, "tasks": ["16.1", "16.2", "17.1", "17.2", "17.4"] },
    { "id": 7, "tasks": ["16.3", "17.3", "17.5"] }
  ]
}
```
