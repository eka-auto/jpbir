import crypto from 'crypto';
import { decodeOne } from './lib/geo.js';
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

export function normalizeCommandQueue(queue) {
  if (!queue || typeof queue !== 'object' || Array.isArray(queue)) return [];
  return Object.entries(queue)
    .filter(([, entry]) => entry && typeof entry === 'object')
    .map(([id, entry]) => ({
      id,
      action: entry.action || null,
      status: entry.status || 'pending',
      queuedAt: entry.requestedAt || entry.queuedAt || null,
      completedAt: entry.completedAt || null,
    }))
    .sort((a, b) => (b.queuedAt || '').localeCompare(a.queuedAt || ''));
}

const S24_DEVICE_ID = 'samsung-s24-ultra';

// The same phone is written to more than one document: devices/Samsung-S24 is
// a legacy alias carrying canonicalDeviceId='samsung-s24-ultra', and the
// collector updates both every cycle. Keying strict mode on the literal
// document id left the alias on plain timestamp-freshness, so the phone showed
// live:true there while the strict document beside it said live:false — the
// attestation bypassed by picking the other row.
function isS24Document(deviceId, fields) {
  return deviceId === S24_DEVICE_ID ||
    fields.canonicalDeviceId === S24_DEVICE_ID ||
    (Array.isArray(fields.legacyDeviceIds) && fields.legacyDeviceIds.includes(deviceId) &&
      fields.canonicalDeviceId === S24_DEVICE_ID);
}
const S24_ACK_MAX_AGE_SECONDS = 300;
const S24_SOURCE_TYPES = new Set(['live_termux', 'live_daemon']);

// Every other field this check reads is written by whatever process owns the
// document, so a bridge running off-device could assert all of them about
// itself — and one did: a Windows process writing heartbeatAuth='termux-phone',
// sourceType='live_termux' and liveDeviceVerified=true for the S24. The agent
// version prefix was the only thing standing in its way, and a version string
// is one edit away from matching.
//
// runtimeIsAndroid is set by the collector from the platform it is actually
// executing on, and the collector now reports false off Termux rather than
// omitting the field. Requiring it strictly true means an absent field — an
// older build that predates this, or anything that simply does not set it —
// fails closed, which is the behaviour we want while the fleet catches up.
const S24_RUNTIME_EVIDENCE = 'runtimeIsAndroid';

function nonFutureAgeSeconds(value, now) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > now) return null;
  return Math.round((now - timestamp) / 1000);
}

function commandAckTimestamp(fields) {
  const lastAck = fields.lastAck && typeof fields.lastAck === 'object'
    ? fields.lastAck
    : {};
  return fields.lastCommandAckAt || fields.ackAt || lastAck.ackAt ||
    lastAck.completedAt || lastAck.at || null;
}

