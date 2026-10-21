// The unattended half of the Product engineering panel.
//
// The panel in index.html is live only while a browser has it open. That is a
// dashboard, not monitoring: the failure you care about is the one that starts
// at 03:00 while nobody is looking. This route runs the same probes on Vercel's
// schedule, records each run, and emails on a state CHANGE.
//
// ON A CHANGE, not on every tick. At a 5-minute cadence an alert-per-tick would
// be 288 emails a day for one broken thing, and the ninth identical mail is
// where a human stops reading. `lib/stale.js` already established the
// edge-transition shape for device alerts and the reasoning is identical here,
// so the state machine matches it: healthy → alerted fires one DOWN mail,
// alerted → healthy fires one RECOVERED mail, everything else is silent.
//
// Two independent schedules drive this on purpose:
//   - Vercel cron (vercel.json) every 5 min — fast detection.
//   - .github/workflows/health-check.yml every 15 min — an outside witness. If
//     Vercel's scheduler itself stops, the Vercel cron cannot report its own
//     absence; GitHub can, because it runs somewhere else entirely.
// Neither alone is 24x7. Together they survive either one failing.
//
// Three things are kept apart here, because they used to be one thing:
//
//   1. SCHEDULER EXECUTION. Only a run the platform scheduler started writes
//      the native receipt (`system/stackHealthNative`). A person pressing
//      "check now" writes the ordinary one and proves nothing about the
//      schedule.
//   2. HEALTH MEASURED DURING THAT EXECUTION. The verdict, the counts and the
//      readiness of the rows.
//   3. ALERT DELIVERY. Whether a mail was actually handed to the server, and
//      whether it was needed at all. This is written WITH the run, so a
//      receipt never claims a delivery that did not happen.
//
// The recovery mail is the sharp end: it may only say "every check is passing
// again" when the verdict is a proven pass or a proven warning. A failure that
// becomes "unproven" — the evidence missing rather than the check broken —
// must not produce it.

import nodemailer from 'nodemailer';
import { requireKey } from './_auth.js';
import { cronAuthorized } from './lib/cron-auth.js';
import { runProbes, snapshot, recordCronRun, lastCronRun } from './jp-stack.js';
import { getFirestoreToken } from './jp-devices.js';
import { evaluateAlertState, VERDICT_FAIL, VERDICT_UNPROVEN, VERDICT_PASS, VERDICT_WARN } from './lib/stack-readiness.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const FIRESTORE_DB = _env['FIRESTORE_' + 'DB'] || 'eka-agent';
const FIREBASE_SA_JSON = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'] || _env['FIREBASE_' + 'SA_JSON'];
const GMAIL_APP_PASSWORD = _env['GMAIL_APP_' + 'PASSWORD'];

// Mirrors check-stale.js. Inlined there and here for the same reason: the
// shared config file is CommonJS and outside this Vercel project root, so a
// cross-root import would not reliably bundle.
const MAIL = {
  recipients: ['ekaaiurgaa@gmail.com', 'jaytipargal.jp@gmail.com', 'pargaljayati.06@gmail.com'],
  host: 'smtp.gmail.com',
  port: 587,
  user: 'ekaaiurgaa@gmail.com',
  from: 'Jayti Dashboard <ekaaiurgaa@gmail.com>',
  replyTo: 'ekaaiurgaa@gmail.com',
};

const ALERT_DOC = 'system/stackAlert';

/**
 * The lock that keeps two overlapping ticks from both deciding to alert.
 *
 * Vercel can deliver a cron invocation twice, and a slow probe can push the
 * next tick into the same window. Without this, two ticks could both see
 * "healthy" and both fire the DOWN mail.
 *
 * It is a best-effort lock: the read-then-write window is not atomic, so two
 * ticks can still both enter. The state machine is the real backstop — the
 * alert state is persisted, so only the first tick to write "alerted" sends,
 * and the second finds it already alerted and stays silent. The lock only
 * removes the duplicate probe run and the duplicate receipt, not the
 * duplicate mail.
 */
