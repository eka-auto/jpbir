import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceHealth, commandItem } from '../device-health.mjs';

const now = Date.parse('2026-09-18T00:00:00Z');
const at = new Date(now - 10000).toISOString();
const valid = () => ({ online: true, lastSeen: at, agentVersion: 's24-termux-test',
  connectionMethod: 'termux-direct-cloud', heartbeatAuth: 'termux-phone',
  samsungS24DirectSync: { liveDeviceVerified: true, heartbeatAuth: 'termux-phone', sourceType: 'live_termux' },
  lastCommandAckAt: at, lastCommandAckId: 'test', lastCommandAckStatus: 'completed',
  commandQueue: { test: { status: 'completed', completedAt: at } } });
const health = doc => deviceHealth('samsung-s24-ultra', doc, now);

test('accept authenticated heartbeat and matching completed acknowledgement', () => {
  assert.equal(health(valid()).device_online, true);
});
test('accept the version string the shipped collector actually writes', () => {
  // The collector on the phone writes s24-direct-cloud-<date>.<n> — its own
  // currentDirectCloudRuntime.expectedAgentVersion says so — not s24-termux-.
  // Accepting only the latter made a genuinely live S24 read as unauthenticated
  // here and on the dashboard. See S24_AGENT_VERSION_PREFIXES in
  // Backend/jp-devices.js.
  assert.equal(
    health({ ...valid(), agentVersion: 's24-direct-cloud-2026-09-07.1' }).device_online,
    true
  );
  // Widening adds a prefix; it must not turn the check into a loose match.
  for (const agentVersion of ['not-s24-direct-cloud-2026-09-07.1', 's24-direct-cloud']) {
    assert.equal(health({ ...valid(), agentVersion }).device_online, false, agentVersion);
  }
});
test('reject stale, future, laptop-origin and unauthenticated heartbeat', () => {
  for (const change of [{ lastSeen: new Date(now - 301000).toISOString() },
    { lastSeen: new Date(now + 10000).toISOString() }, { agentVersion: 's24-laptop-keepalive' },
    { heartbeatAuth: 'laptop' }, { samsungS24DirectSync: {} }, { online: false }]) {
    assert.equal(health({ ...valid(), ...change }).device_online, false);
  }
});
test('queue deletion and mismatched acknowledgement do not prove online', () => {
  assert.equal(health({ ...valid(), commandQueue: {} }).device_online, false);
  assert.equal(health({ ...valid(), lastCommandAckAt: new Date(now - 20000).toISOString() }).device_online, false);
});
test('boot grace requires fresh attestation without a prior acknowledgement', () => {
  const doc = valid();
  delete doc.lastCommandAckAt;
  delete doc.commandQueue;
  assert.equal(health(doc).device_online, true);
  assert.equal(health({ ...doc, heartbeatAuth: null }).device_online, false);
});
test('stored flag alone is never current connectivity', () => {
  assert.equal(health({ online: true, updatedAt: at }).device_online, false);
  assert.equal(deviceHealth('jayti-asus-vivobook', { online: true }, now).device_online, false);
});
test('preserve permitted parameters, reject forged lifecycle metadata', () => {
  const item = commandItem('sync-now', 'HIGH', { detail: 'test' }, at);
  assert.equal(item.status, 'pending');
  assert.equal(item.detail, 'test');
  for (const key of ['status', 'action', 'completedAt', 'requestedBy']) {
    assert.throws(() => commandItem('sync-now', 'HIGH', { [key]: 'forged' }, at), /Reserved/);
  }
});
