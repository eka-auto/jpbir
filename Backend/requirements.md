# Requirements Document

## Introduction

The Broker v2 Device Enrollment Control Plane is a secure, zero-trust device
identity system for a small fleet of personally-owned machines (Lenovo G4G
laptop, ASUS VivoBook, Samsung Galaxy S24 Ultra) that dial out to a
Vercel-hosted API backed by Cloud Firestore.

Devices hold non-exportable hardware-backed P-256 signing keys
(TPM-CNG on Windows, AndroidKeyStore on Android, software-p256 only for
sandbox use with explicit permission). Every API request carries a signed
envelope; the server derives identity exclusively from the verified keyId and
never trusts the client-supplied deviceId after enrollment.

The control plane covers five concerns:

1. **Enrollment** — one-time, code-gated, hardware-fingerprint-bound pairing
2. **Heartbeat** — periodic liveness + telemetry push from device to server
3. **Command pipeline** — server-enqueued commands polled, claimed, and completed by devices
4. **Key lifecycle** — expiry, rotation, revocation of device keys
5. **Liveness monitoring** — stale-device detection and alert delivery
6. **Reconciliation of endpoint security** — restore any security controls
   dropped in uncommitted edits (TELEMETRY_WHITELIST, canonical path exports)

---

## Glossary

- **Broker**: The Vercel serverless API (`jayti-dashboard`) that serves as the
  control plane for all device communication.
- **Device**: A registered physical machine identified by its canonical
  `deviceId` (`g4g-lenovo-laptop`, `jayti-asus-vivobook`, `samsung-s24-ultra`).
- **Device_Agent**: The Python daemon (`device_agent.py`) running on each
  Device that performs heartbeats, polls for commands, and executes them.
- **Enrollment_Code**: A 32-hex-character random secret printed once by the
  admin tool; stored only as its SHA-256 hash in Firestore.
- **Envelope**: The set of HTTP request headers (`X-Broker-Proto`,
  `X-Key-Id`, `X-Device-Seq`, `X-Timestamp`, `X-Request-Id`,
  `X-Signature`) that authenticate every broker request.
- **KeyId**: The first 32 hex characters of the SHA-256 hash of the DER-encoded
  public key SPKI; used as the Firestore document ID in `deviceKeys/{keyId}`.
- **Platform_Signer**: The hardware-backed cryptographic key holder:
  `WindowsCngSigner` (Windows TPM), `TermuxKeystoreSigner` (Android), or
  `SoftwareP256Signer` (sandbox only).
- **Hardware_Fingerprint**: The normalized set of `manufacturer`, `model`,
  and `serialHash` fields collected from the Device's OS and stored at
  enrollment time.
- **Claim_Lease**: A 120-second exclusive lock on a Command held by a single
  worker session; expires automatically if not completed.
- **Command**: A Firestore map entry in `devices/{deviceId}/commandQueue`
  with fields `action`, `payload`, `status`, `claimToken`, `leaseUntil`.
- **Stale_Monitor**: The Vercel cron job (`check-stale.js`, every 5 minutes)
  that sends email alerts when a Device stops checking in.
- **TELEMETRY_WHITELIST**: The explicit allowlist of fields
  (`deviceId`, `canonicalDeviceId`, `deviceDisplayName`, `deviceRole`,
  `deviceType`, `connectionMethod`, `agentVersion`,
  `heartbeatIntervalSeconds`, `local`, `network`) that the Broker copies from
  the heartbeat body into the device document.
- **CAS**: Compare-and-swap write, implemented via Firestore `updateTime`
  precondition to prevent lost updates under concurrent access.
- **Replay_Window**: The sliding set of up to 50 most-recent `requestId`
  values stored per device to detect replayed requests.
- **Software_Permitted_Code**: An Enrollment_Code minted with
  `allowSoftware: true`, required before a `software-p256` key may enroll.

---

## Requirements

### Requirement 1: Request Envelope Authentication

**User Story:** As the system operator, I want every broker request to be authenticated by a hardware-backed signature over a canonical string, so that compromised network credentials cannot impersonate a registered Device.

#### Acceptance Criteria

