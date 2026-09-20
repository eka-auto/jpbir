// Contract tests for the public, PII-free S24 projection in Backend/s24-public.js.
//
// Why this exists: on 2026-09-20 the /s24 page and /api/jp-devices collided.
// f372da6 removed the requireKey gate from jp-devices to make the page load for
// visitors — which published every enrolled device's SSID, BSSID, LAN/egress
// IPs, command bodies and (with ?subcollections=1) call logs, SMS and contacts
// to the whole internet. Its parent merge b2c1778 restored the gate and broke
// the supposedly-public page. Option 3 split the difference: a separate public
// route that answers everyone with coarse, hand-picked fields; exact sync
// times and command bodies appear only when the caller presents the dashboard
// key. This suite pins that split from the projection's side — the auth
// posture is pinned in wa-endpoint-auth.test.mjs.
//
// Import the REAL exports; nothing here reimplements the projection.
import assert from 'node:assert/strict';
import { coarseAge, publicS24View } from '../../Backend/s24-public.js';

// A frozen clock: every age in this file is computed against NOW, so a test
// failing here cannot depend on when CI happened to run it.
const NOW = Date.parse('2026-09-20T12:00:00.000Z');
const isoAgo = (seconds) => new Date(NOW - seconds * 1000).toISOString();
const isoAhead = (seconds) => new Date(NOW + seconds * 1000).toISOString();

// The static attestation facts (sevenths are the time-based heartbeat/ack
// freshness) as a fully honest, freshly-heartbeating S24 writes them. Version
// string is the real collector output, same rule as device-liveness.test.mjs:
// a fixture that encodes a fiction tests the fiction, not the phone.
const ATTESTED = {
  agentVersion: 's24-direct-cloud-2026-09-07.1',
  heartbeatAuth: 'termux-phone',
  liveDeviceVerified: true,
  sourceType: 'live_termux',
  runtimeIsAndroid: true,
};

// A rich decoded devices/samsung-s24-ultra document: everything the view is
// allowed to see, buried in everything it must never echo. The bombs are
// shaped exactly like the decoded Firestore document handleDevices() consumes —
// nested maps, arrays of rows, one full stored payload — because the failure
// this guards is "someone adds one Object.assign and the open page starts
// publishing the owner's call log".
function s24Fields(overrides) {
  const base = {
    deviceDisplayName: 'Samsung S24 Ultra',
    model: 'SM-S928B',
    deviceType: 'android-phone',
    online: true,
    status: 'online',
    uptimeSeconds: 112233,
    heartbeatIntervalSeconds: 900,
    connectionMethod: 'termux-direct-cloud',
    batteryLevel: 87,
    networkType: 'wifi',
    lastSeen: isoAgo(45),
    lastCommandAckAt: isoAgo(45),
    ...ATTESTED,
    commandQueue: {
      'cmd-z-dial': { action: 'dial_secret +919876543210', status: 'pending', requestedAt: isoAgo(300) },
      'cmd-y-ping': { action: 'ping', status: 'queued', requestedAt: isoAgo(240) },
      'cmd-x-done': { action: 'ping', status: 'done', requestedAt: isoAgo(600), completedAt: isoAgo(560) },
    },
    network: {
      ssid: 'AtCoderJunction',
      bssid: 'aa:bb:cc:dd:ee:ff',
      interfaces: { wlan0: '10.42.0.9' },
      publicIp: '210.16.82.193',
      observedIp: '157.49.23.247',
      networkType: 'wifi',
      wifiSignal: { signal_percent: 78 },
    },
    info: {
      batteryCharging: true,
      wifiSSID: 'AtCoderJunction',
      wifiIP: '157.49.23.247',
    },
    contactName: 'Jayti Pargal',
    phoneNumber: '+919876543210',
    callLogs: [{ number: '+919876543210', name: 'Santosh Satyarthi', duration: 812 }],
    sms: [{ from: '+919876543210', body: 'private: OTP 4417' }],
    whatsappMedia: [{ caption: 'private: family photo', url: 'https://blob/x' }],
    videoEvent: { lastEventId: 'v-7', seenBy: { 'samsung-s24-ultra': isoAgo(1200) } },
    full_payload: { private: 'everything the daemon ever sent', seenBy: {} },
  };
  return { ...base, ...overrides };
}