const LOCK_DOC = 'system/stackCronLock';
const LOCK_TTL_MS = 60 * 1000;

/**
 * Pure edge-transition evaluator, exported so the suite can drive every branch
 * without Firestore or SMTP.
 *
 * It takes the READINESS VERDICT, not "is it failing". A verdict of
 * 'unproven' — evidence missing, stale or forged — is not healthy, and the
 * old `overall !== 'fail'` test treated it as recovery-worthy, which is how a
 * panel could announce "all checks passing again" over eight rows it could
 * not prove.
 *
 * A warning is still not worth waking anyone at 03:00: a certificate with
 * twenty days left earns a colour in the panel, not a phone call.
 */
export function evaluateStack(verdict, previousState) {
  return evaluateAlertState(verdict, previousState);
}

/** The failing probes, as "<name>: <one-line reason>" — never any value. */
export function failureLines(snap) {
  return Object.entries(snap.probes)
    .filter(([, p]) => p.status === 'fail')
    .map(([name, p]) => '  • ' + name + ': ' + (p.problem || 'failed'));
}

/** The unproven probes, as "<name>: <one-line reason>" — never any value. */
export function unprovenLines(snap) {
  return Object.entries(snap.probes)
    .filter(([, p]) => p.status === 'unknown')
    .map(([name, p]) => '  • ' + name + ': ' + (p.problem || 'no usable evidence'));
}

export function alertBody(action, snap) {
  const verdict = (snap.readiness && snap.readiness.verdict) || 'unproven';
  if (action === 'down') {
    if (verdict === VERDICT_UNPROVEN) {
      return {
        subject: '⚠️ Stack UNPROVEN: ' + (snap.readiness ? snap.readiness.scope.rows_unproven : '?') + ' check(s) have no usable evidence',
        text:
          'The jpbir stack cannot be proven healthy.\n\n' +
          unprovenLines(snap).join('\n') +
          '\n\nA failure may be hiding behind missing evidence, so this is not reported as recovered.\n' +
          '\nChecked: ' + snap.fetched_at +
          '\nPanel: https://jaytipargal.tech/ → Product engineering',
      };
    }
    return {
      subject: '⚠️ Stack DOWN: ' + snap.summary.fail + ' check(s) failing',
      text:
        'The jpbir stack has failing checks.\n\n' +
        failureLines(snap).join('\n') +
        '\n\nChecked: ' + snap.fetched_at +
        '\nPanel: https://jaytipargal.tech/ → Product engineering' +
        '\n\nYou will get one RECOVERED email when every check passes again.',
    };
  }
  return {
    subject: '✅ Stack RECOVERED: all checks passing',
    text: 'Every jpbir stack check is passing again.\n\nChecked: ' + snap.fetched_at,
  };
}

function firestoreBase() {
  const projectId = JSON.parse(FIREBASE_SA_JSON).project_id;
  return 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/' + FIRESTORE_DB + '/documents';
}

async function readAlertState(token) {
  const res = await fetch(firestoreBase() + '/' + ALERT_DOC, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) return null;
  return (await res.json()).fields?.state?.stringValue || null;
}

