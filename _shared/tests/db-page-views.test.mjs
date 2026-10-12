// What the /db explorer puts on screen, and when.
//
// db-page-render.test.mjs proves every page RUNS. This suite pins what they
// SHOW, because each case below shipped once as a page that rendered without an
// error and still showed the operator the wrong thing:
//
//   * time_on_page is milliseconds; fed to a seconds formatter, a 30-second
//     read printed "8h 20m" in three tables.
//   * TEXT columns holding JSON (events.screen, s24_files.content) printed as
//     raw JSON strings, and nesting past the depth cap printed JSON.stringify.
//   * the S24 drawer printed a stored file -- up to 1,000,000 characters --
//     in full, twice.
//   * interactions / visitor_device printed "[object Object]".
//   * a slow response for an earlier page painted over a newer one.
//   * a first visit with no key was told its key "was rejected"; an auth 503 on
//     the S24 page claimed the just-deleted key was "still stored".
//   * unlocking left the property list and the nav counts empty until reload.
//   * "Lock archive" locked the whole dashboard, and left its data drawn.
//
// The page is one inline script with no exports, so -- as db-page-render does
// -- the IIFE's tail is instrumented in this copy only, and the script runs
// against a stub DOM just rich enough for the paths under test: elements keep
// their innerHTML, forms and buttons keep their listeners, `.page.on` follows
// draw(), and `tr.clickable` rows are found in the HTML a renderer wrote.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'Frontend', 'db.html'), 'utf8');
const script = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
const EXPORTS = ['RENDER', 'state', 'draw', 'lockDashboard', 'treeHtml', 'briefHtml', 'fileContentHtml',
  'secs', 'msSecs', 'when', 'whenText', 'TREE_MAX_ENTRIES', 'TREE_MAX_NODES'];
const instrumented = script.replace(/\}\)\(\);\s*$/,
  'globalThis.__dbg = {' + EXPORTS.map((n) => `${n}: ${n}`).join(', ') + '};\n})();');

