import crypto from 'crypto';
import { decodeOne } from './lib/geo.js';
import { requireKey } from './_auth.js';
import { query as pgQuery, isConfigured as pgIsConfigured } from '../Integrations/postgres.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const FIREBASE_SA_JSON = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'];
const FIRESTORE_DB = _env['FIRESTORE_' + 'DB'] || 'eka-agent';

// Neon device_telemetry is the freshness source of truth. When a Firestore
// device doc has not been updated recently (the phone daemon died, a bridge
// never wrote back, etc.), the Neon row carries the real last-seen time and
// current telemetry. The overlay merges only when Neon is strictly fresher —
// it never downgrades a live Firestore doc.
const NEON_FRESHNESS_WINDOW_SECONDS = 24 * 60 * 60;

async function readNeonTelemetry() {
  if (!pgIsConfigured()) return new Map();
  try {
    const { rows } = await pgQuery(
      `SELECT device_id, online, last_seen_at, agent_version, battery_level,
              cpu_temp_c, carrier, network_type, public_ip, phone_country,
              connection, kind, display_name, model, vendor, os_version
         FROM device_telemetry`
    );
    const map = new Map();
    for (const row of rows) {
      map.set(row.device_id, row);
    }
    return map;
  } catch {
    return new Map();
  }
}

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

// Both of these prefixes name the S24's own agent. The collector that actually
// ships to the phone writes s24-direct-cloud-<date>.<n> — its own
// currentDirectCloudRuntime.expectedAgentVersion says so — but this check only
// ever accepted s24-termux-, a prefix no real writer produced. So
// authenticatedAgent could never pass and the S24 stayed offline on the
// dashboard however fresh its heartbeat was, while the regression tests stayed
// green because their fixture asserted against the same fictional string.
//
// Widening costs little. The comment below already records that a version string
// is one edit away from matching, and runtimeIsAndroid — written by the
// collector from the platform it is actually executing on — is the control that
// caught the off-device Windows bridge. A bridge copying either prefix still
// fails androidRuntime, which device-liveness.test.mjs now asserts against the
// real production version string rather than an invented one.
const S24_AGENT_VERSION_PREFIXES = ['s24-termux-', 's24-direct-cloud-'];

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
      S24_AGENT_VERSION_PREFIXES.some(p => fields.agentVersion.startsWith(p)),
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

    // ── Neon freshness overlay ──────────────────────────────────────────
    // Firestore is the enrollment authority but its device docs go stale when
    // the phone daemon dies. Neon's device_telemetry table is written by the
    // ingest pipeline and carries the real heartbeat time. When Neon knows a
    // device is fresher than Firestore, merge its telemetry in so the
    // dashboard shows the truth rather than the last Firestore write.
    let neonSource = 'unavailable';
    try {
      const telemetry = await readNeonTelemetry();
      neonSource = telemetry.size > 0 ? 'merged' : 'empty';
      for (const device of devices) {
        const neon = telemetry.get(device.deviceId);
        if (!neon) continue;
        const neonAge = neon.last_seen_at
          ? Math.round((now - new Date(neon.last_seen_at).getTime()) / 1000)
          : null;
        const firestoreAge = device.lastSeenAgeSeconds;
        const neonIsFresher = neonAge !== null &&
          (firestoreAge === null || neonAge < firestoreAge);
        if (!neonIsFresher) continue;
        // Neon is strictly fresher — overlay live state and telemetry.
        const neonLive = neon.online === true && neonAge !== null &&
          neonAge <= NEON_FRESHNESS_WINDOW_SECONDS;
        device.online = neon.online === true;
        device.live = neonLive;
        device.lastSeen = neon.last_seen_at ? new Date(neon.last_seen_at).toISOString() : device.lastSeen;
        device.lastSeenAgeSeconds = neonAge;
        device.liveness = {
          mode: 'neon-telemetry-override',
          live: neonLive,
          checks: {
            neonFresh: neonAge !== null && neonAge <= NEON_FRESHNESS_WINDOW_SECONDS,
            neonOnline: neon.online === true,
          },
          reason: neonLive
            ? `Neon device_telemetry is fresher (${neonAge}s ago) than Firestore (${firestoreAge ?? '?'}s ago)`
            : `Neon telemetry exists but device is not live (online=${neon.online}, age=${neonAge ?? '?'}s)`,
          firestoreAgeSeconds: firestoreAge,
          neonAgeSeconds: neonAge,
        };
        if (neon.agent_version) device.agentVersion = neon.agent_version;
        if (neon.connection) device.connectionMethod = neon.connection;
        if (neon.model) device.model = neon.model;
        if (neon.display_name) device.deviceDisplayName = neon.display_name;
        // Merge Neon network/telemetry into the network object.
        const neonNet = {
          ...device.network,
          publicIp: neon.public_ip || (device.network && device.network.publicIp) || null,
          networkType: neon.network_type || (device.network && device.network.networkType) || null,
          carrier: neon.carrier || null,
          phoneCountry: neon.phone_country || null,
          batteryLevel: neon.battery_level ?? null,
          cpuTempC: neon.cpu_temp_c ?? null,
          source: 'neon-telemetry',
          updatedAt: neon.last_seen_at || (device.network && device.network.updatedAt) || null,
        };
        device.network = neonNet;
        device.neonOverlay = { applied: true, neonAgeSeconds: neonAge, firestoreAgeSeconds: firestoreAge };
      }
      // Re-sort after overlay may have changed lastSeen values.
      devices.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));
    } catch { neonSource = 'error'; }

    // Filter out ghost documents — devices with zero Firestore fields and no
    // Neon telemetry are enrollment artifacts that pollute the roster.
    const ghostIds = new Set(['g4g-laptop']);
    const filteredDevices = devices.filter(d => !ghostIds.has(d.deviceId));

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
      source: 'firestore+neon',
      database: FIRESTORE_DB,
      neon: neonSource,
      generated_at: new Date().toISOString(),
      devices: filteredDevices,
      videoEvent,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'jp-devices failed' });
  }
}