// Every key name in the projection's recursive object graph. Matching key
// NAMES, not substrings: 'networkType' is a contract field, 'ssid' never is.
function allKeyNames(node, acc) {
  acc = acc || [];
  if (Array.isArray(node)) { for (const n of node) allKeyNames(n, acc); }
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) { acc.push(k); allKeyNames(v, acc); }
  }
  return acc;
}

const FORBIDDEN_KEY_NAMES = [
  'ssid', 'bssid', 'interfaces', 'full_payload', 'callLogs', 'sms',
  'whatsappMedia', 'videoEvent', 'publicIp', 'observedIp', 'seenBy',
];

const FORBIDDEN_VALUES = [
  'AtCoderJunction', 'aa:bb', '10.42.0.9', '210.16.82.193', '157.49.23.247',
  '+91', 'private:', 'seenBy', 'callLogs', 'Jayti Pargal', 'dial_secret',
];

function expectNoNetworkIdentity(json, tier) {
  for (const secret of FORBIDDEN_VALUES) {
    if (tier === 'precise' && secret === 'dial_secret') {
      // The authenticated tier is OWED the command bodies — assert presence
      // instead of absence, so a queue projection that silently disappears
      // fails this suite just as loudly as one that shows up anonymous.
      continue;
    }
    assert.ok(!json.includes(secret), tier + ' tier leaked value "' + secret + '"');
  }
  const names = allKeyNames(JSON.parse(json));
  for (const forbidden of FORBIDDEN_KEY_NAMES) {
    assert.ok(!names.includes(forbidden), tier + ' JSON carries forbidden key name "' + forbidden + '"');
  }
}

// The published coarse-tier contract: exactly these keys, sorted. Adding a
// field to publicS24View is a disclosure decision — it fails this list on
// purpose so the decision is made in review, not in a diff.
function sortedKeys(obj) { return Object.keys(obj).sort(); }
const ALWAYS_KEYS = sortedKeys({
  deviceId: 0, deviceDisplayName: 0, model: 0, deviceType: 0, online: 0,
  reportedStatus: 0, uptimeSeconds: 0, heartbeatIntervalSeconds: 0,
  heartbeatMaxAgeSeconds: 0, live: 0, liveness: 0, lastSeenCoarse: 0,
  lastCommandAckCoarse: 0, agentVersion: 0, connectionMethod: 0,
  batteryLevel: 0, batteryCharging: 0, networkType: 0, wifiSignalPercent: 0,
  commandQueueDepth: 0, commandQueuePendingDepth: 0,
});
const PRECISE_ONLY_KEYS = sortedKeys({
  lastSeen: 0, lastSeenAgeSeconds: 0, lastCommandAckAt: 0,
  lastCommandAckAgeSeconds: 0, commandQueue: 0,
});

let pass = 0;
let total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const keyless = publicS24View(s24Fields(), NOW, false);
const keylessJson = JSON.stringify(keyless);

t('a keyless visitor gets a PII-free projection: no SSID, BSSID, LAN/egress IP, call logs, SMS, contacts, media, video events, raw payloads or command bodies', () => {
  expectNoNetworkIdentity(keylessJson, 'keyless');
});

t('the coarse tier exposes exactly the published key set — adding a field here is a disclosure decision, not a convenience one', () => {
  assert.deepEqual(sortedKeys(keyless), ALWAYS_KEYS);
});

t('a fully attested, freshly-heartbeating, freshly-acking phone reads live through the public view on the same math the gated dashboard uses', () => {
  assert.equal(keyless.live, true);
  assert.equal(keyless.deviceId, 'samsung-s24-ultra');
  assert.equal(keyless.liveness.mode, 'strict-s24-attestation');
  assert.equal(Object.keys(keyless.liveness.checks).length, 7, 'exactly the 7 attestation booleans');
  assert.ok(Object.values(keyless.liveness.checks).every((v) => typeof v === 'boolean' && v === true));
  assert.equal(keyless.lastSeenCoarse, '<1m');
  assert.equal(keyless.lastCommandAckCoarse, '<1m');
  assert.equal(keyless.heartbeatIntervalSeconds, 900);
  assert.equal(keyless.heartbeatMaxAgeSeconds, 300);
  assert.equal(keyless.batteryLevel, 87);
  assert.equal(keyless.batteryCharging, true);
  assert.equal(keyless.wifiSignalPercent, 78);
  assert.equal(keyless.networkType, 'wifi');
  assert.equal(keyless.online, true);
  assert.equal(keyless.reportedStatus, 'online');
});

