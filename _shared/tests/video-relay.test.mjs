// The Video relay panel's ✓ must belong to the play it is shown beside.
//
// On 2026-09-24 the Lenovo's site video watcher logged two plays from one
// visit, 57 s and 8 s after they fired:
//   NEW video event site_video_play_1790242510579: closing-clip  ... 09:35:10.579Z
//   NEW video event site_video_play_1790242625729: dark-empath-1 ... 09:37:05.729Z
// The panel could not show that. It printed every key of
// settings/siteVideoEvents.seenBy as a ✓, and nothing ever clears seenBy (the
// site relay's PATCH names seven fields, seenBy not among them), so a watcher
// that had stopped kept its ✓ on every later play, and the id the Lenovo's
// watcher wrote until 2026-09-23, g4g-laptop, kept a second one.
//
// This pins videoEventWatchers() (Backend/jp-devices.js), the handler that
// feeds it, and the page that renders its verdict. The timestamps are the real
// ones from that log and the Postgres video_events rows.
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

const KEY = 'k-test-video-relay';
process.env.STATS_KEY = KEY;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'] = JSON.stringify({
  type: 'service_account', project_id: 'demo-project', client_email: 'svc@demo-project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
});
const jpDevices = await import(new URL('../../Backend/jp-devices.js', import.meta.url).href);
const { videoEventWatchers } = jpDevices;

const CLOSING = { id: 'site_video_play_1790242510579', at: '2026-09-24T09:35:10.579Z' };
const EMPATH = { id: 'site_video_play_1790242625729', at: '2026-09-24T09:37:05.729Z' };
const SEEN_CLOSING = '2026-09-24T09:36:07.300784+00:00'; // the watcher's own clock, as it logs it
const SEEN_EMPATH = '2026-09-24T09:37:13.516129+00:00';
const GHOST_ACK = '2026-09-22T19:14:52.179519+00:00'; // last ack under g4g-laptop
const play = (p, seenBy) => ({ lastEventId: p.id, lastEventAt: p.at, seenBy });
const byId = (list) => Object.fromEntries(list.map((w) => [w.deviceId, w]));

// ---- the verdict ----
await t('a watcher whose own document names the play gets it, with its lag: the Lenovo caught dark-empath-1 7.8 s after it fired', () => {
  const [w] = videoEventWatchers(play(EMPATH, { 'g4g-lenovo-laptop': SEEN_EMPATH }),
    { 'g4g-lenovo-laptop': { eventId: EMPATH.id, at: SEEN_EMPATH } });
  assert.deepEqual(w, {
    deviceId: 'g4g-lenovo-laptop', fleet: true, forThisEvent: true,
    ackedEventId: EMPATH.id, ackedAt: SEEN_EMPATH, lagSeconds: 7.8,
  });
});

await t('a seenBy entry left from the previous play is not a ✓ for the next one, because nothing clears seenBy', () => {
  const [w] = videoEventWatchers(play(EMPATH, { 'g4g-lenovo-laptop': SEEN_CLOSING }), {});
  assert.equal(w.forThisEvent, false, 'the 09:36:07 ack was for closing-clip, not for the 09:37:05 play');
  assert.equal(w.ackedAt, SEEN_CLOSING, 'the earlier acknowledgement is still reported, as earlier');
  assert.equal(w.lagSeconds, null);
});

await t('g4g-laptop, the id the Lenovo watcher wrote until 2026-09-23, is outside the fleet and never credited', () => {
  const w = byId(videoEventWatchers(play(EMPATH, { 'g4g-laptop': GHOST_ACK, 'g4g-lenovo-laptop': SEEN_EMPATH }), {}));
  assert.equal(w['g4g-laptop'].fleet, false);
  assert.equal(w['g4g-laptop'].forThisEvent, false);
  assert.equal(w['g4g-lenovo-laptop'].forThisEvent, true, 'with no named id, an ack at or after the play counts');
  assert.equal(w['g4g-lenovo-laptop'].ackedEventId, null, 'a time-based verdict names no event id');
});

