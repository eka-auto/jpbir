import crypto from 'crypto';
import { decodeOne } from './lib/geo.js';
import {
  S24_DEVICE_ID,
  S24_ACK_MAX_AGE_SECONDS,
  S24_RUNTIME_EVIDENCE,
  s24AttestationChecks,
  s24CommandAckConsistent,
  s24LivenessVerdict,
} from './lib/s24-attestation.js';
import { requireKey } from './_auth.js';
import { DEVICE_IDS, splitFleet } from './broker.js';
import { query, isConfigured } from '../Integrations/postgres.js';
import { projectFields } from './lib/section-data.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const FIREBASE_SA_JSON = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'];
const FIRESTORE_DB = _env['FIRESTORE_' + 'DB'] || 'eka-agent';

let _tokenCache = { token: null, exp: 0 };

// Upstream bodies never go into an Error message. The handler below answers a
// failure with err.message, jp-stack.js and stack-cron.js put the same message
// on the dashboard's stack panel, and both throw sites below used to build it
// around the body Google sent back: OAuth's JSON, Firestore's JSON, or an HTML
// error page when Google's front end answered. That put raw JSON and HTML on
// screen, against the dashboard rule that nothing raw reaches it (jteka.html
// had to scrub it in the browser, #114). What an operator needs is the one
// sentence inside Google's two error envelopes --
//   OAuth      {"error":"invalid_grant","error_description":"Invalid JWT Signature."}
//   Firestore  {"error":{"code":403,"message":"Missing or insufficient permissions.","status":"PERMISSION_DENIED"}}
// -- and anything without one (HTML, a proxy page, an empty body) is described
// by its status. A candidate that itself holds braces or markup is refused.
export function upstreamMessage(body, status) {
  const o = body && typeof body === 'object' ? body : null;
  const err = o && o.error;
  const candidates = o
    ? [o.error_description, err && typeof err === 'object' ? err.message : null, typeof err === 'string' ? err : null, o.message]
    : [];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const s = c.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
    if (s && s.length <= 300 && !/[{}<>]/.test(s)) return s;
  }
  return 'HTTP ' + status;
}

// A malformed secret must not be quoted back. V8's JSON.parse error quotes the
// text it choked on ('Unexpected token ..., "..." is not valid JSON'), and here
// that text is a service-account private key; thrown as-is, a fragment of it
// went out in this route's 500 body. The message names the secret and what is
// wrong with it, never anything from inside it.
function serviceAccount() {
  let sa;
  try { sa = JSON.parse(FIREBASE_SA_JSON); } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON — paste the whole service-account key file into the secret');
  }
  if (!sa || typeof sa !== 'object' || !sa.private_key || !sa.client_email || !sa.project_id) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing private_key, client_email or project_id');
  }
  return sa;
}

