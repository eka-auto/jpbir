// There are three devices, and every device count says three.
//
// The broker enrols and accepts heartbeats only from the ids in HARDWARE_RULES
// (Backend/broker.js): g4g-lenovo-laptop, jayti-asus-vivobook and
// samsung-s24-ultra. The Firestore devices collection holds more. On
// 2026-09-23 it held five documents, the other two being `eka-cloud-sandbox`
// (the channel-sandbox test agent, silent since 2026-09-08) and `g4g-laptop`
// (an enrolment artifact with no fields). Every reader counted what the
// collection held: the health verdict, its runtime log line and the stale-alert
// cron said five devices, the dashboard said four (it hid `g4g-laptop` only),
// verify-db said five, and so did the droplet's list_devices.
//
// Every one of those now goes through splitFleet(). This suite pins the fleet,
// runs each reader over the production-shaped collection, and fails if the
// droplet's copy of the list drifts from the broker's. The Backend handlers run
// for real against a generated service-account key and a stubbed fetch, so env
// is set before any Backend module loads (_auth.js reads STATS_KEY at import).
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, total = 0;
async function t(name, fn) {
  total++;
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const KEY = 'k-test-device-fleet';
process.env.STATS_KEY = KEY;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'] = JSON.stringify({
  type: 'service_account', project_id: 'demo-project', client_email: 'svc@demo-project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
});
// No mail, no Postgres: check-stale then only reads Firestore and patches alert state.
for (const k of ['GMAIL_APP_' + 'PASSWORD', 'DATABASE_URL', 'POSTGRES_URL', 'CRON_' + 'SECRET']) delete process.env[k];

const { DEVICE_IDS, HARDWARE_RULES, splitFleet, verifyHardwareFingerprint } = await import('../../Backend/broker.js');
const { FLEET_DEVICE_IDS, splitFleet: dropletSplitFleet } = await import('../../Server/jp-agent/device-health.mjs');
const { deviceFreshness, snapshot, logVerdict } = await import('../../Backend/jp-stack.js');
const { default: jpDevices } = await import('../../Backend/jp-devices.js');
const { default: checkStale } = await import('../../Backend/check-stale.js');
const { verifyFirestore } = await import('../../Backend/verify-db.js');

const FLEET = ['g4g-lenovo-laptop', 'jayti-asus-vivobook', 'samsung-s24-ultra'];
const NOT_DEVICES = ['eka-cloud-sandbox', 'g4g-laptop'];

// The devices collection as production held it on 2026-09-23, in the order
// Firestore lists it (by id), with the heartbeat ages the health check logged.
const NOW = Date.now();
const seen = (minsAgo) => ({ lastSeen: { timestampValue: new Date(NOW - minsAgo * 60000).toISOString() } });
const named = (s) => ({ deviceDisplayName: { stringValue: s } });
const doc = (id, fields = {}) => ({
  name: 'projects/demo-project/databases/eka-agent/documents/devices/' + id,
  fields, createTime: '2026-09-01T00:00:00Z',
});
const PRODUCTION = [
  doc('eka-cloud-sandbox', { ...seen(20854), ...named('Eka Cloud Sandbox') }),
  doc('g4g-laptop'),
  doc('g4g-lenovo-laptop', { ...seen(17876), ...named("Jayti's Lenovo 82KA") }),
  doc('jayti-asus-vivobook', named("Jayti's ASUS VivoBook")),
  doc('samsung-s24-ultra', { ...seen(13054), ...named('Samsung Galaxy S24 Ultra') }),
];
const idOf = (d) => d.name.split('/').pop();

// Firestore and Google OAuth as the handlers see them; PATCHes are recorded.
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function stubFirestore(documents) {
  const patched = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) return reply(200, { access_token: 'ya29.test', expires_in: 3600 });
    if ((init.method || 'GET') === 'PATCH') {
      patched.push(u.split('/documents/devices/')[1].split('?')[0]);
      return reply(200, {});
    }
    if (u.split('?')[0].endsWith('/documents/devices')) return reply(200, { documents });
    return reply(404, { error: { code: 404, message: 'not found', status: 'NOT_FOUND' } });
  };
  return patched;
}
const mkRes = () => ({
  statusCode: null, payload: null,
  setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.payload = b; return this; },
});
const keyed = (url) => ({ method: 'GET', url, headers: { 'x-stats-key': KEY }, query: {} });

await t('the fleet is exactly the three devices the broker will enrol', () => {
  assert.deepEqual([...DEVICE_IDS], FLEET);
  assert.deepEqual([...DEVICE_IDS], Object.keys(HARDWARE_RULES), 'DEVICE_IDS must be derived from HARDWARE_RULES, not kept beside it');
  // Why the list is authoritative: the broker refuses any other id outright.
  for (const id of NOT_DEVICES) {
    assert.match(verifyHardwareFingerprint(id, { manufacturer: 'LENOVO', model: '82KA' }), /no hardware rules/, id + ' must be refused');
  }
});

