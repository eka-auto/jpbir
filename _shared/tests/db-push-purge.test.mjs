// The purge action on /api/db-push.
//
// A destructive operation on the production warehouse belongs in the
// application that holds the credential, and a destructive operation deserves
// a test that says exactly what it touches. These pin the scope: the tracked
// property and nothing else, the same filter as the repair, the journal
// cleaned with that same filter, and the same credential gate as the rest of
// the route.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TRACKED_PROPERTY } from '../../Backend/lib/warehouse.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(ROOT, 'Backend', 'db-push.js'), 'utf8');

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const action = source.slice(source.indexOf("action === 'purge'"), source.indexOf("action === 'push'"));

t('the purge action exists and is on the db-push route', () => {
  assert.ok(action.length > 0, 'no purge action found');
  assert.ok(source.includes("if (action === 'purge')"));
});

t('it deletes from the three site-scoped tables', () => {
  for (const table of ['events', 'sessions', 'visitors']) {
    assert.match(action, new RegExp('DELETE FROM ' + table), 'no delete against ' + table);
  }
});

t('it deletes only what is not the tracked property', () => {
  assert.equal(TRACKED_PROPERTY, 'jaytibirthday.in');
  const deletes = action.match(/DELETE FROM \w+ WHERE site <> \$1/g) || [];
  assert.equal(deletes.length, 3, 'every delete must be scoped to the tracked property');
  assert.ok(action.includes('[TRACKED_PROPERTY]'), 'the scope must be the tracked property, not a literal');
});

t('it records the purge in the shared ledger', () => {
  assert.match(action, /INSERT INTO schema_migrations/);
  assert.match(action, /016_purge_non_birthday_analytics\.sql/);
});

t('it purges the journal with the same filter, so the repair cannot undo it', () => {
  assert.match(action, /DeleteCommand/);
  assert.match(action, /host === TRACKED_PROPERTY/);
  assert.match(action, /journalDeleted/);
});

t('it reports what it deleted', () => {
  assert.match(action, /before/);
  assert.match(action, /after/);
  assert.match(action, /deleted:/);
});

t('the whole route stays behind the credential gate', () => {
  // The purge is a destructive action on production data, so it must not be
  // reachable without one of the two credentials the route already demands.
  const gate = source.slice(0, source.indexOf('const action ='));
  assert.match(gate, /cronAuthorized\(req\)/);
  assert.match(gate, /secretEquals\(/);
  const beforeGate = source.slice(0, source.indexOf("action === 'purge'"));
  assert.match(beforeGate, /if \(!cronAuthorized\(req\) && !secretEquals\(/,
    'the route must refuse an unauthenticated request before it reaches the purge');
});

console.log('\n  ' + pass + '/' + total + ' passed');
