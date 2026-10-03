import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.STATS_KEY = 'read-only-key';
process.env.OPERATOR_KEY = 'operator-key';

const { checkOperatorKey } = await import('../../Backend/_auth.js');

assert.equal(checkOperatorKey({ headers: {}, query: {} }).code, 'operator_auth_missing');
assert.equal(checkOperatorKey({ headers: { 'x-operator-key': 'read-only-key' }, query: {} }).code, 'operator_auth_invalid');
assert.deepEqual(checkOperatorKey({ headers: { 'x-operator-key': 'operator-key' }, query: {} }), { ok: true });
assert.equal(checkOperatorKey({ headers: {}, query: { key: 'operator-key' } }).code, 'operator_auth_missing');

const route = readFileSync(join(ROOT, 'Backend', 'agent-run.js'), 'utf8');
const page = readFileSync(join(ROOT, 'Frontend', 'index.html'), 'utf8');
assert.match(route, /requireOperatorKey\(req, res\)/);
assert.doesNotMatch(route, /requireKey\(req, res\)/);
assert.match(page, /['"]x-operator-key['"]\s*:\s*operatorKey/);
assert.doesNotMatch(page, /authHeaders\([^)]*operator/i);

console.log('operator authentication verified');