async function writeAlertState(token, state) {
  const fields = {
    state: { stringValue: state },
    since: { timestampValue: new Date().toISOString() },
  };
  const mask = Object.keys(fields).map((k) => 'updateMask.fieldPaths=' + k).join('&');
  const res = await fetch(firestoreBase() + '/' + ALERT_DOC + '?' + mask, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error('failed to persist alert state: HTTP ' + res.status);
}

/**
 * Take the run lock, or report that somebody else holds it.
 *
 * The stored `expiresAt` is what makes a crashed tick harmless: a lock whose
 * expiry has passed is stale and is taken over, so a tick that died mid-run
 * cannot block the schedule forever.
 */
async function takeLock(token) {
  const now = Date.now();
  const url = firestoreBase() + '/' + LOCK_DOC;
  const current = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (current.ok) {
    const fields = (await current.json()).fields || {};
    const expiresAt = Date.parse(fields.expiresAt?.timestampValue || fields.expiresAt?.stringValue || '');
    if (Number.isFinite(expiresAt) && expiresAt > now) {
      return { acquired: false, heldUntil: new Date(expiresAt).toISOString() };
    }
  }
  const fields = {
    expiresAt: { timestampValue: new Date(now + LOCK_TTL_MS).toISOString() },
    takenAt: { timestampValue: new Date(now).toISOString() },
  };
  const mask = Object.keys(fields).map((k) => 'updateMask.fieldPaths=' + k).join('&');
  const res = await fetch(url + '?' + mask, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error('failed to take the run lock: HTTP ' + res.status);
  return { acquired: true, heldUntil: new Date(now + LOCK_TTL_MS).toISOString() };
}

async function sendAlert(action, snap) {
  const transport = nodemailer.createTransport({
    host: MAIL.host,
    port: MAIL.port,
    secure: false,
    requireTLS: true,
    auth: { user: MAIL.user, pass: GMAIL_APP_PASSWORD },
  });
  const { subject, text } = alertBody(action, snap);
  await transport.sendMail({ from: MAIL.from, to: MAIL.recipients.join(','), replyTo: MAIL.replyTo, subject, text });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!cronAuthorized(req) && !requireKey(req, res)) return;
  if (!FIREBASE_SA_JSON) {
    return res.status(503).json({ success: false, error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' });
  }

  // Email is optional, exactly as in check-stale.js: without the app password
  // the run still probes and still records, so the panel keeps its unattended
  // history even before SMTP is configured.
  const emailEnabled = Boolean(GMAIL_APP_PASSWORD);
  const source = cronAuthorized(req) ? 'cron' : 'manual';

  try {
    const token = await getFirestoreToken();
    const lock = await takeLock(token);
    if (!lock.acquired) {
      // Another tick is running. This run is not evidence of anything, so it
      // is not recorded and it is not a health verdict — it says only that
      // the schedule is busy.
      return res.status(202).json({
        success: true,
        skipped: true,
        reason: 'another run holds the lock until ' + lock.heldUntil,
        source,
      });
    }

    const snap = snapshot(await runProbes());
    const previous = await readAlertState(token);
    const decision = evaluateStack(snap.readiness.verdict, previous);

    let notification = 'none';
    if (decision.changed) {
      // Mail first, then persist. If the send throws, the state is left
      // unchanged so the next tick retries — the opposite order would mark it
      // alerted and go permanently silent about a live outage.
      if (emailEnabled) {
        try {
          await sendAlert(decision.action, snap);
          // "sent" means the SMTP server accepted the message. Delivery to the
          // mailbox is the recipient's mail server's business and is not
          // claimed here.
          notification = 'sent';
        } catch (e) {
          notification = 'failed';
          await recordCronRun(snap, source, { notification, executor: source });
          throw e;
        }
      } else {
        notification = 'disabled';
      }
      await writeAlertState(token, decision.newState);
    }

    // The receipt is written last, with the notification outcome, so it
    // describes the whole run rather than the part before it.
    await recordCronRun(snap, source, { notification, executor: source });

    const proven = snap.readiness.verdict === VERDICT_PASS || snap.readiness.verdict === VERDICT_WARN;
    res.status(proven ? 200 : 503).json({
      success: proven,
      checked_at: snap.fetched_at,
      overall: snap.overall,
      verdict: snap.readiness.verdict,
      ready: snap.readiness.ready,
      reason: snap.readiness.reason,
      summary: snap.summary,
      transition: decision.changed ? decision.action : 'none',
      notification,
      email_enabled: emailEnabled,
      source,
      failures: failureLines(snap).map((l) => l.trim()),
      unproven: unprovenLines(snap).map((l) => l.trim()),
    });
  } catch (error) {
    // 500 on purpose: Vercel surfaces a failing cron, and health-check.yml
    // fails its step. A swallowed error here would mean the watchdog itself
    // dies quietly, which is the one failure mode this route cannot have.
    res.status(500).json({ success: false, error: String(error.message).slice(0, 300) });
  }
}

export { lastCronRun };
