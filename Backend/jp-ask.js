import crypto from 'crypto';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const FIREBASE_SA_JSON = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'];
const FIRESTORE_DB = _env['FIRESTORE_' + 'DB'] || 'eka-agent';
const MAX_QUEUE_ENTRIES = Number(_env['JP_MAX_QUEUE_ENTRIES']) || 25;

const ALLOWED_ACTIONS = new Set(['sync-now', 'collect-history', 'status-only', 'heartbeat', 'start-ssh']);

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

/* Sort key for a queue entry, oldest first. Entries are Firestore-encoded, so
   requestedAt sits at entry.mapValue.fields.requestedAt.stringValue. Falls back
   to the millisecond stamp in the `dash_<ms>_<hex>` key, then to 0 so anything
   malformed sorts oldest and is evicted first rather than throwing. */
function queueEntryTime(key, entry) {
  const iso = entry && entry.mapValue && entry.mapValue.fields
    && entry.mapValue.fields.requestedAt
    && entry.mapValue.fields.requestedAt.stringValue;
  if (iso) {
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return t;
  }
  const m = /^dash_(\d+)_/.exec(String(key));
  if (m) {
    const t = Number(m[1]);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

/* Keep only the newest `limit` entries. Safe to drop keys here because the PATCH
   below masks the whole commandQueue field, so omitted keys are deleted by that
   same write — no extra request needed. */
function pruneQueue(entries, limit) {
  const keys = Object.keys(entries);
  if (keys.length <= limit) return { kept: entries, evicted: 0 };
  keys.sort((a, b) => queueEntryTime(a, entries[a]) - queueEntryTime(b, entries[b]));
  const drop = keys.length - limit;
  const kept = {};
  for (const k of keys.slice(drop)) kept[k] = entries[k];
  return { kept, evicted: drop };
}

async function queueCommand(device, action) {
  const sa = JSON.parse(FIREBASE_SA_JSON);
  const projectId = sa.project_id;
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${FIRESTORE_DB}/documents/devices/${device}`;
  const token = await getFirestoreToken();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  let current = {};
  try {
    const r = await fetch(base, { headers });
    if (r.ok) {
      const d = await r.json();
      current = d.fields || {};
    }
  } catch {}

  const reqId = `dash_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const nowIso = new Date().toISOString();
  const cmd = {
    action,
    status: 'pending',
    requestedAt: nowIso,
    requestedBy: 'dashboard-agent',
    source: 'jp-ask',
  };

  const existing = current.commandQueue && current.commandQueue.mapValue
    ? current.commandQueue.mapValue.fields || {}
    : {};
  // Reserve one slot for the entry being added, so the result never exceeds the cap.
  const { kept, evicted } = pruneQueue(existing, Math.max(0, MAX_QUEUE_ENTRIES - 1));
  const merged = { ...kept, [reqId]: enc(cmd) };

  const patchUrl = `${base}?updateMask.fieldPaths=${encodeURIComponent('commandQueue')}`;
  const body = JSON.stringify({ fields: { commandQueue: { mapValue: { fields: merged } } } });
  const res = await fetch(patchUrl, { method: 'PATCH', headers, body });
  if (!res.ok) throw new Error('firestore patch failed: ' + (await res.text()).slice(0, 300));

  return {
    reqId,
    action,
    queuedAt: nowIso,
    device,
    queueDepth: Object.keys(merged).length,
    evicted,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!FIREBASE_SA_JSON) {
    return res.status(500).json({ success: false, error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const device = String(body.device || 'samsung-s24-ultra').trim();
  const action = String(body.action || 'sync-now').trim();
  if (!ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ success: false, error: `action must be one of: ${[...ALLOWED_ACTIONS].join(', ')}` });
  }

  try {
    const result = await queueCommand(device, action);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'jp-ask failed' });
  }
}
