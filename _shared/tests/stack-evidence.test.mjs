// The evidence that proves the two rows a serverless function cannot probe.
//
// `Devices/S24/runtime_contract.json` and `Database/scripts/migrate.mjs` used
// to sit on a probe that answered "unknown" forever. The proof now comes from
// a protected CI job and arrives as a signed receipt — and a receipt is only
// evidence if it cannot be forged, aimed at the wrong subject, replayed from
// an older revision or read after it expired.
//
// These pin every way that has to fail closed.

import assert from 'node:assert/strict';
import { verifyReceipt, signBody, canonicalBody, digestOf, REQUIRED_CHECKS } from '../../Backend/lib/stack-evidence.js';
import { SUBJECTS, S24_CONTRACT } from '../../Backend/lib/stack-subjects.js';

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const KEY = 'test-signing-key';
const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const REVISION = 'a'.repeat(40);

function receiptFor(subject, overrides = {}) {
  const body = {
    subject,
    digest: SUBJECTS[subject].digest,
    revision: REVISION,
    workflow: 'evidence-publish',
    producer: 'github-actions:evidence-publish',
    run_id: '12345',
    result: 'pass',
    produced_at: new Date(NOW - 3600000).toISOString(),
    expires_at: new Date(NOW + 30 * 86400000).toISOString(),
    checks: Object.fromEntries(REQUIRED_CHECKS[subject].map((c) => [c, 'pass'])),
    ...overrides,
  };
  return { ...body, signature: signBody(body, KEY) };
}

