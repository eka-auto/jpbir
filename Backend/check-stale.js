import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { evaluate } from './lib/stale.js';
import { query as pgQuery, isConfigured as pgIsConfigured } from '../Integrations/postgres.js';
import { requireKey } from './_auth.js';
import { cronAuthorized } from './lib/cron-auth.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const FIREBASE_SA_JSON = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'];
const FIRESTORE_DB = _env['FIRESTORE_' + 'DB'] || 'eka-agent';
const GMAIL_APP_PASSWORD = _env['GMAIL_APP_' + 'PASSWORD'];
const STALE_ALERT_SECONDS = Number(_env['STALE_ALERT_SECONDS']) || 600;

// Recipients + SMTP settings mirror email_notifications/email_config.js. Inlined
// rather than imported: that file is CommonJS and lives outside this Vercel
// project root, so a cross-root import would not reliably bundle. Only the app
// password is secret (env); the addresses are already in the repo.
const MAIL = {
  recipients: ['ekaaiurgaa@gmail.com', 'jaytipargal.jp@gmail.com', 'pargaljayati.06@gmail.com'],
  host: 'smtp.gmail.com',
  port: 587,
  user: 'ekaaiurgaa@gmail.com',
  from: 'Jayati Device Monitor <analytics@jaytibirthday.in>',
  replyTo: 'ekaaiurgaa@gmail.com',
};

let _tokenCache = { token: null, exp: 0 };

async function getFirestoreToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.exp - 60000) return _tokenCache.token;
  const sa = JSON.parse(FIREBASE_SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const input = `${b64url(header)}.${b64url(claim)}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(input), sa.private_key);
  const jwt = `${input}.${sig.toString('base64url')}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) {
    const detail = JSON.stringify(data).slice(0, 200);
    // `invalid_grant` means Google rejected the signed assertion itself — almost
    // always because the FIREBASE_SERVICE_ACCOUNT_JSON key has been revoked or
    // rotated, so its public half no longer matches the service account. The
    // signing above is not at fault; the credential is. Say so, so the fix is a
    // key rotation and not a hunt through this code.
    if (data.error === 'invalid_grant') {
      throw new Error('token exchange failed (' + detail + '): the FIREBASE_SERVICE_ACCOUNT_JSON key is invalid, revoked, or rotated — generate a fresh service-account key and update the secret.');
    }
    throw new Error('token exchange failed: ' + detail);
  }
  _tokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
}

function dec(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) out[k] = dec(val);
    return out;
  }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  return null;
}

function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: v } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = enc(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function alertBody(action, d) {
  const age = d.lastSeenAgeSeconds;
  const mins = age === null || age === undefined ? '?' : Math.round(age / 60);
  if (action === 'down') {
    return {
      subject: `⚠️ Device DOWN: ${d.displayName}`,
      text: `${d.displayName} (${d.deviceId}) has stopped checking in.\n\n`
        + `Last seen: ${d.lastSeen} (${mins} min ago)\n`
        + `Threshold: ${Math.round(STALE_ALERT_SECONDS / 60)} min of silence.\n\n`
        + `You will get one RECOVERED email when it starts heartbeating again.`,
    };
  }
  return {
    subject: `✅ Device RECOVERED: ${d.displayName}`,
    text: `${d.displayName} (${d.deviceId}) is checking in again.\n\nLast seen: ${d.lastSeen} (${mins} min ago).`,
  };
}

async function sendAlert(action, d) {
  const transport = nodemailer.createTransport({
    host: MAIL.host,
    port: MAIL.port,
    secure: false,
    requireTLS: true,
    auth: { user: MAIL.user, pass: GMAIL_APP_PASSWORD },
  });
  const { subject, text } = alertBody(action, d);
  await transport.sendMail({
    from: MAIL.from,
    to: MAIL.recipients.join(','),
    replyTo: MAIL.replyTo,
    subject,
    text,
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Sends alert email and patches Firestore: Vercel Cron (CRON_SECRET) or the
  // dashboard key only, same as verify-db.
  if (!cronAuthorized(req) && !requireKey(req, res)) return;
  if (!FIREBASE_SA_JSON) return res.status(500).json({ success: false, error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' });
  if (!GMAIL_APP_PASSWORD) return res.status(500).json({ success: false, error: 'GMAIL_APP_PASSWORD not configured' });

  try {
    const token = await getFirestoreToken();
    const projectId = JSON.parse(FIREBASE_SA_JSON).project_id;
    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${FIRESTORE_DB}/documents`;
    const r = await fetch(`${base}/devices`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error('firestore read failed: ' + (await r.text()).slice(0, 300));
    const data = await r.json();

    const nowMs = Date.now();
    const nowIso = new Date().toISOString();
    const thresholdMs = STALE_ALERT_SECONDS * 1000;
    const transitions = [];
    let checked = 0;

    for (const doc of data.documents || []) {
      const f = {};
      for (const [k, v] of Object.entries(doc.fields || {})) f[k] = dec(v);
      const deviceId = doc.name.split('/').pop();
      checked++;
      const device = {
        lastSeen: f.lastSeen || null,
        staleAlertState: f.staleAlert && f.staleAlert.state,
      };
      const result = evaluate(device, nowMs, thresholdMs);
      if (!result.changed) continue;

      const d = {
        deviceId,
        displayName: f.deviceDisplayName || deviceId,
        lastSeen: f.lastSeen || null,
        lastSeenAgeSeconds: f.lastSeen ? Math.round((nowMs - new Date(f.lastSeen).getTime()) / 1000) : null,
      };
      // Send first; only persist the new state if the email went out, so a
      // transient send failure retries on the next tick instead of going silent.
      try {
        await sendAlert(result.action, d);
        const patchUrl = `${base}/devices/${deviceId}?updateMask.fieldPaths=${encodeURIComponent('staleAlert')}`;
        const body = JSON.stringify({ fields: { staleAlert: enc({ state: result.newState, since: nowIso }) } });
        const pr = await fetch(patchUrl, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body,
        });
        if (!pr.ok) throw new Error('patch failed: ' + (await pr.text()).slice(0, 200));
        transitions.push({ deviceId, action: result.action });
      } catch (e) {
        transitions.push({ deviceId, action: result.action, error: e.message });
      }
    }

    // ── Neon staleness sweep ────────────────────────────────────────────
    // Downgrade s24_agents that have been silent for >1h and expire
    // s24_queue_items that have been pending for >24h without pickup.
    let neonSweep = null;
    if (pgIsConfigured()) {
      try {
        const [agentResult, queueResult] = await Promise.all([
          pgQuery(
            `UPDATE s24_agents SET status = 'stale'
             WHERE status = 'active' AND last_seen < now() - interval '1 hour'`
          ),
          pgQuery(
            `UPDATE s24_queue_items SET status = 'expired-stale-check'
             WHERE status IN ('pending', 'queued') AND created_at < now() - interval '24 hours'`
          ),
        ]);
        neonSweep = {
          agentsStaled: agentResult.rowCount,
          queueExpired: queueResult.rowCount,
        };
      } catch { neonSweep = { error: 'neon sweep failed' }; }
    }

    return res.status(200).json({ success: true, checked, transitions, neonSweep, thresholdSeconds: STALE_ALERT_SECONDS, at: nowIso });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'check-stale failed' });
  }
}