await t('a named id outranks a time that only looks recent: a watcher that read one play and acked after the next landed', () => {
  // Site visits fire closing-clip and dark-empath-1 about half a second apart.
  const next = { id: 'site_video_play_1790236215651', at: '2026-09-24T07:50:15.651Z' };
  const ackAt = '2026-09-24T07:50:15.900000+00:00';
  const [w] = videoEventWatchers(play(next, { 'g4g-lenovo-laptop': ackAt }),
    { 'g4g-lenovo-laptop': { eventId: 'site_video_play_1790236211825', at: ackAt } });
  assert.equal(w.forThisEvent, false, 'the watcher says which play it handled, and it was the one before');
});

await t('a restored document\'s old ack id does not outvote a newer seenBy time', () => {
  // fleet:register (jaytibirthday-site) carries lastVideoEventAck onto a
  // re-created document, so the id there can predate the watcher's latest ack.
  const [w] = videoEventWatchers(play(EMPATH, { 'g4g-lenovo-laptop': SEEN_EMPATH }),
    { 'g4g-lenovo-laptop': { eventId: 'site_video_play_1790104482524', at: GHOST_ACK } });
  assert.equal(w.forThisEvent, true);
  assert.equal(w.ackedEventId, null, 'the stale id is not what the verdict rests on');
  assert.equal(w.ackedAt, SEEN_EMPATH);
  assert.equal(w.lagSeconds, 7.8);
});

await t('an unreadable or non-string ack time proves nothing', () => {
  const w = byId(videoEventWatchers(play(EMPATH, { 'g4g-lenovo-laptop': 'yesterday', 'samsung-s24-ultra': true }), {}));
  assert.equal(w['g4g-lenovo-laptop'].forThisEvent, false);
  assert.equal(w['samsung-s24-ultra'].forThisEvent, false);
  assert.equal(w['samsung-s24-ultra'].ackedAt, null);
});

await t('a watcher clock behind the relay\'s is skew, not a negative lag', () => {
  const [w] = videoEventWatchers(play(EMPATH, {}),
    { 'g4g-lenovo-laptop': { eventId: EMPATH.id, at: '2026-09-24T09:37:03.000000+00:00' } });
  assert.equal(w.forThisEvent, true, 'the id settles it whatever the clocks say');
  assert.equal(w.lagSeconds, null);
});

await t('with no play there is nothing to credit, and an array-shaped seenBy is no map', () => {
  assert.equal(videoEventWatchers({ seenBy: { 'g4g-lenovo-laptop': SEEN_EMPATH } }, {})[0].forThisEvent, false);
  assert.deepEqual(videoEventWatchers(play(EMPATH, ['g4g-lenovo-laptop']), {}), []);
  assert.deepEqual(videoEventWatchers(null, null), []);
});

await t('this play\'s fleet acks sort first, then the fleet, then newest', () => {
  const order = videoEventWatchers(play(EMPATH, {
    'g4g-laptop': GHOST_ACK, 'samsung-s24-ultra': '2026-09-13T21:08:30.000Z', 'g4g-lenovo-laptop': SEEN_EMPATH,
  }), {}).map((w) => w.deviceId);
  assert.deepEqual(order, ['g4g-lenovo-laptop', 'samsung-s24-ultra', 'g4g-laptop']);
});

// ---- the handler ----
// The real handler, with Firestore stubbed: the watcher's two records must
// reach the verdict (the fleet document's id, the settings doc's seenBy), and a
// document outside the fleet must not lend its id to anyone.
const s = (v) => ({ stringValue: v });
const FIRESTORE = {
  devices: {
    documents: [
      { name: 'projects/demo-project/databases/eka-agent/documents/devices/g4g-lenovo-laptop',
        fields: { lastSeen: s('2026-09-24T09:37:40.000Z'), lastVideoEventAck: s(EMPATH.id), lastVideoEventAckAt: s(SEEN_EMPATH) } },
      { name: 'projects/demo-project/databases/eka-agent/documents/devices/g4g-laptop',
        fields: { lastVideoEventAck: s(EMPATH.id), lastVideoEventAckAt: s(SEEN_EMPATH) } },
    ],
  },
  settings: {
    fields: {
      lastEventId: s(EMPATH.id), lastEventAt: s(EMPATH.at), lastVideoEvent: s('dark-empath-1'),
      lastVisitorCountry: s('IN'), lastVisitorCity: s('New%20Delhi'),
      seenBy: { mapValue: { fields: { 'g4g-laptop': s(GHOST_ACK), 'g4g-lenovo-laptop': s(SEEN_EMPATH) } } },
    },
  },
};
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
async function roster() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) return json({ access_token: 'ya29.test', expires_in: 3600 });
    if (u.endsWith('/settings/siteVideoEvents')) return json(FIRESTORE.settings);
    if (u.endsWith('/devices')) return json(FIRESTORE.devices);
    throw new Error('unexpected fetch ' + u);
  };
  try {
    const res = {
      statusCode: null, payload: null, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.payload = b; return this; },
    };
    await jpDevices.default({ method: 'GET', url: '/api/jp-devices', headers: { 'x-stats-key': KEY }, query: {} }, res);
    return res;
  } finally { globalThis.fetch = realFetch; }
}
const served = await roster();

