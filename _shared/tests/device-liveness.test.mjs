// Regression tests for the dashboard's fail-closed device status contract.
import assert from 'node:assert/strict';
import { strictS24Liveness } from '../../Backend/jp-devices.js';

const valid = {
  agentVersion: 's24-termux-direct-cloud-test',
  heartbeatAuth: 'termux-phone',
  liveDeviceVerified: true,
  sourceType: 'live_termux',
};

let pass = 0;
function t(name, fn) {
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

console.log(`\n${pass}/3 passed`);
