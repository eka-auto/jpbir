// A receipt must survive the trip from the publisher to the panel.
//
// The publisher writes a receipt into Firestore as an encoded map; the panel
// reads it back and recomputes the signature over what it read. If anything
// about that round trip changed the bytes - a key order, a number that came
// back as a string, a nested object flattened - the signature would no longer
// verify, and the row would sit unproven with a reason that said "altered or
// forged receipt" about a receipt nobody forged.
//
// This runs the real encoder and the real decoder over a real body and
// checks that the panel accepts what the publisher wrote.

import assert from 'node:assert/strict';

import { encodeValue } from '../../scripts/stack-evidence-publish.mjs';
import { decodeFirestoreDocument } from '../../Backend/jp-devices.js';
import { verifyReceipt, signBody, REQUIRED_CHECKS } from '../../Backend/lib/stack-evidence.js';
import { SUBJECTS } from '../../Backend/lib/stack-subjects.js';

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const KEY = 'test-signing-key';
const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const REVISION = 'c'.repeat(40);

t('a published receipt reads back and still verifies', () => {
  const body = {
    subject: 'runtime-contract',
    digest: SUBJECTS['runtime-contract'].digest,
    revision: REVISION,
    workflow: 'evidence-publish',
    producer: 'github-actions:evidence-publish',
    run_id: '99999',
    result: 'pass',
    produced_at: new Date(NOW - 60000).toISOString(),
    expires_at: new Date(NOW + 90 * 86400000).toISOString(),
    checks: Object.fromEntries(REQUIRED_CHECKS['runtime-contract'].map((c) => [c, 'pass'])),
  };
  const receipt = { ...body, signature: signBody(body, KEY) };

  // The publisher's way in: an encoded Firestore map.
  const encoded = encodeValue({ revisions: { [REVISION]: receipt } });
  // The panel's way out: the decoded document.
  const decoded = decodeFirestoreDocument({ fields: { runtimeContract: encoded } });
  const read = decoded.runtimeContract.revisions[REVISION];

  assert.equal(read.subject, 'runtime-contract');
  assert.equal(read.revision, REVISION);
  assert.equal(read.result, 'pass');
  assert.equal(read.signature, receipt.signature);

  const verdict = verifyReceipt(read, 'runtime-contract', { nowMs: NOW, key: KEY, expectedRevision: REVISION });
  assert.equal(verdict.valid, true, 'the panel refused a receipt the publisher wrote: ' + verdict.reason);
});

t('a receipt altered after publication is still refused', () => {
  const body = {
    subject: 'migration-tooling',
    digest: SUBJECTS['migration-tooling'].digest,
    revision: REVISION,
    workflow: 'evidence-publish',
    producer: 'github-actions:evidence-publish',
    run_id: '99999',
    result: 'pass',
    produced_at: new Date(NOW - 60000).toISOString(),
    expires_at: new Date(NOW + 90 * 86400000).toISOString(),
    checks: Object.fromEntries(REQUIRED_CHECKS['migration-tooling'].map((c) => [c, 'pass'])),
  };
  const receipt = { ...body, signature: signBody(body, KEY) };
  const encoded = encodeValue({ revisions: { [REVISION]: receipt } });
  const decoded = decodeFirestoreDocument({ fields: { migrationTooling: encoded } });
  const read = decoded.migrationTooling.revisions[REVISION];

  // Someone with write access to the evidence document changes a check.
  read.checks['fresh-apply'] = 'fail';
  const verdict = verifyReceipt(read, 'migration-tooling', { nowMs: NOW, key: KEY, expectedRevision: REVISION });
  assert.equal(verdict.valid, false, 'an altered receipt must not verify');
  assert.match(verdict.reason, /signature does not verify/);
});

console.log('\n  ' + pass + '/' + total + ' passed');