t('a keyless view is coarse by construction: exact lastSeen, exact ack timestamp, ages and command bodies are simply not keys of it', () => {
  assert.ok(!('lastSeen' in keyless));
  assert.ok(!('lastSeenAgeSeconds' in keyless));
  assert.ok(!('lastCommandAckAt' in keyless));
  assert.ok(!('lastCommandAckAgeSeconds' in keyless));
  assert.ok(!('commandQueue' in keyless));
  assert.equal(keyless.commandQueueDepth, 3);
  assert.equal(keyless.commandQueuePendingDepth, 2);
  // queue depth and statuses stay ("the queue is moving") without proving WHO
  // is on the other end of it — the depth numbers appear in the JSON even
  // though no command string does.
});

const precise = publicS24View(s24Fields(), NOW, true);
const preciseJson = JSON.stringify(precise);

t('the precise tier adds timestamps and queue entries but still no network identity or raw payloads', () => {
  assert.deepEqual(
    sortedKeys(precise).filter((k) => !ALWAYS_KEYS.includes(k)),
    PRECISE_ONLY_KEYS,
  );
  assert.equal(precise.lastSeen, isoAgo(45));
  assert.equal(precise.lastSeenAgeSeconds, 45);
  assert.equal(precise.lastCommandAckAt, isoAgo(45));
  assert.equal(precise.lastCommandAckAgeSeconds, 45);
  assert.ok(Array.isArray(precise.commandQueue));
  assert.equal(precise.commandQueue.length, 3);
  for (const entry of precise.commandQueue) {
    assert.deepEqual(
      sortedKeys(entry),
      ['action', 'completedAt', 'id', 'queuedAt', 'status'],
      'queue entry must expose only the five broker fields',
    );
  }
  // bodies exist ONLY for the authenticated caller, and queuedAt is the
  // broker's requestedAt rename — proving the view reuses normalizeCommandQueue
  // rather than a private re-projection that could drift from it.
  assert.ok(preciseJson.includes('dial_secret'), 'the authenticated tier must still see command bodies');
  assert.ok(precise.commandQueue.some((e) => e.id === 'cmd-x-done' && e.completedAt === isoAgo(560)));
  assert.ok(precise.commandQueue.every((e) => e.queuedAt !== null));
  // ...and even with the extra keys, each never-tier bomb value stays absent:
  for (const secret of ['AtCoderJunction', 'aa:bb', '10.42.0.9', '210.16.82.193', '157.49.23.247', 'private:', 'seenBy', 'callLogs', 'Jayti Pargal']) {
    assert.ok(!preciseJson.includes(secret), 'precise tier leaked value "' + secret + '"');
  }
  const names = allKeyNames(precise);
  for (const forbidden of FORBIDDEN_KEY_NAMES) {
    assert.ok(!names.includes(forbidden), 'precise JSON carries forbidden key name "' + forbidden + '"');
  }
});

t('pending depth counts exactly the normalizeCommandQueue statuses — pending, queued, requested and claimed — never done or failed', () => {
  const fields = s24Fields({});
  fields.commandQueue = {
    a: { action: 'ping', status: 'pending', requestedAt: isoAgo(10) },
    b: { action: 'ping', status: 'queued', requestedAt: isoAgo(20) },
    c: { action: 'ping', status: 'requested', requestedAt: isoAgo(30) },
    d: { action: 'ping', status: 'claimed', requestedAt: isoAgo(40) },
    e: { action: 'ping', status: 'done', requestedAt: isoAgo(50) },
    f: { action: 'ping', status: 'failed', requestedAt: isoAgo(60) },
    g: { action: 'ping', requestedAt: isoAgo(70) }, // no status: normalises to 'pending'
  };
  const v = publicS24View(fields, NOW, false);
  assert.equal(v.commandQueueDepth, 7);
  assert.equal(v.commandQueuePendingDepth, 5);
});

function expectDead(overrides, failedCheck) {
  const v = publicS24View(s24Fields(overrides), NOW, false);
  assert.equal(v.live, false);
  assert.equal(v.liveness.checks[failedCheck], false);
  assert.equal(v.liveness.reason, failedCheck + ' is missing or stale');
  return v;
}

t('a 301-second-old command ack makes an otherwise fully attested phone dead on the public page', () => {
  const v = expectDead({ lastCommandAckAt: isoAgo(301) }, 'commandAckFresh');
  assert.equal(v.lastCommandAckCoarse, '<15m', 'the coarse ack bucket keeps telling the visitor the ack is old even in its honest non-live state');
});

