// Contracts for the 2026-09-20 command-gate audit of the direct-cloud chain.
//
// The e2e debug found every queue writer (jp-agent s24-tools, connect-MCP)
// accepting ANY action string, while the daemon then implemented the
// pre-contract dangerous verbs: 'start-ssh' spawned sshd, 'wakeup' published
// a bore.pub tunnel, and 'test-ping' set an attacker-supplied lock-screen
// password with no token — a leaked tool token plus one heartbeat re-awakening
// the phone was a lockout primitive. The gate now lives in
// Server/jp-agent/device-health.mjs and is mirrored in
// Integrations/s24-connect-mcp/server.py; the daemon copy has the capability
// deleted outright. This suite is the wire that stops any of the three
// drifting back apart.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SAFE_DEVICE_ACTIONS, normalizeAction, actionGateError, commandItem, RESERVED_COMMAND_PARAMS,
} from '../../Server/jp-agent/device-health.mjs';

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const ALLOWED = ['sync-now', 'status-only', 'wa-push', 'wa-media-push', 'echo', 'heartbeat', 'wakeup',
  'ping', 'sync', 'collect_history', 'history', 'wake-up', 'SYNC-NOW'];
const REFUSED = ['start-ssh', 'start-sshd', 'ssh', 'wakeup-sshd', 'secure-wipe', 'wipe', 'kill',
  'emergency-wipe', 'test-ping', 'test', 'update-and-restart', 'restart', 'pull-and-restart',
  'rm -rf /', 'anything', ''];

t('the gate admits exactly the contract-safe actions after alias resolution', () => {
  for (const a of ALLOWED) assert.equal(actionGateError(a), null, a + ' must enqueue');
});

t('the gate refuses inbound-ssh, tunnels, wipe, lock-screen and arbitrary actions with an explanation', () => {
  for (const a of REFUSED) {
    const err = actionGateError(a);
    assert.equal(typeof err, 'string', a + ' must be refused');
    assert.match(err, /resolves to/, a + ' error reports resolution');
    assert.match(err, /refused/i, a + ' error explains the 2026-09-20 refusal');
  }
});

t('normalization can never smuggle a refused verb as a new token', () => {
  assert.equal(normalizeAction('START-SSH'), 'start-ssh');
  assert.equal(normalizeAction('Start_SSHd'), 'start-ssh');
  assert.equal(normalizeAction('Wipe'), 'secure-wipe');
  assert.equal(typeof actionGateError('secure - wipe'), 'string', 'spaced variants cannot slip through');
  assert.match(actionGateError('secure-wipe'), /secure-wipe/);
});

t('commandItem rejects reserved params and, since 2026-09-20, handler credentials too', () => {
  assert.throws(() => commandItem('echo', 'NORMAL', { status: 'completed' }, 'now'));
  assert.throws(() => commandItem('echo', 'NORMAL', { action: 'sync-now' }, 'now'));
  assert.throws(() => commandItem('echo', 'NORMAL', { wipeToken: 'x' }, 'now'));
  assert.throws(() => commandItem('echo', 'NORMAL', { newPassword: 'x' }, 'now'));
  assert.deepEqual(commandItem('echo', 'NORMAL', { tag: 'ok' }, 'now'),
    { tag: 'ok', action: 'echo', status: 'pending', priority: 'NORMAL', requestedAt: 'now',
      requestedBy: 'jp-agent-s24-tools', source: 'commandQueue' });
  assert.ok(RESERVED_COMMAND_PARAMS.includes('wipeToken'));
});

t('the Python MCP writer mirrors the same action table without drift', async () => {
  const py = await readFile(new URL('../../Integrations/s24-connect-mcp/server.py', import.meta.url), 'utf8');
  const m = py.match(/_SAFE_DEVICE_ACTIONS = frozenset\({\n([^]+?)\n\}\)/);
  assert.ok(m, 'frozenset block missing from server.py — the mirror gate was removed');
  const pySet = new Set((m[1].match(/'([^']+)'/g) || []).map((x) => x.slice(1, -1)));
  assert.deepEqual([...pySet].sort(), [...SAFE_DEVICE_ACTIONS].sort(), 'JS and Python action tables drifted apart');
  // device_send must call the gate AND reject reserved params inside it.
  const body = py.slice(py.indexOf('def device_send('), py.indexOf('@mcp.tool()', py.indexOf('def device_send(')));
  assert.match(body, /gate = _action_gate\(action\)\n    if gate is not None:/, 'device_send no longer calls the gate');
  assert.match(body, /_RESERVED_COMMAND_PARAMS/, 'device_send no longer rejects reserved params');
});

t('the jp-agent tool imports the shared gate instead of its own judgement', async () => {
  const js = await readFile(new URL('../../Server/jp-agent/s24-tools.mjs', import.meta.url), 'utf8');
  assert.match(js, /device-health\.mjs(?:'[^']*|[^']*?)actionGateError/);
  assert.match(js, /const gate = actionGateError\(action\);/, 'device_send must gate before writing');
  assert.doesNotMatch(js, /e\.g\. 'sync-now', 'status-only', 'start-ssh'/, 'tool description must stop advertising start-ssh');
});

t('the hardened daemon copy has no lock-screen or inbound-network capability left', async () => {
  const py = await readFile(new URL('../../Backend/s24_phone_direct_cloud.py', import.meta.url), 'utf8');
  assert.doesNotMatch(py, /^\s+ensure_sshd_running\(\)$|=\s*ensure_sshd_running\(\)/m, 'sshd must never be started again');
  assert.doesNotMatch(py, /^\s+ensure_reverse_tunnel\(\)$|=\s*ensure_reverse_tunnel\(\)/m, 'no bore tunnel');
  assert.doesNotMatch(py, /BORE_BIN_SHA256|BORE_SERVER = /, 'bore constants deleted');
  assert.doesNotMatch(py, /\['locksettings'/, null, 'x');
  assert.doesNotMatch(py, /'locksettings', 'set-password'/, 'the lock-screen setter call must be gone; comments may mention it');
  assert.doesNotMatch(py, /def _ensure_bore_binary|def ensure_reverse_tunnel|def ensure_sshd_running/, 'capabilities not merely hidden');
  assert.match(py, /refused-inbound-ssh/, 'start-ssh acknowledges with an explicit refusal');
  // The attestation guard that ended the Windows-bridge incident must stay.
  assert.match(py, /if not RUNTIME_IS_ANDROID:/);
  assert.match(py, /sys\.exit\(78\)/);
});

console.log('  ' + pass + '/' + total + ' passed');
