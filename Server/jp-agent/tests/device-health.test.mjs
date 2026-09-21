import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceHealth, commandItem } from '../device-health.mjs';

const now = Date.parse('2026-09-18T00:00:00Z');
const at = new Date(now - 10000).toISOString();
const valid = () => ({ online: true, lastSeen: at, agentVersion: 's24-termux-test',
  runtimeIsAndroid: true,
  connectionMethod: 'signed-broker-v2', heartbeatAuth: 'termux-phone',
  liveDeviceVerified: true, sourceType: 'live_termux',
  enrollment: { activeKeyId: 'a'.repeat(32), keyType: 'android-keystore-p256',
    lastSignedHeartbeatAt: at, lastSignedHeartbeatKeyId: 'a'.repeat(32),
    lastSignedHeartbeatProtocol: '2' },
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
    { heartbeatAuth: 'laptop' }, { sourceType: 'bridge_process' }, { online: false }]) {
    assert.equal(health({ ...valid(), ...change }).device_online, false);
  }
});
test('an off-device bridge asserting every other field is still not the phone', () => {
  // runtimeIsAndroid is the one field the collector derives from the platform it is
  // actually executing on, which is why it is the control that caught a real Windows
  // bridge asserting heartbeatAuth, sourceType and liveDeviceVerified about itself.
  // Everything else in this document is attacker-writable; this is not.
  //
  // Absent must fail as well as false — an older build that never set the field has to
  // fail closed rather than pass by omission, which is what `=== true` buys. A truthy
  // non-boolean must fail too, so the check cannot be satisfied by 'true' or 1.
  for (const runtimeIsAndroid of [false, null, 'true', 1, 'yes']) {
    const result = health({ ...valid(), runtimeIsAndroid });
    assert.equal(result.device_online, false, `runtimeIsAndroid=${String(runtimeIsAndroid)}`);
    assert.equal(result.heartbeat_authenticated, false, `runtimeIsAndroid=${String(runtimeIsAndroid)}`);
    // The stored flag is still reported as-is, so a caller can see the disagreement
    // between what the document claims and what was attested.
    assert.equal(result.stored_online, true);
  }

  const absent = valid();
  delete absent.runtimeIsAndroid;
  assert.equal(health(absent).device_online, false, 'an absent field must not pass');
  assert.equal(health(valid()).device_online, true, 'and a genuine true still must');
});
test('queue deletion and mismatched acknowledgement do not prove command execution', () => {
  for (const doc of [
    { ...valid(), commandQueue: {} },
    { ...valid(), lastCommandAckAt: new Date(now - 20000).toISOString() },
  ]) {
    assert.equal(health(doc).device_online, true);
    assert.equal(health(doc).command_execution_recently_proven, false);
  }
});
test('fresh signed heartbeat remains live without a prior acknowledgement', () => {
  const doc = valid();
  delete doc.lastCommandAckAt;
  delete doc.commandQueue;
  assert.equal(health(doc).device_online, true);
  assert.equal(health(doc).command_execution_recently_proven, false);
  assert.equal(health({ ...doc, heartbeatAuth: null }).device_online, false);
});
test('self-asserted phone telemetry without server broker evidence fails closed', () => {
  const doc = valid();
  delete doc.enrollment;
  assert.equal(health(doc).device_online, false);
  assert.equal(health(doc).heartbeat_authenticated, false);
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
