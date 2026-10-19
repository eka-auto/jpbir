// Regression tests for the dashboard's fail-closed device status contract.
import assert from 'node:assert/strict';
import { strictS24Liveness } from '../../Backend/jp-devices.js';

// The version string the collector shipped to the phone actually writes —
// Backend/s24_phone_direct_cloud.py's DIRECT_CLOUD_AGENT_VERSION, corroborated by
// the device document's own currentDirectCloudRuntime.expectedAgentVersion. This
// fixture used to read 's24-termux-direct-cloud-test', a string no writer ever
// produced, which is exactly how authenticatedAgent stayed unsatisfiable in
// production while every assertion below kept passing. Keep it real: a fixture
// that encodes a fiction tests the fiction, not the fleet.
const valid = {
  agentVersion: 's24-direct-cloud-2026-09-07.1',
  connectionMethod: 'signed-broker-v2',
  heartbeatAuth: 'termux-phone',
  liveDeviceVerified: true,
  sourceType: 'live_termux',
  runtimeIsAndroid: true,
  lastSeen: '2026-09-21T00:00:00.000Z',
  // A completed ACK whose queue entry agrees with it: the only kind that proves execution.
  lastCommandAckAt: '2026-09-21T00:00:00.000Z',
  lastCommandAckId: 'c1',
  lastCommandAckStatus: 'completed',
  commandQueue: { c1: { action: 'ping', status: 'completed', completedAt: '2026-09-21T00:00:00.000Z' } },
  enrollment: {
    activeKeyId: 'a'.repeat(32),
    keyType: 'android-keystore-p256',
    lastSignedHeartbeatAt: '2026-09-21T00:00:00.000Z',
    lastSignedHeartbeatKeyId: 'a'.repeat(32),
    lastSignedHeartbeatProtocol: '2',
  },
};

// What a bridge process running off-device actually writes now. Every one of
// these values is self-asserted by the writer, which is the whole point: the
// document cannot be trusted to describe itself unless the writer is honest
// about where it runs.
const bridge = {
  agentVersion: 's24-bridge-win32-2026-09-07.1',
  heartbeatAuth: 'non-termux-bridge',
  liveDeviceVerified: false,
  sourceType: 'bridge_process',
  runtimeIsAndroid: false,
};

let pass = 0;
let total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

t('S24 is live when its signed broker heartbeat and telemetry attestation are fresh', () => {
  const result = strictS24Liveness(valid, 30, 120);
  assert.equal(result.live, true);
  assert.equal(result.reason, 'signed broker heartbeat is authenticated and fresh');
  assert.equal(result.commandExecutionRecentlyProven, true);
});

t('stored online state cannot replace a missing authenticated agent proof', () => {
  const result = strictS24Liveness({ ...valid, agentVersion: 'laptop-keepalive-v1' }, 30, 120);
  assert.equal(result.live, false);
  assert.equal(result.checks.authenticatedAgent, false);
});

t('a stale command ACK is reported separately without making a fresh S24 offline', () => {
  const result = strictS24Liveness(valid, 30, 301);
  assert.equal(result.live, true);
  assert.equal(result.checks.commandAckFresh, false);
  assert.equal(result.commandExecutionRecentlyProven, false);
});

t('client telemetry without a matching server broker stamp fails closed', () => {
  const unsigned = { ...valid };
  delete unsigned.enrollment;
  const result = strictS24Liveness(unsigned, 30, 30);
  assert.equal(result.live, false);
  assert.equal(result.checks.signedBrokerHeartbeat, false);
});

t('legacy direct-cloud evidence remains a strict ACK-gated fallback', () => {
  const legacy = { ...valid, connectionMethod: 'termux-direct-cloud' };
  delete legacy.enrollment;
  const live = strictS24Liveness(legacy, 30, 30);
  assert.equal(live.live, true);
  assert.equal(live.evidenceMode, 'legacy-strict');
  assert.equal(live.reason, 'legacy heartbeat and completed command acknowledgement are authenticated and fresh',
    'a legacy doc must not be described as a signed broker heartbeat');
  const stale = strictS24Liveness(legacy, 30, 301);
  assert.equal(stale.live, false);
  assert.equal(stale.reason, 'commandAckFresh is missing or stale');
});