await t('the droplet carries the same fleet and splits a collection the same way', () => {
  assert.deepEqual([...FLEET_DEVICE_IDS], [...DEVICE_IDS], 'Server/jp-agent/device-health.mjs drifted from Backend/broker.js');
  const cloud = splitFleet(PRODUCTION), droplet = dropletSplitFleet(PRODUCTION);
  assert.deepEqual(droplet.fleet.map(idOf), cloud.fleet.map(idOf));
  assert.deepEqual(droplet.other, cloud.other);
});

await t('the production collection is three devices and two documents that are not devices', () => {
  const { fleet, other } = splitFleet(PRODUCTION);
  assert.deepEqual(fleet.map(idOf), FLEET);
  assert.deepEqual(other, NOT_DEVICES);
  assert.deepEqual(splitFleet(undefined), { fleet: [], other: [] }, 'an empty listing has no "documents" key at all');
});

await t('the health verdict judges the three devices and never the test agent or the artifact', () => {
  const r = deviceFreshness({ status: 'ok', _docs: PRODUCTION });
  assert.deepEqual(Object.keys(r.byDevice).sort(), FLEET);
  assert.equal(r.status, 'fail');
  assert.match(r.problem, /^3 of 3 device\(s\) not reporting/, 'the count is of devices, and there are three');
  assert.doesNotMatch(r.problem, /eka-cloud-sandbox|g4g-laptop/);
  assert.deepEqual(r.byDevice['samsung-s24-ultra'], { status: 'fail', mins: 13054 });
  assert.deepEqual(r.byDevice['jayti-asus-vivobook'], { status: 'warn', mins: null }, 'no lastSeen reads as never reported');
});

await t('the health log line counts devices against the fleet of three', () => {
  const lines = [];
  const log = { warn: (m) => lines.push(m), error: (m) => lines.push(m) };
  logVerdict(snapshot({ devices: deviceFreshness({ status: 'ok', _docs: PRODUCTION }) }), log);
  assert.equal(lines.length, 1);
  assert.match(lines[0],
    / devices_not_ok=3\/3 devices=g4g-lenovo-laptop:17876m,jayti-asus-vivobook:never,samsung-s24-ultra:13054m$/,
    'at 06:15 UTC on 2026-09-23 this line listed five, the test agent and the artifact among them');
});

await t('a fleet device with no document is judged as never enrolled, not dropped from the count', () => {
  const r = deviceFreshness({ status: 'ok', _docs: PRODUCTION.filter((d) => idOf(d) !== 'g4g-lenovo-laptop') });
  assert.equal(Object.keys(r.byDevice).length, 3);
  assert.deepEqual(r.byDevice['g4g-lenovo-laptop'], { status: 'warn', mins: null });
  assert.match(r.problem, /g4g-lenovo-laptop has no device document \(never enrolled\)/);
});

await t('/api/jp-devices lists the three devices and names the two documents it left out', async () => {
  stubFirestore(PRODUCTION);
  const res = mkRes();
  await jpDevices(keyed('/api/jp-devices'), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  assert.deepEqual(res.payload.devices.map((d) => d.deviceId).sort(), FLEET, '"Total devices" on the dashboard is this length');
  assert.deepEqual(res.payload.other_documents, NOT_DEVICES, 'what was left out is named, not silently hidden');
});

await t('the stale-alert cron checks three devices and never alerts on the other two documents', async () => {
  const patched = stubFirestore(PRODUCTION);
  const res = mkRes();
  await checkStale(keyed('/api/check-stale'), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  assert.equal(res.payload.checked, 3);
  // All three are down or never seen, so each is alerted once...
  assert.deepEqual(res.payload.transitions.map((x) => x.deviceId).sort(), FLEET);
  assert.deepEqual([...new Set(patched)].sort(), FLEET);
  // ...and the documents that are not devices get no alert and no state write.
  for (const id of NOT_DEVICES) assert.equal(patched.includes(id), false, id + ' was alerted on');
});

await t('verify-db reports the fleet as the device count', async () => {
  stubFirestore(PRODUCTION);
  const r = await verifyFirestore();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.devices_found, 3);
});

await t('both droplet list_devices tools count the fleet and name the rest', () => {
  // Their Firestore client needs the droplet's key file, so the wiring is
  // pinned by source; the split itself is the function tested above.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (const file of ['Server/jp-agent/s24-tools.mjs', 'Server/jp-agent/s24-mcp-server.mjs']) {
    const src = readFileSync(join(root, file), 'utf8');
    const from = src.indexOf("'list_devices'");
    const body = src.slice(from, src.indexOf("'device_ping'", from));
    assert.match(body, /const \{ fleet, other \} = splitFleet\(documents\);/, file + ' no longer splits the listing');
    assert.match(body, /const rows = fleet\.map\(/, file + ' counts documents that are not devices');
    assert.match(body, /count: rows\.length, devices: rows, other_documents: other/, file + ' no longer names what it left out');
  }
});

console.log(`\n${pass}/${total} checks passed`);
if (pass !== total) process.exitCode = 1;
