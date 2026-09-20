// GET /api/s24-public — the unauthenticated, narrowed public projection of the
// S24's live status, for the /s24 page.
//
// Why this file exists. /s24 has always been meant to load for any visitor,
// with no unlock gate in the browser. The data behind it was never meant to be
// public: /api/jp-devices returns, for every enrolled device, observed and
// public IPs, SSID/BSSID and the network map, every command body in the queue,
// raw stored payloads, and with ?subcollections=1 call logs, SMS and contacts.
// On 2026-09-20 those two facts collided: commit f372da6 (07:11Z) removed the
// requireKey() gate from /api/jp-devices and /api/jp-device to make /s24 work
// for visitors — publishing the PII along with the status — and its parent
// merge b2c1778 (07:16Z) restored requireKey() to both, leaving production
// with an open frontend page calling a gated backend: visitors without the
// dashboard key got 401 "invalid key" on a page that was supposed to show them
// a status. Keying everything and keying nothing were both wrong; the missing
// piece was a narrowed public projection, which is this route.
//
// The rule this file upholds:
//   * It is the ONLY unauthenticated device route in the API surface
//     (vercel.json: /api/s24-public -> this file). Full device data lives
//     behind requireKey in ./jp-devices.js and stays there.
//   * Its scope is the single S24 document (devices/samsung-s24-ultra). It
//     never enumerates /devices, never reads ?full=1 payloads, subcollections,
//     or the siteVideoEvents document.
//   * Its shape is publicS24View below: a hand-picked, PII-free projection.
//     Exact timestamps and command bodies appear only when the caller passes
//     the dashboard key (precise=true); a missing or wrong key downgrades
//     precision, it never denies service.
//   * Adding a field here is a disclosure decision, not a convenience one.
//
// The strict liveness math is NOT duplicated here: it is imported from
// ./jp-devices.js (computeS24Liveness) exactly like the keyed handler calls
// it, so the open page and the operator's dashboard can never disagree about
// whether the phone is alive — two implementations of one liveness rule
// drifting apart is the incident log this repo is written in (see
// ./lib/s24-attestation.js).
//
// Broker exports what we need from Firestore: fsGet returns the raw Firestore
// REST document — { name, fields: { key: { stringValue | booleanValue |
// integerValue | doubleValue | timestampValue | mapValue | arrayValue }, ... },
// updateTime } — and `dec` is the shared decoder that turns those typed
// values into plain JS (timestampValue decodes to its ISO-8601 string). The
// decoder lives in broker.js precisely so this kind of reader does not
// re-invent it; an un-decoded {timestampValue: ...} object must never reach
// Date.parse.

import { fsGet, dec } from './broker.js';
import { S24_DEVICE_ID } from './lib/s24-attestation.js';
import { computeS24Liveness, normalizeCommandQueue } from './jp-devices.js';
import { checkKey } from './_auth.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const FIREBASE_SA_JSON = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'];
const FIRESTORE_DB = _env['FIRESTORE_' + 'DB'] || 'eka-agent';

const PENDING_STATUSES = ['pending', 'queued', 'requested', 'claimed'];

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

// Accepts whatever shape the stored timestamp survived decoding as. Normally a
// plain ISO string; a raw {timestampValue} from an undecoded read is honoured
// too so lastSeenCoarse degrades honestly instead of throwing. Numbers and
// other types are deliberately NOT guess-converted — an unparseable stamp must
// read 'unknown', not a plausible age.
function toIsoOrNull(value) {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && typeof value.timestampValue === 'string') {
    return value.timestampValue;
  }
  return null;
}

/**
 * Bucket a timestamp into a public coarseness. The enum values
 * ('never', 'unknown', '<1m', '<5m', '<15m', '<1h', '<6h', '<24h', '>1d') are
 * a published contract — /s24 renders them verbatim. 'unknown' (not 'never')
 * means "the document has a stamp we cannot trust", which is a different
 * statement from "no heartbeat has ever arrived", and collapsing the two is
 * how a broken feed looks like a switched-off phone.
 */
export function coarseAge(isoTs, nowMs) {
  if (isoTs === null || isoTs === undefined || isoTs === '') return 'never';
  const iso = toIsoOrNull(isoTs);
  const timestamp = iso === null ? NaN : Date.parse(iso);
  if (!Number.isFinite(timestamp) || timestamp > nowMs) return 'unknown';
  const ageSeconds = (nowMs - timestamp) / 1000;
  if (ageSeconds < 60) return '<1m';
  if (ageSeconds < 300) return '<5m';
  if (ageSeconds < 900) return '<15m';
  if (ageSeconds < 3600) return '<1h';
  if (ageSeconds < 21600) return '<6h';
  if (ageSeconds < 86400) return '<24h';
  return '>1d';
}

/**
 * The public projection of a decoded devices/samsung-s24-ultra document.
 * `precise` is the authenticated tier: the same route, richer fields.
 */
