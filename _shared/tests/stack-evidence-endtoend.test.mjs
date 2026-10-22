// From "CI published a receipt" to "the panel accepted it".
//
// The verifier, the publisher and the panel's two evidence probes were each
// tested on their own. The seam BETWEEN them was not: the publisher writes
// its subjects under one key (`runtimeContract`, `migrationTooling`) and the
// panel reads them under those keys, and a single wrong character in that
// map would leave the row unproven with a reason that said "no CI evidence
// has been published" while a perfectly good receipt sat in the store.
//
// This runs the publisher's encoder, the panel's decoder and the panel's own
// probes over one receipt, and checks the panel accepts it - and refuses it
// for the right reasons when the revision or the device is wrong.

import assert from 'node:assert/strict';

import { encodeValue } from '../../scripts/stack-evidence-publish.mjs';
import { decodeFirestoreDocument } from '../../Backend/jp-devices.js';
import { signBody, REQUIRED_CHECKS } from '../../Backend/lib/stack-evidence.js';
import { SUBJECTS, S24_CONTRACT } from '../../Backend/lib/stack-subjects.js';
import { probeRuntimeContract, probeMigrationTooling } from '../../Backend/jp-stack.js';

const KEY = 'test-signing-key';
const NOW = Date.now();
const REVISION = 'd'.repeat(40);

process.env['STACK_' + 'EVIDENCE_KEY'] = KEY;

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

/** Exactly what the publisher writes for one subject. */
function publishedBundle(subject, key, revision = REVISION) {
  const body = {
    subject,
    digest: SUBJECTS[subject].digest,
    revision,
    workflow: 'evidence-publish',
    producer: 'github-actions:evidence-publish',
    run_id: '4242',
    result: 'pass',
    produced_at: new Date(NOW - 60000).toISOString(),
    expires_at: new Date(NOW + 90 * 86400000).toISOString(),
    checks: Object.fromEntries(REQUIRED_CHECKS[subject].map((c) => [c, 'pass'])),
  };
  const receipt = { ...body, signature: signBody(body, KEY) };
  // The publisher's field name for this subject, and the panel's read of it.
  const encoded = encodeValue({ revisions: { [revision]: receipt } });
  return decodeFirestoreDocument({ fields: { [key]: encoded } });
}

// The device, as the broker stamps it: the contracted release, exactly.
const attestedDevice = {
  'samsung-s24-ultra': { status: 'ok', mins: 1, agentVersion: S24_CONTRACT.release },
};

t('the migration-tooling row goes green on a published receipt', () => {
  const receipts = publishedBundle('migration-tooling', 'migrationTooling');
  const probe = probeMigrationTooling({ evidence: { available: true, receipts }, revision: REVISION, nowMs: NOW });
  assert.equal(probe.status, 'ok', 'the panel refused a published receipt: ' + probe.problem);
});

t('the runtime-contract row goes green on a published receipt and an attested device', () => {
  const receipts = publishedBundle('runtime-contract', 'runtimeContract');
  const probe = probeRuntimeContract({
    evidence: { available: true, receipts },
    revision: REVISION,
    nowMs: NOW,
    devices: { byDevice: attestedDevice },
  });
  assert.equal(probe.status, 'ok', 'the panel refused a published receipt: ' + probe.problem);
});

t('a receipt for another revision leaves the row unproven', () => {
  const receipts = publishedBundle('migration-tooling', 'migrationTooling', 'e'.repeat(40));
  const probe = probeMigrationTooling({ evidence: { available: true, receipts }, revision: REVISION, nowMs: NOW });
  assert.equal(probe.status, 'unknown');
  assert.match(probe.problem, /no CI evidence has been published/);
});

t('the runtime-contract row stays unproven while the device is not attested', () => {
  const receipts = publishedBundle('runtime-contract', 'runtimeContract');
  const probe = probeRuntimeContract({
    evidence: { available: true, receipts },
    revision: REVISION,
    nowMs: NOW,
    devices: { byDevice: { 'samsung-s24-ultra': { status: 'fail', mins: 4000 } } },
  });
  assert.equal(probe.status, 'unknown');
  assert.match(probe.problem, /has not attested the runtime contract/);
});

t('a device running the wrong release is not the contracted device', () => {
  const receipts = publishedBundle('runtime-contract', 'runtimeContract');
  const probe = probeRuntimeContract({
    evidence: { available: true, receipts },
    revision: REVISION,
    nowMs: NOW,
    devices: { byDevice: { 'samsung-s24-ultra': { status: 'ok', mins: 1, agentVersion: 's24-termux-https-worker-2026-07-27.1' } } },
  });
  assert.equal(probe.status, 'unknown');
  assert.match(probe.problem, /not the contracted release/);
});

t('a receipt signed with another key is refused', () => {
  const body = {
    subject: 'migration-tooling',
    digest: SUBJECTS['migration-tooling'].digest,
    revision: REVISION,
    workflow: 'evidence-publish',
    producer: 'github-actions:evidence-publish',
    run_id: '4242',
    result: 'pass',
    produced_at: new Date(NOW - 60000).toISOString(),
    expires_at: new Date(NOW + 90 * 86400000).toISOString(),
    checks: Object.fromEntries(REQUIRED_CHECKS['migration-tooling'].map((c) => [c, 'pass'])),
  };
  const receipt = { ...body, signature: signBody(body, 'another-key') };
  const encoded = encodeValue({ revisions: { [REVISION]: receipt } });
  const receipts = decodeFirestoreDocument({ fields: { migrationTooling: encoded } });
  const probe = probeMigrationTooling({ evidence: { available: true, receipts }, revision: REVISION, nowMs: NOW });
  assert.equal(probe.status, 'unknown');
  assert.match(probe.problem, /signature does not verify/);
});

console.log('\n  ' + pass + '/' + total + ' passed');
