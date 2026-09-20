import crypto from 'crypto';
import { decodeOne } from './lib/geo.js';
import {
  S24_DEVICE_ID,
  S24_ACK_MAX_AGE_SECONDS,
  S24_RUNTIME_EVIDENCE,
  s24AttestationChecks,
  firstFailedCheck,
} from './lib/s24-attestation.js';
import { requireKey } from './_auth.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { scanBounded } from './lib/ddb-scan.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const FIREBASE_SA_JSON = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'];
const FIRESTORE_DB = _env['FIRESTORE_' + 'DB'] || 'eka-agent';
const AWS_ACCESS_KEY_ID = _env['JP_AWS_' + 'ACCESS_KEY_ID'];
const AWS_SECRET_ACCESS_KEY = _env['JP_AWS_' + 'SECRET_ACCESS_KEY'];
const AWS_REGION = _env['JP_AWS_' + 'REGION'] || 'us-west-2';
const TABLE = _env['JP_TELEMETRY_' + 'TABLE'] || 'jaytipargal_telemetry';

let _tokenCache = { token: null, exp: 0 };

// Exported because `jp-stack.js` probes Firestore reachability for the Product
// engineering panel and must exercise the *same* credential path this handler
// uses — a second copy of the JWT exchange could pass while this one fails (or
// the reverse) and the panel would report health this endpoint does not have.
export async function getFirestoreToken() {
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

// Known device identities: visitor IDs observed on the site mapped to
// their real hardware. The S24 Ultra browser visitor is the same device
// as the daemon, so both roll up under one canonical id.
const IDENTITY_MAP = {
  'jbtv_1789288497389_4vez00y62': { canonical: 'samsung-s24-ultra', label: 'S24 Ultra (SM-S928B)', ip: null },
  'jbtv_1788609338910_nwc1wtunc': { canonical: 'samsung-s24-ultra', label: 'S24 Ultra (SM-S928B)', ip: '157.49.23.247' },
  'jbtv_1787941629418_yn7aswqg7': { canonical: 'samsung-s24-ultra', label: 'S24 Ultra (SM-S928B)', ip: '210.16.82.193' },
  'samsung-s24-ultra': { canonical: 'samsung-s24-ultra', label: 'S24 Ultra (SM-S928B)', ip: '157.49.23.247' },
  'jbtv_1788026445435_74eqr76hi': { canonical: 'iphone-london', label: 'iPhone (iOS 18.7)', ip: '172.226.0.6' },
};

function resolveIdentity(visitorId) {
  const m = IDENTITY_MAP[visitorId];
  if (m) return m;
  return { canonical: visitorId, label: visitorId, ip: null };
}

// S24_DEVICE_ID, S24_ACK_MAX_AGE_SECONDS, the accepted agentVersion prefixes, the
// runtime-evidence field name, the source types and the connection methods all live in
// ./lib/s24-attestation.js and are imported above. They used to be declared here and,
// independently, in Server/jp-agent/device-health.mjs; the two copies drifted twice in one
// day. The rationale for each value is in that module — do not re-declare any of it here.

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
  // Every field is read top-level here. Server/jp-agent/device-health.mjs reads
  // liveDeviceVerified and sourceType from the nested samsungS24DirectSync sub-map, and
  // grants a boot grace this dashboard does not. Those are deliberate per-caller policy
  // differences passed explicitly at the call site — not drift, and not to be "unified"
  // without deciding which behaviour is correct first. allowBootGrace defaults to false.
  const checks = s24AttestationChecks({
    agentVersion: fields.agentVersion,
    heartbeatAuth: fields.heartbeatAuth,
    liveDeviceVerified: fields.liveDeviceVerified,
    sourceType: fields.sourceType,
    runtimeIsAndroid: fields[S24_RUNTIME_EVIDENCE],
    heartbeatAgeSeconds,
    ackAgeSeconds,
  });
  const failed = firstFailedCheck(checks);
  return {
    mode: 'strict-s24-attestation',
    live: !failed,
    checks,
    reason: failed ? `${failed} is missing or stale` : 'authenticated heartbeat and command acknowledgement are fresh',
  };
}