1. THE Broker SHALL parse and validate the six Envelope headers (`X-Broker-Proto`, `X-Key-Id`, `X-Device-Seq`, `X-Timestamp`, `X-Request-Id`, `X-Signature`) on every inbound POST request before performing any Firestore read.
2. WHEN an Envelope header is malformed or absent, THE Broker SHALL reject the request with HTTP 400 and a descriptive error before reading Firestore; specifically: `X-Broker-Proto` must be the string `"2"`; `X-Key-Id` must be exactly 32 lowercase hex characters; `X-Device-Seq` must be a non-negative integer in string form; `X-Timestamp` must be a string representation of a Unix millisecond timestamp; `X-Request-Id` must be 1–128 printable ASCII characters; `X-Signature` must be a base64url-encoded string.
3. WHEN the `X-Timestamp` value differs from server clock by more than 5 minutes (300,000 ms), THE Broker SHALL reject the request with HTTP 401.
4. WHEN `X-Broker-Proto` is not `"2"`, THE Broker SHALL reject the request with HTTP 400.
5. THE Broker SHALL compute a canonical string as `"v2\n{keyId}\nPOST\n{canonicalPath}\n{seq}\n{timestamp}\n{requestId}\n{bodySha256}"` and verify the `X-Signature` ECDSA P-256 signature over that string using the enrolled public key.
6. IF the `X-Key-Id` value is not found in `deviceKeys` or the corresponding key has a status other than `active`, THEN THE Broker SHALL reject the request with HTTP 401 before performing signature verification.
7. IF the `X-Device-Seq` value from the incoming request is not strictly greater than the last recorded `enrollment.seq` for the device associated with that key, THEN THE Broker SHALL reject the request with HTTP 401.
8. WHEN signature verification fails, THE Broker SHALL reject the request with HTTP 401 and record a log entry containing the `keyId` and endpoint name.
9. WHEN a POST request is to be transmitted, THE Device_Agent SHALL sign the request using the Platform_Signer and set all six Envelope headers before transmitting.
10. THE Device_Agent SHALL produce DER-encoded ECDSA P-256 signatures compatible with Node.js `crypto.createVerify('SHA256')`.

---

### Requirement 2: Enrollment Code Issuance

**User Story:** As the system operator, I want to mint one-time enrollment codes bound to a specific device, hardware fingerprint, and key type, so that only the intended physical machine can enroll.

#### Acceptance Criteria

1. THE Admin_Tool (`mint_enrollment_code.py`) SHALL generate a 32-character lowercase hexadecimal enrollment code using a cryptographically secure random source.
2. THE Admin_Tool SHALL only print the raw enrollment code to stdout after a successful Firestore write; the raw code SHALL be stored only as its SHA-256 hash as the Firestore document ID in the `enrollmentCodes` collection, and SHALL NOT be written to any file, environment variable, or log.
3. WHEN a code is minted, THE Admin_Tool SHALL bind it to: the target `deviceId`, the expected `hardwareFingerprint` consisting of specific `manufacturer`, `model`, and optionally `serialHash` string patterns, an allowed `keyType` (one of `tpm-cng-p256`, `android-keystore-p256`, or `software-p256`), a 10-minute expiry from the time of minting, and a maximum of 5 attempts.
4. WHERE `--allow-software` is specified at mint time, THE Admin_Tool SHALL set `allowSoftware: true` in the code document, permitting a `software-p256` key to enroll with that code.
5. THE Admin_Tool SHALL support: `revoke <code>` to set the status of the code identified by that raw value to `revoked`; `revoke-device <deviceId>` to set status to `revoked` for all codes for that device where status is not `consumed`; and `list` to display, for each code, its `deviceId`, `keyType`, `status`, `expiresAt`, and `remainingAttempts` without printing raw code values.
6. WHEN minting a code, THE Admin_Tool SHALL validate that `deviceId` is one of the three canonical IDs (`g4g-lenovo-laptop`, `jayti-asus-vivobook`, `samsung-s24-ultra`); IF the `deviceId` is not one of these values, THEN THE Admin_Tool SHALL print an error message, exit with a non-zero exit code, and not write to Firestore.
7. IF the Firestore write fails during minting, THEN THE Admin_Tool SHALL NOT print the raw enrollment code, SHALL print an error message indicating the write failure, and SHALL exit with a non-zero exit code.

---

### Requirement 3: Device Enrollment

**User Story:** As a Device operator, I want a Device to present an enrollment code with its hardware identity and public key, so that the Broker can register the device and replace service-account-based authentication permanently.

#### Acceptance Criteria

