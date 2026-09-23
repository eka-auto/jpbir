// Attestation policy is shared with Backend/jp-devices.js. ./s24-attestation.js is a
// byte-identical copy of Backend/lib/s24-attestation.js — deploy.sh ships files flat into
// /opt/jp-agent, and .vercelignore excludes Server/, so neither side can import the other's
// path directly. Edit the Backend/lib original, re-copy, and let
// _shared/tests/s24-attestation.test.mjs fail if the two diverge.
//
// That module's header records why this was extracted: the two implementations drifted
// twice in one day, first on the agentVersion prefix and then on runtimeIsAndroid, which
// this file did not check at all — so device_ping reported an off-device Windows bridge as
// both device_online and heartbeat_authenticated while the dashboard correctly refused it.
// The Python implementations (Integrations/s24-connect-mcp/server.py and
// Devices/S24/pull_direct_cloud.py) are executed against it by s24-attestation.test.mjs.
import {
  S24_DEVICE_ID,
  S24_CONNECTION_METHODS,
  S24_ACK_MAX_AGE_SECONDS,
  S24_RUNTIME_EVIDENCE,
  s24AttestationChecks,
  s24CommandAckConsistent,
  s24LivenessVerdict,
} from './s24-attestation.js';

/**
 * The fleet, for the droplet: a copy of DEVICE_IDS in Backend/broker.js, whose
 * HARDWARE_RULES make these three the only ids the broker will enrol or accept
 * a heartbeat from. list_devices counted every document in devices/ and said
 * five, because the collection also holds a test agent (`eka-cloud-sandbox`)
 * and an empty enrolment artifact (`g4g-laptop`). deploy.sh ships files flat,
 * so this side cannot import that one; _shared/tests/device-fleet.test.mjs
 * fails if the two lists, or the two splitFleet functions, disagree.
 */
export const FLEET_DEVICE_IDS = Object.freeze(['g4g-lenovo-laptop', 'jayti-asus-vivobook', 'samsung-s24-ultra']);

/** Listed devices/ documents → the fleet's documents, and the ids of the rest. */
export function splitFleet(documents) {
  const fleet = [];
  const other = [];
  for (const doc of documents || []) {
    const id = String((doc && doc.name) || '').split('/').pop();
    if (FLEET_DEVICE_IDS.includes(id)) fleet.push(doc);
    else other.push(id);
  }
  return { fleet, other };
}

export function deviceHealth(deviceId, doc, now = Date.now()) {
  const age = value => {
    if (typeof value !== 'string') return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.round((now - timestamp) / 1000) : null;
  };
  const lastSeenAge = age(doc.lastSeen);
  const ackAge = age(doc.lastCommandAckAt);
  const fresh = value => value !== null && value >= 0 && value <= S24_ACK_MAX_AGE_SECONDS;
  const enrollment = doc.enrollment || {};

  const checks = s24AttestationChecks({
    agentVersion: doc.agentVersion,
    connectionMethod: doc.connectionMethod,
    heartbeatAuth: doc.heartbeatAuth,
    liveDeviceVerified: doc.liveDeviceVerified,
    sourceType: doc.sourceType,
    runtimeIsAndroid: doc[S24_RUNTIME_EVIDENCE],
    heartbeatAgeSeconds: lastSeenAge,
    ackAgeSeconds: ackAge,
    // The ack triple — completed status, a completed queue entry, matching completedAt — is
    // part of commandAckFresh itself, so the legacy path (which requires it) cannot pass on a
    // bare lastCommandAckAt with no queue entry behind it, as it briefly did when this caller
    // dropped its own triple check.
    ackConsistent: s24CommandAckConsistent(doc),
    lastSeen: doc.lastSeen,
    signedHeartbeatAt: enrollment.lastSignedHeartbeatAt,
    signedHeartbeatKeyId: enrollment.lastSignedHeartbeatKeyId,
    signedHeartbeatProtocol: enrollment.lastSignedHeartbeatProtocol,
    activeKeyId: enrollment.activeKeyId,
    keyType: enrollment.keyType,
  });

  // Conditions this caller adds on top of the shared verdict: the stored online flag and a
  // known connection method are extra evidence the dashboard does not require.
  const authenticated = s24LivenessVerdict(checks).evidenceMode !== null
    && doc.online === true
    && S24_CONNECTION_METHODS.includes(doc.connectionMethod);
  const commandExecutionRecentlyProven = checks.commandAckFresh;
  return {
    device_online: deviceId === S24_DEVICE_ID ? authenticated
      : Boolean(doc.online || doc.effectiveOnline) && fresh(lastSeenAge),
    heartbeat_authenticated: deviceId === S24_DEVICE_ID ? authenticated : false,
    command_execution_recently_proven: deviceId === S24_DEVICE_ID
      ? commandExecutionRecentlyProven
      : false,
    stored_online: Boolean(doc.online || doc.effectiveOnline),
    last_command_ack_at: doc.lastCommandAckAt ?? null,
    last_command_ack_age_seconds: ackAge,
    freshness_window_seconds: S24_ACK_MAX_AGE_SECONDS,
  };
}

