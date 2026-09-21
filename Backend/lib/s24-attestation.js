// The single source of truth for S24 liveness attestation.
//
// This existed as two independent implementations — Backend/jp-devices.js for the
// dashboard and Server/jp-agent/device-health.mjs for the droplet's device_ping and
// list_devices — and they drifted twice in one day. First the droplet accepted only the
// `s24-termux-` agentVersion prefix while the collector shipped to the phone writes
// `s24-direct-cloud-<date>.<n>`, so authenticatedAgent could never pass. Then, after both
// prefixes were accepted, the droplet was still missing `runtimeIsAndroid` entirely — the
// one field the collector derives from the platform it is actually executing on, and the
// control that caught a real Windows bridge asserting heartbeatAuth='termux-phone',
// sourceType='live_termux' and liveDeviceVerified=true about itself. Every other field in
// the chain is writable by whatever process owns the document; a version prefix is one edit
// from matching. The dashboard refused that bridge. The droplet reported it as both
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
// Two more implementations exist in Python and are NOT served by this file:
// Integrations/s24-connect-mcp/server.py and Devices/S24/pull_direct_cloud.py. They are
// kept in step by _shared/tests/s24-source-mirrors.test.mjs, which regex-asserts their
// prefix tuples. Change a constant here and that suite tells you what else must move.

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
// writer asserting its own freshness would produce, and the droplet's age() returns it as a
// negative number. jp-devices.js maps future timestamps to null before calling in, so for
// the dashboard this bound changes nothing; for the droplet it is the one that matters.
const isFresh = (seconds) =>
  seconds !== null && seconds !== undefined && seconds >= 0 && seconds <= S24_ACK_MAX_AGE_SECONDS;

/**
 * Evaluate every attestation check. Key order is load-bearing: callers report the first
 * failing key as the reason, so do not reorder without reading the tests.
 *
 * `commandAckFresh` is returned alongside heartbeat attestation, but consumers must use
 * s24HeartbeatAuthenticated() for basic liveness rather than requiring every value here.
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
    commandAckFresh: isFresh(ackAgeSeconds),
  };
}

export function s24LivenessEvidence(checks) {
  const common = checks.heartbeatFresh && checks.authenticatedAgent &&
    checks.heartbeatAuth && checks.liveDeviceVerified && checks.liveSource &&
    checks.androidRuntime;
  if (checks.signedBrokerConnection) {
    return common && checks.signedBrokerHeartbeat && checks.androidHardwareKey
      ? 'signed-broker-v2'
      : null;
  }
  if (checks.legacyConnection) {
    return common && checks.commandAckFresh ? 'legacy-strict' : null;
  }
  return null;
}

export function s24HeartbeatAuthenticated(checks) {
  return s24LivenessEvidence(checks) !== null;
}

/** The first failing check name, or null when every check passed. */
export function firstFailedCheck(checks) {
  const failed = Object.entries(checks).find(([, passed]) => !passed);
  return failed ? failed[0] : null;
}
