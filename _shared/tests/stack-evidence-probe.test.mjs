// The evidence probes must name the FIRST missing precondition.
//
// The panel says a row is unproven. That is true, and it is not useful: the
// operator has to guess which of several things is missing. Two defects made
// it worse.
//
// A 404 on the evidence document was reported as "the CI evidence store is
// unreachable". The store answered perfectly — the DOCUMENT does not exist
// yet, because no receipt has been published. The message sent the reader
// looking at the wrong thing.
//
// And the revision check ran after the evidence-store check, so a deployment
// that could not name its own revision would still be reported as an
// unreachable store, and the real blocker would stay invisible.
//
// These pin the order and the wording.

import assert from 'node:assert/strict';

import { evidencePrecondition, evidenceBundleFromResponse } from '../../Backend/jp-stack.js';

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const REVISION = 'a'.repeat(40);

t('a deployment that cannot name its revision says so first', () => {
  const reason = evidencePrecondition({ evidence: { available: true, receipts: {} } });
  assert.match(reason, /source revision is unknown/);
});

t('an unreadable evidence store is named second', () => {
  const reason = evidencePrecondition({
    revision: REVISION,
    evidence: { available: false, reason: 'the CI evidence store answered HTTP 500' },
  });
  assert.match(reason, /could not be read/);
  assert.match(reason, /HTTP 500/);
});

t('both preconditions present means no reason', () => {
  assert.equal(evidencePrecondition({ revision: REVISION, evidence: { available: true, receipts: {} } }), null);
});

t('a document that does not exist yet is not an unreachable store', () => {
  // The store answered. What is missing is the receipt nobody has published
  // yet, and that is a different thing to go and fix.
  const bundle = evidenceBundleFromResponse(404, {});
  assert.equal(bundle.available, true, 'the store answered, so it is available');
  assert.match(bundle.reason, /no CI evidence has been published yet/);
  assert.deepEqual(bundle.receipts, {});
});

t('a store that answers with an error is not available', () => {
  const bundle = evidenceBundleFromResponse(500, {});
  assert.equal(bundle.available, false);
  assert.match(bundle.reason, /answered HTTP 500/);
});

console.log('\n  ' + pass + '/' + total + ' passed');
