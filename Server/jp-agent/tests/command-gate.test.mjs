// Droplet-side contract for the 2026-09-20 command gate — shipped flat by
// deploy.sh alongside device-health.mjs, and run by the CI job that only ever
// executes Server/jp-agent/tests, so the gate the operator's tools lean on
// cannot silently regress even when the full _shared suite is skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAFE_DEVICE_ACTIONS, actionGateError, commandItem, normalizeAction } from '../device-health.mjs';

test('device_send can enqueue only contract-safe actions after alias resolution', () => {
  for (const a of ['sync-now', 'status-only', 'wa-push', 'wa-media-push', 'echo', 'ping', 'sync_now']) {
    assert.equal(actionGateError(a), null, a + ' must pass the gate');
  }
  for (const a of ['heartbeat', 'wakeup']) {
    assert.equal(typeof actionGateError(a), 'string', a + ' is outside runtime_contract.json');
  }
});

test('inbound-ssh, tunnels, wipe and lock-screen verbs are refused at the queue', () => {
  // The incident: 'test-ping' used to run `locksettings set-password` with
  // whatever newPassword the payload carried, and 'start-ssh' opened sshd on
  // the phone. Since runtime_contract.json these are forbidden features; the
  // gate refuses them regardless of case, separators or aliases.
  for (const a of ['start-ssh', 'Start_SSHd', 'ssh', 'wakeup-sshd', 'secure-wipe', 'Wipe', 'kill',
                   'test-ping', 'test', 'update-and-restart', 'pull-and-restart', 'echo rm -rf /', '']) {
    const r = actionGateError(a);
    assert.equal(typeof r, 'string', a + ' must be refused');
    assert.match(r, /refused/i, a + ' refusal must say so');
  }
  assert.equal(normalizeAction('START-SSH'), 'start-ssh');
  assert.equal(normalizeAction('pull_and_restart'), 'update-and-restart');
});

test('queued params can never carry handler credentials or forge state', () => {
  assert.throws(() => commandItem('echo', 'NORMAL', { wipeToken: 'x' }, 't'), /Reserved command parameter: wipeToken/);
  assert.throws(() => commandItem('echo', 'NORMAL', { newPassword: 'x' }, 't'), /Reserved command parameter: newPassword/);
  assert.throws(() => commandItem('echo', 'NORMAL', { status: 'completed' }, 't'), /Reserved command parameter: status/);
  assert.deepEqual([...SAFE_DEVICE_ACTIONS].sort(),
    ['echo', 'ping', 'status-only', 'sync-now', 'wa-media-push', 'wa-push']);
});
