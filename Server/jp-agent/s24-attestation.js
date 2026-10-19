// The single source of truth for S24 liveness attestation.
//
// This existed as two independent implementations — Backend/jp-devices.js for the
// dashboard and Server/jp-agent/device-health.mjs for the jp-agent's device_ping and
// list_devices — and they drifted twice in one day. First the jp-agent accepted only the
// `s24-termux-` agentVersion prefix while the collector shipped to the phone writes
// `s24-direct-cloud-<date>.<n>`, so authenticatedAgent could never pass. Then, after both
// prefixes were accepted, the jp-agent was still missing `runtimeIsAndroid` entirely — the
// one field the collector derives from the platform it is actually executing on, and the
// control that caught a real Windows bridge asserting heartbeatAuth='termux-phone',
// sourceType='live_termux' and liveDeviceVerified=true about itself. Every other field in
// the chain is writable by whatever process owns the document; a version prefix is one edit
// from matching. The dashboard refused that bridge. The jp-agent reported it as both
// device_online and heartbeat_authenticated, feeding a false "the phone is reachable" into
// the model's reasoning.
//
// Broker v2 now supplies the non-self-asserted root of trust: after it verifies the device
// signature, active key, expiry and enrolled hardware, it stamps the accepted heartbeat
// time/key/protocol beside the enrollment. The client telemetry below is still checked, but
// cannot establish liveness without that server stamp. Command acknowledgement freshness is
// deliberately a separate execution-path diagnostic: commands are scheduled six hours
// apart, so requiring a five-minute ACK made a healthy heartbeating phone offline for most
// of every day.
//
// Which checks each evidence mode requires is decided here, in S24_EVIDENCE_REQUIREMENTS,
// and nowhere else. jp-devices.js once kept its own name lists for "the checks that matter
// for a broker doc" beside the evidence function, so `live` and the reported reason could
// disagree the moment either list moved. Callers take the verdict — mode and first failing
// check — from s24LivenessVerdict() instead of re-deriving the policy.
//
// Two more implementations exist in Python and are NOT served by this file:
// Integrations/s24-connect-mcp/server.py and Devices/S24/pull_direct_cloud.py. Regex checks
// of their constants let both keep rejecting every signed-broker-v2 heartbeat, so
// _shared/tests/s24-attestation.test.mjs now executes them against this module on the same
// documents. Change the policy here and that suite tells you what else must move.

export const S24_DEVICE_ID = 'samsung-s24-ultra';

// Both prefixes name the S24's own agent. The collector shipped to the phone writes
// s24-direct-cloud-<date>.<n>; the newer on-device build writes
// s24-termux-direct-cloud-<build>. One prefix is backward-compatible with the build
// currently installed, the other forward-compatible with the one in Backend/
// s24_phone_direct_cloud.py. Widening the list is cheap precisely because
// runtimeIsAndroid, not the version string, is the real control.
export const S24_AGENT_VERSION_PREFIXES = ['s24-termux-', 's24-direct-cloud-'];

export const S24_RUNTIME_EVIDENCE = 'runtimeIsAndroid';
export const S24_HEARTBEAT_AUTH = 'termux-phone';
export const S24_SOURCE_TYPES = new Set(['live_termux', 'live_daemon']);
export const S24_CONNECTION_METHODS = ['signed-broker-v2', 'termux-direct-cloud', 'direct-daemon'];
export const S24_ACK_MAX_AGE_SECONDS = 300;

export function isS24AgentVersion(agentVersion) {
  return typeof agentVersion === 'string' &&
    S24_AGENT_VERSION_PREFIXES.some((p) => agentVersion.startsWith(p));
}

// Negative ages are rejected, not just nulls. A future-dated lastSeen is exactly what a
// writer asserting its own freshness would produce, and the jp-agent's age() returns it as a
// negative number. jp-devices.js maps future timestamps to null before calling in, so for
// the dashboard this bound changes nothing; for the jp-agent it is the one that matters.
const isFresh = (seconds) =>
  seconds !== null && seconds !== undefined && seconds >= 0 && seconds <= S24_ACK_MAX_AGE_SECONDS;