1. WHEN a Device posts to `/api/device-enroll` with an Envelope where `X-Device-Seq` is `0`, THE Broker SHALL look up the enrollment code by its SHA-256 hash and verify all of the following: the code is not revoked, not consumed, not expired, has fewer than 5 attempts, the `deviceId` in the request body matches the code's bound `deviceId`, and the `keyType` in the request body matches the code's bound `keyType`.
2. WHEN any enrollment code validation check fails, THE Broker SHALL increment the `attempts` counter, reject the request with HTTP 403 with a reason drawn from the set (`code-revoked`, `code-consumed`, `code-expired`, `code-attempts-exhausted`, `deviceId-mismatch`, `keyType-mismatch`), and log the failure reason.
3. WHEN a Device posts to `/api/device-enroll`, THE Broker SHALL verify that the presented public key is an EC P-256 SPKI PEM, that its derived KeyId matches `X-Key-Id`, and that the self-signature with seq=0 is valid before accessing any further Firestore documents.
4. WHEN `keyType` is `software-p256` and the enrollment code has `allowSoftware !== true`, THE Broker SHALL reject with HTTP 403 with reason `software-not-permitted`.
5. WHEN a Device posts to `/api/device-enroll`, THE Broker SHALL verify the Hardware_Fingerprint from the request body against the patterns stored in the enrollment code; manufacturer and model patterns are tested as case-insensitive regular expressions; IF the Hardware_Fingerprint does not match, THE Broker SHALL reject with HTTP 403 with reason `hardware-mismatch`.
6. WHEN a Device posts to `/api/device-enroll`, THE Broker SHALL verify the `attestation` object against the declared `keyType`: `tpm-cng-p256` requires `provider === "Microsoft Platform Crypto Provider"` and `exportable === false`; `android-keystore-p256` requires `provider === "AndroidKeyStore"`, `insideSecureHardware === true`, `algorithm === "EC"`, and `keySize === 256`; IF attestation verification fails, THE Broker SHALL reject with HTTP 403 with reason `attestation-invalid`.
7. WHEN all validations pass, THE Broker SHALL atomically (within a single Firestore transaction): mark the code `consumed`, create `deviceKeys/{keyId}` with `status: "active"` and a 180-day expiry, and update `devices/{deviceId}.enrollment` with `activeKeyId`, `seq: 0`, and `lastEnrolledAt`.
8. WHEN a key with the same KeyId already exists in `deviceKeys`, THE Broker SHALL reject enrollment with HTTP 409 and return a response body indicating the key is already enrolled and the caller should use the rotation flow.
9. WHEN the enrollment transaction succeeds, THE Broker SHALL emit an audit log entry with `actor=keyId`, `action="enrollment.success"`, `deviceId`, and `keyType`.
10. WHEN the Broker rejects any enrollment request, THE Broker SHALL return only one of the reason codes from criterion 2 or a generic `enrollment-rejected` label; THE Broker SHALL NOT reveal whether the code exists in Firestore.
11. IF the Firestore transaction fails due to a conflict or service error, THEN THE Broker SHALL return HTTP 500 with a message indicating a transient failure, and SHALL NOT partially write any of the three documents.
12. IF the Envelope is malformed or any required body field is missing, THEN THE Broker SHALL return HTTP 400 and SHALL NOT increment the enrollment code `attempts` counter.

---

### Requirement 4: Heartbeat

**User Story:** As the system operator, I want each Device to periodically send a signed heartbeat with hardware identity and telemetry, so that liveness and device state remain current in Firestore.

#### Acceptance Criteria

1. WHEN a Device posts to `/api/device-heartbeat` with an Envelope whose signature is cryptographically valid, whose signing key status is `active`, whose hardware fingerprint matches both the static `HARDWARE_RULES` and the enrolled fingerprint, and whose `X-Device-Seq` is strictly greater than `enrollment.seq`, THE Broker SHALL proceed to the CAS write described in criterion 5.
2. WHEN the `X-Device-Seq` value is less than or equal to `enrollment.seq`, THE Broker SHALL reject with HTTP 401 and log `heartbeat-seq-replay`.
3. WHEN the `X-Request-Id` appears in `enrollment.lastRequestIds`, THE Broker SHALL reject with HTTP 401 and log `heartbeat-reqid-replay`.
4. WHEN hardware fingerprint verification fails at heartbeat time, THE Broker SHALL reject with HTTP 403, write an audit entry `action="heartbeat-hardware-mismatch"`, and not update `lastSeen`.
5. WHEN all verifications in criterion 1 pass, THE Broker SHALL perform a CAS write updating `lastSeen`, `online: true`, `enrollment.seq`, `enrollment.lastRequestIds`, `enrollment.lastHeartbeatAt`, and `enrollment.lastHardware`; if the CAS write fails due to a precondition conflict, the Broker SHALL retry the read-verify-write cycle up to 5 times with a delay of 100 ms between each attempt before returning HTTP 409 with no partial update written.
6. THE Broker SHALL copy into the device document only the fields present in `TELEMETRY_WHITELIST` from the heartbeat body's `telemetry` object; any field not in `TELEMETRY_WHITELIST` SHALL be silently ignored and not written.
7. WHILE the Device_Agent is running, THE Device_Agent SHALL send a heartbeat at least once every `heartbeat_interval_seconds` seconds as configured in `devices.json`; IF `heartbeat_interval_seconds` is absent or is less than or equal to 0 in `devices.json`, THEN THE Device_Agent SHALL default to a heartbeat interval of 60 seconds.
8. IF network collection fails on the Device_Agent, THE Device_Agent SHALL send the heartbeat without the `network` field rather than dropping the heartbeat entirely.

