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
import { runPython } from './python-harness.mjs';

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const runtimeContract = JSON.parse(await readFile(
  new URL('../../Devices/S24/runtime_contract.json', import.meta.url), 'utf8',
));
const CONTRACT_ACTIONS = runtimeContract.command.allowlistedActions;

const ALLOWED = [...CONTRACT_ACTIONS, 'sync', 'collect_history', 'history', 'SYNC-NOW'];
const REFUSED = ['start-ssh', 'start-sshd', 'ssh', 'wakeup-sshd', 'secure-wipe', 'wipe', 'kill',
  'emergency-wipe', 'test-ping', 'test', 'update-and-restart', 'restart', 'pull-and-restart',
  'heartbeat', 'wakeup', 'wake-up', 'rm -rf /', 'anything', ''];

function quotedSet(source, pattern, label) {
  const match = source.replace(/\r\n/g, '\n').match(pattern);
  assert.ok(match, label + ' action set was not found');
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
}

t('the shared queue gate is exactly the runtime contract action set', () => {
  assert.deepEqual([...SAFE_DEVICE_ACTIONS].sort(), [...CONTRACT_ACTIONS].sort());
});

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
    { action: 'echo', status: 'pending', priority: 'NORMAL', requestedAt: 'now',
      requestedBy: 'jp-agent-s24-tools', source: 'commandQueue', payload: { tag: 'ok' } });
  assert.ok(RESERVED_COMMAND_PARAMS.includes('wipeToken'));
  assert.equal(commandItem('sync', 'NORMAL', {}, 'now').action, 'sync-now',
    'accepted aliases must be canonicalized before reaching the mailbox');
  assert.throws(() => commandItem('heartbeat', 'NORMAL', {}, 'now'), /outside the safe set/);
});

t('every Python and sandbox writer mirrors the runtime contract without drift', async () => {
  const py = await readFile(new URL('../../Integrations/s24-connect-mcp/server.py', import.meta.url), 'utf8');
  assert.deepEqual(
    quotedSet(py, /_SAFE_DEVICE_ACTIONS = frozenset\({\n([^]+?)\n\}\)/, 'connect MCP'),
    [...CONTRACT_ACTIONS].sort(),
  );
  assert.deepEqual(
    quotedSet(py, /_RESERVED_COMMAND_PARAMS = \(\n([^]+?)\n\)/, 'connect MCP reserved params'),
    [...RESERVED_COMMAND_PARAMS].sort(),
  );
  // device_send must call the gate AND reject reserved params inside it.
  const body = py.slice(py.indexOf('def device_send('), py.indexOf('@mcp.tool()', py.indexOf('def device_send(')));
  assert.match(body, /gate = _action_gate\(action\)\n    if gate is not None:/, 'device_send no longer calls the gate');
  assert.match(body, /_RESERVED_COMMAND_PARAMS/, 'device_send no longer rejects reserved params');

  const legacyMcp = await readFile(new URL('../../Database/firestore_mcp.py', import.meta.url), 'utf8');
  assert.deepEqual(
    quotedSet(legacyMcp, /SAFE_DEVICE_ACTIONS = frozenset\({\n([^]+?)\n\}\)/, 'legacy Firestore MCP'),
    [...CONTRACT_ACTIONS].sort(),
  );
  assert.deepEqual(
    quotedSet(legacyMcp, /RESERVED_COMMAND_PARAMS = frozenset\({\n([^]+?)\n\}\)/,
      'legacy Firestore MCP reserved params'),
    [...RESERVED_COMMAND_PARAMS].sort(),
  );
  const queueBody = legacyMcp.slice(
    legacyMcp.indexOf('def s24_queue_command('),
    legacyMcp.indexOf('@mcp.tool()', legacyMcp.indexOf('def s24_queue_command(')),
  );
  assert.match(queueBody, /gate = _action_gate\(action\)/, 'legacy MCP no longer gates actions');
  assert.match(queueBody, /RESERVED_COMMAND_PARAMS\.intersection\(extra_dict\)/,
    'legacy MCP no longer rejects reserved params');

  const cli = await readFile(new URL('../../Backend/queue_command.py', import.meta.url), 'utf8');
  assert.deepEqual(
    quotedSet(cli, /ALLOWED_ACTIONS = \{\n([^]+?)\n\}/, 'queue CLI'),
    [...CONTRACT_ACTIONS].sort(),
  );

  const dashboard = await readFile(new URL('../../Devices/sandbox/dashboard_api.py', import.meta.url), 'utf8');
  assert.deepEqual(
    quotedSet(dashboard, /ALLOWED_DEVICE_ACTIONS = frozenset\({\n([^]+?)\n\}\)/, 'sandbox dashboard'),
    [...CONTRACT_ACTIONS].sort(),
  );
  for (const configPath of ['devices.json', 'devices.emulator.json']) {
    const config = JSON.parse(await readFile(
      new URL('../../Devices/sandbox/' + configPath, import.meta.url), 'utf8',
    ));
    assert.deepEqual([...config.allowed_commands].sort(), [...CONTRACT_ACTIONS].sort(),
      configPath + ' action policy drifted from runtime contract');
  }
});

