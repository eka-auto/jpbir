// Strict readiness for the Product engineering panel.
//
// The panel's colours answer "what is the state of this subsystem right now".
// The release gate answers a different question: "can this exact candidate be
// released, and can that claim be PROVED". The two used to be the same field.
//
// `overall` was computed as `fail ? fail : warn ? warn : ok`, so a snapshot
// with eight unproven rows and no failures read as "ok". The panel painted
// itself green, the navigation dot said the same thing, and the alert cron
// read "not fail" as "healthy" and could announce a recovery while eight
// rows had no evidence at all. That is the false-green this module exists to
// remove.
//
// Two verdicts, kept apart on purpose:
//
//   - `overall` is the worst status any row carries, INCLUDING unknown. A
//     subsystem nobody could reach is not the same as a healthy one, and
//     collapsing the two is what made the panel claim more than it knew.
//   - `readiness.verdict` is the release-facing answer: 'pass', 'warn',
//     'fail' or 'unproven'. It is never 'pass' while a required row is
//     unproven, and `readiness.ready` is true only when every required row is
//     proven green.
//
// Everything here is pure: no clock, no network, no environment. The caller
// passes `now`. A readiness verdict that depended on the machine that
// computed it could not be replayed from an evidence record later, and this
// repo has already shipped one verdict that could not be.

export const OK = 'ok';
export const FAIL = 'fail';
export const WARN = 'warn';
export const UNKNOWN = 'unknown';

/** Worst-of, so a layer is only as green as its weakest file. */
const RANK = { [FAIL]: 3, [WARN]: 2, [UNKNOWN]: 1, [OK]: 0 };

export function worstOf(statuses) {
  return (statuses || []).reduce((acc, s) => (RANK[s] > RANK[acc] ? s : acc), OK);
}

/**
 * The headline status of a set of rows.
 *
 * Unknown is not a soft pass: a row whose evidence is missing is a failure of
 * proof, and a summary that hides it behind "ok" is exactly the claim the
 * contract's rule 1 forbids ("never treated as a pass").
 */
export function overallFor(summary) {
  if (!summary) return UNKNOWN;
  if (Number(summary.fail) > 0) return FAIL;
  if (Number(summary.warn) > 0) return WARN;
  if (Number(summary.unknown) > 0) return UNKNOWN;
  return OK;
}

export const VERDICT_PASS = 'pass';
export const VERDICT_WARN = 'warn';
export const VERDICT_FAIL = 'fail';
export const VERDICT_UNPROVEN = 'unproven';

/** Map a status onto the release-facing verdict vocabulary. */
export function verdictFor(overall) {
  if (overall === OK) return VERDICT_PASS;
  if (overall === WARN) return VERDICT_WARN;
  if (overall === FAIL) return VERDICT_FAIL;
  return VERDICT_UNPROVEN;
}

/** Accepts the old 'ok'/'unknown' spellings as well as the verdict names. */
export function normalizeVerdict(value) {
  if (value === VERDICT_PASS || value === OK) return VERDICT_PASS;
  if (value === VERDICT_WARN || value === WARN) return VERDICT_WARN;
  if (value === VERDICT_FAIL || value === FAIL) return VERDICT_FAIL;
  return VERDICT_UNPROVEN;
}

/**
 * The strict readiness of a set of mapped rows.
 *
 * `files` are the flattened stack-map rows ({ path, status, ... }). Every
 * status that is not ok, warn or fail counts as unproven: a row that reported
 * something this code does not understand is not evidence, and treating an
 * unfamiliar status as a pass would be the same lie with a new label.
 *
 * `ready` is deliberately stricter than "no failures". The acceptance bar for
 * this release is zero failed, zero warning and zero unproven rows, so a
 * warning keeps the gate closed as well — a certificate with three days left
 * is a fact an operator needs to act on before a release, not a footnote.
 */