---

### Requirement 5: Command Poll

**User Story:** As a Device operator, I want the Device to periodically poll for queued commands and receive only commands that are pending or have an expired lease, so that no command is silently lost.

#### Acceptance Criteria

1. WHEN a Device posts to `/api/device-commands-poll` with a valid Envelope, THE Broker SHALL advance `enrollment.seq` and return a response containing `commandId`, `action`, `payload`, `queuedAt`, `state` (`"pending"` or `"lease-expired"`), and `attempt` for each command in `commandQueue` with `status === "pending"` or with `status === "claimed"` and `leaseUntil` in the past, where `payload` is included as `null` when absent.
2. IF a Device posts to `/api/device-commands-poll` with an Envelope that fails signature verification or is structurally malformed, THEN THE Broker SHALL reject the request without advancing `enrollment.seq` and return an error response indicating the reason for rejection.
3. WHEN the commandQueue is empty or no commands meet the visibility criteria, THE Broker SHALL return `{ success: true, deviceId, commands: [] }`.
4. THE Device_Agent SHALL poll `/api/device-commands-poll` at an interval no greater than `command_poll_interval_seconds`, where `command_poll_interval_seconds` is a value between 1 and 3600 inclusive, and SHALL attempt to execute each command returned in the `commands` list unless the command is rejected per the disallowed-action rule.
5. IF the `action` field of a returned command is not present in the `allowed_commands` list configured for the Device, THEN THE Device_Agent SHALL claim the command and complete it with `status: "rejected"` and an error message indicating the action is not permitted.

---

### Requirement 6: Command Claim

**User Story:** As a Device operator, I want the Device to acquire an exclusive lease on a command before executing it, so that two agent instances cannot execute the same command concurrently.

#### Acceptance Criteria

1. WHEN a Device posts to `/api/device-command-claim/{commandId}` with a valid Envelope, THE Broker SHALL verify `status === "pending"` or `status === "claimed"` with an expired lease (current time is after `leaseUntil`) before granting a new claim.
2. WHEN a valid claim is granted, THE Broker SHALL generate a 32-hex-character cryptographically random `claimToken`, set `status: "claimed"`, `leaseUntil` to now + 120 seconds, increment `attempt`, and return HTTP 200 with `claimToken`, `leaseUntil`, `action`, and `payload` to the Device.
3. WHEN `attempt` reaches `MAX_CLAIM_ATTEMPTS` (3) on a lease-expired re-claim, THE Broker SHALL set `status: "dead-letter"` with `deadLetterReason: "claim attempts exhausted"` and return HTTP 409.
4. WHEN a claim request arrives while a non-expired lease is held, THE Broker SHALL return HTTP 409 `"command lease is active"`.
5. WHEN a command has already reached a final state (`completed`, `rejected`, `failed`, `dead-letter`), THE Broker SHALL return HTTP 409 with the current state.
6. IF a claim request arrives with a `requestId` already present in `enrollment.recentResults`, THEN THE Broker SHALL return the original stored HTTP status code and response body for that `requestId` without re-executing the claim.
7. IF the `commandId` extracted from the request is not found in `commandQueue`, THEN THE Broker SHALL return HTTP 404 with an error message indicating the command was not found.

---

### Requirement 7: Command Completion

**User Story:** As a Device operator, I want the Device to report command outcome back to the Broker atomically, so that the dashboard reflects accurate command status.

#### Acceptance Criteria