t('a legacy doc with a fresh ACK timestamp but no completed queue entry behind it is offline', () => {
  // The jp-agent briefly accepted exactly this after dropping its ack-triple check: a bare
  // lastCommandAckAt is one field write away for any writer.
  const orphan = { ...valid, connectionMethod: 'termux-direct-cloud', lastCommandAckId: 'gone', commandQueue: {} };
  delete orphan.enrollment;
  const result = strictS24Liveness(orphan, 30, 10);
  assert.equal(result.live, false);
  assert.equal(result.checks.commandAckFresh, false);
});

t('a rejected command is acknowledged, not executed, so it proves nothing about execution', () => {
  // broker-command-complete stamps lastCommandAckAt for rejected results too; the phone
  // rejecting a leftover 'wakeup' once read as commandExecutionRecentlyProven=true here
  // while the jp-agent said false.
  const rejected = {
    ...valid,
    lastCommandAckStatus: 'rejected',
    commandQueue: { c1: { action: 'wakeup', status: 'rejected', completedAt: valid.lastCommandAckAt } },
  };
  const result = strictS24Liveness(rejected, 30, 10);
  assert.equal(result.live, true, 'a signed heartbeat is still liveness');
  assert.equal(result.commandExecutionRecentlyProven, false);
});

t('a bridge process acknowledging commands on time is still not the phone', () => {
  // This is the case that was live in production: a Windows process writing
  // fresh heartbeats and fresh command ACKs into the S24 document.
  const result = strictS24Liveness(bridge, 30, 30);
  assert.equal(result.live, false);
  assert.equal(result.checks.androidRuntime, false);
});

t('renaming the agent version is not enough to pass', () => {
  // The version string was the only thing separating the bridge from the
  // phone, and a constant is one edit away from matching. Flipping it while
  // still running off-device must not be sufficient. This copies the *real*
  // production version string, so it stays honest now that two prefixes are
  // accepted: a bridge that clones the collector's identity is still caught,
  // by runtimeIsAndroid rather than by the version.
  const spoofed = { ...bridge, agentVersion: valid.agentVersion };
  const result = strictS24Liveness(spoofed, 30, 30);
  assert.equal(result.live, false);
  assert.equal(result.checks.authenticatedAgent, true, 'version check passes, as it would');
  assert.equal(result.checks.androidRuntime, false, 'runtime evidence still fails');
});

t('the older s24-termux- prefix is still accepted after widening', () => {
  // Widening must add a prefix, never drop one: an S24 still running the older
  // Termux build has to keep being judged on its heartbeat, not on its version.
  const result = strictS24Liveness(
    { ...valid, agentVersion: 's24-termux-2026-08-01.1' }, 30, 30
  );
  assert.equal(result.checks.authenticatedAgent, true);
  assert.equal(result.live, true);
});

t('a version string naming some other agent is still rejected', () => {
  for (const agentVersion of ['laptop-keepalive-v1', 's24-bridge-win32-2026-09-07.1']) {
    const result = strictS24Liveness({ ...valid, agentVersion }, 30, 30);
    assert.equal(result.checks.authenticatedAgent, false, agentVersion + ' must not pass');
    assert.equal(result.live, false);
  }
});

t('an older build that never reports runtimeIsAndroid fails closed', () => {
  const legacy = { ...valid };
  delete legacy.runtimeIsAndroid;
  const result = strictS24Liveness(legacy, 30, 30);
  assert.equal(result.live, false);
  assert.equal(result.checks.androidRuntime, false);
});

console.log(`\n${pass}/${total} passed`);