export function readinessOf(files, options = {}) {
  const rows = files || [];
  const failed = [];
  const warned = [];
  const unproven = [];
  let ok = 0;

  for (const f of rows) {
    const status = f && f.status;
    if (status === OK) { ok++; continue; }
    if (status === FAIL) { failed.push(f.path); continue; }
    if (status === WARN) { warned.push(f.path); continue; }
    unproven.push(f.path);
  }

  const summary = { ok, warn: warned.length, fail: failed.length, unknown: unproven.length, total: rows.length };
  const overall = overallFor(summary);
  const verdict = verdictFor(overall);
  const ready = verdict === VERDICT_PASS;

  let reason;
  if (ready) {
    reason = 'every required row is proven green (' + summary.total + ' rows)';
  } else if (verdict === VERDICT_FAIL) {
    reason = failed.length + ' required row(s) failed: ' + failed.join(', ');
  } else if (verdict === VERDICT_UNPROVEN) {
    reason = unproven.length + ' required row(s) have no usable evidence: ' + unproven.join(', ');
  } else {
    reason = warned.length + ' required row(s) are warnings: ' + warned.join(', ');
  }

  return {
    ready,
    verdict,
    overall,
    reason,
    scope: {
      rows_total: summary.total,
      rows_ok: summary.ok,
      rows_warn: summary.warn,
      rows_fail: summary.fail,
      rows_unproven: summary.unknown,
    },
    failed_rows: failed,
    warned_rows: warned,
    unproven_rows: unproven,
    as_of: options.asOf || null,
  };
}

/**
 * The state of the unattended schedule, judged from the last run the
 * scheduler itself recorded.
 *
 * A manual run must never refresh this: R3 of the plan says "manual runs
 * cannot refresh proof of an unattended schedule", so the caller must pass the
 * NATIVE receipt only. A browser polling the panel proves the browser works,
 * not that anything runs while the browser is closed.
 *
 * A receipt dated in the future is treated as missing rather than fresh: a
 * clock that runs ahead (or a writer that sets its own timestamp) must not be
 * able to make a dead scheduler look alive.
 */
export function scheduleState(receipt, nowMs, options = {}) {
  const cadenceMinutes = Number(options.cadenceMinutes) > 0 ? Number(options.cadenceMinutes) : 5;
  const maxAgeMinutes = Number(options.maxAgeMinutes) > 0 ? Number(options.maxAgeMinutes) : 20;
  const base = {
    present: false,
    stale: true,
    age_minutes: null,
    checked_at: null,
    cadence_minutes: cadenceMinutes,
    max_age_minutes: maxAgeMinutes,
    missed_runs: null,
    reason: 'no unattended run has ever been recorded',
  };

  if (!receipt || !receipt.checked_at) return base;

  const at = Date.parse(receipt.checked_at);
  if (!Number.isFinite(at)) {
    return { ...base, checked_at: receipt.checked_at, reason: 'the last unattended run has an unreadable timestamp' };
  }
  if (at > nowMs) {
    return {
      ...base,
      present: true,
      checked_at: receipt.checked_at,
      age_minutes: -1,
      reason: 'the last unattended run claims a future time (' + receipt.checked_at + ')',
    };
  }

  const ageMinutes = Math.floor((nowMs - at) / 60000);
  const stale = ageMinutes > maxAgeMinutes;
  const missedRuns = Math.max(0, Math.floor(ageMinutes / cadenceMinutes) - 1);
  return {
    present: true,
    stale,
    age_minutes: ageMinutes,
    checked_at: receipt.checked_at,
    cadence_minutes: cadenceMinutes,
    max_age_minutes: maxAgeMinutes,
    missed_runs: missedRuns,
    reason: stale
      ? 'the unattended scheduler has not run for ' + ageMinutes + ' min (max ' + maxAgeMinutes + ' min)'
      : null,
  };
}

/**
 * The alert state machine, on the verdict rather than on "is it failing".
 *
 * Three states matter to a responder, not two:
 *
 *   - 'fail'    — a required check failed. Something is broken.
 *   - 'unproven'— the evidence is missing, stale or forged. Something may be
 *                 broken AND we cannot prove it is not. Silence here is the
 *                 failure mode this plan exists to remove, so it alerts.
 *   - 'warn'    — a required check is proven but degraded. A certificate with
 *                 twenty days left earns a colour, not a 03:00 phone call.
 *
 * The recovery message is the sharp end. It may only be sent when the verdict
 * is a proven pass or a proven warning — never after a failure has become
 * "unproven", because "every check is passing again" is a claim about
 * evidence, and there is none.
 */
export function evaluateAlertState(verdict, previousState) {
  const v = normalizeVerdict(verdict);
  const prev = previousState === 'alerted' ? 'alerted' : 'healthy';
  const bad = v === VERDICT_FAIL || v === VERDICT_UNPROVEN;

  if (bad && prev === 'healthy') {
    return { action: 'down', newState: 'alerted', changed: true, subject: v };
  }
  if (!bad && prev === 'alerted') {
    return { action: 'recovered', newState: 'healthy', changed: true, subject: v };
  }
  // Still bad while already alerted: stay alerted, stay silent. The first mail
  // already said something is wrong; a repeat every five minutes is how the
  // real ones get ignored.
  return { action: 'none', newState: prev, changed: false, subject: v };
}