1. WHEN a Device posts to `/api/device-command-complete/{commandId}` with an Envelope containing a `requestId`, THE Broker SHALL verify: the command is in `status: "claimed"`, the `claimToken` matches, and the lease has not expired.
2. IF the command is not in `status: "claimed"` at the time of the completion request, THEN THE Broker SHALL return HTTP 409 with an error message indicating the command is not in a claimable state and SHALL NOT write to Firestore.
3. IF the `claimToken` in the completion request does not match the stored `claimToken`, THEN THE Broker SHALL return HTTP 403 with an error message indicating a token mismatch and SHALL NOT write to Firestore.
4. WHEN `result.status` is not one of `ok | rejected | failed | error`, THE Broker SHALL return HTTP 400.
5. WHEN the result object serializes to more than 32 KB, THE Broker SHALL return HTTP 413 and not write to Firestore.
6. WHEN all verifications in criterion 1 pass, THE Broker SHALL perform a single atomic CAS write that: maps `result.status` to Firestore status (`"ok"` → `"completed"`, `"rejected"` → `"rejected"`, `"failed"` or `"error"` → `"failed"`), sets `status`, `result`, and `completedAt`, clears `claimToken`, advances `enrollment.seq`, and appends the result to `enrollment.recentResults`; IF the CAS write fails due to a concurrent update, THEN THE Broker SHALL return HTTP 409 with an error message indicating a write conflict and SHALL NOT partially update Firestore.
7. WHEN the claim lease has expired before completion arrives, THE Broker SHALL return HTTP 409 with an error message indicating the claim lease has expired and that re-claiming is required.
8. WHEN a completion request arrives with a `requestId` already present in `enrollment.recentResults` (up to the last 10 entries), THE Broker SHALL return the original stored response for that `requestId` without performing a new Firestore write; IF the incoming `requestId` is absent, THEN THE Broker SHALL treat the request as non-idempotent and proceed with normal verification.

---

### Requirement 8: Replay and Sequence Protection

**User Story:** As the system operator, I want every broker endpoint to reject replayed or out-of-order requests, so that a network adversary cannot replay a captured request.

#### Acceptance Criteria

1. IF a request's `X-Device-Seq` value is less than or equal to the stored `enrollment.seq` for that device, THEN THE Broker SHALL reject the request with HTTP 401 and write a log entry recording the device identifier, the received seq value, and the stored seq value.
2. IF a request's `X-Request-Id` value matches any entry in the device's `enrollment.lastRequestIds` ring buffer, THEN THE Broker SHALL reject the request with HTTP 401 and write a log entry recording the device identifier and the duplicate request ID.
3. THE Broker SHALL maintain `enrollment.lastRequestIds` as a ring buffer of up to 50 entries, appending the new request ID and discarding the oldest entry beyond 50 only after the request has been fully validated and the operation successfully completed; rejected requests SHALL NOT cause an entry to be added to the ring buffer.
4. THE Broker SHALL retain each record in `enrollment.recentResults` for a maximum of 50 entries, evicting the oldest record when a new successful operation result is stored.
5. WHEN a request arrives with a `requestId` that matches a record in `enrollment.recentResults` AND the seq, path, and body hash all match, THE Broker SHALL return the stored response without re-executing the operation (idempotent replay).
6. WHEN a request arrives with a `requestId` that matches a record in `enrollment.recentResults` but any of seq, path, or body hash differ, THE Broker SHALL reject with HTTP 401 `"requestId was reused with a different signed request"`.

---

### Requirement 9: Rate Limiting

**User Story:** As the system operator, I want each enrolled key to be subject to a per-minute request rate limit, so that a misbehaving agent cannot exhaust Firestore quota.

#### Acceptance Criteria

1. THE Broker SHALL enforce a shared rate limit of 30 requests per 60-second sliding window per KeyId, counted across all endpoints combined.
2. WHEN a KeyId exceeds 30 requests within its current 60-second sliding window, THE Broker SHALL return HTTP 429 with an error message indicating rate limit exceeded and log the event with the KeyId and the timestamp of the violation.
3. WHEN a request arrives, THE Broker SHALL perform Envelope validation before evaluating the rate-limit counter for the associated KeyId.
4. IF Envelope validation fails for an incoming request, THEN THE Broker SHALL reject the request with an authentication error and SHALL NOT increment the rate-limit counter for that KeyId.

---

### Requirement 10: Key Lifecycle and Rotation

**User Story:** As the system operator, I want enrolled device keys to expire after 180 days and support explicit revocation, so that compromised or decommissioned devices cannot continue to authenticate.

#### Acceptance Criteria