export function publicS24View(fields, nowMs, precise) {
  const doc = fields && typeof fields === 'object' ? fields : {};
  const computed = computeS24Liveness(doc, nowMs);
  const cq = doc.commandQueue || {};
  const queue = normalizeCommandQueue(cq);
  const info = doc.info && typeof doc.info === 'object' ? doc.info : {};
  const network = doc.network && typeof doc.network === 'object' ? doc.network : {};

  // Always-on fields only. NOT included, ever: observedIp, publicIp or any
  // other ip field, ssid, bssid, the network map and its interfaces (only two
  // non-locating scalars are lifted out of it), the full stored payload, any
  // subcollection (whatsappMedia, callLogs, sms, contacts), site video events,
  // and seenBy. None of that is an oversight of this projection — it is the
  // reason the projection exists. An SSID names the network the phone is
  // standing on, and an IP is a location fix in a document tied to a named
  // person's handset; command bodies are an activity log.
  // `lastSeen` is coarse for the same family of reason: publishing an exact
  // "last seen 12s ago" to strangers, refreshed on a 10s poll, is a live
  // presence oracle for the owner's phone — it answers "is the device in a
  // pocket and reporting right now?" continuously. Bucketing it answers the
  // dashboard's actual question (is the status stream fresh) without turning
  // every visitor's poll into a timestamped presence ping.
  const device = {
    deviceId: S24_DEVICE_ID,
    deviceDisplayName: doc.deviceDisplayName || S24_DEVICE_ID,
    model: doc.model || null,
    deviceType: doc.deviceType || null,
    online: doc.online === true,
    reportedStatus: doc.status || null,
    uptimeSeconds: firstNumber(doc.uptimeSeconds),
    heartbeatIntervalSeconds: computed.heartbeatIntervalSeconds,
    heartbeatMaxAgeSeconds: computed.heartbeatMaxAgeSeconds,
    live: computed.liveness.live,
    // The seven attestation booleans are meant to be public: a visitor
    // deserves to see WHY the page says live, and the checks attest to stored
    // claims about the agent, not to anything about the owner.
    liveness: computed.liveness,
    lastSeenCoarse: coarseAge(doc.lastSeen, nowMs),
    lastCommandAckCoarse: coarseAge(computed.lastCommandAckAt, nowMs),
    agentVersion: doc.agentVersion || null,
    connectionMethod: doc.connectionMethod || null,
    batteryLevel: firstNumber(
      doc.batteryLevel,
      doc.battery,
      info.battery && typeof info.battery === 'object' ? info.battery.level : null,
    ),
    batteryCharging: typeof info.batteryCharging === 'boolean'
      ? info.batteryCharging
      : (typeof doc.batteryCharging === 'boolean' ? doc.batteryCharging : null),
    networkType: doc.networkType || network.networkType || null,
    wifiSignalPercent: firstNumber(
      network.wifiSignal && typeof network.wifiSignal === 'object'
        ? network.wifiSignal.signal_percent
        : null,
    ),
    commandQueueDepth: Object.keys(cq).length,
    commandQueuePendingDepth: queue.filter((entry) =>
      PENDING_STATUSES.includes(entry.status)
    ).length,
  };

  // The precise tier adds only what a stranger must not learn: exact sync
  // times (the presence-oracle protection above) and command bodies (what was
  // asked of the phone and when). Depths and statuses stay in the coarse
  // shape, which is enough for "the queue is moving".
  if (precise === true) {
    device.lastSeen = toIsoOrNull(doc.lastSeen);
    device.lastSeenAgeSeconds = computed.heartbeatAgeSeconds;
    device.lastCommandAckAt = toIsoOrNull(computed.lastCommandAckAt);
    device.lastCommandAckAgeSeconds = computed.lastCommandAckAgeSeconds;
    device.commandQueue = queue;
  }
  return device;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // checkKey(), deliberately not requireKey(): here a missing or wrong key is
  // not an error, it is the anonymous case — it flips `precise` to false and
  // nothing else. This route answers 200 for the whole internet.
  const precise = checkKey(req).ok === true;
  if (!FIREBASE_SA_JSON) {
    return res.status(503).json({ success: false, error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' });
  }

  try {
    // The scope limit as code: one document id from the attestation module,
    // read directly. There is no query path here that could enumerate or
    // search devices.
    const doc = await fsGet('/devices/' + S24_DEVICE_ID);
    // generated_at is a FETCH stamp: it is born when this response is built,
    // so on /s24's 10s polls it resets every 10 seconds and says nothing about
    // the phone. Renderers must label it "fetched", never "synced"; the real
    // sync figure is lastSeen (precise tier) or lastSeenCoarse (always).
    const generatedAt = new Date().toISOString();
    if (!doc) {
      return res.status(200).json({
        success: true,
        source: 'firestore',
        database: FIRESTORE_DB,
        generated_at: generatedAt,
        precise,
        device: null,
      });
    }
    const fields = {};
    for (const [k, v] of Object.entries(doc.fields || {})) fields[k] = dec(v);
    return res.status(200).json({
      success: true,
      source: 'firestore',
      database: FIRESTORE_DB,
      generated_at: generatedAt,
      precise,
      device: publicS24View(fields, Date.now(), precise),
    });
  } catch (err) {
    // Generic message, detail to the server log — the same split s24-ingest.js uses
    // for its public surface. This catch was `err.message` verbatim at first
    // (2026-09-20 audit), and that is not safe here: a set-but-broken
    // FIREBASE_SERVICE_ACCOUNT_JSON makes broker.js rethrow 'firestore read failed:
    // <first 300 chars of the REST error body>', which contains the GCP project id
    // and the document path, and the token-exchange branch can echo Google's error
    // payload. The gated jp-devices.js 500 only speaks to key-holders; this route
    // answers strangers, so the doctrine the header records — every field here is
    // a disclosure decision — has to cover error text as well as success text.
    console.error('[s24-public] status read failed:', err && err.message ? String(err.message).slice(0, 300) : 'unknown');
    return res.status(500).json({ success: false, error: 'device status unavailable' });
  }
}
