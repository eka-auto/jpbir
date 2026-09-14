// Regression tests for the dashboard's fail-closed device status contract.
import assert from 'node:assert/strict';
import { strictS24Liveness } from '../../Backend/jp-devices.js';

const valid = {
  agentVersion: 's24-termux-direct-cloud-test',
  heartbeatAuth: 'termux-phone',
  liveDeviceVerified: true,
  sourceType: 'live_termux',
  runtimeIsAndroid: true,
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

t('S24 is live only when every attestation check and ACK is fresh', () => {
  const result = strictS24Liveness(valid, 30, 120);
  assert.equal(result.live, true);
  assert.equal(result.reason, 'authenticated heartbeat and command acknowledgement are fresh');
});

t('stored online state cannot replace a missing authenticated agent proof', () => {
  const result = strictS24Liveness({ ...valid, agentVersion: 'laptop-keepalive-v1' }, 30, 120);
  assert.equal(result.live, false);
  assert.equal(result.checks.authenticatedAgent, false);
});

t('a stale command ACK makes an otherwise fresh S24 offline', () => {
  const result = strictS24Liveness(valid, 30, 301);
  assert.equal(result.live, false);
  assert.equal(result.checks.commandAckFresh, false);
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
  // still running off-device must not be sufficient.
  const spoofed = { ...bridge, agentVersion: 's24-termux-direct-cloud-test' };
  const result = strictS24Liveness(spoofed, 30, 30);
  assert.equal(result.live, false);
  assert.equal(result.checks.authenticatedAgent, true, 'version check passes, as it would');
  assert.equal(result.checks.androidRuntime, false, 'runtime evidence still fails');
});

t('an older build that never reports runtimeIsAndroid fails closed', () => {
  const legacy = { ...valid };
  delete legacy.runtimeIsAndroid;
  const result = strictS24Liveness(legacy, 30, 30);
  assert.equal(result.live, false);
  assert.equal(result.checks.androidRuntime, false);
});

console.log(`\n${pass}/${total} passed`);
