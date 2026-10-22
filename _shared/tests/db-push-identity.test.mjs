// The identity action must name the DATABASE, not only the AWS account.
//
// The credential that opens the production warehouse is a Vercel Secret, so
// nothing outside the deployment can read it. That is how two different Neon
// copies both looked authoritative: the local .env.local and the repository's
// DATABASE_URL secret pointed at a copy frozen on 2026-10-09, while
// production read a live one, and every local analysis of "the warehouse" was
// an analysis of the wrong database.
//
// The database can answer for itself - Neon publishes its project, branch and
// endpoint as session settings - so the identity is read from the connection
// rather than remembered by somebody.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(ROOT, 'Backend', 'db-push.js'), 'utf8');
const action = source.slice(source.indexOf("action === 'identity'"), source.indexOf("action === 'push'"));

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

t('the identity action reports the database as well as the account', () => {
  assert.match(action, /postgres/, 'the response must carry the database identity');
  assert.match(action, /current_setting\('neon\.project_id'/);
  assert.match(action, /current_setting\('neon\.branch_id'/);
  assert.match(action, /current_setting\('neon\.endpoint_id'/);
  assert.match(action, /current_database\(\)/);
});

t('a database that cannot be asked says so instead of failing the call', () => {
  assert.match(action, /configured: false/, 'a failure must be reported, not thrown');
  assert.match(action, /catch \(e\)/);
});

t('the identity action is still behind the credential gate', () => {
  const before = source.slice(0, source.indexOf("action === 'identity'"));
  assert.match(before, /if \(!cronAuthorized\(req\) && !secretEquals\(/);
});

console.log('\n  ' + pass + '/' + total + ' passed');
