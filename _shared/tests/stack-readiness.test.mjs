// The strict readiness verdict, and the schedule behind it.
//
// The Product engineering panel's colours answer "what is the state of this
// subsystem right now". The release gate answers a different question: "can
// this exact candidate be released, and can that be PROVED". The two used to
// be the same field, and `overall` was computed as
// `fail ? fail : warn ? warn : ok` — so a snapshot with eight unproven rows
// and no failures read as "ok". The panel painted itself green over rows it
// could not prove, and the alert cron read "not fail" as "healthy" and could
// announce a recovery while the evidence was missing.
//
// These pin the separation.

import assert from 'node:assert/strict';
import {
  overallFor, verdictFor, readinessOf, scheduleState, evaluateAlertState,
  VERDICT_PASS, VERDICT_WARN, VERDICT_FAIL, VERDICT_UNPROVEN,
} from '../../Backend/lib/stack-readiness.js';

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const row = (path, status) => ({ path, status });

t('an unproven row is never summarised as healthy', () => {
  assert.equal(overallFor({ ok: 30, warn: 0, fail: 0, unknown: 8, total: 38 }), 'unknown',
    'eight rows with no evidence cannot read as "ok"');
  assert.equal(overallFor({ ok: 30, warn: 0, fail: 0, unknown: 0, total: 30 }), 'ok');
  assert.equal(overallFor({ ok: 30, warn: 1, fail: 0, unknown: 0, total: 31 }), 'warn');
  assert.equal(overallFor({ ok: 30, warn: 0, fail: 1, unknown: 0, total: 31 }), 'fail');
  // A failure outranks an unknown: the operator must see the failure first.
  assert.equal(overallFor({ ok: 30, warn: 0, fail: 1, unknown: 8, total: 39 }), 'fail');
});

t('the verdict vocabulary is pass, warn, fail or unproven — never a soft ok', () => {
  assert.equal(verdictFor('ok'), VERDICT_PASS);
  assert.equal(verdictFor('warn'), VERDICT_WARN);
  assert.equal(verdictFor('fail'), VERDICT_FAIL);
  assert.equal(verdictFor('unknown'), VERDICT_UNPROVEN);
});

t('readiness is not ready while any required row is unproven', () => {
  const files = [
    row('a', 'ok'), row('b', 'ok'), row('c', 'ok'),
    row('Devices/S24/runtime_contract.json', 'unknown'),
  ];
  const r = readinessOf(files, { asOf: '2026-10-22T00:00:00.000Z' });
  assert.equal(r.ready, false);
  assert.equal(r.verdict, VERDICT_UNPROVEN);
  assert.deepEqual(r.unproven_rows, ['Devices/S24/runtime_contract.json']);
  assert.equal(r.scope.rows_ok, 3);
  assert.equal(r.scope.rows_unproven, 1);
  assert.match(r.reason, /no usable evidence/);
});

t('readiness is ready only when every row is proven green', () => {
  const r = readinessOf([row('a', 'ok'), row('b', 'ok')], { asOf: '2026-10-22T00:00:00.000Z' });
  assert.equal(r.ready, true);
  assert.equal(r.verdict, VERDICT_PASS);
  assert.match(r.reason, /every required row is proven green \(2 rows\)/);
});

t('a warning keeps the gate closed and says which row', () => {
  // The acceptance bar for this release is zero failures, zero warnings and
  // zero unproven rows. A certificate with three days left is a fact an
  // operator needs before a release, not a footnote.
  const r = readinessOf([row('a', 'ok'), row('Frontend/index.html', 'warn')]);
  assert.equal(r.ready, false);
  assert.equal(r.verdict, VERDICT_WARN);
  assert.deepEqual(r.warned_rows, ['Frontend/index.html']);
});

t('a failure names itself', () => {
  const r = readinessOf([row('a', 'ok'), row('Backend/verify-db.js', 'fail')]);
  assert.equal(r.ready, false);
  assert.equal(r.verdict, VERDICT_FAIL);
  assert.deepEqual(r.failed_rows, ['Backend/verify-db.js']);
  assert.match(r.reason, /Backend\/verify-db\.js/);
});

t('a status the code does not understand counts as unproven', () => {
  // A typo in a probe must not be rewarded with a pass.
  const r = readinessOf([row('a', 'ok'), row('b', 'weird')]);
  assert.equal(r.verdict, VERDICT_UNPROVEN);
  assert.deepEqual(r.unproven_rows, ['b']);
});

t('the schedule reads as stale when the native receipt is missing', () => {
  const s = scheduleState(null, Date.now(), { cadenceMinutes: 5, maxAgeMinutes: 20 });
  assert.equal(s.present, false);
  assert.equal(s.stale, true);
  assert.match(s.reason, /no unattended run/);
});

t('the schedule reads as stale when the receipt is unreadable or in the future', () => {
  const now = Date.now();
  const unreadable = scheduleState({ checked_at: 'not-a-date' }, now);
  assert.equal(unreadable.stale, true);
  assert.match(unreadable.reason, /unreadable timestamp/);

  const future = scheduleState({ checked_at: new Date(now + 60000).toISOString() }, now);
  assert.equal(future.stale, true, 'a clock that runs ahead must not look alive');
  assert.match(future.reason, /future time/);
});

t('the schedule counts the runs it has missed', () => {
  const now = Date.parse('2026-10-22T12:00:00.000Z');
  const fresh = scheduleState({ checked_at: '2026-10-22T11:57:00.000Z' }, now, { cadenceMinutes: 5, maxAgeMinutes: 20 });
  assert.equal(fresh.present, true);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.age_minutes, 3);
  assert.equal(fresh.missed_runs, 0);

  const late = scheduleState({ checked_at: '2026-10-22T11:30:00.000Z' }, now, { cadenceMinutes: 5, maxAgeMinutes: 20 });
  assert.equal(late.stale, true);
  assert.equal(late.age_minutes, 30);
  assert.equal(late.missed_runs, 5);
  assert.match(late.reason, /has not run for 30 min/);
});

t('the alert state machine treats unproven as something to act on', () => {
  assert.equal(evaluateAlertState(VERDICT_FAIL, 'healthy').action, 'down');
  assert.equal(evaluateAlertState(VERDICT_UNPROVEN, 'healthy').action, 'down');
  assert.equal(evaluateAlertState(VERDICT_WARN, 'healthy').changed, false);
  assert.equal(evaluateAlertState(VERDICT_PASS, 'healthy').changed, false);
});

t('a failure that turns unproven is not a recovery', () => {
  const s = evaluateAlertState(VERDICT_UNPROVEN, 'alerted');
  assert.notEqual(s.action, 'recovered');
  assert.equal(s.changed, false);
  assert.equal(s.newState, 'alerted');
});

console.log('\n  ' + pass + '/' + total + ' passed');
