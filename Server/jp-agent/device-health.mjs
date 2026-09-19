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

export function commandItem(action, priority, params, requestedAt) {
  // Extra parameters must never forge a completed command or change its action.
  const reserved = ['action', 'status', 'priority', 'requestedAt', 'requestedBy',
    'source', 'completedAt', 'ackAt', 'claimedAt', 'processedAt', 'result'];
  for (const key of reserved) {
    if (Object.hasOwn(params, key)) throw new Error(`Reserved command parameter: ${key}`);
  }
  return { ...params, action, status: 'pending', priority, requestedAt,
    requestedBy: 'jp-agent-s24-tools', source: 'commandQueue' };
}
