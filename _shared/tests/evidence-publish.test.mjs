// The report the publisher reads, and the shape it is written in.
//
// The publication failed on 2026-10-21 with "the check report has no entry
// for runtime-contract" while every proof on the page was green: the merge
// step wrote a subject's checks under `checks` and the publisher looked for
// them at the top level. Two places defining one shape, and they had never
// met.
//
// The shape now lives in scripts/stack-merge-checks.mjs and the publisher
// reads it through the functions under test. These pin the two halves against
// each other, so the next change of shape breaks a test instead of a
// publication.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { subjectChecksFrom, subjectResult } from '../../scripts/stack-evidence-publish.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const dir = mkdtempSync(join(tmpdir(), 'jpbir-merge-'));
const write = (name, body) => {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(body, null, 2), 'utf8');
  return path;
};

t('the merge script writes a report the publisher can read', () => {
  const runtime = write('runtime-contract.json', {
    subject: 'runtime-contract',
    checks: { 'contract-bundle-digest': 'pass', 'contract-schema-valid': 'pass', 'device-bundle-syntax': 'pass' },
    notes: [],
  });
  const migration = write('migration-tooling.json', {
    subject: 'migration-tooling',
    checks: { 'fresh-apply': 'pass', 'second-run-noop': 'pass', 'ledger-match': 'pass' },
    notes: [],
  });
  const ledger = write('ledger.json', {
    subject: 'migration-tooling',
    checks: { 'ledger-reconciliation': 'pass' },
    notes: ['the shared ledger holds 24 migration name(s)'],
  });
  const out = join(dir, 'checks.json');

  execFileSync(process.execPath, [join(ROOT, 'scripts', 'stack-merge-checks.mjs'), runtime, migration, ledger, out], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(report.result, 'pass');
  assert.equal(report.notes.length, 1);
  // The two halves meet here: what the merge wrote, the publisher reads.
  assert.deepEqual(subjectChecksFrom(report, 'runtime-contract'), {
    'contract-bundle-digest': 'pass', 'contract-schema-valid': 'pass', 'device-bundle-syntax': 'pass',
  });
  assert.deepEqual(subjectChecksFrom(report, 'migration-tooling'), {
    'fresh-apply': 'pass', 'second-run-noop': 'pass', 'ledger-match': 'pass', 'ledger-reconciliation': 'pass',
  });
});

t('a report without a subject is refused rather than published empty', () => {
  assert.throws(() => subjectChecksFrom({ checks: { 'migration-tooling': { 'fresh-apply': 'pass' } } }, 'runtime-contract'),
    /no entry for runtime-contract/);
  assert.throws(() => subjectChecksFrom({ checks: { 'runtime-contract': {} } }, 'runtime-contract'),
    /no entry for runtime-contract/);
});

t('a subject result is pass only when every check passed', () => {
  assert.equal(subjectResult({ a: 'pass', b: 'pass' }), 'pass');
  assert.equal(subjectResult({ a: 'pass', b: 'fail' }), 'fail');
  assert.equal(subjectResult({ a: 'absent' }), 'fail');
});

t('the merge script fails when a proof did not pass', () => {
  const runtime = write('bad-runtime.json', { subject: 'runtime-contract', checks: { 'contract-bundle-digest': 'fail' }, notes: [] });
  const migration = write('ok-migration.json', { subject: 'migration-tooling', checks: { 'fresh-apply': 'pass' }, notes: [] });
  const ledger = write('ok-ledger.json', { subject: 'migration-tooling', checks: { 'ledger-reconciliation': 'pass' }, notes: [] });
  const out = join(dir, 'bad-checks.json');
  let failed = false;
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'stack-merge-checks.mjs'), runtime, migration, ledger, out], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    failed = true;
    assert.match(String(e.stderr), /at least one proof did not pass/);
  }
  assert.equal(failed, true, 'a failing proof must fail the merge');
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(report.result, 'fail');
});

rmSync(dir, { recursive: true, force: true });
console.log('\n  ' + pass + '/' + total + ' passed');