// The whole of "is this S24 document evidence that the physical phone is alive":
// heartbeat and command-ACK ages, the strict attestation verdict, and the
// heartbeat interval/max-age pair the frontend needs to render them. It exists
// as one exported helper because there are now TWO readers of exactly this math
// — handleDevices below (keyed, full roster) and the unauthenticated projection
// in ./s24-public.js — and two implementations of a liveness rule computing
// differently is this repo's signature failure mode (see ./lib/s24-attestation.js:
// the droplet and dashboard copies drifted twice in one day, and the second
// drift let a Windows bridge claim to be the phone). Pure function: no I/O, no
// module state; pass the decoded fields and a frozen `nowMs`. Note that key
// order inside s24AttestationChecks is load-bearing (firstFailedCheck reports
// the first false key as the reason) — reordering it here or there is a
// contract change, not a tidy-up.
export function computeS24Liveness(fields, nowMs) {
  const DEFAULT_INTERVAL_SECONDS = { 'android-phone': 900 };
  const heartbeatIntervalSeconds = typeof fields.heartbeatIntervalSeconds === 'number'
    ? fields.heartbeatIntervalSeconds
    : (DEFAULT_INTERVAL_SECONDS[fields.deviceType] || 45);
  const heartbeatAgeSeconds = nonFutureAgeSeconds(fields.lastSeen, nowMs);
  const lastCommandAckAt = commandAckTimestamp(fields);
  const lastCommandAckAgeSeconds = nonFutureAgeSeconds(lastCommandAckAt, nowMs);
  const liveness = strictS24Liveness(fields, heartbeatAgeSeconds, lastCommandAckAgeSeconds);
  return {
    heartbeatAgeSeconds,
    lastCommandAckAt,
    lastCommandAckAgeSeconds,
    liveness,
    heartbeatMaxAgeSeconds: S24_ACK_MAX_AGE_SECONDS,
    heartbeatIntervalSeconds,
  };
}