t('a subject digest is stable and covers every file', () => {
  const files = [{ path: 'b', sha256: '22' }, { path: 'a', sha256: '11' }];
  assert.equal(digestOf(files), digestOf([...files].reverse()), 'the order of the file list must not matter');
  assert.notEqual(digestOf(files), digestOf([{ path: 'a', sha256: '11' }]), 'a missing file changes the digest');
  assert.match(SUBJECTS['runtime-contract'].digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(SUBJECTS['migration-tooling'].digest, /^sha256:[0-9a-f]{64}$/);
});

t('a missing receipt keeps the row unproven', () => {
  const r = verifyReceipt(null, 'runtime-contract', { nowMs: NOW, key: KEY, expectedRevision: REVISION });
  assert.equal(r.valid, false);
  assert.match(r.reason, /no CI evidence/);
});

t('an unsigned receipt is not evidence', () => {
  const receipt = receiptFor('runtime-contract');
  delete receipt.signature;
  const r = verifyReceipt(receipt, 'runtime-contract', {
    nowMs: NOW, key: KEY, expectedRevision: REVISION,
  });
  assert.equal(r.valid, false, 'a receipt with no signature must never be trusted');
  assert.match(r.reason, /unsigned/);
});

t('an altered receipt does not verify', () => {
  const receipt = receiptFor('runtime-contract');
  receipt.result = 'pass';
  receipt.checks['contract-bundle-digest'] = 'fail';
  const r = verifyReceipt(receipt, 'runtime-contract', { nowMs: NOW, key: KEY, expectedRevision: REVISION });
  assert.equal(r.valid, false);
  assert.match(r.reason, /signature does not verify/);
});

t('a receipt signed with another key does not verify', () => {
  const receipt = receiptFor('runtime-contract');
  receipt.signature = signBody({ ...receipt, signature: undefined }, 'a-different-key');
  const r = verifyReceipt(receipt, 'runtime-contract', { nowMs: NOW, key: KEY, expectedRevision: REVISION });
  assert.equal(r.valid, false);
});

t('a receipt for another subject is refused', () => {
  const r = verifyReceipt(receiptFor('migration-tooling'), 'runtime-contract', {
    nowMs: NOW, key: KEY, expectedRevision: REVISION,
  });
  assert.equal(r.valid, false);
  assert.match(r.reason, /not "runtime-contract"/);
});

t('a receipt for changed subject bytes is refused', () => {
  const r = verifyReceipt(receiptFor('runtime-contract', { digest: 'sha256:' + '0'.repeat(64) }), 'runtime-contract', {
    nowMs: NOW, key: KEY, expectedRevision: REVISION,
  });
  assert.equal(r.valid, false);
  assert.match(r.reason, /has changed since the evidence was produced/);
});

t('a receipt for another revision is refused', () => {
  const r = verifyReceipt(receiptFor('runtime-contract'), 'runtime-contract', {
    nowMs: NOW, key: KEY, expectedRevision: 'b'.repeat(40),
  });
  assert.equal(r.valid, false);
  assert.match(r.reason, /not the running revision/);
});

t('an expired receipt is refused', () => {
  const expired = receiptFor('runtime-contract', { expires_at: new Date(NOW - 1000).toISOString() });
  const r = verifyReceipt(expired, 'runtime-contract', { nowMs: NOW, key: KEY, expectedRevision: REVISION });
  assert.equal(r.valid, false);
  assert.match(r.reason, /expired/);
});

t('a receipt dated in the future is refused', () => {
  const future = receiptFor('runtime-contract', { produced_at: new Date(NOW + 60000).toISOString() });
  const r = verifyReceipt(future, 'runtime-contract', { nowMs: NOW, key: KEY, expectedRevision: REVISION });
  assert.equal(r.valid, false);
  assert.match(r.reason, /future production time/);
});

t('a receipt from an untrusted workflow is refused', () => {
  const r = verifyReceipt(receiptFor('runtime-contract', { workflow: 'somebody-else' }), 'runtime-contract', {
    nowMs: NOW, key: KEY, expectedRevision: REVISION,
  });
  assert.equal(r.valid, false);
  assert.match(r.reason, /not produced by a trusted workflow/);
});

t('a receipt missing one of its named checks is refused', () => {
  const checks = { ...Object.fromEntries(REQUIRED_CHECKS['migration-tooling'].map((c) => [c, 'pass'])) };
  delete checks['second-run-noop'];
  const r = verifyReceipt(receiptFor('migration-tooling', { checks }), 'migration-tooling', {
    nowMs: NOW, key: KEY, expectedRevision: REVISION,
  });
  assert.equal(r.valid, false);
  assert.match(r.reason, /second-run-noop/);
});

t('a complete receipt verifies', () => {
  for (const subject of ['runtime-contract', 'migration-tooling']) {
    const r = verifyReceipt(receiptFor(subject), subject, { nowMs: NOW, key: KEY, expectedRevision: REVISION });
    assert.equal(r.valid, true, subject + ': ' + r.reason);
    assert.match(r.reason, /CI evidence verified/);
  }
});

t('a receipt with no verification key is refused, not waved through', () => {
  const r = verifyReceipt(receiptFor('runtime-contract'), 'runtime-contract', {
    nowMs: NOW, key: '', expectedRevision: REVISION,
  });
  assert.equal(r.valid, false);
  assert.match(r.reason, /verification key is not configured/);
});

t('the canonical body is stable under key order', () => {
  const a = { subject: 'x', result: 'pass', checks: { b: 'pass', a: 'pass' } };
  const b = { checks: { a: 'pass', b: 'pass' }, result: 'pass', subject: 'x' };
  assert.equal(canonicalBody(a), canonicalBody(b));
  assert.equal(signBody(a, KEY), signBody(b, KEY));
});

t('the pinned contract facts come from the device runtime contract', () => {
  // These are lifted out of Devices/S24/runtime_contract.json by the generator,
  // so the panel's expectation of the device cannot drift from the contract
  // the device actually runs.
  assert.equal(S24_CONTRACT.device_id, 'samsung-s24-ultra');
  assert.equal(S24_CONTRACT.connection_method, 'signed-broker-v2');
  assert.ok(S24_CONTRACT.job_scheduler_period_ms > 0);
  assert.match(S24_CONTRACT.release, /^s24-termux-broker-/);
});

console.log('\n  ' + pass + '/' + total + ' passed');
