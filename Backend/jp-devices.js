import crypto from 'crypto';

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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!FIREBASE_SA_JSON) {
    return res.status(500).json({ success: false, error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' });
  }

  try {
    const token = await getFirestoreToken();
    const base = `https://firestore.googleapis.com/v1/projects/${JSON.parse(FIREBASE_SA_JSON).project_id}/databases/${FIRESTORE_DB}/documents`;
    const r = await fetch(`${base}/devices`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error('firestore read failed: ' + (await r.text()).slice(0, 300));
    const data = await r.json();

    const now = Date.now();
    const devices = (data.documents || []).map((d) => {
      const f = {};
      for (const [k, v] of Object.entries(d.fields || {})) f[k] = dec(v);
      const lastSeen = f.lastSeen || null;
      const interval = typeof f.heartbeatIntervalSeconds === 'number' ? f.heartbeatIntervalSeconds : 45;
      const ageMs = lastSeen ? now - new Date(lastSeen).getTime() : null;
      const live = ageMs !== null && ageMs < 3 * interval * 1000;
      const cq = f.commandQueue || {};
      return {
        deviceId: d.name.split('/').pop(),
        deviceDisplayName: f.deviceDisplayName || d.name.split('/').pop(),
        online: f.online === true,
        live,
        lastSeen,
        lastSeenAgeSeconds: ageMs !== null ? Math.round(ageMs / 1000) : null,
        connectionMethod: f.connectionMethod || null,
        heartbeatIntervalSeconds: interval,
        commandQueueDepth: Object.keys(cq).length,
        network: f.network || null,
      };
    });

    devices.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));

    // Site video-event relay state: last play event from jaytibirthday.in and
    // which devices acknowledged it (seenBy map written by the device watchers).
    let videoEvent = null;
    try {
      const vr = await fetch(`${base}/settings/siteVideoEvents`, { headers: { Authorization: `Bearer ${token}` } });
      if (vr.ok) {
        const vd = await vr.json();
        const f = {};
        for (const [k, v] of Object.entries(vd.fields || {})) f[k] = dec(v);
        videoEvent = {
          lastEventId: f.lastEventId || null,
          lastEventAt: f.lastEventAt || null,
          lastVideoEvent: f.lastVideoEvent || null,
          lastEventSource: f.lastEventSource || null,
          lastVisitorCountry: f.lastVisitorCountry || null,
          lastVisitorCity: f.lastVisitorCity || null,
          seenBy: f.seenBy || {},
        };
      }
    } catch { videoEvent = null; }

    return res.status(200).json({ success: true, source: 'firestore', database: FIRESTORE_DB, generated_at: new Date().toISOString(), devices, videoEvent });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'jp-devices failed' });
  }
}