// Exported because `jp-stack.js` probes Firestore reachability for the Product
// engineering panel and must exercise the *same* credential path this handler
// uses — a second copy of the JWT exchange could pass while this one fails (or
// the reverse) and the panel would report health this endpoint does not have.
export async function getFirestoreToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.exp - 60000) return _tokenCache.token;
  const sa = serviceAccount();
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
    const detail = upstreamMessage(data, res.status);
    // Status and Google's own sentence only: the dashboard's Vercel panel
    // renders runtime log text, so the body stays out of the log as well.
    console.error('[jp-devices] token exchange failed', res.status, detail);
    // `invalid_grant` means Google rejected the signed assertion itself — almost
    // always because the FIREBASE_SERVICE_ACCOUNT_JSON key has been revoked or
    // rotated, so its public half no longer matches the service account. The
    // signing above is not at fault; the credential is. Say so, so the fix is a
    // key rotation and not a hunt through this code.
    if (data.error === 'invalid_grant') {
      throw new Error('token exchange failed: ' + detail + ' — the FIREBASE_SERVICE_ACCOUNT_JSON key is invalid, revoked, or rotated; generate a fresh service-account key and update the secret.');
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
   if ('integerValue' in v) { const n=Number(v.integerValue); return Number.isSafeInteger(n)?n:String(v.integerValue); }
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

/**
 * The Firestore REST value decoder, exported.
 *
 * It was private to this file, which left the Product engineering panel
 * needing its own decoder to read the same device documents — and a second
 * decoder is a second liveness rule. This repo has already shipped two
 * implementations of the S24 liveness policy that disagreed (see
 * ./lib/s24-attestation.js), so the decoder travels with the module it
 * belongs to instead of being copied into a second file.
 */
export function decodeFirestoreValue(v) {
  return dec(v);
}

/** Decode every field of a Firestore REST document into plain values. */
export function decodeFirestoreDocument(doc) {
  const out = {};
  for (const [k, v] of Object.entries((doc && doc.fields) || {})) out[k] = dec(v);
  return out;
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

const LIVE_REASONS = {
  'signed-broker-v2': 'signed broker heartbeat is authenticated and fresh',
  'legacy-strict': 'legacy heartbeat and completed command acknowledgement are authenticated and fresh',
};

export function strictS24Liveness(fields, heartbeatAgeSeconds, ackAgeSeconds, options = {}) {
  const enrollment = fields.enrollment || {};
  const checks = s24AttestationChecks({
    agentVersion: fields.agentVersion,
    connectionMethod: fields.connectionMethod,
    heartbeatAuth: fields.heartbeatAuth,
    liveDeviceVerified: fields.liveDeviceVerified,
    sourceType: fields.sourceType,
    runtimeIsAndroid: fields[S24_RUNTIME_EVIDENCE],
    heartbeatAgeSeconds,
    ackAgeSeconds,
    ackConsistent: s24CommandAckConsistent(fields),
    lastSeen: fields.lastSeen,
    signedHeartbeatAt: enrollment.lastSignedHeartbeatAt,
    signedHeartbeatKeyId: enrollment.lastSignedHeartbeatKeyId,
    signedHeartbeatProtocol: enrollment.lastSignedHeartbeatProtocol,
    activeKeyId: enrollment.activeKeyId,
    keyType: enrollment.keyType,
    // Optional and defaulted: the dashboard and the public projection keep the
    // module's own bound, and the Product engineering panel passes the S24's
    // declared reporting period. See ./lib/s24-attestation.js.
    heartbeatMaxAgeSeconds: options.heartbeatMaxAgeSeconds,
  });
  // Which checks a mode requires is the shared module's decision, not this file's: a local
  // copy of those lists is how `live` and `reason` could come to disagree.
  const { evidenceMode, failedCheck } = s24LivenessVerdict(checks);
  return {
    mode: 'strict-s24-attestation',
    live: evidenceMode !== null,
    evidenceMode,
    heartbeatAuthenticated: evidenceMode !== null,
    commandExecutionRecentlyProven: checks.commandAckFresh,
    checks,
    reason: failedCheck ? `${failedCheck} is missing or stale` : LIVE_REASONS[evidenceMode],
  };
}

// The whole of "is this S24 document evidence that the physical phone is alive":
// heartbeat and command-ACK ages, the strict attestation verdict, and the
// heartbeat interval/max-age pair the frontend needs to render them. It exists
// as one exported helper because there are now TWO readers of exactly this math
// — handleDevices below (keyed, full roster) and the unauthenticated projection
// in ./s24-public.js — and two implementations of a liveness rule computing
// differently is this repo's signature failure mode (see ./lib/s24-attestation.js:
// the jp-agent and dashboard copies drifted twice in one day, and the second
// drift let a Windows bridge claim to be the phone). Pure function: no I/O, no
// module state; pass the decoded fields and a frozen `nowMs`. Note that key
// order inside s24AttestationChecks is load-bearing (s24LivenessVerdict reports
// the first false required key as the reason) — reordering it here or there is a
// contract change, not a tidy-up.
export function computeS24Liveness(fields, nowMs, options = {}) {
  const DEFAULT_INTERVAL_SECONDS = { 'android-phone': 900 };
  const heartbeatIntervalSeconds = typeof fields.heartbeatIntervalSeconds === 'number'
    ? fields.heartbeatIntervalSeconds
    : (DEFAULT_INTERVAL_SECONDS[fields.deviceType] || 45);
  const heartbeatAgeSeconds = nonFutureAgeSeconds(fields.lastSeen, nowMs);
  const lastCommandAckAt = commandAckTimestamp(fields);
  const lastCommandAckAgeSeconds = nonFutureAgeSeconds(lastCommandAckAt, nowMs);
  const liveness = strictS24Liveness(fields, heartbeatAgeSeconds, lastCommandAckAgeSeconds, options);
  return {
    heartbeatAgeSeconds,
    lastCommandAckAt,
    lastCommandAckAgeSeconds,
    liveness,
    heartbeatMaxAgeSeconds: S24_ACK_MAX_AGE_SECONDS,
    heartbeatIntervalSeconds,
  };
}

// Which watchers picked up the play the Video relay panel is showing.
//
// A watcher records an acknowledgement in two places, and the panel used to
// read the one that cannot say which play it was for:
//   - settings/siteVideoEvents.seenBy.<id>: the time that watcher last
//     acknowledged *a* play. Nothing clears it. The site relay
//     (jaytibirthday-site Backend/api/video-event.js) PATCHes seven named
//     fields and seenBy is not one of them, so an entry outlives its play.
//   - devices/<id>.lastVideoEventAck / lastVideoEventAckAt: the id of the
//     play that watcher last handled, and when.
// The panel printed every seenBy key as a ✓ beside the newest play. A watcher
// that had stopped kept "picking up" every later play, and the Lenovo showed a
// second ✓ under `g4g-laptop`, the id its watcher wrote until 2026-09-23 (see
// DEVICE_IDS in broker.js). On 2026-09-24 the laptop's own log showed it
// catching two plays 57 s and 8 s after they fired; the panel could not tell
// those acknowledgements from ones a week old.
//
// So an acknowledgement counts for the displayed play only when it is tied to
// that play: the device document names the play's id, or, failing a current
// named id, the seenBy time is at or after the play. The id is preferred
// because a time can belong to the previous play: a watcher that read play A
// and wrote its ack after play B landed passes a time test for B, and site
// visits fire two plays half a second apart. But the id only counts while it
// is the watcher's newest acknowledgement. fleet:register (jaytibirthday-site)
// restores lastVideoEventAck onto a re-created document, so a seenBy time
// newer than the document's ack means the id is stale, and the time decides.
// Everything else is still returned, as an earlier acknowledgement, because
// "last acknowledged three days ago" is how a stopped watcher shows itself.
// Ids outside the fleet are returned with fleet:false, not dropped, the same
// way the roster names other_documents.
//
// Pure: `event` is the decoded settings doc, `deviceAcks` maps a fleet device
// id to { eventId, at } from its own document.
export function videoEventWatchers(event, deviceAcks, fleetIds = DEVICE_IDS) {
  const ev = event && typeof event === 'object' ? event : {};
  // dec() turns an arrayValue into [], which `|| {}` does not catch.
  const seenBy = ev.seenBy && typeof ev.seenBy === 'object' && !Array.isArray(ev.seenBy) ? ev.seenBy : {};
  const named = deviceAcks && typeof deviceAcks === 'object' ? deviceAcks : {};
  const eventMs = typeof ev.lastEventAt === 'string' ? Date.parse(ev.lastEventAt) : NaN;
  const str = (v) => (typeof v === 'string' && v ? v : null);

  const watchers = [];
  for (const deviceId of new Set([...Object.keys(seenBy), ...Object.keys(named)])) {
    const own = named[deviceId] && typeof named[deviceId] === 'object' ? named[deviceId] : {};
    const namedId = str(own.eventId);
    const namedAt = str(own.at);
    const seenAt = str(seenBy[deviceId]);
    const idCurrent = Boolean(namedId) && !(Date.parse(seenAt) > Date.parse(namedAt));
    const ackedAt = idCurrent ? namedAt || seenAt : seenAt || namedAt;
    const ackMs = ackedAt ? Date.parse(ackedAt) : NaN;
    const forThisEvent = Boolean(ev.lastEventId) && (idCurrent
      ? namedId === ev.lastEventId
      : Number.isFinite(ackMs) && Number.isFinite(eventMs) && ackMs >= eventMs);
    // The ack time is the watcher's clock and the play time is Vercel's, so a
    // negative gap is skew, not a lag, and is reported as unknown.
    const lagMs = forThisEvent ? ackMs - eventMs : NaN;
    watchers.push({
      deviceId,
      fleet: fleetIds.includes(deviceId),
      forThisEvent,
      ackedEventId: idCurrent ? namedId : null,
      ackedAt,
      lagSeconds: lagMs >= 0 ? Math.round(lagMs / 100) / 10 : null,
    });
  }

  const ms = (w) => (w.ackedAt && Number.isFinite(Date.parse(w.ackedAt)) ? Date.parse(w.ackedAt) : -Infinity);
  return watchers.sort((a, b) =>
    (b.forThisEvent - a.forThisEvent) || (b.fleet - a.fleet) || (ms(b) - ms(a)) || a.deviceId.localeCompare(b.deviceId));
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
    const base = `https://firestore.googleapis.com/v1/projects/${serviceAccount().project_id}/databases/${FIRESTORE_DB}/documents`;
    const r = await fetch(`${base}/devices`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      // See upstreamMessage(): Google's sentence, never its body.
      const text = await r.text().catch(() => '');
      let body = null;
      try { body = JSON.parse(text); } catch { /* HTML or empty: described by status */ }
      const detail = upstreamMessage(body, r.status);
      console.error('[jp-devices] firestore read failed', r.status, detail);
      throw new Error('firestore read failed: ' + detail);
    }
    const data = await r.json();
    // The roster is the fleet (DEVICE_IDS in broker.js), not the collection.
    // This used to drop one hard-coded ghost id, `g4g-laptop`, and list the
    // rest, so the channel-sandbox test agent's `eka-cloud-sandbox` document sat
    // in the table and made "Total devices" 4 when there are three devices. The
    // documents left out are named in `other_documents`, not silently hidden.
    const { fleet, other: otherDocuments } = splitFleet(data.documents);

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
    // Each fleet document's own video-watcher acknowledgement, for
    // videoEventWatchers() below.
    const videoAcks = {};
    const devices = fleet.map((d) => {
      const f = {};
      for (const [k, v] of Object.entries(d.fields || {})) f[k] = dec(v);
      const deviceId = d.name.split('/').pop();
      if (f.lastVideoEventAck) videoAcks[deviceId] = { eventId: f.lastVideoEventAck, at: f.lastVideoEventAckAt || null };
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
        display_values: projectFields(f),
        ...(includeFullPayload ? { full_payload: f } : {}),
      };
    });

    devices.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));

    // Site video-event relay state: last play event from jaytibirthday.in and
    // which watchers acknowledged that play. seenBy is passed through as stored;
    // `watchers` is the verdict the panel renders (videoEventWatchers above).
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
          watchers: videoEventWatchers(f, videoAcks),
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
      await Promise.all(devices.map(async (d) => {
        const perDevice = {};
        await Promise.all(SUBS.map(async (name) => {
          try {
            const sr = await fetch(
              `${base}/devices/${encodeURIComponent(d.deviceId)}/${encodeURIComponent(name)}?pageSize=${subLimit}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
             if (!sr.ok) { perDevice[name] = null; return; }
            const sd = await sr.json();
            perDevice[name] = (sd.documents || []).map((doc) => {
               const out = { id: (doc.name || '').split('/').pop(), source_updated_at:doc.updateTime };
              for (const [k, v] of Object.entries(doc.fields || {})) out[k] = dec(v);
              return out;
            });
          } catch (_) {
             perDevice[name] = null;
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
      devices,
      other_documents: otherDocuments,
      videoEvent,
      videoEventError,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'jp-devices failed' });
  }
}

async function handleDeviceHistory(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireKey(req, res)) return;
  if (!isConfigured()) return res.status(503).json({ success: false, error: 'DATABASE_URL not set on this deployment' });
  const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 90);
  try {
    const result = await query(
      `SELECT event_type, occurred_at, visitor_id, page_url, page_title, ip,
              country, city, user_agent, time_on_page, scroll_percent,
              fingerprint, browser, event_data, raw_payload
         FROM events WHERE occurred_at > now() - ($1 || ' days')::interval
         ORDER BY occurred_at DESC`, [days]);
    const items = result.rows;
    const deviceMap = new Map();
    const entries = [];
    for (const d of items) {
      const idn = resolveIdentity(d.visitor_id);
      const dev = idn.canonical;
      const cur = deviceMap.get(dev) || { device: dev, label: idn.label, events: 0, types: {}, first: null, last: null, ip: null };
      cur.events++;
      cur.types[d.event_type || 'unknown'] = (cur.types[d.event_type || 'unknown'] || 0) + 1;
      const timestamp = d.occurred_at instanceof Date ? d.occurred_at.toISOString() : d.occurred_at;
      if (timestamp) {
        if (!cur.first || timestamp < cur.first) cur.first = timestamp;
        if (!cur.last || timestamp > cur.last) cur.last = timestamp;
      }
      if (idn.ip) cur.ip = idn.ip;
      else if (d.ip) cur.ip = d.ip;
      const data = d.event_data || {};
      if (d.event_type === 'browser_history' || d.event_type === 'device_history') {
        const list = Array.isArray(data.entries) ? data.entries : (Array.isArray(data.history) ? data.history : []);
        for (const entry of list) entries.push({
          url: entry.url || entry.title || null, title: entry.title || null,
          visitedAt: entry.visitedAt || entry.timestamp || timestamp || null,
          browser: entry.browser || data.browser || d.browser || null,
          device: idn.canonical, deviceLabel: idn.label, ip: idn.ip || d.ip || null,
        });
      }
      deviceMap.set(dev, cur);
    }
    entries.sort((a, b) => (b.visitedAt || '').localeCompare(a.visitedAt || ''));
    const devices = [...deviceMap.values()].sort((a, b) => (b.last || '').localeCompare(a.last || ''));
    let deviceEvents = null;
    const knownCanonicals = new Set();
    const requestedDevice = String(req.query.device || '').trim() || null;
    if (req.query.device) {
      const dev = req.query.device;
      const evs = items.filter((item) => resolveIdentity(item.visitor_id).canonical === dev);
      for (const item of items) knownCanonicals.add(resolveIdentity(item.visitor_id).canonical);
      for (const k of Object.keys(IDENTITY_MAP)) knownCanonicals.add(IDENTITY_MAP[k].canonical);
      deviceEvents = evs.map((d) => {
        const idn = resolveIdentity(d.visitor_id);
        const timestamp = d.occurred_at instanceof Date ? d.occurred_at.toISOString() : d.occurred_at;
        return {
          event_type: d.event_type, timestamp,
          url: d.page_url || d.event_data?.url || null,
          title: d.page_title || d.event_data?.title || null,
          browser: d.browser || d.event_data?.browser || null,
          page_url: d.page_url, page_title: d.page_title,
          ip: idn.ip || d.ip,
          country: decodeOne(d.country),
          city: decodeOne(d.city),
          userAgent: d.user_agent, time_on_page: d.time_on_page, scroll_percent: d.scroll_percent,
          fingerprint: d.fingerprint,
          event_data: d.event_data,
          full_payload: d,
          visitor_id: d.visitor_id,
          device_label: idn.label,
        };
      });
    }

    return res.status(200).json({
      success: true,
      source: 'neon',
      generated_at: new Date().toISOString(),
      window_days: days,
      total_events: items.length,
      total_entries: entries.length,
      entries: entries.slice(0, 500),
      devices,
      device_events: deviceEvents,
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
