import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ALLOWED_ACTIONS, S24_DEVICE_ID, isAuthorized, validateCommand } from '../../Backend/s24-command.js';

const validToken = 'owner-dashboard-token';

function request(headers = {}) {
  return { headers };
}

assert.deepEqual(validateCommand({}), { device: S24_DEVICE_ID, action: 'sync-now' });
assert.deepEqual(validateCommand({ device: S24_DEVICE_ID, action: 'ping' }), {
  device: S24_DEVICE_ID,
  action: 'ping',
});
assert.match(validateCommand({ device: S24_DEVICE_ID, action: 'heartbeat' }).error, /action must be one of/);
assert.equal(ALLOWED_ACTIONS.has('start-ssh'), false);
assert.equal(ALLOWED_ACTIONS.has('update-and-restart'), false);
assert.equal(validateCommand({ device: 'jayti-asus-vivobook', action: 'sync-now' }).error, 'device must be samsung-s24-ultra');
assert.match(validateCommand({ action: 'run-shell' }).error, /action must be one of/);
assert.equal(isAuthorized(request({ authorization: `Bearer ${validToken}` }), validToken), true);
assert.equal(isAuthorized(request({ authorization: `Bearer ${validToken}x` }), validToken), false);
assert.equal(isAuthorized(request({}), validToken), false);

console.log('s24-command contract tests passed');

// ── allowlist is a pinned contract ──────────────────────────────────────
// The remote command allowlist is the S24's blast radius. PR #32 once
// silently reverted auth on nearby WhatsApp routes with every check green, so
// pin the exact set: a new action can't slip in, and an approved one (e.g.
// wa-media-push, which maps to one fixed on-device wrapper) can't be dropped,
// without this test failing. Keep it in lockstep with device_agent.py's
// handle_command and Devices/S24/runtime_contract.json.
const runtimeContract = JSON.parse(await readFile(
  new URL('../../Devices/S24/runtime_contract.json', import.meta.url), 'utf8',
));
assert.deepEqual(
  [...ALLOWED_ACTIONS].sort(),
  [...runtimeContract.command.allowlistedActions].sort(),
  'ALLOWED_ACTIONS drifted — update device_agent.py + runtime_contract.json + this pin together',
);
// Extraction/destruction actions must never be remotely triggerable here.
for (const forbidden of ['start-ssh', 'update-and-restart', 'run-shell', 'wipe', 'reset', 'location', 'network-scan']) {
  assert.equal(ALLOWED_ACTIONS.has(forbidden), false, `${forbidden} must not be allowlisted`);
}

console.log('s24-command allowlist pin tests passed');
