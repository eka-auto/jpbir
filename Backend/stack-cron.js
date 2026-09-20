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

import nodemailer from 'nodemailer';
import { requireKey } from './_auth.js';
import { cronAuthorized } from './lib/cron-auth.js';
import { runProbes, snapshot, recordCronRun, lastCronRun } from './jp-stack.js';
import { getFirestoreToken } from './jp-devices.js';

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
 * Pure edge-transition evaluator, exported so the suite can drive every branch
 * without Firestore or SMTP. Same contract as `lib/stale.js` `evaluate`.
 *
 * `warn` counts as healthy for alerting. A cert with 20 days left is worth a
 * colour in the panel but is not worth waking someone at 03:00, and an alert
 * that fires for something nobody must act on tonight is how the red ones get
 * ignored.
 */
export function evaluateStack(overall, previousState) {
  const failing = overall === 'fail';
  const prev = previousState === 'alerted' ? 'alerted' : 'healthy';
  if (failing && prev === 'healthy') return { action: 'down', newState: 'alerted', changed: true };
  if (!failing && prev === 'alerted') return { action: 'recovered', newState: 'healthy', changed: true };
  return { action: 'none', newState: prev, changed: false };
}

/** The failing probes, as "<name>: <one-line reason>" — never any value. */
export function failureLines(snap) {
  return Object.entries(snap.probes)
    .filter(([, p]) => p.status === 'fail')
    .map(([name, p]) => '  • ' + name + ': ' + (p.problem || 'failed'));
}

export function alertBody(action, snap) {
  if (action === 'down') {
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
    const snap = snapshot(await runProbes());
    const token = await getFirestoreToken();
    const previous = await readAlertState(token);
    const decision = evaluateStack(snap.overall, previous);

    // Recording the run is what proves the unattended loop is alive, so it
    // happens whether or not anything changed and whether or not mail is on.
    await recordCronRun(snap, source);

    let emailed = false;
    if (decision.changed) {
      // Mail first, then persist. If the send throws, the state is left
      // unchanged so the next tick retries — the opposite order would mark it
      // alerted and go permanently silent about a live outage.
      if (emailEnabled) {
        await sendAlert(decision.action, snap);
        emailed = true;
      }
      await writeAlertState(token, decision.newState);
    }

    res.status(200).json({
      success: true,
      checked_at: snap.fetched_at,
      overall: snap.overall,
      summary: snap.summary,
      transition: decision.changed ? decision.action : 'none',
      emailed,
      email_enabled: emailEnabled,
      source,
      failures: failureLines(snap).map((l) => l.trim()),
    });
  } catch (error) {
    // 500 on purpose: Vercel surfaces a failing cron, and health-check.yml
    // fails its step. A swallowed error here would mean the watchdog itself
    // dies quietly, which is the one failure mode this route cannot have.
    res.status(500).json({ success: false, error: String(error.message).slice(0, 300) });
  }
}

export { lastCronRun };
