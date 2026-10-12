// Columns that reached the database and then stopped.
//
// db-page-render.test.mjs proves every page runs; db-page-views.test.mjs pins
// what each page shows. Both hand the page EMPTY payloads, so neither can catch
// the failure this suite exists for: db-api selects a column, the renderer
// never draws it, every suite is green, and the data is invisible to the only
// person who would act on it.
//
// Three of those shipped at once:
//
//   * Database/schema/008_wa_sync_attachment_counts.sql added
//     wa_sync_runs.attachments_seen / attachments_skipped for exactly one
//     reason -- a run that discarded every attachment read like a perfect one,
//     which is how wa_attachments stayed empty against 18,232 media messages --
//     and nothing selected or drew either column.
//   * s24_device_snapshots.manufacturer, model, android_version, battery_level
//     and observed_at were selected for the phone panel; only some were drawn.
//   * s24_sync_batches (batch_index of batch_count) had no reader at all, so a
//     run that delivered 12 of 40 chunks looked complete.
//
// This drives the real page script against a stub DOM with those fields
// PRESENT and asserts they reach the HTML. It also pins the general fix: Health
// must render coverage for every table from information_schema, not only
// `events`, so the next migration's column cannot go missing the same way.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'Frontend', 'db.html'), 'utf8');
const api = readFileSync(join(ROOT, 'Backend', 'db-api.js'), 'utf8');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};

// ---- the API side: is every column even asked for? ------------------------
check('db-api reads whole rows: SELECT * for every table a view serves',
  ['s24_records', 's24_calls', 's24_sms', 's24_locations', 's24_commands', 's24_queue_items',
    's24_sync_runs', 's24_device_snapshots', 'wa_chats', 'wa_messages', 'wa_attachments',
    'wa_sync_runs', 'events', 'visitors', 'sessions', 'letters', 'email_opens', 'video_events', 'devices']
    .every((table) => {
      const hits = [];
      for (let i = api.indexOf('FROM ' + table); i !== -1; i = api.indexOf('FROM ' + table, i + 1)) hits.push(i);
      return hits.some((i) => api.slice(Math.max(0, i - 400), i).includes('SELECT *'));
    }),
  'a table is still read with a hand-kept column list, which is how a column goes missing');
check('db-api has no masking, rounding or dataset filter left',
  !/maskPhone|maskPerson|maskIdentifier|coarseCoordinate|sanitizeS24Rows|isReviewableDataset|dataset <> 'firestore_files'/.test(api),
  'a stored value is still being changed on the way out');
check('db-api returns the per-chunk batch ledger',
  /statusCounts, batches, batchesTotal/.test(api), 's24_sync_batches has no reader');
check('db-api returns coverage for every table, not only events',
  /coverage, coverageByTable, sources, span/.test(api),
  'a column added by a future migration would have neither a panel nor a coverage row');
check('db-api exposes one generic view over an allow-list of app tables',
  /const APP_TABLES = \[/.test(api) && /APP_TABLES\.includes\(table\)/.test(api) && /SELECT \* FROM \$\{table\}/.test(api),
  'there is no every-column view, or it is not scoped to the app table list');
check('the handler forwards the table name to the generic view',
  /name: req\.query\.name/.test(api), 'the every-column view can never be asked for a table');
check('the coverage queries are scoped to the public schema and the app table list',
  (api.match(/table_schema = 'public'/g) || []).length >= 2 && !/information_schema\.tables/.test(api),
  'coverage could report tables this app does not own');

// ---- the page side: does it draw them? ------------------------------------
const script = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
const instrumented = script.replace(/\}\)\(\);\s*$/,
  'globalThis.__dbg = { RENDER: RENDER, state: state, PAGES: PAGES };\n})();');

// The /db explorer's page inventory, pinned.
//
// db-page-render.test.mjs iterates PAGES and checks that every entry has a
// renderer and a section. That loop is driven by whatever PAGES currently
// holds, so DELETING a page removes its own check instead of failing the
// suite: thirteen checks quietly became twelve, every suite stayed green, and
// a view the operator read every day simply vanished from the nav. This list
// is the inventory, not a summary of what is there.
//
// A page added to the explorer belongs in this list in the same commit. A page
// removed from it has to be removed here on purpose, by someone who knows it
// is being withdrawn.
const EXPECTED_PAGES = ['overview', 'audience', 'geo', 'pages', 'sessions', 'events', 'video',
  'devices', 's24', 'whatsapp', 'letters', 'emails', 'health', 'tables'];