await t('/api/jp-devices credits the Lenovo from its own document and lists g4g-laptop as outside the fleet', () => {
  assert.equal(served.statusCode, 200, JSON.stringify(served.payload));
  const ve = served.payload.videoEvent;
  assert.deepEqual(ve.watchers.map((w) => [w.deviceId, w.fleet, w.forThisEvent, w.ackedEventId]), [
    ['g4g-lenovo-laptop', true, true, EMPATH.id],
    ['g4g-laptop', false, false, null],
  ]);
  assert.deepEqual(ve.seenBy, { 'g4g-laptop': GHOST_ACK, 'g4g-lenovo-laptop': SEEN_EMPATH }, 'seenBy is still passed through as stored');
  assert.equal(ve.lastVisitorCity, 'New Delhi');
  assert.deepEqual(served.payload.other_documents, ['g4g-laptop']);
});

// ---- the page ----
// renderVideoRelay and the helpers it calls are lifted out of the page by
// brace matching (none holds a brace inside a string or regex; ip-grouping.test.mjs
// has the literal-aware version), so this runs the code that ships.
const INDEX = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'Frontend', 'index.html'), 'utf8');
function lift(name) {
  const start = INDEX.indexOf('function ' + name + '(');
  assert.ok(start !== -1, `${name}() not found in Frontend/index.html`);
  let depth = 0;
  for (let i = INDEX.indexOf('{', start); i < INDEX.length; i++) {
    if (INDEX[i] === '{') depth++;
    else if (INDEX[i] === '}' && --depth === 0) return INDEX.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces while lifting ${name}()`);
}
const page = new Function(
  'var container = { innerHTML: "" };\n' +
  'function $(id) { return id === "videoRelayContainer" ? container : null; }\n' +
  ['esc', 'fmtTime', 'fmtAgo', 'fmtDur', 'renderVideoRelay'].map(lift).join('\n') +
  '\nreturn function (body) { renderVideoRelay(body); return container.innerHTML; };')();
const ticks = (html) => (html.match(/✓/g) || []).length;

await t('the panel gives the Lenovo one ✓ with its lag, and shows g4g-laptop muted, without one', () => {
  const html = page(served.payload);
  assert.equal(ticks(html), 1, html);
  assert.match(html, /g4g-lenovo-laptop ✓ · 8s after the play<\/span>/);
  assert.match(html, /g4g-laptop \(not a fleet device\) — last acknowledged an earlier play, at /);
});

await t('a play no watcher has acknowledged says so, and names when each one last did', () => {
  const ve = Object.assign({}, served.payload.videoEvent, {
    watchers: videoEventWatchers(play(EMPATH, { 'g4g-lenovo-laptop': SEEN_CLOSING }), {}),
  });
  const html = page({ videoEvent: ve });
  assert.equal(ticks(html), 0, html);
  assert.match(html, /no fleet device has acknowledged this play/);
  assert.match(html, /g4g-lenovo-laptop — last acknowledged an earlier play, at /);
});

await t('the page never turns seenBy keys into ticks on its own', () => {
  const html = page({ videoEvent: Object.assign({}, served.payload.videoEvent, { watchers: undefined }) });
  assert.equal(ticks(html), 0, 'with no server verdict there is nothing to tick: ' + html);
  const code = INDEX.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/seenBy/.test(code), false, 'Frontend/index.html reads seenBy again');
});

console.log(`\n${pass}/${total} checks passed`);
if (pass !== total) process.exitCode = 1;