let pass = 0, total = 0;
async function t(name, fn) {
  total++;
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

// ---------- fixtures ----------
const KEY = 'k'.repeat(40); // the gate accepts 32-256 printable ASCII
const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const BIG_JSON = JSON.stringify(Object.fromEntries(Array.from({ length: 300 }, (_, i) => ['k' + i, 'value-' + i])));
const LONG_TEXT = 'phone log line with ordinary words. '.repeat(170) + 'END-OF-FILE-MARKER';
const INTERACTIONS = [{ type: 'mousemove', x: 400, y: 20 }, { type: 'click', x: 10, y: 5 }, { type: 'mousemove', x: 1, y: 2 }];

const DATA = {
  sites: () => [{ site: 'jaytibirthday.in', events: 1200, visitors: 80, first_event_at: iso(9e8), last_event_at: iso(6e4) }],
  health: () => ({ counts: { events: 1200, visitors: 80 }, countsForSite: { events: 1200, visitors: 80 },
    coverage: { total: 1200, city: 1100 }, sources: [], span: { newest: iso(6e4) } }),
  overview: () => ({ totals: { events: 1200, visitors: 80, last_event_at: iso(6e4) },
    daily: [{ day: '2026-09-21', events: 5 }, { day: '2026-09-22', events: 7 }], hourly: [],
    byType: [{ label: 'page_view', n: 900 }], topPages: [], countries: [], cities: [], browsers: [], oses: [],
    devices: [], referrers: [], utm: [], languages: [], isps: [], timezones: [], domains: [], screens: [] }),
  visitors: (q) => ({ total: 1, limit: 100, offset: Number(q.offset) || 0,
    rows: [{ visitor_id: 'v-1', last_seen_at: iso(6e4), first_seen_at: iso(9e8), event_count: 3, session_count: 1 }] }),
  visitor: () => ({ profile: { visitor_id: 'v-1', city: 'Pune' }, sessions: [],
    events: [{ occurred_at: iso(6e4), event_type: 'page_view', page_url: 'https://jaytibirthday.in/', time_on_page: 30000 }],
    eventTotal: 1 }),
  sessions: (q) => ({ total: 1, limit: 100, offset: Number(q.offset) || 0,
    rows: [{ session_id: 's-1', visitor_id: 'v-1', started_at: iso(6e4), duration_seconds: 95, event_count: 3 }] }),
  session: () => ({ meta: { session_id: 's-1' },
    events: [{ occurred_at: iso(6e4), event_type: 'interaction_batch', page_url: 'https://jaytibirthday.in/',
      time_on_page: 30000, scroll_percent: 40, interactions: INTERACTIONS }] }),
  events: (q) => ({ total: 350, limit: 100, offset: Number(q.offset) || 0,
    rows: ['e-1', 'e-2'].map((id) => ({ id, occurred_at: iso(6e4), event_type: 'page_view', visitor_id: 'v-1',
      page_url: 'https://jaytibirthday.in/', time_on_page: 30000 })) }),
  event: (q) => ({ id: q.id, event_type: 'page_view', occurred_at: iso(6e4), time_on_page: 30000,
    screen: '{"width":1280,"height":720,"dpr":1.5,"raw":"1280x720 (DPR:1.5)"}',
    event_data: { section: 'hero' }, raw_payload: { eventType: 'page_view', timestamp: iso(6e4) } }),
  video: (q) => ({ total: 1, limit: 100, offset: Number(q.offset) || 0, byClip: [], byPlace: [],
    rows: [{ occurred_at: iso(6e4), video_event: 'intro', event_id: 'vid-1',
      visitor_device: { browser: 'Chrome', os: 'Android', device_type: 'mobile', screen: { w: 412, h: 915 } } }] }),
  s24: (q) => ({ migrated: true, normalized: true, total: 3, limit: 100, offset: Number(q.offset) || 0, runsTotal: 0,
    counts: { all: 3, files: 1, calls: 1, queue: 1 }, device: {}, datasets: [], runs: [],
    rows: [
      { dataset: 'firestore_files', record_id: 'f-private', filename: 'private.json', content: BIG_JSON, last_seen: iso(6e4) },
      { dataset: 'firestore_callLogs', record_id: 'call-123456', contact_name: 'Aarav', phone_number: '9876543210',
        call_type: 'incoming', called_at: iso(6e4), last_seen: iso(6e4) },
      { dataset: 'firestore_queue', record_id: 'q-123456', action: 'sync-now', status: 'queued',
        description: 'private sync details', created_at: iso(6e4), last_seen: iso(6e4) },
    ] }),
};
const ok = (data) => ({ status: 200, body: { ok: true, data } });
const answer = (q) => ok(DATA[q.view] ? DATA[q.view](q) : {});

// ---------- a fresh page per scenario ----------
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
const visible = (h) => String(h).replace(/<[^>]*>/g, ' ')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const assertNoJson = (h, where) => {
  const text = visible(h);
  assert.equal(/\{"|":/.test(text), false, `${where} shows JSON text: ${text.match(/.{0,30}(\{"|":).{0,30}/)?.[0]}`);
  assert.equal(text.includes('[object Object]'), false, `${where} shows [object Object]`);
  assert.equal(/<pre[\s>]/i.test(h), false, `${where} uses <pre>`);
};

async function load({ key = '', handler = answer } = {}) {
  await settle(); // let any previous instance finish before the globals move
  const elements = new Map();
  const mkEl = (id) => {
    const cls = new Set();
    const listeners = {};
    const el = {
      id, innerHTML: '', textContent: '', value: '', disabled: false, rowClicks: [],
      classList: {
        add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
        toggle: (c, on) => ((on === undefined ? !cls.has(c) : on) ? cls.add(c) : cls.delete(c)),
      },
      // A real form is rebuilt each time its gate is redrawn, so only the
      // newest listener is live; the stub keeps the element and fires the last.
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      fire(type) { const fns = listeners[type] || []; fns[fns.length - 1].call(el, { preventDefault() {} }); },
      getAttribute: () => null, setAttribute() {},
      querySelectorAll(sel) {
        if (sel !== 'tr.clickable') return [];
        el.rowClicks = [];
        return [...el.innerHTML.matchAll(/<tr class="clickable" data-i="(\d+)"/g)].map((m) => ({
          getAttribute: (n) => (n === 'data-i' ? m[1] : null),
          addEventListener: (type, fn) => { if (type === 'click') el.rowClicks[Number(m[1])] = fn; },
        }));
      },
    };
    return el;
  };
  const $ = (id) => { if (!elements.has(id)) elements.set(id, mkEl(id)); return elements.get(id); };
  const pages = [...html.matchAll(/<section class="page( on)?" id="(page-[a-z0-9]+)"/g)].map((m) => {
    const p = $(m[2]);
    if (m[1]) p.classList.add('on');
    return p;
  });
  globalThis.document = {
    getElementById: $,
    querySelectorAll: (sel) => (sel === '.page' ? pages : []),
    querySelector: (sel) => (sel === '.page.on' ? pages.find((p) => p.classList.contains('on')) || null : null),
    addEventListener() {},
  };
  globalThis.window = { location: { search: '' }, addEventListener() {} };
  const mkStorage = (init) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
  };
  const local = mkStorage(key ? { jbt_stats_key: key } : {});
  globalThis.localStorage = local;
  const session = mkStorage({});
  globalThis.sessionStorage = session;
  const log = [];
  globalThis.fetch = async (url, opts) => {
    const q = Object.fromEntries(new URL(url, 'https://x.test').searchParams.entries());
    const sentKey = (opts && opts.headers && opts.headers['x-stats-key']) || '';
    log.push({ ...q, sentKey });
    const res = await handler(q, sentKey);
    return { status: res.status, json: async () => res.body };
  };
  new Function(instrumented)();
  const dbg = globalThis.__dbg;
  await settle(); // boot: sites, first draw, health
  return { dbg, $, log, local, session, pages };
}

const deferred = () => { let release; const wait = new Promise((r) => { release = r; }); return { wait, release }; };

// ---------- units ----------
const app = await load({ key: KEY });
const { treeHtml, briefHtml, fileContentHtml, secs, msSecs, when, whenText } = app.dbg;

await t('a 30-second time_on_page, which arrives in milliseconds, reads "30s" and not "8h 20m"', () => {
  assert.equal(msSecs(30000), '30s');
  assert.equal(secs(30000), '8h 20m', 'the old call, for contrast');
  assert.equal(msSecs(null), '—');
  assert.equal(msSecs(95500), '1m 36s');
});

await t('a drawer tree reads time_on_page and the tracker\'s timeOnPage as a duration too, the stored ms on hover', () => {
  // The Events table said "30s" while the event drawer, a tree, printed the
  // same field as a bare 30000 and left the unit to a guess.
  const out = treeHtml({ time_on_page: 30000, raw_payload: { timeOnPage: '95500' }, loadTime: 1234 });
  assert.match(out, /<dt>time_on_page<\/dt><dd><span title="30000 ms">30s<\/span><\/dd>/);
  assert.match(out, /<dt>timeOnPage<\/dt><dd><span title="95500 ms">1m 36s<\/span><\/dd>/);
  assert.match(out, /<dt>loadTime<\/dt><dd>1234<\/dd>/, 'only the two millisecond fields are converted');
  assert.match(treeHtml({ time_on_page: 'n/a' }), /<dt>time_on_page<\/dt><dd>n\/a<\/dd>/, 'a value that is not a number stays as stored');
});

await t('true-seconds fields still read as seconds, and no part rounds up to 60', () => {
  assert.equal(secs(45), '45s');
  assert.equal(secs(119.6), '2m 0s');
  assert.equal(secs(7170), '1h 59m');
  assert.equal(secs(null), '—');
});

await t('a TEXT column holding JSON, like events.screen, renders as a labelled tree and not a JSON string', () => {
  const out = treeHtml({ screen: '{"width":1280,"height":720,"dpr":1.5,"raw":"1280x720 (DPR:1.5)"}', network: '{"effectiveType":"4g"}' });
  assert.match(out, /<dt>width<\/dt><dd>1280<\/dd>/);
  assert.match(out, /<dt>height<\/dt><dd>720<\/dd>/);
  assert.match(out, /<dt>effectiveType<\/dt><dd>4g<\/dd>/);
  assertNoJson(out, 'the tree');
});

await t('text that only starts with a bracket stays text, and unparseable JSON is shown in full as well as described', () => {
  for (const line of ['[INFO] daemon started', '[2026-09-22 10:00] daemon started', '[123456] is your OTP', '[-] failed']) {
    assert.equal(visible(treeHtml(line)), line, `a log line or message was hidden: ${line}`);
  }
  const cut = treeHtml('{"records": ["abc", "de');
  assert.match(cut, /does not parse/);
  // A note about a value is not the value: the stored text follows the note.
  assert.match(visible(cut), /records/, 'the stored text was replaced by a note about it');
});

await t('a deep tree renders every level: no depth cap and no shape summary', () => {
  let deep = { leaf: { a: 1, b: 2 } };
  for (let i = 0; i < 8; i++) deep = { level: deep };
  const out = treeHtml(deep);
  assert.match(out, /<dt>a<\/dt><dd>1<\/dd>/, 'the deepest leaf is rendered');
  assert.equal(out.includes('{ 1 key }'), false, 'a level was replaced by its shape');
  assertNoJson(out, 'a deep tree');
});
await t('a long object or list renders every entry: no entry cap and no count of what was left out', () => {
  const obj = treeHtml(JSON.parse(BIG_JSON));
  assert.equal((obj.match(/<dt>/g) || []).length, 300, 'every key is rendered');
  assert.equal(obj.includes('more'), false, 'entries were replaced by a count of entries');
  const list = treeHtml(Array.from({ length: 250 }, (_, i) => i));
  assert.equal((list.match(/<li>/g) || []).length, 250, 'every item is rendered');
});
await t('a structure small at every level but huge in total renders in full: no node budget', () => {
  const cube = Array.from({ length: 30 }, () => Array.from({ length: 30 }, () => Array.from({ length: 30 }, () => 1)));
  const out = treeHtml(cube);
  const rows = (out.match(/<li>/g) || []).length;
  // 30 outer items + 900 + 27,000 leaves: every level of the cube is rendered.
  assert.equal(rows, 30 + 900 + 27000, `${rows} rows for a 27,000-cell cube`);
  assert.equal(out.includes('[ 30 items ]'), false, 'a level was collapsed to its shape');
});
await t('timestamps are dates under _at, last_seen, camelCase At/Time/timestamp keys and as ISO strings anywhere', () => {
  const at = '2026-09-22T10:00:00.000Z';
  const out = treeHtml({ created_at: at, last_seen: at, first_seen: at, uploadedAt: at, timestamp: at, note: at,
    startTime: Date.parse(at), loadTime: 1234, phone_number: '9876543210' });
  const text = visible(out);
  assert.equal(text.includes(at), false, 'a raw ISO value is still on screen: ' + text);
  assert.equal((out.match(new RegExp('title="' + at.replace(/\./g, '\\.') + '"', 'g')) || []).length, 6, 'six ISO values carry their raw form on hover');
  assert.match(out, /<dt>startTime<\/dt><dd><span title="\d+">/, 'an epoch under a time key is a date');
  assert.match(out, /<dt>loadTime<\/dt><dd>1234<\/dd>/, 'a duration is not 1 Jan 1970');
  assert.match(out, /<dt>phone_number<\/dt><dd>9876543210<\/dd>/, 'a ten-digit number under any other key stays a number');
  const strings = treeHtml({ loadTime: '1500', responseTime: '8000 ms', seen_at: '12345', sentAt: 'Tue, 22 Sep 2026 10:00:00 GMT',
    lastSeen: '1758535200.25' });
  assert.match(strings, /<dt>lastSeen<\/dt><dd><span title="1758535200\.25">/, "a Python time.time() string is a date");
  assert.match(strings, /<dt>loadTime<\/dt><dd>1500<\/dd>/, 'a duration string became the year 1500');
  assert.match(strings, /<dt>responseTime<\/dt><dd>8000 ms<\/dd>/);
  assert.match(strings, /<dt>seen_at<\/dt><dd>12345<\/dd>/, 'a short number became the year 12345');
  assert.match(strings, /<dt>sentAt<\/dt><dd><span title="Tue, 22 Sep 2026 10:00:00 GMT">/, 'a written-out date is a date');
});

await t('an unparseable timestamp is escaped exactly once, in tables, trees and KPIs alike', () => {
  const bad = 'n/a <unknown>';
  assert.equal(when(bad), 'n/a &lt;unknown&gt;');
  assert.equal(whenText(bad), bad);
  assert.equal(treeHtml({ created_at: bad }).includes('&amp;lt;'), false);
});

await t('interactions and visitor_device get a one-line summary in a table cell instead of [object Object]', () => {
  assert.equal(briefHtml(INTERACTIONS), '3 · mousemove ×2, click ×1');
  const device = briefHtml({ browser: 'Chrome', os: 'Android', device_type: 'mobile', screen: { w: 1 } });
  assert.match(device, /^browser: Chrome · os: Android · device_type: mobile/);
  assert.match(device, /\+1 more/);
  assert.equal(briefHtml(null), '—');
  assert.equal(briefHtml(0), '0');
});

await t('a stored JSON file renders as a full tree under a summary, every key included', () => {
  const out = fileContentHtml(BIG_JSON, { filename: 'result.json', fileType: 'json' });
  assert.match(out, /JSON object with 300 keys/);
  assert.match(out, /value-250/, 'entries past the old cap are rendered');
  assert.equal(out.includes('more'), false, 'entries were replaced by a count of entries');
  assertNoJson(out, 'the JSON file');
});
await t('a plain-text file shows its name, type, length and its whole content', () => {
  const out = fileContentHtml(LONG_TEXT, { filename: 'notes.txt', fileType: 'txt' });
  assert.match(out, /<dd>notes\.txt<\/dd>/);
  assert.match(out, /<dd>txt<\/dd>/);
  assert.match(out, new RegExp('Content \u00b7 ' + LONG_TEXT.length.toLocaleString('en-IN') + ' characters'));
  assert.match(out, /END-OF-FILE-MARKER/, 'the whole file reaches the drawer');
  assert.equal(/<pre[\s>]/.test(out), false);
});
await t('a PDF, base64 or unparseable JSON stored as text is shown as text', () => {
  const pdf = fileContentHtml('%PDF-1.7\n' + 'x'.repeat(900));
  assert.match(pdf, /%PDF-1\.7/);
  assert.equal(pdf.includes('Not shown'), false);
  const b64 = Buffer.from(Array.from({ length: 900 }, (_, i) => (i * 37) % 256)).toString('base64').replace(/(.{76})/g, '$1\n');
  assert.match(fileContentHtml(b64), /Content \u00b7 /);
  assert.equal(fileContentHtml(b64).includes('Not shown'), false);
  const cut = fileContentHtml('{"records": ["' + 'x'.repeat(800));
  assert.match(cut, /records/);
  assert.equal(cut.includes('Not shown'), false);
});
await t('a file that is only a list of numbers or ids is shown in full, like any other text', () => {
  const numbers = Array.from({ length: 40 }, (_, i) => '98765' + String(10000 + i)).join('\n');
  assert.match(fileContentHtml(numbers), /9876510000/);
  const ids = Array.from({ length: 40 }, (_, i) => 'Rec' + i + 'AbC9x').join('\n');
  assert.match(fileContentHtml(ids), /Rec0AbC9x/);
  assert.match(fileContentHtml(ids), /Rec39AbC9x/, 'the last line is rendered too');
  const hashes = '0123456789abcdef'.repeat(20);
  assert.match(fileContentHtml(hashes), /0123456789abcdef/);
});
await t('the Events table and the Session and Visitor drawers show time_on_page in seconds, and interactions as a count by type', async () => {
  await app.dbg.RENDER.events();
  const events = app.$('page-events').innerHTML;
  assert.match(events, /<td>30s<\/td>/);
  assert.equal(events.includes('8h 20m'), false);

  await app.dbg.RENDER.sessions();
  app.$('page-sessions').rowClicks[0]();
  await settle();
  const session = app.$('drawerBody').innerHTML;
  assert.match(session, /<td>30s<\/td>/);
  assert.match(session, /3 · mousemove ×2, click ×1/);
  assertNoJson(session, 'the session drawer');

  await app.dbg.RENDER.audience();
  app.$('page-audience').rowClicks[0]();
  await settle();
  assert.match(app.$('drawerBody').innerHTML, /<td>30s<\/td>/);
});

await t('the event drawer shows the screen column as a width/height tree', async () => {
  await app.dbg.RENDER.events();
  app.$('page-events').rowClicks[0]();
  await settle();
  const body = app.$('drawerBody').innerHTML;
  assert.match(body, /<dt>screen<\/dt><dd><dl class="kv"><dt>width<\/dt><dd>1280<\/dd><dt>height<\/dt><dd>720<\/dd>/);
  assertNoJson(body, 'the event drawer');
});

await t('the Video table renders an object visitor_device whole, and its drawer shows the same value', async () => {
  await app.dbg.RENDER.video();
  const page = app.$('page-video').innerHTML;
  assert.match(page, /<dt>browser<\/dt><dd>Chrome<\/dd>/, 'the cell carries the whole value, not a summary');
  assert.match(page, /<dt>device_type<\/dt><dd>mobile<\/dd>/);
  assertNoJson(page, 'the video table');
  app.$('page-video').rowClicks[0]();
  assert.match(app.$('drawerBody').innerHTML, /<dt>screen<\/dt><dd><dl class="kv"><dt>w<\/dt><dd>412<\/dd>/);
});
await t('the S24 surface shows stored artifacts, personal fields and every row, and filters only when asked', async () => {
  app.dbg.state.s24Section = 'calls';
  app.dbg.state.s24Query = '';
  await app.dbg.RENDER.s24();
  const page = app.$('page-s24');
  assert.match(page.innerHTML, /private\.json/, 'a stored artifact name is shown');
  assert.match(page.innerHTML, /9876543210/, 'the stored number is shown as stored');
  assert.match(page.innerHTML, /Aarav/, 'the stored contact name is shown');
  assert.equal(page.innerHTML.includes('\u2022\u2022\u2022\u2022'), false, 'a value is still masked');
  assert.equal(page.rowClicks.length, 3, 'every stored row is on the page and clickable');

  page.rowClicks[1]();
  const call = app.$('drawerBody').innerHTML;
  assert.match(call, /9876543210/, 'the raw number reaches the drawer');
  assert.match(call, /<dt>phone_number<\/dt>/, 'the column is named, not hidden');
  assert.match(call, /Every stored field of this record/, 'the drawer says what it is showing');

  app.dbg.state.s24Section = 'all';
  app.dbg.state.s24Query = 'sync';
  await app.dbg.RENDER.s24();
  const filtered = app.$('page-s24').innerHTML;
  assert.match(filtered, /Review the records, not the storage layer/);
  assert.match(filtered, /<strong>1<\/strong> of 3 loaded records/, 'the query filters the loaded rows');
  assert.match(filtered, /sync-now/);
  assert.equal(filtered.includes('Aarav'), false, 'the pre-query row is gone');
});
await t('a slow detail response for one row cannot replace the drawer of a row opened after it', async () => {
  const slow = deferred();
  const racing = await load({ key: KEY, handler: async (q) => {
    if (q.view === 'event' && q.id === 'e-1') await slow.wait;
    return answer(q);
  } });
  await racing.dbg.RENDER.events();
  racing.$('page-events').rowClicks[0](); // e-1, slow
  racing.$('page-events').rowClicks[1](); // e-2, fast
  await settle();
  slow.release();
  await settle();
  const body = racing.$('drawerBody').innerHTML;
  assert.match(body, /<dt>id<\/dt><dd>e-2<\/dd>/);
  assert.equal(body.includes('<dd>e-1</dd>'), false, "row A's late response replaced row B's drawer");
});

await t('a superseded detail request neither raises a banner when it fails nor reopens a drawer the operator closed', async () => {
  const failing = deferred();
  const late = deferred();
  const racing = await load({ key: KEY, handler: async (q) => {
    if (q.view === 'event' && q.id === 'e-1') { await failing.wait; throw new TypeError('Failed to fetch'); }
    if (q.view === 'session') await late.wait;
    return answer(q);
  } });
  await racing.dbg.RENDER.events();
  racing.$('page-events').rowClicks[0](); // e-1: will fail, after e-2 has opened
  racing.$('page-events').rowClicks[1]();
  await settle();
  failing.release();
  await settle();
  assert.equal(racing.$('err').innerHTML, '', 'the superseded failure put a banner over the open drawer');
  assert.match(racing.$('drawerBody').innerHTML, /<dd>e-2<\/dd>/);

  await racing.dbg.RENDER.sessions();
  racing.$('page-sessions').rowClicks[0]();
  racing.$('drawerClose').fire('click'); // dismissed before the detail arrived
  late.release();
  await settle();
  assert.equal(racing.$('drawer').classList.contains('on'), false, 'the late response reopened a dismissed drawer');
});

await t('two overlapping draws end on the later page even when the earlier response arrives last', async () => {
  const first = deferred();
  const paged = await load({ key: KEY, handler: async (q) => {
    if (q.view === 'events' && q.offset === '100') await first.wait;
    return answer(q);
  } });
  paged.dbg.state.page = 'events';
  paged.dbg.state.offsets.events = 100;
  paged.dbg.draw();
  paged.dbg.state.offsets.events = 200;
  paged.dbg.draw();
  await settle();
  first.release();
  await settle();
  const out = paged.$('page-events').innerHTML;
  assert.match(out, /201–300 of 350/);
  assert.equal(out.includes('101–200 of 350'), false, 'the stale page-2 response painted over page 3');
});

const refused = (code) => ({ status: 401, body: { ok: false, code, error: 'unauthorized' } });

await t('a first visit with no key asks for one instead of saying a key was rejected', async () => {
  const fresh = await load({ handler: () => refused('auth_missing') });
  const gate = fresh.$('page-overview').innerHTML;
  assert.match(gate, /Enter the dashboard key to load this page\./);
  assert.equal(/rejected/i.test(gate), false);
  assert.match(gate, /only for this browser tab/i);
});

await t('a stored key the server refuses is reported as rejected, even after the keyless requests that follow', async () => {
  const stale = await load({ key: KEY, handler: () => refused('auth_invalid') });
  assert.match(stale.$('page-overview').innerHTML, /That dashboard key was rejected\./);
  assert.equal(stale.local.getItem('jbt_stats_key'), null, 'the refused legacy key was kept');
  assert.equal(stale.session.getItem('jbt_stats_key'), null, 'the refused session key was kept');
});

await t('an auth 503 on the S24 page leaves the gate up without claiming the deleted key is still stored', async () => {
  const s24 = await load({ key: KEY, handler: (q) => (q.view === 's24'
    ? { status: 503, body: { ok: false, code: 'auth_not_configured', error: 'STATS_KEY is not configured on this deployment' } }
    : answer(q)) });
  s24.dbg.state.page = 's24';
  s24.dbg.draw();
  await settle();
  const out = s24.$('page-s24').innerHTML;
  assert.match(out, /STATS_KEY is not configured on this deployment/);
  assert.match(out, /<form id="dbUnlock">/);
  assert.equal(/still stored|locked /.test(visible(out)), false, visible(out));
});

await t('unlocking through the gate reloads the property list and the nav counts, not only the page', async () => {
  const gated = await load({ handler: (q, sentKey) => (sentKey ? answer(q) : refused('auth_missing')) });
  assert.equal(gated.$('siteSel').innerHTML, '', 'boot filled the property list without a key');
  gated.$('dbKeyInput').value = KEY;
  gated.$('dbUnlock').fire('submit');
  await settle();
  assert.match(gated.$('siteSel').innerHTML, /<option value="jaytibirthday\.in">/);
  assert.match(gated.$('foot').textContent, /events, all properties/);
  assert.match(gated.$('page-overview').innerHTML, /class="kpi"/);
  const afterUnlock = gated.log.filter((r) => r.sentKey === KEY).map((r) => r.view);
  assert.ok(afterUnlock.includes('sites') && afterUnlock.includes('health'), afterUnlock.join(', '));
});

await t('a keyless boot request refused after the operator has unlocked does not delete the new key', async () => {
  const late = deferred();
  const racing = await load({ handler: async (q, sentKey) => {
    if (sentKey) return answer(q);
    if (q.view === 'health') await late.wait; // boot's badge refresh, still in flight
    return refused('auth_missing');
  } });
  racing.$('dbKeyInput').value = KEY;
  racing.$('dbUnlock').fire('submit');
  await settle();
  late.release();
  await settle();
  assert.equal(racing.local.getItem('jbt_stats_key'), null, 'the valid key must not persist in localStorage');
  assert.equal(racing.session.getItem('jbt_stats_key'), KEY, 'the valid session key was deleted by a refusal of no key');
  assert.match(racing.$('page-overview').innerHTML, /class="kpi"/);
  assert.equal(racing.$('page-overview').innerHTML.includes('private-gate'), false);
});

await t('a property list that fails after unlocking says so instead of leaving the selector silently empty', async () => {
  const broken = await load({ handler: (q, sentKey) => (!sentKey ? refused('auth_missing')
    : q.view === 'sites' ? { status: 500, body: { ok: false, error: 'sites query failed' } } : answer(q)) });
  broken.$('dbKeyInput').value = KEY;
  broken.$('dbUnlock').fire('submit');
  await settle();
  assert.match(broken.$('err').innerHTML, /sites query failed/);
  assert.match(broken.$('page-overview').innerHTML, /class="kpi"/, 'the page itself still drew');
});

await t('Lock dashboard forgets the key, wipes every drawn page and drops responses still in flight', async () => {
  const slow = deferred();
  let holdCounts = false;
  const locking = await load({ key: KEY, handler: async (q) => {
    if ((q.view === 's24' && q.section === 'calls') || (q.view === 'health' && holdCounts)) await slow.wait;
    return answer(q);
  } });
  // Two requests will be in flight when the lock lands: a page draw, and a
  // nav-count refresh -- which belongs to no draw, so only the lock epoch can
  // drop it. The property switch starts the refresh and redraws the overview.
  holdCounts = true;
  locking.$('siteSel').fire('change');
  await settle();
  assert.match(locking.$('page-overview').innerHTML, /class="kpi"/);
  locking.dbg.state.page = 's24';
  locking.dbg.draw();
  await settle();
  assert.match(locking.$('page-s24').innerHTML, />Lock dashboard</);
  locking.$('page-s24').rowClicks[1](); // a record is open in the drawer
  assert.match(locking.$('drawerBody').innerHTML, /Every stored field of this record/);
  locking.dbg.state.s24Section = 'calls';
  locking.dbg.draw();
  locking.$('s24Lock').fire('click');
  slow.release();
  await settle();
  assert.equal(locking.local.getItem('jbt_stats_key'), null);
  assert.match(locking.$('page-s24').innerHTML, /Dashboard locked\./);
  assert.equal(locking.$('page-s24').innerHTML.includes('class="kpi"'), false, 'the in-flight page painted behind the lock');
  assert.equal(locking.$('foot').textContent, '—', 'the in-flight counts refilled the footer after the lock');
  assert.equal(locking.$('page-overview').innerHTML, '', 'the overview kept its data after the lock');
  assert.equal(locking.$('drawerBody').innerHTML, '', 'the last opened record stayed in the hidden drawer');
  assert.equal(locking.$('siteSel').innerHTML, '');
});

await t('a request from before the lock that fails afterwards puts no error banner on the locked screen', async () => {
  const slow = deferred();
  let holdCounts = false;
  const locking = await load({ key: KEY, handler: async (q) => {
    if (q.view === 'health' && holdCounts) { await slow.wait; throw new TypeError('Failed to fetch'); }
    return answer(q);
  } });
  holdCounts = true;
  locking.$('siteSel').fire('change'); // starts a nav-count refresh that will fail
  locking.dbg.state.page = 's24';
  locking.dbg.draw();
  await settle();
  locking.$('s24Lock').fire('click');
  slow.release();
  await settle();
  assert.equal(locking.$('err').innerHTML, '', 'a pre-lock failure raised a banner over the gate');
  assert.match(locking.$('page-s24').innerHTML, /Dashboard locked\./);
});

console.log(`\n${pass}/${total} checks passed`);
if (pass !== total) process.exitCode = 1;