const elements = new Map();
const mkEl = (id) => {
  const cls = new Set();
  return {
    id, innerHTML: '', textContent: '', value: '', disabled: false,
    classList: {
      add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
      toggle: (c, on) => ((on === undefined ? !cls.has(c) : on) ? cls.add(c) : cls.delete(c)),
    },
    addEventListener() {}, getAttribute: () => null, setAttribute() {},
    querySelectorAll: () => [],
  };
};
const $ = (id) => { if (!elements.has(id)) elements.set(id, mkEl(id)); return elements.get(id); };
const pages = [...html.matchAll(/<section class="page( on)?" id="(page-[a-z0-9]+)"/g)]
  .map((m) => { const p = $(m[2]); if (m[1]) p.classList.add('on'); return p; });

check('the /db explorer keeps every page it has ever had',
  EXPECTED_PAGES.every((id) => html.includes(`id="page-${id}"`)),
  'a page section is gone from db.html, so its data has no screen:\n      missing: '
  + EXPECTED_PAGES.filter((id) => !html.includes(`id="page-${id}"`)).join(', '));

globalThis.document = {
  getElementById: $,
  querySelectorAll: (sel) => (sel === '.page' ? pages : []),
  querySelector: (sel) => (sel === '.page.on' ? pages.find((p) => p.classList.contains('on')) || null : null),
  addEventListener() {},
};
globalThis.window = { location: { search: '' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
const KEY = 'k'.repeat(40);
const mkStorage = (init) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
globalThis.localStorage = mkStorage({ jbt_stats_key: KEY });
globalThis.sessionStorage = mkStorage({});
globalThis.setInterval = () => 0;

const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600e3).toISOString();
const DATA = {
  sites: [{ site: 'jaytibirthday.in', events: 10, visitors: 2, first_event_at: iso(50), last_event_at: iso(1) }],
  health: {
    counts: { events: 10, wa_sync_runs: 3 }, countsForSite: { events: 10, wa_sync_runs: 3 },
    coverage: { total: 10, city: 9 },
    coverageByTable: [
      { table: 'events', total: 10, columns: [{ name: 'city', filled: 9 }, { name: 'brand_new_column', filled: 0 }] },
      { table: 'wa_sync_runs', total: 3, columns: [{ name: 'attachments_seen', filled: 3 }, { name: 'attachments_skipped', filled: 1 }] },
    ],
    sources: [{ source_system: 'dynamodb', n: 4, oldest: iso(80), newest: iso(2) }], span: { newest: iso(1) },
  },
  whatsapp: {
    total: 1, limit: 100, offset: 0, byKind: [{ label: 'direct', n: 1, messages: 5 }],
    totals: { chats: 1, messages: 5, attachments: 2, runs: 1, oldest: iso(90), newest: iso(1) },
    runs: [{
      run_id: 'r1', device_id: 'samsung-s24-ultra', started_at: iso(3), finished_at: iso(2),
      chats_seen: 5, messages_seen: 50, attachments_seen: 7, attachments_skipped: 3,
      status: 'done', note: 'media metadata arrived with no blob_url',
    }],
    rows: [{ chat_id: 'c1', name: 'Chat', kind: 'direct', msg_count: 5, enc_count: 0, media_count: 2, audio_count: 0, call_count: 0, member_count: null, last_at: iso(1) }],
  },
  table: { table: 'events', total: 1, limit: 100, offset: 0,
    columns: [
      { column_name: 'id', data_type: 'text' },
      { column_name: 'occurred_at', data_type: 'timestamp with time zone' },
      { column_name: 'brand_new_column', data_type: 'text' }
    ],
    rows: [{ id: 'e-1', occurred_at: iso(1), brand_new_column: 'a value that must be on screen' }] },
  s24: {
    migrated: true, normalized: true, section: 'overview', total: 1, limit: 100, offset: 0, rows: [],
    datasets: [{ dataset: 'direct_sms', status: 'ok', record_count: 10, stored_records: 10, source: 'pull_direct_cloud.py', detail: 'all records stored', collected_at: iso(5) }],
    runs: [], runsTotal: 0, statusCounts: [],
    batches: [{ run_id: 'run-1234567890', batch_index: 2, batch_count: 40, record_count: 500, received_at: iso(4) }],
    batchesTotal: 40,
    counts: { all: 1, calls: 0, sms: 1, locations: 0, agents: 0, commands: 0, queue: 0 },
    device: {
      observed_at: iso(6), agent_version: '1.2.3', android_version: '15', model: 'SM-S928B',
      manufacturer: 'samsung', battery_level: 42, status: 'verified', connection_method: 'adb',
      heartbeat_auth: 'signed', source_type: 'pull', runtime_is_android: true,
      live_device_verified: true, last_seen: iso(6),
    },
  },
};
globalThis.fetch = async (url) => {
  const q = Object.fromEntries(new URL(url, 'https://x.test').searchParams.entries());
  const data = q.view ? (DATA[q.view] ?? {}) : {};
  return { ok: true, status: 200, json: async () => ({ ok: true, view: q.view, data }), text: async () => '' };
};

new Function(instrumented)();
const dbg = globalThis.__dbg;
await new Promise((resolve) => setTimeout(resolve, 0));

dbg.state.s24Key = KEY;
await dbg.RENDER.health();
await dbg.RENDER.tables();
await dbg.RENDER.whatsapp();
await dbg.RENDER.s24();

const health = $('page-health').innerHTML;
const whatsapp = $('page-whatsapp').innerHTML;
const s24 = $('page-s24').innerHTML;

check('WhatsApp draws the attachment counts 008 added',
  whatsapp.includes('Attachments') && whatsapp.includes('Dropped') && whatsapp.includes('>7<'),
  'the columns that make a discarded attachment visible never reach the page');
check('a run that dropped attachments is marked, not just counted',
  whatsapp.includes('pill bad">3'), 'skipped attachments render as an ordinary number');
check('WhatsApp draws finished_at and note',
  whatsapp.includes('60m') && whatsapp.includes('media metadata arrived with no blob_url'),
  'a run that never finished still looks like a completed one');
check('the S24 batch ledger is drawn',
  s24.includes('Batch ledger') && s24.includes('2 / 40') && s24.includes('500'),
  's24_sync_batches has no panel');
check('the phone panel draws what the phone reported about itself',
  s24.includes('Reported hardware') && s24.includes('samsung SM-S928B') && s24.includes('42%') && s24.includes('Snapshot taken'),
  'manufacturer / battery_level / observed_at are selected and dropped');
check('dataset coverage rows carry source and collected_at',
  s24.includes('source pull_direct_cloud.py') && s24.includes('collected '),
  'a dataset whose pull came from elsewhere, or stopped, looks the same as one that is fine');
check('Health covers every table, and names the empty columns',
  health.includes('Column coverage by table') && health.includes('brand_new_column') && health.includes('wa_sync_runs'),
  'coverage for anything but events is still missing');
check('a populated new column is still findable by name',
  health.includes('attachments_seen 3'),
  'only empty columns are named, so "is this column arriving?" has no answer');

const tablesPage = $('page-tables').innerHTML;
check('the all-tables page lists every column of the table it opened',
  ['id', 'occurred_at', 'brand_new_column'].every((c) => tablesPage.includes(c)),
  'a column of the selected table is not named on the page');
check('the all-tables page renders the stored value of every column',
  tablesPage.includes('a value that must be on screen') && tablesPage.includes('e-1'),
  'a column rendered as a header with no value');

// The inventory, the other way round: PAGES is the nav. A page that has a
// section but no nav entry is unreachable by anyone who cannot guess its id,
// and PAGES is also what db-page-render iterates -- so this is the list whose
// loop quietly shortens when a page is deleted.
const livePages = (globalThis.__dbg.PAGES || []).map((p) => p[0]);
check('the nav lists exactly the pages the explorer has',
  EXPECTED_PAGES.every((id) => livePages.includes(id)) && livePages.every((id) => EXPECTED_PAGES.includes(id)),
  'the nav and the page set have drifted apart:\n      nav: ' + livePages.join(', ')
  + '\n      expected: ' + EXPECTED_PAGES.join(', '));
check('every page in the inventory still has a renderer',
  EXPECTED_PAGES.every((id) => typeof globalThis.__dbg.RENDER[id] === 'function'),
  'a section would render as a blank tab:\n      missing renderer: '
  + EXPECTED_PAGES.filter((id) => typeof globalThis.__dbg.RENDER[id] !== 'function').join(', '));

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
