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
// So the checks live here once. Callers still compose them, because the two genuinely
// differ in policy and those differences are deliberate, not drift:
//
//   * jp-devices.js reads every field top-level. device-health.mjs reads
//     liveDeviceVerified and sourceType from the nested samsungS24DirectSync sub-map.
//   * device-health.mjs additionally requires the stored `online` flag and a known
//     connectionMethod; jp-devices.js requires neither.
//   * device-health.mjs grants a boot grace when no command has ever been acknowledged
//     (allowBootGrace), so a freshly rebooted phone is not reported dead before its first
//     ACK. jp-devices.js does not.
//
// Those are passed in explicitly at the call site so a reader can see them. What is NOT
// negotiable is the check set itself: androidRuntime is always evaluated, so no caller can
// silently omit it again. _shared/tests/s24-attestation.test.mjs asserts that, and asserts
// the droplet's byte-identical copy has not drifted.
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
export const S24_CONNECTION_METHODS = ['termux-direct-cloud', 'direct-daemon'];
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
 * `allowBootGrace` makes commandAckFresh pass when no acknowledgement has ever existed
 * (ackAgeSeconds === null). It does not weaken any other check.
 */
export function s24AttestationChecks({
  agentVersion,
  heartbeatAuth,
  liveDeviceVerified,
  sourceType,
  runtimeIsAndroid,
  heartbeatAgeSeconds,
  ackAgeSeconds,
  allowBootGrace = false,
}) {
  return {
    heartbeatFresh: isFresh(heartbeatAgeSeconds),
    authenticatedAgent: isS24AgentVersion(agentVersion),
    heartbeatAuth: heartbeatAuth === S24_HEARTBEAT_AUTH,
    liveDeviceVerified: liveDeviceVerified === true,
    liveSource: S24_SOURCE_TYPES.has(sourceType),
    androidRuntime: runtimeIsAndroid === true,
    commandAckFresh: isFresh(ackAgeSeconds) || (allowBootGrace && ackAgeSeconds === null),
  };
}

/** The first failing check name, or null when every check passed. */
export function firstFailedCheck(checks) {
  const failed = Object.entries(checks).find(([, passed]) => !passed);
  return failed ? failed[0] : null;
}