async function handleDevices(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // The enrolled-device roster, and with ?full=1 the whole stored payload.
  // That payload is PII — IPs, SSIDs, command bodies, and with
  // ?subcollections=1 call logs, SMS and contacts — so this route is keyed.
  // The keyless view for /s24 visitors is ./s24-public.js, which projects the
  // single S24 document down to a PII-free shape instead of opening this one.
  if (!requireKey(req, res)) return;
  if (!FIREBASE_SA_JSON) {
    return res.status(503).json({ success: false, error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' });
  }

  try {
    const includeFullPayload = String(req.query.full || '') === '1';
    // Opt-in fetch of per-device data subcollections (whatsappMedia, callLogs,
    // sms, contacts). Off by default because each device costs 4 extra list
    // reads; on when the dashboard's Firestore section asks for it.
    const includeSubcollections = String(req.query.subcollections || '') === '1';
    const subLimit = Math.max(1, Math.min(parseInt(req.query.sub_limit) || 20, 50));
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
      const isS24 = isS24Document(deviceId, f);
      // The S24 branch delegates to computeS24Liveness — the same helper
      // ./s24-public.js runs — so a keyed client and the open /s24 page can
      // never disagree about whether the phone is alive. Non-S24 documents
      // keep the plain timestamp-freshness path that predates attestation.
      const s24 = isS24 ? computeS24Liveness(f, now) : null;
      const heartbeatAgeSeconds = s24 ? s24.heartbeatAgeSeconds : nonFutureAgeSeconds(lastSeen, now);
      const heartbeatMaxAgeSeconds = s24 ? s24.heartbeatMaxAgeSeconds : 3 * interval;
      const heartbeatFresh = heartbeatAgeSeconds !== null && heartbeatAgeSeconds <= heartbeatMaxAgeSeconds;
      const lastCommandAckAt = s24 ? s24.lastCommandAckAt : commandAckTimestamp(f);
      const lastCommandAckAgeSeconds = s24 ? s24.lastCommandAckAgeSeconds : nonFutureAgeSeconds(lastCommandAckAt, now);
      const strict = s24
        ? s24.liveness
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
        // For S24 documents this comes from computeS24Liveness so the interval
        // the dashboard displays and the one the public ./s24-public.js projection
        // publishes are the same value by construction. The local `interval`
        // remains for the non-S24 heartbeat window below — two live formulas for
        // one constant is exactly the drift pattern this file's header documents.
        heartbeatIntervalSeconds: s24 ? s24.heartbeatIntervalSeconds : interval,
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

    // Filter out ghost documents — devices with zero Firestore fields are
    // enrollment artifacts that pollute the roster.
    const ghostIds = new Set(['g4g-laptop']);
    const filteredDevices = devices.filter(d => !ghostIds.has(d.deviceId));

    // Site video-event relay state: last play event from jaytibirthday.in and
    // which devices acknowledged it (seenBy map written by the device watchers).
    let videoEvent = null;
    let videoEventError = null;
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
    } catch (e) {
      // Was `catch { videoEvent = null; }`, which made "the relay read failed"
      // and "there is no relay event" the same value. The dashboard renders the
      // null as absence, so a Firestore outage looked like a quiet, working
      // system with nothing to report -- the failure mode this repo's liveness
      // rules exist to prevent.
      videoEvent = null;
      videoEventError = e && e.message ? String(e.message).slice(0, 200) : 'settings/siteVideoEvents read failed';
    }

    // Subcollections — one Firestore list per (device, subcollection). Runs
    // in parallel across devices so the overall wall-clock stays close to the
    // slowest single subcollection read, not the sum. Failures on one device
    // don't take down the whole response; that device just gets an empty map.
    if (includeSubcollections) {
      const SUBS = ['whatsappMedia', 'callLogs', 'sms', 'contacts'];
      await Promise.all(filteredDevices.map(async (d) => {
        const perDevice = {};
        await Promise.all(SUBS.map(async (name) => {
          try {
            const sr = await fetch(
              `${base}/devices/${encodeURIComponent(d.deviceId)}/${encodeURIComponent(name)}?pageSize=${subLimit}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!sr.ok) { perDevice[name] = []; return; }
            const sd = await sr.json();
            perDevice[name] = (sd.documents || []).map((doc) => {
              const out = { id: (doc.name || '').split('/').pop() };
              for (const [k, v] of Object.entries(doc.fields || {})) out[k] = dec(v);
              return out;
            });
          } catch (_) {
            perDevice[name] = [];
          }
        }));
        d.subcollections = perDevice;
      }));
    }

    return res.status(200).json({
      success: true,
      source: 'firestore',
      database: FIRESTORE_DB,
      generated_at: new Date().toISOString(),
      devices: filteredDevices,
      videoEvent,
      videoEventError,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'jp-devices failed' });
  }
}

async function handleDeviceHistory(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Per-device telemetry, including network and location detail. Keyed for the
  // same reason the roster is: it is the complete browsing trail.
  if (!requireKey(req, res)) return;
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return res.status(503).json({ success: false, error: 'AWS credentials not configured' });
  }

  const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 90);
  const cutoff = Date.now() - days * 86400000;

  try {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({
      region: AWS_REGION,
      credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY }
    }));

    // `truncated` is surfaced, not swallowed. A page ceiling or the time budget
    // can stop the scan before the table ends, and a partial total presented as
    // a complete one is worse than an error because nothing looks wrong.
    const scan = await scanBounded(client, TABLE);
    const items = scan.items;
    const historyEvents = items.filter(i =>
      i.epoch && i.epoch >= cutoff &&
      (i.eventType === 'browser_history' || i.eventType === 'device_history')
    );

    const entries = [];
    for (const d of historyEvents) {
      const data = d.eventData || {};
      const list = Array.isArray(data.entries) ? data.entries : (Array.isArray(data.history) ? data.history : []);
      const idn = resolveIdentity(d.visitorId);
      for (const e of list) {
        entries.push({
          url: e.url || e.title || null,
          title: e.title || null,
          visitedAt: e.visitedAt || e.timestamp || d.timestamp || null,
          browser: e.browser || data.browser || null,
          device: idn.canonical,
          deviceLabel: idn.label,
          ip: idn.ip || d.ip || null,
        });
      }
    }

    entries.sort((a, b) => (b.visitedAt || '').localeCompare(a.visitedAt || ''));

    // device summary: every device that has sent any event in the window
    const deviceMap = new Map();
    for (const d of items) {
      if (!d.epoch || d.epoch < cutoff) continue;
      const idn = resolveIdentity(d.visitorId);
      const dev = idn.canonical;
      const cur = deviceMap.get(dev) || { device: dev, label: idn.label, events: 0, types: {}, first: null, last: null, ip: null };
      cur.events++;
      cur.types[d.eventType || 'unknown'] = (cur.types[d.eventType || 'unknown'] || 0) + 1;
      if (d.timestamp) {
        if (!cur.first || d.timestamp < cur.first) cur.first = d.timestamp;
        if (!cur.last || d.timestamp > cur.last) cur.last = d.timestamp;
      }
      // known identity IP wins over whatever network the event arrived from
      if (idn.ip) cur.ip = idn.ip;
      else if (d.ip) cur.ip = d.ip;
      deviceMap.set(dev, cur);
    }
    const devices = [...deviceMap.values()].sort((a, b) => (b.last || '').localeCompare(a.last || ''));

    // full event dump for one device when ?device= is given
    let deviceEvents = null;
    const knownCanonicals = new Set();
    const requestedDevice = String(req.query.device || '').trim() || null;
    if (req.query.device) {
      const dev = req.query.device;
      const evs = items.filter(i => {
        if (!i.epoch || i.epoch < cutoff) return false;
        const idn = resolveIdentity(i.visitorId);
        return idn.canonical === dev;
      });
      // Every canonical identity this table can actually yield, whether or not
      // it had events inside the window -- that is what makes "unknown device"
      // distinguishable from "quiet device".
      for (const i of historyEvents) knownCanonicals.add(resolveIdentity(i.visitorId).canonical);
      for (const k of Object.keys(IDENTITY_MAP)) knownCanonicals.add(IDENTITY_MAP[k].canonical);
      evs.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
      deviceEvents = evs.map(d => {
        const idn = resolveIdentity(d.visitorId);
        return {
          event_type: d.eventType,
          timestamp: d.timestamp,
          url: d.pageUrl || d.eventData?.url || null,
          title: d.pageTitle || d.eventData?.title || null,
          browser: d.browser || d.eventData?.browser || null,
          page_url: d.pageUrl,
          page_title: d.pageTitle,
          ip: idn.ip || d.ip,
          // Same percent-encoded DynamoDB rows the visitor drawer reads - decode
          // here too, or the device table and the drawer disagree on one value.
          country: decodeOne(d.country),
          city: decodeOne(d.city),
          userAgent: d.userAgent,
          time_on_page: d.timeOnPage,
          scroll_percent: d.scrollPercent,
          fingerprint: d.fingerprint,
          event_data: d.eventData,
          // Preserve the complete DynamoDB item for the dashboard's raw
          // payload viewer. The normalized fields above remain unchanged.
          full_payload: d,
          visitor_id: d.visitorId,
          device_label: idn.label,
        };
      });
    }

    return res.status(200).json({
      success: true,
      source: 'dynamodb',
      ...(scan.truncated ? { truncated: true } : {}),
      generated_at: new Date().toISOString(),
      window_days: days,
      total_events: historyEvents.length,
      total_entries: entries.length,
      entries: entries.slice(0, 500),
      devices,
      device_events: deviceEvents,
      // Whether the requested device can EVER produce events here, as distinct
      // from having none in this window.
      //
      // device_events is filtered by `resolveIdentity(visitorId).canonical ===
      // dev`, so a device that never writes to this DynamoDB table -- or whose
      // browser visitorId is absent from IDENTITY_MAP -- matches nothing however
      // long the window. Frontend/vivobook.html asks for 'jayti-asus-vivobook'
      // and rendered the empty result as "No events synced yet", which reads as
      // a quiet device rather than a query that cannot succeed.
      ...(requestedDevice ? {
        device_requested: requestedDevice,
        device_known: knownCanonicals.has(requestedDevice),
      } : {}),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'jp device history failed' });
  }
}

export default async function handler(req, res) {
  // Route: /api/jp-device (or /api/jp-device?days=...&device=...)
  if (req.url?.startsWith('/api/jp-device') && !req.url?.startsWith('/api/jp-devices')) {
    return handleDeviceHistory(req, res);
  }
  // Route: /api/jp-devices (or /api/jp-devices?full=1)
  return handleDevices(req, res);
}