/**
 * True only for a *completed* acknowledgement whose queue entry agrees with it.
 *
 * A fresh lastCommandAckAt alone proves nothing about execution: broker-command-complete
 * stamps it for rejected, failed and error results too, and a legacy writer can set it with
 * no queue entry behind it at all. The dashboard once reported a rejected leftover 'wakeup'
 * as commandExecutionRecentlyProven while the jp-agent, which checked the entry, said false.
 * Both now ask this one question.
 */
export function s24CommandAckConsistent(doc) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const queue = d.commandQueue && typeof d.commandQueue === 'object' ? d.commandQueue : {};
  const entry = typeof d.lastCommandAckId === 'string' && Object.hasOwn(queue, d.lastCommandAckId)
    ? queue[d.lastCommandAckId]
    : null;
  return d.lastCommandAckStatus === 'completed' &&
    Boolean(entry) && entry.status === 'completed' &&
    typeof d.lastCommandAckAt === 'string' && entry.completedAt === d.lastCommandAckAt;
}

/**
 * Evaluate every attestation check. Key order is load-bearing: callers report the first
 * failing key as the reason, so do not reorder without reading the tests.
 *
 * `commandAckFresh` is returned alongside heartbeat attestation, but consumers must use
 * s24LivenessVerdict() for basic liveness rather than requiring every value here. It is a
 * fresh *and* consistent acknowledgement (see s24CommandAckConsistent): pass
 * `ackConsistent` or it stays false.
 */
export function s24AttestationChecks({
  agentVersion,
  connectionMethod,
  heartbeatAuth,
  liveDeviceVerified,
  sourceType,
  runtimeIsAndroid,
  heartbeatAgeSeconds,
  ackAgeSeconds,
  ackConsistent,
  lastSeen,
  signedHeartbeatAt,
  signedHeartbeatKeyId,
  signedHeartbeatProtocol,
  activeKeyId,
  keyType,
}) {
  return {
    heartbeatFresh: isFresh(heartbeatAgeSeconds),
    signedBrokerHeartbeat: isFresh(heartbeatAgeSeconds) &&
      typeof signedHeartbeatAt === 'string' && signedHeartbeatAt === lastSeen &&
      typeof activeKeyId === 'string' && activeKeyId.length > 0 &&
      signedHeartbeatKeyId === activeKeyId && signedHeartbeatProtocol === '2',
    androidHardwareKey: keyType === 'android-keystore-p256',
    signedBrokerConnection: connectionMethod === 'signed-broker-v2',
    legacyConnection: ['termux-direct-cloud', 'direct-daemon'].includes(connectionMethod),
    authenticatedAgent: isS24AgentVersion(agentVersion),
    heartbeatAuth: heartbeatAuth === S24_HEARTBEAT_AUTH,
    liveDeviceVerified: liveDeviceVerified === true,
    liveSource: S24_SOURCE_TYPES.has(sourceType),
    androidRuntime: runtimeIsAndroid === true,
    commandAckFresh: isFresh(ackAgeSeconds) && ackConsistent === true,
  };
}

const COMMON_LIVENESS_CHECKS = [
  'heartbeatFresh', 'authenticatedAgent', 'heartbeatAuth', 'liveDeviceVerified', 'liveSource',
  'androidRuntime',
];

// The whole liveness policy. A signed-broker doc proves itself with the broker's own stamp
// and an AndroidKeyStore key; a legacy doc has no server stamp, so it still needs a fresh,
// consistent command ACK. A doc with any other connectionMethod is judged — and fails — as
// legacy, on legacyConnection.
export const S24_EVIDENCE_REQUIREMENTS = Object.freeze({
  'signed-broker-v2': Object.freeze([
    'signedBrokerConnection', 'signedBrokerHeartbeat', 'androidHardwareKey', ...COMMON_LIVENESS_CHECKS,
  ]),
  'legacy-strict': Object.freeze(['legacyConnection', 'commandAckFresh', ...COMMON_LIVENESS_CHECKS]),
});

/**
 * { evidenceMode, failedCheck }: the mode that proved liveness (null if none did) and the
 * first required check that failed, in the checks object's key order.
 */
export function s24LivenessVerdict(checks) {
  const mode = checks.signedBrokerConnection ? 'signed-broker-v2' : 'legacy-strict';
  const required = S24_EVIDENCE_REQUIREMENTS[mode];
  const failedCheck = Object.keys(checks).find((name) => required.includes(name) && !checks[name]) || null;
  return { evidenceMode: failedCheck ? null : mode, failedCheck };
}