1. WHEN a key is successfully enrolled, THE Broker SHALL set `expiresAt` to 180 days after `enrolledAt`.
2. WHEN a heartbeat, poll, claim, or complete request arrives with a key whose `expiresAt` is in the past, THE Broker SHALL return HTTP 403 with an error body containing `"key expired; re-enroll"` and log the KeyId and expiry timestamp.
3. WHEN any device request arrives using a key whose `deviceKeys/{keyId}.status` is `"revoked"` or `"suspended"`, THE Broker SHALL return HTTP 403 on all such requests regardless of endpoint.
4. IF the Broker reads a device document and finds that `enrollment.activeKeyId` does not equal the `keyId` from the request's `X-Key-Id` header, THEN THE Broker SHALL return HTTP 403 `"key is not the active device key"`.
5. IF a Device_Agent receives HTTP 403 with a body containing `"key expired"`, `"revoked"`, `"suspended"`, or `"not the active device key"`, THEN THE Device_Agent SHALL stop all retry attempts for the current key, write a fatal log entry, and exit with code 3 to require human re-enrollment intervention.

---

### Requirement 11: Hardware Fingerprint Binding

**User Story:** As the system operator, I want the Hardware_Fingerprint recorded at enrollment to be verified on every heartbeat, so that a key cannot be used from a different physical device.

#### Acceptance Criteria

1. WHEN a device enrolls, THE Broker SHALL validate the presented Hardware_Fingerprint against the per-device static `HARDWARE_RULES` patterns: `g4g-lenovo-laptop` requires `manufacturer =~ /^LENOVO$/i` and `model =~ /^82KA/`; `jayti-asus-vivobook` requires `manufacturer =~ /ASUSTeK|ASUS/i` and `model =~ /VivoBook/i`; `samsung-s24-ultra` requires `model =~ /^SM-S928/i`.
2. IF the presented Hardware_Fingerprint fails the `HARDWARE_RULES` pattern check for the enrolling device, THEN THE Broker SHALL reject the enrollment request with HTTP 403 and write an audit entry indicating the specific field and pattern that did not match.
3. THE Broker SHALL store the Hardware_Fingerprint fields (`manufacturer` trimmed to ≤ 128 characters, `model` trimmed to ≤ 128 characters, `serialHash` trimmed to ≤ 256 characters) in `deviceKeys/{keyId}.hardwareFingerprint` at enrollment; fields absent from the enrollment payload SHALL be stored as absent (not as empty string).
4. WHEN a heartbeat presents a Hardware_Fingerprint where any field present in the enrolled fingerprint differs in value from the stored field, or where the heartbeat omits a field that was stored at enrollment, THE Broker SHALL reject with HTTP 403, write an audit entry identifying which field mismatched or was absent, and not update `lastSeen`.
5. IF a heartbeat presents a Hardware_Fingerprint field that was absent in the enrolled fingerprint, THEN THE Broker SHALL treat the extra field as ignored and not reject the heartbeat on that basis alone.
6. IF a heartbeat contains no Hardware_Fingerprint object at all, THEN THE Broker SHALL treat it as a full mismatch, reject with HTTP 403, write an audit entry indicating the fingerprint was missing, and not update `lastSeen`.

---

### Requirement 12: Liveness Monitoring and Stale Alerts

**User Story:** As the system operator, I want to receive an email alert when a Device stops sending heartbeats for more than 10 minutes, and a recovery email when it resumes, so that device downtime is detected promptly.

#### Acceptance Criteria

1. THE Stale_Monitor SHALL run every 5 minutes via Vercel cron and evaluate every document in the `devices` collection that contains a `lastSeen` field.
2. IF `lastSeen` is older than `STALE_ALERT_SECONDS` (default 600 s) and the current `staleAlert.state` is not `"alerted"`, THEN THE Stale_Monitor SHALL send a DOWN alert email to the configured recipients and set `staleAlert.state = "alerted"`.
3. IF `lastSeen` is within `STALE_ALERT_SECONDS` and the current `staleAlert.state` is `"alerted"`, THEN THE Stale_Monitor SHALL send a RECOVERED alert email to the configured recipients and set `staleAlert.state = "healthy"`.
4. IF a device document has no `lastSeen` field, or `lastSeen` is null or unparseable, THEN THE Stale_Monitor SHALL skip that device and take no alert action; a device with no `lastSeen` is not considered stale until it has successfully sent at least one heartbeat.
5. IF a device document has no `staleAlert.state` field, or its value is neither `"alerted"` nor `"healthy"`, THEN THE Stale_Monitor SHALL treat `staleAlert.state` as `"healthy"` for the purpose of criteria 2 and 3.
6. THE Stale_Monitor SHALL send the alert email before writing the state transition to Firestore; IF the email send fails, THE Stale_Monitor SHALL NOT update `staleAlert.state`, ensuring the alert is retried on the next cron tick.
7. IF the Firestore write fails after a successful email send, THE Stale_Monitor SHALL log the write failure including the device ID and continue processing remaining devices without rethrowing the error.
8. WHEN `GMAIL_APP_PASSWORD` is not set in the Vercel environment, THE Stale_Monitor SHALL return HTTP 500 with an error message indicating the missing credential without attempting Firestore reads.
9. THE Stale_Monitor SHALL be authorised only via `Authorization: Bearer <CRON_SECRET>` or `x-stats-key` header using timing-safe comparison; IF the required header is absent or the token does not match, THE Stale_Monitor SHALL return HTTP 401 without processing the request.
10. THE Stale_Monitor SHALL source the alert recipient list from the `ALERT_RECIPIENTS` environment variable, interpreted as a comma-separated list of up to 10 email addresses; IF the variable is absent or resolves to zero valid addresses, THE Stale_Monitor SHALL return HTTP 500 with an error message indicating the missing configuration without sending alerts or reading Firestore.