t('a bridge process asserting the STRING "true" for runtimeIsAndroid is still not the phone: ===true is the only Android evidence', () => {
  // The 2026-09 Windows bridge incident, re-run through the PUBLIC projection:
  // the droplet copy that compared loosely reported the bridge as device_online
  // while the dashboard said dead. Two implementations of one liveness rule,
  // opposite answers — the open page must inherit the gated one's verdict.
  expectDead({ runtimeIsAndroid: 'true' }, 'androidRuntime');
});

t('a windows-bridge agentVersion is rejected on the public page exactly as on the gated one', () => {
  expectDead({ agentVersion: 'windows-bridge-1' }, 'authenticatedAgent');
});

t('sourceType bridge fails liveSource even when the version, auth flag and runtime all look phone-shaped', () => {
  expectDead({ sourceType: 'bridge' }, 'liveSource');
});

t('a future-dated lastSeen is never live and reads unknown, not a negative age — a writer asserting its own freshness proves nothing by being early', () => {
  const v = expectDead({ lastSeen: isoAhead(60) }, 'heartbeatFresh');
  assert.equal(v.lastSeenCoarse, 'unknown');
  const p = publicS24View(s24Fields({ lastSeen: isoAhead(60) }), NOW, true);
  assert.equal(p.lastSeenAgeSeconds, null, 'null, not negative, at the precise tier either');
});

t('live:false on the public view still names its failed check: visitors see WHY the page says offline, because the checks attest to the agent, not the owner', () => {
  const v = publicS24View(s24Fields({ heartbeatAuth: 'non-termux-bridge' }), NOW, false);
  assert.equal(v.live, false);
  assert.equal(typeof v.liveness.reason, 'string');
  assert.match(v.liveness.reason, /heartbeatAuth/);
  assert.equal(Object.keys(v.liveness.checks).length, 7);
});

t('coarseAge hugs its real boundaries: 59s is <1m, 60s is <5m, 300s is <15m, 900s is <1h, 3600s is <6h, 21600s is <24h, and 86400s is >1d', () => {
  const cases = [
    [0, '<1m'], [59, '<1m'],
    [60, '<5m'], [299, '<5m'],
    [300, '<15m'], [899, '<15m'],
    [900, '<1h'], [3599, '<1h'],
    [3600, '<6h'], [21599, '<6h'],
    [21600, '<24h'], [86399, '<24h'],
    [86400, '>1d'], [999999, '>1d'],
  ];
  for (const [seconds, bucket] of cases) {
    assert.equal(coarseAge(isoAgo(seconds), NOW), bucket, 'age ' + seconds + 's');
  }
});

t('coarseAge never fabricates an age: absent stamps read never, while unparseable text, raw numbers and future stamps all read unknown', () => {
  assert.equal(coarseAge(null, NOW), 'never');
  assert.equal(coarseAge(undefined, NOW), 'never');
  assert.equal(coarseAge('', NOW), 'never');
  assert.equal(coarseAge('not a timestamp', NOW), 'unknown');
  assert.equal(coarseAge(NOW - 30000, NOW), 'unknown', 'a raw epoch number is not guess-converted into a plausible age');
  assert.equal(coarseAge(isoAhead(60), NOW), 'unknown', 'a future stamp is unknown, never <1m via a negative age');
  assert.equal(coarseAge(isoAhead(3600), NOW), 'unknown');
  // A stamp that survived decoding as a raw {timestampValue} is honoured
  // rather than thrown at Date.parse — an un-decoded read degrades honestly.
  assert.equal(coarseAge({ timestampValue: isoAgo(30) }, NOW), '<1m');
  assert.equal(coarseAge({ timestampValue: 'garbage' }, NOW), 'unknown');
});

t('an empty or missing commandQueue projects to zero depths instead of throwing — an empty mailbox is state, not absence', () => {
  const fields = s24Fields({});
  delete fields.commandQueue;
  const v = publicS24View(fields, NOW, false);
  assert.equal(v.commandQueueDepth, 0);
  assert.equal(v.commandQueuePendingDepth, 0);
  const p = publicS24View(s24Fields({ commandQueue: {} }), NOW, true);
  assert.deepEqual(p.commandQueue, []);
});

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exitCode = 1;
