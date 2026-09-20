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
// Devices/S24/pull_direct_cloud.py) are kept in step by s24-source-mirrors.test.mjs.
import {
  S24_DEVICE_ID,
  S24_CONNECTION_METHODS,
  S24_HEARTBEAT_AUTH,
  S24_ACK_MAX_AGE_SECONDS,
  S24_RUNTIME_EVIDENCE,
  s24AttestationChecks,
} from './s24-attestation.js';

export function deviceHealth(deviceId, doc, now = Date.now()) {
  const age = value => {
    if (typeof value !== 'string') return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.round((now - timestamp) / 1000) : null;
  };
  const lastSeenAge = age(doc.lastSeen);
  const ackAge = age(doc.lastCommandAckAt);
  const fresh = value => value !== null && value >= 0 && value <= S24_ACK_MAX_AGE_SECONDS;
  const sync = doc.samsungS24DirectSync || {};
  const ack = doc.commandQueue?.[doc.lastCommandAckId];

  // Deliberate divergences from the dashboard, stated here rather than left implicit:
  // liveDeviceVerified and sourceType come from the nested samsungS24DirectSync sub-map
  // (jp-devices.js reads them top-level), and allowBootGrace lets a freshly rebooted phone
  // pass before its first command acknowledgement. jp-devices.js grants no such grace.
  // Neither difference is drift, and neither should be "unified" without first deciding
  // which behaviour is correct — that is a policy call, not a refactor.
  const checks = s24AttestationChecks({
    agentVersion: doc.agentVersion,
    heartbeatAuth: doc.heartbeatAuth,
    liveDeviceVerified: sync.liveDeviceVerified,
    sourceType: sync.sourceType,
    runtimeIsAndroid: doc[S24_RUNTIME_EVIDENCE],
    heartbeatAgeSeconds: lastSeenAge,
    ackAgeSeconds: ackAge,
    allowBootGrace: true,
  });

  // Conditions this caller adds on top of the shared set. The stored online flag and the
  // connection method are extra evidence the dashboard does not require; sync.heartbeatAuth
  // and the ack triple are the droplet's stricter proof that a recorded acknowledgement
  // really belongs to the command it claims to complete.
  const ackConsistent = doc.lastCommandAckStatus === 'completed' && ack?.status === 'completed'
    && ack.completedAt === doc.lastCommandAckAt;
  const authenticated = Object.values(checks).every(Boolean)
    && doc.online === true
    && S24_CONNECTION_METHODS.includes(doc.connectionMethod)
    && sync.heartbeatAuth === S24_HEARTBEAT_AUTH
    && (ackConsistent || ackAge === null);
  return {
    device_online: deviceId === S24_DEVICE_ID ? authenticated
      : Boolean(doc.online || doc.effectiveOnline) && fresh(lastSeenAge),
    heartbeat_authenticated: deviceId === S24_DEVICE_ID ? authenticated : false,
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
 * itself — not through anything a tool token can touch. 'wakeup' and
 * 'heartbeat' are permitted because the 2026-09-20 daemon copy reduces them
 * to a wake-lock, a notification and an immediate status publish; permitting
 * 'wakeup' also lets the three commands parked since 2026-09-17 drain
 * harmlessly when the real phone daemon is finally installed.
 *
 * The MCP server (Integrations/s24-connect-mcp/server.py) mirrors this exact
 * table; _shared/tests/s24-action-gate.test.mjs fails if the two lists, or
 * the hardened daemon copy, drift apart.
 */
export const SAFE_DEVICE_ACTIONS = new Set([
  // contract (runtime_contract.json allowlistedActions)
  'status-only', 'ping', 'echo', 'wa-push', 'wa-media-push', 'sync-now',
  // daemon aliases that resolve to the above
  'sync', 'direct-cloud-sync', 'collect-history', 'history',
  // safe queue-only verbs implemented by the 2026-09-20 daemon
  'heartbeat', 'wakeup',
]);

/** Mirrors normalize_runtime_action() in the daemon, gate before queueing. */
export function normalizeAction(action) {
  const normalized = String(action ?? '').trim().toLowerCase().replace(/_/g, '-');
  const aliases = {
    'sync': 'sync-now', 'direct-cloud-sync': 'sync-now', 'collect-history': 'sync-now', 'history': 'sync-now',
    'status': 'status-only',
    'ping': 'heartbeat', // daemon maps 'ping' to heartbeat; 'test-ping' stays test-ping
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
  // Extra parameters must never forge a completed command or change its action.
  const reserved = RESERVED_COMMAND_PARAMS;
  for (const key of reserved) {
    if (Object.hasOwn(params, key)) throw new Error(`Reserved command parameter: ${key}`);
  }
  return { ...params, action, status: 'pending', priority, requestedAt,
    requestedBy: 'jp-agent-s24-tools', source: 'commandQueue' };
}
