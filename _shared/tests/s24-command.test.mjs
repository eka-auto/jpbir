import assert from 'node:assert/strict';
import { ALLOWED_ACTIONS, S24_DEVICE_ID, isAuthorized, validateCommand } from '../../Backend/s24-command.js';

const validToken = 'owner-dashboard-token';

function request(headers = {}) {
  return { headers };
}

assert.deepEqual(validateCommand({}), { device: S24_DEVICE_ID, action: 'sync-now' });
assert.deepEqual(validateCommand({ device: S24_DEVICE_ID, action: 'heartbeat' }), {
  device: S24_DEVICE_ID,
  action: 'heartbeat',
});
assert.equal(ALLOWED_ACTIONS.has('start-ssh'), false);
assert.equal(ALLOWED_ACTIONS.has('update-and-restart'), false);
assert.equal(validateCommand({ device: 'jayti-asus-vivobook', action: 'sync-now' }).error, 'device must be samsung-s24-ultra');
assert.match(validateCommand({ action: 'run-shell' }).error, /action must be one of/);
assert.equal(isAuthorized(request({ authorization: `Bearer ${validToken}` }), validToken), true);
assert.equal(isAuthorized(request({ authorization: `Bearer ${validToken}x` }), validToken), false);
assert.equal(isAuthorized(request({}), validToken), false);

console.log('s24-command contract tests passed');