/**
 * Command gating, added after the 2026-09-20 end-to-end debug of the
 * direct-cloud chain.
 *
 * Before this, every queue writer accepted an arbitrary action string and
 * merged arbitrary params into the queued item — and the daemon that reads
 * that mailbox historically implemented actions that
 * Devices/S24/runtime_contract.json now forbids outright: 'start-ssh', a
 * 'wakeup' that also spawned sshd and published a public bore.pub reverse
 * tunnel, and a 'test-ping' that SET AN ATTACKER-CHOSEN LOCK-SCREEN PASSWORD
 * with NO token check at all ("pipeline test"). The device is a pull-only
 * mailbox client, so a leaked JP_AGENT_TOKEN or MCP session was enough to
 * queue something that locks the owner out of their own phone the next time
 * it wakes. The queue is the trust boundary; nothing that can hurt the
 * device or its owner may be enqueued through a tool.
 *
 * 'secure-wipe' is intentionally refused here: it stays reachable only
 * through the audited bootstrap/emergency token path the daemon verifies
 * itself — not through anything a tool token can touch. The exported set is
 * deliberately the exact runtime_contract.json allowlist. Safe historical
 * aliases may resolve to one of those canonical values, but commandItem always
 * writes the canonical value so the mailbox itself cannot drift from contract.
 *
 * The MCP server (Integrations/s24-connect-mcp/server.py) mirrors this exact
 * table; _shared/tests/s24-action-gate.test.mjs fails if the two lists, or
 * the hardened daemon copy, drift apart.
 */
export const SAFE_DEVICE_ACTIONS = new Set([
  'status-only', 'ping', 'echo', 'wa-push', 'wa-media-push', 'sync-now',
]);

/** Mirrors normalize_runtime_action() in the daemon, gate before queueing. */
export function normalizeAction(action) {
  const normalized = String(action ?? '').trim().toLowerCase().replace(/_/g, '-');
  const aliases = {
    'sync': 'sync-now', 'direct-cloud-sync': 'sync-now', 'collect-history': 'sync-now', 'history': 'sync-now',
    'status': 'status-only',
    'start-sshd': 'start-ssh', 'ssh': 'start-ssh',
    'wake': 'wakeup', 'wake-up': 'wakeup',
    'restart': 'update-and-restart', 'pull-and-restart': 'update-and-restart', 'update': 'update-and-restart',
    'wipe': 'secure-wipe', 'kill': 'secure-wipe', 'emergency-wipe': 'secure-wipe',
    'test': 'test-ping',
  };
  return aliases[normalized] ?? (normalized || '');
}

/** Returns null when enqueueing `action` is safe, otherwise the refusal text. */
export function actionGateError(action) {
  const resolved = normalizeAction(action);
  if (SAFE_DEVICE_ACTIONS.has(resolved)) return null;
  return `action '${action}' is not allowed: it resolves to '${resolved || 'unknown'}', which is outside `
    + `the safe set [${[...SAFE_DEVICE_ACTIONS].sort().join(', ')}]. Destructive or inbound-network actions `
    + '(secure-wipe, start-ssh, test-ping, update-and-restart, arbitrary text) are refused at every queue '
    + 'writer since 2026-09-20; see runtime_contract.json forbiddenRuntimeFeatures.';
}

/** Param keys a queue writer must never accept — see commandItem / MCP parity. */
export const RESERVED_COMMAND_PARAMS = Object.freeze([
  'action', 'status', 'priority', 'requestedAt', 'requestedBy',
  'source', 'completedAt', 'ackAt', 'claimedAt', 'processedAt', 'result',
  // handler credentials/readers: wipeToken gates the daemon emergency wipe,
  // newPassword was the 'test-ping' lockout primitive. Neither belongs in a
  // tool-suppliable param.
  'wipeToken', 'newPassword',
]);

export function commandItem(action, priority, params, requestedAt) {
  const gate = actionGateError(action);
  if (gate) throw new Error(gate);
  // Reserved names stay refused even though params no longer sit beside them: wipeToken and
  // newPassword were read by historical handlers, and none of these is a payload field.
  const reserved = RESERVED_COMMAND_PARAMS;
  for (const key of reserved) {
    if (Object.hasOwn(params, key)) throw new Error(`Reserved command parameter: ${key}`);
  }
  // Params travel as the command's `payload`, which is the only place the broker's poll and
  // claim hand them to the device (Devices/S24/README.md documents timeout_seconds there).
  // Spread at the top level of the entry they never reached the phone — a queued
  // timeout_seconds was silently replaced by the default — and they sat beside the lease
  // fields the broker writes onto the same entry (claimToken, leaseUntil, attempt).
  return { action: normalizeAction(action), status: 'pending', priority, requestedAt,
    requestedBy: 'jp-agent-s24-tools', source: 'commandQueue', payload: { ...params } };
}