---

### Requirement 13: Endpoint Security and TELEMETRY_WHITELIST Integrity

**User Story:** As the system operator, I want the heartbeat endpoint to write only whitelisted telemetry fields to Firestore, so that a compromised Device cannot overwrite arbitrary document fields.

#### Acceptance Criteria

1. THE Broker heartbeat handler SHALL define TELEMETRY_WHITELIST as the fixed set of exactly 10 keys: `deviceId`, `canonicalDeviceId`, `deviceDisplayName`, `deviceRole`, `deviceType`, `connectionMethod`, `agentVersion`, `heartbeatIntervalSeconds`, `local`, `network`, and SHALL reject any runtime modification to this set.
2. WHEN a heartbeat body contains a `telemetry` field whose key is not in TELEMETRY_WHITELIST, THE Broker SHALL silently ignore that field and not write it to Firestore, such that the Firestore document contains only keys present in TELEMETRY_WHITELIST.
3. WHEN a heartbeat body contains a `telemetry` object in which all keys are in TELEMETRY_WHITELIST, THE Broker SHALL write exactly those whitelisted keys and their associated values to Firestore without modification.
4. THE Broker heartbeat handler SHALL export `CANONICAL_PATH = '/api/device-heartbeat'` and THE Broker poll handler SHALL export `CANONICAL_PATH = '/api/device-commands-poll'` so that unit tests can verify canonical path construction without instantiating the full handler.
5. WHEN the `vercel.json` rewrites map `/api/device-command-claim/:commandId` and `/api/device-command-complete/:commandId` to their handler files, THE handlers SHALL extract `commandId` from `req.query.commandId` and validate it against `/^[A-Za-z0-9_-]{1,128}$/` before reading any header.
6. IF `commandId` extracted from `req.query.commandId` does not match `/^[A-Za-z0-9_-]{1,128}$/` or is absent, THEN THE handler SHALL reject the request with an error response indicating an invalid command identifier and SHALL NOT read any request header or access Firestore.

---

### Requirement 14: Firestore Consistency and Atomic Writes

**User Story:** As the system operator, I want all multi-document state transitions to be atomic, so that partial failures cannot leave the enrollment or command state in an inconsistent condition.

#### Acceptance Criteria

1. WHEN enrolling a new device key, THE Broker SHALL use a Firestore multi-document transaction to atomically mark the enrollment code consumed, create the `deviceKeys` document, and update the `devices` document.
2. IF any write in the enrollment transaction conflicts or fails, THE Broker SHALL roll back all documents modified within that transaction and return an error response indicating a concurrent enrollment conflict, leaving the enrollment code, `deviceKeys` document, and `devices` document in their pre-transaction states.
3. WHEN performing heartbeat, poll, claim, or complete writes, THE Broker SHALL use `updateTime` precondition (CAS) on the `devices` document; IF the precondition check fails, THE Broker SHALL retry the write up to 5 times with the latest `updateTime` value before each attempt; IF all 5 retries are exhausted without success, THE Broker SHALL return an error response indicating a concurrent write conflict without modifying the `devices` document.
4. THE Broker SHALL use the `eka-agent` Firestore database for all `devices`, `deviceKeys`, `enrollmentCodes`, and `auditLog` collections; THE Broker SHALL NOT read or write the `(default)` database for device control plane operations.
5. IF a Firestore transaction or CAS write fails due to a transient service error rather than a conflict, THE Broker SHALL return an error response indicating a transient failure, distinct from a conflict response, without retrying beyond the 5-attempt limit defined in criterion 3.

---

### Requirement 15: Remote Enrollment (Out-of-Band Devices)

