// Scheduled S24 sync trigger — Vercel Cron queues a sync-now command for the
// S24 Ultra so the phone daemon picks it up on its next poll. When the daemon
// is offline the command sits in the queue until it comes back; when it is
// online, the next poll processes the command and pushes fresh telemetry.
//
// Auth: Vercel Cron (CRON_SECRET bearer) or dashboard key (STATS_KEY).
import crypto from 'crypto';
import { cronAuthorized } from './lib/cron-auth.js';
import { requireKey } from './_auth.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const FIREBASE_SA_JSON = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'];
const FIRESTORE_DB = _env['FIRESTORE_' + 'DB'] || 'eka-agent';

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
    iat: now, exp: now + 3600,
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
  if (!data.access_token) throw new Error('token exchange failed: ' + JSON.stringify(data).slice(0, 200));
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
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object' && !Array.isArray(v)) {
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, enc(val)])) } };
  }
  return { nullValue: null };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!cronAuthorized(req) && !requireKey(req, res)) return;
  if (!FIREBASE_SA_JSON) return res.status(500).json({ success: false, error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' });

  try {
    const token = await getFirestoreToken();
    const projectId = JSON.parse(FIREBASE_SA_JSON).project_id;
    const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${FIRESTORE_DB}/documents/devices/samsung-s24-ultra`;

    // Read current commandQueue
    const getRes = await fetch(docUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!getRes.ok) throw new Error('firestore read failed: ' + getRes.status);
    const doc = await getRes.json();
    const fields = {};
    for (const [k, v] of Object.entries(doc.fields || {})) fields[k] = dec(v);
    const cq = fields.commandQueue || {};

    // Skip if there's already a pending sync-now command
    const pendingSync = Object.values(cq).some(
      (e) => e.action === 'sync-now' && ['pending', 'queued', 'requested'].includes(e.status)
    );
    if (pendingSync) {
      return res.status(200).json({ success: true, action: 'skipped', reason: 'pending sync-now already in queue' });
    }

    // Queue a new sync-now command
    const commandId = `cron_sync_${Date.now()}`;
    const now = new Date().toISOString();
    cq[commandId] = {
      action: 'sync-now',
      status: 'pending',
      requestedAt: now,
      requestedBy: 'vercel-cron-s24-sync',
      source: 'scheduled-sync',
    };

    const patchBody = {
      fields: { commandQueue: enc(cq) },
    };
    const patchRes = await fetch(`${docUrl}?updateMask.fieldPaths=commandQueue`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody),
    });
    if (!patchRes.ok) throw new Error('firestore patch failed: ' + patchRes.status);

    return res.status(200).json({
      success: true,
      action: 'queued',
      commandId,
      requestedAt: now,
      queueDepth: Object.keys(cq).length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 's24-sync-cron failed' });
  }
}