export function strictS24Liveness(fields, heartbeatAgeSeconds, ackAgeSeconds) {
  const checks = {
    heartbeatFresh: heartbeatAgeSeconds !== null && heartbeatAgeSeconds <= S24_ACK_MAX_AGE_SECONDS,
    authenticatedAgent: typeof fields.agentVersion === 'string' &&
      fields.agentVersion.startsWith('s24-termux-'),
    heartbeatAuth: fields.heartbeatAuth === 'termux-phone',
    liveDeviceVerified: fields.liveDeviceVerified === true,
    liveSource: S24_SOURCE_TYPES.has(fields.sourceType),
    androidRuntime: fields[S24_RUNTIME_EVIDENCE] === true,
    commandAckFresh: ackAgeSeconds !== null && ackAgeSeconds <= S24_ACK_MAX_AGE_SECONDS,
  };
  const failed = Object.entries(checks).find(([, passed]) => !passed);
  return {
    mode: 'strict-s24-attestation',
    live: !failed,
    checks,
    reason: failed ? `${failed[0]} is missing or stale` : 'authenticated heartbeat and command acknowledgement are fresh',
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // The enrolled-device roster, and with ?full=1 the whole stored payload.
  if (!requireKey(req, res)) return;
  if (!FIREBASE_SA_JSON) {
    return res.status(500).json({ success: false, error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' });
  }

  try {
    const includeFullPayload = String(req.query.full || '') === '1';
    const token = await getFirestoreToken();
    const base = `https://firestore.googleapis.com/v1/projects/${JSON.parse(FIREBASE_SA_JSON).project_id}/databases/${FIRESTORE_DB}/documents`;
    const r = await fetch(`${base}/devices`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error('firestore read failed: ' + (await r.text()).slice(0, 300));
    const data = await r.json();

    // A stored IP is only worth trusting as "current" while it is fresh. Both
    // IPs on samsung-s24-ultra were stale and neither matched the address the
    // phone was actually browsing from, so age travels with every IP.
    const IP_MAX_AGE_MS = 60 * 60 * 1000;
    const ipAge = (key, value, at, now) => {
      if (!value) return {};
      const ageMs = at ? now - new Date(at).getTime() : null;
      return {
        [`${key}At`]: at,
        [`${key}AgeSeconds`]: ageMs !== null ? Math.round(ageMs / 1000) : null,
        [`${key}Stale`]: ageMs === null || ageMs > IP_MAX_AGE_MS,
      };
    };

    const now = Date.now();
    const devices = (data.documents || []).map((d) => {
      const f = {};
      for (const [k, v] of Object.entries(d.fields || {})) f[k] = dec(v);
      const deviceId = d.name.split('/').pop();
      const lastSeen = f.lastSeen || null;
      // Only an always-on agent can be expected to check in every 45s. Phones
      // heartbeat opportunistically (samsung-s24-ultra uses a native Android
      // heartbeat and stores no heartbeatIntervalSeconds at all), so the old
      // flat 45s default marked it OFFLINE after ~2 minutes idle - which for a
      // phone is nearly always, even while it reports status "online".
      const DEFAULT_INTERVAL_SECONDS = { 'android-phone': 900 };
      const interval = typeof f.heartbeatIntervalSeconds === 'number'
        ? f.heartbeatIntervalSeconds
        : (DEFAULT_INTERVAL_SECONDS[f.deviceType] || 45);
      const heartbeatAgeSeconds = nonFutureAgeSeconds(lastSeen, now);
      const isS24 = isS24Document(deviceId, f);
      const heartbeatMaxAgeSeconds = isS24
        ? S24_ACK_MAX_AGE_SECONDS
        : 3 * interval;
      const heartbeatFresh = heartbeatAgeSeconds !== null && heartbeatAgeSeconds <= heartbeatMaxAgeSeconds;
      const lastCommandAckAt = commandAckTimestamp(f);
      const lastCommandAckAgeSeconds = nonFutureAgeSeconds(lastCommandAckAt, now);
      const strict = isS24
        ? strictS24Liveness(f, heartbeatAgeSeconds, lastCommandAckAgeSeconds)
        : {
          mode: 'timestamp-freshness',
          live: heartbeatFresh,
          checks: { heartbeatFresh },
          reason: heartbeatFresh ? 'lastSeen is within the device heartbeat window' : 'lastSeen is missing, stale, invalid, or in the future',
        };
      const live = strict.live;
      const cq = f.commandQueue || {};
      const commandQueue = normalizeCommandQueue(cq);
      // Phones report connectivity under `info`/`networkType`, not the
      // top-level `network` map the laptop agents write. Normalise it so they
      // stop rendering as "no network data" despite having a known SSID/IP.
      let network = f.network || null;
      if (!network && (f.info || f.networkType)) {
        const info = f.info || {};
        // Two different refresh cadences are mixed in one doc. `info.*` is
        // rewritten on every heartbeat; `publicIp` is only rewritten by the
        // periodic network check that stamps `lastNetworkCheck`, which can be
        // days behind. Stamping the whole object with `lastNetworkCheck` made
        // the fresh fields look stale; emitting publicIp beside them with no
        // timestamp made a stale value look current. Carry each provenance.
        const observedIpAt = f.updatedAt || lastSeen || null;
        const publicIpAt = f.lastNetworkCheck || null;
        network = {
          ssid: info.wifiSSID || null,
          networkType: f.networkType || null,
          // NOT a LAN address despite the `wifiIP` field name: on
          // samsung-s24-ultra this held 210.16.82.155, which matched the
          // visitor-analytics egress IP exactly. Labelling it `localIp` was
          // wrong, so it is reported as what it is - an observed egress IP.
          observedIp: info.wifiIP || null,
          ...ipAge('observedIp', info.wifiIP || null, observedIpAt, now),
          publicIp: f.publicIp || null,
          ...ipAge('publicIp', f.publicIp || null, publicIpAt, now),
          batteryCharging: typeof info.batteryCharging === 'boolean' ? info.batteryCharging : null,
          updatedAt: observedIpAt || publicIpAt,
          source: 'device-info',
        };
      }
      return {
        deviceId,
        deviceDisplayName: f.deviceDisplayName || deviceId,
        online: f.online === true,
        live,
        lastSeen,
        lastSeenAgeSeconds: heartbeatAgeSeconds,
        heartbeatMaxAgeSeconds,
        liveness: strict,
        connectionMethod: f.connectionMethod || null,
        heartbeatIntervalSeconds: interval,
        agentVersion: f.agentVersion || null,
        heartbeatAuth: f.heartbeatAuth || null,
        liveDeviceVerified: f.liveDeviceVerified === true,
        sourceType: f.sourceType || null,
        lastCommandAckAt,
        lastCommandAckAgeSeconds,
        commandQueueDepth: Object.keys(cq).length,
        commandQueuePendingDepth: commandQueue.filter((entry) =>
          ['pending', 'queued', 'requested', 'claimed'].includes(entry.status)
        ).length,
        commandQueue,
        network,
        // What the device itself last asserted, reported alongside the computed
        // `live` so a disagreement between the two is visible rather than
        // silently resolved in favour of one.
        deviceType: f.deviceType || null,
        model: f.model || null,
        reportedStatus: f.status || null,
        staleAlertState: (f.staleAlert && f.staleAlert.state) || null,
        ...(includeFullPayload ? { full_payload: f } : {}),
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
          // Stored verbatim from Vercel's percent-encoded `x-vercel-ip-*`
          // headers, so decode on read. `|| null` keeps the absent case null
          // rather than undefined, as every neighbouring field does.
          lastVisitorCountry: decodeOne(f.lastVisitorCountry) || null,
          lastVisitorCity: decodeOne(f.lastVisitorCity) || null,
          seenBy: f.seenBy || {},
        };
      }
    } catch { videoEvent = null; }

    return res.status(200).json({ success: true, source: 'firestore', database: FIRESTORE_DB, generated_at: new Date().toISOString(), devices, videoEvent });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'jp-devices failed' });
  }
}