t('queued params become the payload the broker actually delivers, never top-level entry fields', () => {
  // poll and claim hand the device `entry.payload` and nothing else. Spread at the top level,
  // a queued timeout_seconds never reached the phone, and a param named leaseUntil or
  // claimToken sat beside the lease fields the broker writes onto the same entry.
  const item = commandItem('wa-media-push', 'NORMAL', { timeout_seconds: 900, leaseUntil: 'x' }, 'now');
  assert.deepEqual(item.payload, { timeout_seconds: 900, leaseUntil: 'x' });
  assert.equal(Object.hasOwn(item, 'timeout_seconds'), false);
  assert.equal(Object.hasOwn(item, 'leaseUntil'), false);
});

t('both Python queue writers quote hyphenated command ids and queue params as the payload', () => {
  // firestore_mcp.py put `commandQueue.mcp_<ts>_wa-push` into updateMask unquoted, so
  // Firestore answered 400 and trigger_wa_sync failed on every call.
  const out = runPython(`
legacy = load("Database/firestore_mcp.py")
connect = load("Integrations/s24-connect-mcp/server.py")
calls = []
def record(method, path, body=None):
    calls.append({"path": path, "body": body})
    return {}
legacy._fs_request = record
connect._fs_request = record
legacy.trigger_wa_sync()
legacy.s24_queue_command("sync", '{"timeout_seconds": 600}')
connect.device_send("wa-media-push", params_json='{"timeout_seconds": 900}')
print(json.dumps({
    "calls": calls,
    "legacyMask": legacy._mask_path("commandQueue.fresh-sync-1.status"),
}))
`);
  assert.equal(out.legacyMask, 'commandQueue.`fresh-sync-1`.status');
  assert.equal(out.calls.length, 3);
  for (const call of out.calls) {
    const query = new URLSearchParams(call.path.split('?')[1]);
    for (const fieldPath of query.getAll('updateMask.fieldPaths')) {
      for (const segment of fieldPath.split('.')) {
        assert.match(segment, /^(?:[A-Za-z_][A-Za-z0-9_]*|`[^`]+`)$/,
          `unquoted Firestore field-path segment ${segment} in ${fieldPath}`);
      }
    }
    const queued = Object.values(call.body.fields.commandQueue.mapValue.fields)[0].mapValue.fields;
    assert.equal(Object.hasOwn(queued, 'timeout_seconds'), false, 'params must not sit at the top level');
    assert.ok(queued.payload && queued.payload.mapValue, 'every queued command carries a payload map');
  }
  assert.equal(out.calls[0].body.fields.commandQueue.mapValue.fields[
    Object.keys(out.calls[0].body.fields.commandQueue.mapValue.fields)[0]].mapValue.fields.action.stringValue, 'wa-push');
  const payloadOf = (call) => Object.values(call.body.fields.commandQueue.mapValue.fields)[0]
    .mapValue.fields.payload.mapValue.fields;
  // Firestore REST accepts integerValue as a number or its canonical string form.
  const timeoutOf = (call) => Number(payloadOf(call).timeout_seconds.integerValue);
  assert.deepEqual(Object.keys(payloadOf(out.calls[1])), ['timeout_seconds']);
  assert.equal(timeoutOf(out.calls[1]), 600);
  assert.deepEqual(Object.keys(payloadOf(out.calls[2])), ['timeout_seconds']);
  assert.equal(timeoutOf(out.calls[2]), 900);
});

t('the jp-agent tool imports the shared gate instead of its own judgement', async () => {
  const js = await readFile(new URL('../../Server/jp-agent/s24-tools.mjs', import.meta.url), 'utf8');
  assert.match(js, /device-health\.mjs(?:'[^']*|[^']*?)actionGateError/);
  assert.match(js, /const gate = actionGateError\(action\);/, 'device_send must gate before writing');
  assert.doesNotMatch(js, /e\.g\. 'sync-now', 'status-only', 'start-ssh'/, 'tool description must stop advertising start-ssh');
});

t('the standalone jp-agent MCP uses the same shared gate before writing', async () => {
  const js = await readFile(new URL('../../Server/jp-agent/s24-mcp-server.mjs', import.meta.url), 'utf8');
  assert.match(js, /device-health\.mjs';[^\n]*actionGateError|device-health\.mjs';/,
    'standalone MCP must import device-health.mjs');
  assert.match(js, /const gate = actionGateError\(action\);/, 'standalone device_send must gate before writing');
  assert.match(js, /action: item\.action/, 'standalone response must report the canonical queued action');
  assert.doesNotMatch(js, /'start-ssh'\)?\. Queued/, 'standalone device_send must stop advertising start-ssh');
  assert.doesNotMatch(js, /e\.g\. 'sync-now', 'status-only', 'start-ssh'/, 'standalone description still advertises start-ssh');
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