**User Story:** As a Device operator for the VivoBook and S24 Ultra (which are on separate networks and cannot be reached from the Lenovo), I want the enrollment flow to be initiated by the Device dialing out to the Broker, so that no inbound connectivity from the operator's machine is required.

#### Acceptance Criteria

1. WHEN the Device_Agent initiates enrollment, THE Device_Agent SHALL read the Enrollment_Code first from the `EKA_ENROLLMENT_CODE` environment variable and, if that variable is absent or empty, then from `enrollment_code.txt` placed in the same directory as the config file; the Enrollment_Code SHALL be between 1 and 256 printable ASCII characters in length.
2. WHEN enrollment succeeds, THE Device_Agent SHALL delete `enrollment_code.txt` from disk to prevent code reuse.
3. IF no Enrollment_Code is found in either the `EKA_ENROLLMENT_CODE` environment variable or `enrollment_code.txt`, and the device is not yet enrolled, THEN THE Device_Agent SHALL exit with an error message indicating that no enrollment code was found in either source, and SHALL NOT enter the heartbeat/poll loop.
4. THE Broker enrollment endpoint SHALL be reachable over public HTTPS at `https://jayti-dashboard.vercel.app/api/device-enroll` (and aliased domains) from any network, without requiring VPN or inbound connectivity to the operator's machine.
5. WHILE the Device_Agent is running on the Samsung S24 Ultra (Android), THE Device_Agent SHALL use the `TermuxKeystoreSigner` with alias `eka-broker-device-key` for all enrollment signing operations.
6. IF the Broker returns a non-success response to an enrollment request (such as an invalid, expired, or already-used Enrollment_Code), THEN THE Device_Agent SHALL exit with an error message indicating the rejection and SHALL NOT enter the heartbeat/poll loop.
7. IF `termux-keystore` reports `inside_secure_hardware` is not `true` for the `eka-broker-device-key` alias, THEN THE Device_Agent SHALL abort enrollment, exit with an error message indicating that secure hardware is required, and SHALL NOT enter the heartbeat/poll loop.

---

### Requirement 16: Audit Logging

**User Story:** As the system operator, I want security-relevant events to be recorded in an append-only audit log, so that enrollment, key changes, and anomalous events can be investigated.

#### Acceptance Criteria

1. THE Broker SHALL write an audit record to the `auditLog` collection for each of the following events: successful enrollment, command completed, command rejected, command dead-lettered, hardware mismatch at heartbeat, hardware mismatch at enrollment.
2. EACH audit record SHALL contain: `at` (ISO 8601 UTC timestamp), `actor` (KeyId of the device or service initiating the event, or `"system"` if no authenticated actor is present), `action` (one of: `enrollment.success`, `command.completed`, `command.rejected`, `command.dead_lettered`, `heartbeat.hardware_mismatch`, `enrollment.hardware_mismatch`), `deviceId` (the device identifier associated with the event), and `detail` (a human-readable description string of no more than 500 characters).
3. THE Broker SHALL write audit records asynchronously so that a failure to write an audit record does not block or alter the primary response to the triggering event.
4. THE Broker SHALL NOT include raw signatures, public key PEM values, or request body content in audit records.
5. IF an asynchronous audit record write fails, THEN THE Broker SHALL log an error indication containing the event type and deviceId to the application error log, without retrying.
6. THE Broker SHALL preserve audit records in the `auditLog` collection without modification or deletion for a minimum of 90 days after the record's `at` timestamp.

---

### Requirement 17: Structured Logging

**User Story:** As the system operator, I want all broker request outcomes to emit structured JSON log lines to Vercel's log stream, so that incidents can be diagnosed from log queries.

#### Acceptance Criteria

1. THE Broker SHALL emit a JSON log line via `slog()` for every request outcome, including the fields: `at` (ISO 8601 timestamp), `event` (a string identifier such as `"heartbeat-ok"` or `"enroll-sig-rejected"`), and any of the context fields `keyId`, `deviceId`, `seq`, `commandId` that are present and applicable to the request being processed.
2. THE Broker SHALL exclude from all `slog()` output the fields `signature`, `code`, `publicKeyPem`, and `body`, even when those fields are present in the request or response payload.
3. WHEN the Broker produces a 4xx or 5xx response, THE Broker SHALL emit a structured `slog()` log line before sending that response, including the `at` timestamp, the `event` identifier, the HTTP status code class (4xx or 5xx), and any context fields applicable to the failed request.
4. IF a `slog()` call fails or the log stream is unavailable, THEN THE Broker SHALL still complete and return the intended HTTP response, and shall not return a 5xx error solely due to the logging failure.
