// The dashboard's "Media" page (/viewer) has to render WhatsApp attachments from
// routes that exist.
//
// Until the rebuild it was a "Chrome Data Browser" whose only request went to a
// chrome-data route. vercel.json's catch-all maps /api/<name> to
// Backend/<name>.js, and that file never existed, so production only ever showed
// "available locally" over a hardcoded "Databases: 4" while every stored value
// was written into innerHTML unescaped. Nothing caught it, because the page is
// one inline script with no build step: a call to a route with no handler parses
// cleanly and fails only in front of the operator.
//
// This loads the page's own script into a stub DOM (the db-page-render.test.mjs
// technique), reaches its private helpers through an instrumented copy, and pins
// the contracts the page exists to keep: every route it calls has a handler, the
// key travels in a header except where <img>/<video>/<audio> cannot send one,
// BIGINT sizes (strings from node-postgres) still format, stored text can never
// become markup, and a failure is a sentence rather than a payload.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
await import('../../Frontend/section-presentation.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'Frontend', 'viewer.html'), 'utf8');
const sharedPresentation = readFileSync(join(ROOT,'Frontend','section-presentation.js'),'utf8');
const script = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
// Comments explain history (including the dead route's name); only code counts.
const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

// ── static contract ──────────────────────────────────────────────────────

t('the sidebar\'s Media entry still lands on this page (index.html -> /viewer -> Frontend/viewer.html)', () => {
  const index = readFileSync(join(ROOT, 'Frontend', 'index.html'), 'utf8');
  assert.match(index, /href="\/viewer"[^>]*>[\s\S]{0,80}Media</, 'the sidebar no longer links Media to /viewer');
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const route = vercel.routes.find((r) => r.src === '/viewer');
  assert.ok(route && route.dest === '/Frontend/viewer.html', 'vercel.json stopped routing /viewer to this file');
});

t('every /api route the page calls resolves to a Backend handler — the old page called one that did not', () => {
  const routes = [...new Set([...(code+sharedPresentation).matchAll(/'\/api\/([a-z0-9-]+)/g)].map((m) => m[1]))];
  assert.deepEqual(routes.sort(), ['jp-live-content', 'jp-whatsapp', 'wa-media']);
  for (const r of routes) {
    assert.ok(existsSync(join(ROOT, 'Backend', r + '.js')), `/api/${r} has no Backend/${r}.js, so it 404s in production`);
  }
  assert.equal(/chrome-data/.test(code), false, 'the dead chrome-data route is still called');
});

t('the key is session-scoped in the shared jbt_stats_key slot and legacy persistent copies are removed', () => {
  assert.ok(code.includes("KEY_STORAGE = 'jbt_stats_key'"), 'wrong or missing slot');
  assert.match(code, /sessionStorage\.getItem\(\s*KEY_STORAGE/, 'never reads the current-tab session slot');
  assert.match(code, /sessionStorage\.setItem\(\s*KEY_STORAGE/, 'never writes the current-tab session slot');
  assert.match(code, /localStorage\.getItem\(\s*KEY_STORAGE/, 'never migrates a legacy persistent key');
  assert.doesNotMatch(code, /localStorage\.setItem\(\s*KEY_STORAGE/, 'persists the dashboard key across browser restarts');
  assert.match(code, /localStorage\.removeItem\(\s*KEY_STORAGE/, 'does not clear a migrated persistent key');
  assert.match(script, /try\s*\{[^}]*localStorage/, 'storage touched outside try/catch; private mode throws');
  assert.equal(code.includes('jbt_site'), false, "jbt_site is index.html's site selector, not a credential");
});

t('only an auth failure clears the key: a 503 store outage branches on _auth.js\'s auth_* code', () => {
  assert.match(code, /\/\^auth_\/\.test\(/, 'every 503 would log the operator out, including a DATABASE_URL outage');
});

t('the dashboard key never enters a URL; media uses a short-lived attachment token', () => {
  const lines = code.split('\n').filter((l) => /[?&]key=/.test(l));
  assert.equal(lines.length, 0, 'a URL still carries the long-lived dashboard key');
  assert.match(sharedPresentation, /\/api\/wa-media\?att_id=.*&token=/, 'media proxy has no attachment token');
  assert.match(code, /'x-stats-key': KEY/, 'API requests no longer send the x-stats-key header');
});

// ── run the page's own script in a stub DOM ─────────────────────────────

const KEY = 'k'.repeat(40);
// Each boot() gets fresh elements, storage and a call log; the stubs below read
// whichever are current.
let elements = new Map(), store = new Map(), sessionStore = new Map(), calls = [], chatsFail = false, liveOverride = null;
function mkEl(id) {
  return {
    id, innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, children: [],
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null,
    querySelectorAll: () => [], focus() {},
  };
}
globalThis.document = {
  getElementById(id) { if (!elements.has(id)) elements.set(id, mkEl(id)); return elements.get(id); },
  createElement: () => mkEl(''),
};
globalThis.window = globalThis;
globalThis.localStorage ={ getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = { getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null), setItem: (k, v) => sessionStore.set(k, String(v)), removeItem: (k) => sessionStore.delete(k) };

const DM = '919800000001@s.whatsapp.net';
const HOSTILE_FILE = '<img src=x onerror="alert(1)">shot.png';
const HOSTILE_CHAT = 'Mallory <script>alert(2)</script>';
const ROWS = [
  // size_bytes as strings: wa_attachments.size_bytes is BIGINT, which node-postgres returns as a string
  { att_id: DM + ':m1:aa', media_token: 'tok-1', chat_id: DM, kind: 'image', mime: 'image/jpeg', file_name: 'IMG-1.jpg', size_bytes: '48213', width: 1080, height: 1440, sent_at: '2026-09-22T10:00:00.000Z', ingested_at: '2026-09-22T10:01:00.000Z' },
  { att_id: DM + ':m2:bb', media_token: 'tok-2', chat_id: DM, kind: 'document', mime: 'application/pdf', file_name: 'Rent.pdf', size_bytes: '2201931', sent_at: '2026-09-21T10:00:00.000Z', ingested_at: '2026-09-21T10:01:00.000Z' },
  { att_id: 'evil:m3:cc', media_token: 'tok-3', chat_id: 'evil', kind: 'image', mime: 'image/png', file_name: HOSTILE_FILE, size_bytes: '1000', sent_at: '2026-09-20T10:00:00.000Z', ingested_at: '2026-09-20T10:01:00.000Z' },
];
globalThis.fetch = async (url, init) => {
  calls.push({ url, headers: (init && init.headers) || {} });
  if (chatsFail && url.startsWith('/api/jp-whatsapp')) {
    return { ok: false, status: 500, text: async () => JSON.stringify({ ok: false, error: 'boom' }) };
  }
  const body = url.startsWith('/api/jp-live-content')
    ? (liveOverride || { ok: true, window_days: 7, newest_attachment_at: ROWS[0].sent_at, newest_message_at: null, attachments: ROWS, messages: [] })
    : url.startsWith('/api/jp-whatsapp')
      ? { ok: true, migrated: true, chats: [{ chat_id: DM, name: 'Maa', kind: 'direct' }, { chat_id: 'evil', name: HOSTILE_CHAT, kind: 'direct' }], runs: [] }
      : { ok: false, error: 'unexpected route' };
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};

// The page's helpers and state are private to its IIFE. The suite needs them;
// the browser does not, so the export is added to this copy only.
const instrumented = script.replace(/\}\)\(\);\s*$/,
  'globalThis.__media = { esc: esc, fmtBytes: fmtBytes, mediaSrc: mediaSrc, cardHtml: cardHtml, summarize: summarize,' +
  ' describeFailure: describeFailure, isAuthFailure: isAuthFailure, kindKey: kindKey, state: state,' +
  ' normalizeDashboardKey: normalizeDashboardKey, isHeaderSafeDashboardKey: isHeaderSafeDashboardKey,' +
  ' haystacks: function () { return haystacks; } };\n})();');
t('the page script could be instrumented', () => assert.ok(instrumented.includes('globalThis.__media'), 'the trailing IIFE shape changed'));
async function boot(storedKey, opts = {}) {
  elements = new Map();
  calls = [];
  store = new Map(storedKey == null ? [] : [['jbt_stats_key', storedKey]]);
  sessionStore = new Map();
  chatsFail = !!opts.chatsFail;
  liveOverride = opts.live || null;
  delete globalThis.__media;
  new Function(instrumented)();
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  return globalThis.__media;
}
const M = await boot(KEY);
const el = (id) => elements.get(id) || mkEl(id);

t('with a stored key it asks jp-live-content for the default 7-day window at the endpoint\'s 200-row ceiling, key in a header', () => {
  const live = calls.find((c) => c.url.startsWith('/api/jp-live-content'));
  assert.ok(live, 'never fetched jp-live-content');
  assert.equal(live.url, '/api/jp-live-content?days=7&limit=200');
  assert.equal(live.headers['x-stats-key'], KEY);
  assert.ok(calls.some((c) => c.url === '/api/jp-whatsapp' && c.headers['x-stats-key'] === KEY), 'chat names are never joined');
});

t('the render path runs end to end: cards, KPIs and pills built from the rows, not a failure state', () => {
  assert.equal(M.state.items.length, 3);
  const grid = el('grid').innerHTML;
  assert.equal((grid.match(/<article /g) || []).length, 3, 'expected one card per row');
  assert.ok(!/Something went wrong|could not be loaded/.test(el('state').innerHTML), 'fell into an error state: ' + el('state').innerHTML);
  assert.ok(el('kpis').innerHTML.includes('>3<'), 'the Attachments KPI does not count the rows');
  assert.ok(el('kpis').innerHTML.includes(M.fmtBytes(48213 + 2201931 + 1000)), 'the Total size KPI is not the sum of the rows');
  assert.ok(el('kinds').innerHTML.includes('data-kind="document"'), 'no kind pill for the loaded document');
  assert.ok(grid.includes('Maa'), 'chat name from jp-whatsapp is not on the card');
});

t('a BIGINT size_bytes, which node-postgres returns as a string, still renders as a human size', () => {
  assert.equal(M.fmtBytes('48213'), '47.1 KB');
  assert.equal(M.fmtBytes(48213), '47.1 KB');
  assert.equal(M.fmtBytes('15728640'), '15.00 MB');
  assert.equal(M.fmtBytes('0'), '0 B');
  for (const v of [null, undefined, '', 'abc', -1, {}]) assert.equal(M.fmtBytes(v), '', 'no size must mean no text, got one for ' + String(v));
});

t('every media src uses a short-lived attachment token; the dashboard key never enters a URL', () => {
  assert.equal(M.mediaSrc({ att_id: 'a:b c', media_token: 'expires.sig' }), '/api/wa-media?att_id=a%3Ab%20c&token=expires.sig');
  assert.equal(M.mediaSrc({ att_id: 'a:b c' }), '');
  assert.equal(M.mediaSrc({ blob_url: 'javascript:alert(1)' }), '');
  assert.equal(M.mediaSrc({ blob_url: 'https://x.public.blob.vercel-storage.com/a.jpg' }), '', 'unindexed URLs must not bypass authenticated media transport');
  assert.equal(M.mediaSrc({}), '');
});

t('stored file and chat names are escaped — the old viewer wrote rows into innerHTML raw', () => {
  const grid = el('grid').innerHTML;
  assert.equal(grid.includes(HOSTILE_FILE), false, 'raw hostile file name reached the markup');
  assert.equal(grid.includes('<script>'), false, 'raw hostile chat name reached the markup');
  assert.ok(grid.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;shot.png'), 'file name is not shown escaped');
  assert.equal(M.esc(`<a href="x" title='y'>&`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;');
});

t('each of the seven wa_attachments kinds renders as the right element, never as a data dump', () => {
  const card = (kind, mime, file_name) => M.cardHtml({ att_id: 'c:' + kind, media_token: 'expires.sig', chat_id: DM, kind, mime, file_name, size_bytes: '10', sent_at: '2026-09-22T10:00:00Z' });
  assert.match(card('image', 'image/jpeg', 'a.jpg'), /<img src="\/api\/wa-media\?[^"]*" loading="lazy"/);
  assert.match(card('sticker', 'image/webp', 's.webp'), /is-sticker"[^>]*><img /);
  const video = card('video', 'video/mp4', 'v.mp4');
  assert.match(video, /<video controls preload="metadata"/);
  assert.equal(/<video[^>]* src=/.test(video), false, 'video src must wait for the viewport, not fire on render');
  assert.match(card('audio', 'audio/mpeg', 'a.mp3'), /<audio controls preload="none" src="\/api\/wa-media\?/);
  assert.match(card('ptt', 'audio/ogg; codecs=opus', 'p.opus'), /Voice note[\s\S]*<audio controls preload="none"/);
  const pdf = card('document', 'application/pdf', 'Rent.pdf');
  assert.match(pdf, /<iframe[^>]*title="Rent.pdf"[^>]*src="\/api\/wa-media\?att_id=/);
  assert.match(pdf, /application\/pdf/);
  assert.match(pdf, /<a class="open" href="\/api\/wa-media\?[^"]*" target="_blank" rel="noopener noreferrer">Open/);
  const zip = card('document', 'application/zip', 'backup.zip');
  assert.match(zip, /doc-icon is-archive/);
  assert.match(card('other', null, 'thing.bin'), /doc-icon/);
  for (const k of ['image', 'sticker', 'video', 'audio', 'ptt', 'document', 'other']) assert.equal(M.kindKey({ kind: k }), k);
  assert.equal(M.kindKey({ kind: 'surprise' }), 'other');
});

t('a row with every optional field null or malformed renders without undefined, null, NaN or [object Object]', () => {
  const sparse = M.cardHtml({ att_id: 'x', chat_id: null, kind: 'document', mime: null, file_name: null, size_bytes: null,
    duration_sec: null, width: null, height: null, sent_at: null, ingested_at: null });
  const odd = M.cardHtml({ att_id: 'y', chat_id: 'nobody', kind: 'video', mime: {}, file_name: { a: 1 }, size_bytes: 'n/a',
    duration_sec: 'soon', width: 'wide', height: -1, sent_at: 'yesterday', ingested_at: 12 });
  for (const out of [sparse, odd]) {
    assert.equal(/undefined|\bnull\b|NaN|\[object Object\]/.test(out), false, out.match(/.{0,40}(undefined|\bnull\b|NaN|\[object Object\]).{0,40}/)?.[0]);
  }
  assert.match(sparse, /No file name recorded/);
  assert.match(sparse, /Not recorded/);
});

t('KPIs sum BIGINT-string sizes and count every kind from the loaded rows', () => {
  const s = M.summarize([
    { kind: 'image', size_bytes: '100', chat_id: 'a' }, { kind: 'sticker', size_bytes: '50', chat_id: 'a' },
    { kind: 'ptt', size_bytes: null, chat_id: 'b' }, { kind: 'document', mime: 'application/zip', file_name: 'z.zip', size_bytes: '1000', chat_id: 'c' },
  ]);
  assert.equal(s.count, 4);
  assert.equal(s.bytes, 1150);
  assert.equal(s.sized, 3);
  assert.equal(s.chats, 3);
  assert.equal(s.fam.images.n, 2);
  assert.equal(s.fam.audio.n, 1);
  assert.equal(s.archives, 1);
  assert.deepEqual(s.byKind, { image: 1, sticker: 1, ptt: 1, document: 1 });
});

t('a failure is a sentence, never the payload — including a server error that is itself JSON', () => {
  const said = M.describeFailure({ status: 500, ok: false, body: { ok: false, error: 'password authentication failed for user "neondb_owner"' } });
  assert.match(said, /HTTP 500/);
  assert.match(said, /password authentication failed/);
  assert.equal(said.includes('{'), false);
  const nested = M.describeFailure({ status: 500, ok: false, body: { ok: false, error: '{"detail":{"code":"XX000"}}' } });
  assert.equal(/[{}]|detail/.test(nested), false, 'echoed a JSON error: ' + nested);
  assert.match(M.describeFailure({ status: 504, ok: false, body: null }), /HTTP 504/);
  assert.match(M.describeFailure({ status: 503, ok: false, body: { ok: false, error: 'DATABASE_URL not set on this deployment' } }), /key is still saved/);
});

t('a key pasted through chat with zero-width characters is cleaned, and only what no header can carry is refused', () => {
  const zw = String.fromCharCode(0x200b), bom = String.fromCharCode(0xfeff);
  assert.equal(M.normalizeDashboardKey(zw + KEY + bom + ' '), KEY);
  assert.equal(M.isHeaderSafeDashboardKey(KEY), true);
  // Right or wrong is the server's call: a short printable key must reach it.
  assert.equal(M.isHeaderSafeDashboardKey('short-but-printable'), true);
  assert.equal(M.isHeaderSafeDashboardKey('has a space'), false);
  assert.equal(M.isHeaderSafeDashboardKey('clé'), false);
});

t('401, 403 and a 503 tagged auth_* are auth failures; a plain 503 or 500 is not', () => {
  assert.equal(M.isAuthFailure({ status: 401, body: { code: 'auth_invalid' } }), true);
  assert.equal(M.isAuthFailure({ status: 403, body: null }), true);
  assert.equal(M.isAuthFailure({ status: 503, body: { code: 'auth_not_configured' } }), true);
  assert.equal(M.isAuthFailure({ status: 503, body: { ok: false, error: 'DATABASE_URL not set on this deployment' } }), false);
  assert.equal(M.isAuthFailure({ status: 500, body: null }), false);
});

// ── the other ways the page can start ───────────────────────────────────

await boot(null);
t('with no stored key the gate shows and not a single request is made', () => {
  assert.equal(calls.length, 0, 'requested ' + calls.map((c) => c.url).join(', '));
  assert.equal(el('app').hidden, true, 'the gallery shell is showing with no key');
  assert.equal(el('gate').hidden, false, 'the gate is hidden');
});

await boot('pasted key with spaces');
t('a stored key no header can carry is removed from the session and legacy slots', () => {
  assert.equal(calls.length, 0, 'sent a request with a key fetch() cannot encode');
  assert.equal(store.get('jbt_stats_key'), undefined, 'an unsafe legacy key was not removed');
  assert.equal(sessionStore.get('jbt_stats_key'), undefined, 'an unsafe session key was not removed');
  assert.match(el('gateMsg').textContent, /cannot carry/);
});

const Mfail = await boot(KEY, { chatsFail: true });
t('when chat names fail to load the gallery still renders, and the placeholder label is not searchable', () => {
  assert.equal(Mfail.state.chatsState, 'failed');
  assert.equal((el('grid').innerHTML.match(/<article /g) || []).length, 3, 'a failed name lookup took the gallery down');
  assert.ok(el('grid').innerHTML.includes('Chat name unavailable'), 'the card does not say why the chat is unnamed');
  const hs = Mfail.haystacks();
  assert.equal(hs.length, 3);
  assert.ok(hs.every((h) => !/unavailable|chat name/.test(h)), 'searching "chat" would match every card: ' + JSON.stringify(hs));
});

const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
await boot(KEY, { live: { ok: true, window_days: 7, newest_attachment_at: daysAgo(21), attachments: [], messages: [] } });
t('an empty window says so in words, names the pusher, and offers the windows that would reach the newest file', () => {
  const s = el('state').innerHTML;
  assert.match(s, /No attachments in the last 7 days\./);
  assert.match(s, /wa_media_push\.py runs on the S24/);
  assert.deepEqual([...s.matchAll(/data-days="(\d+)"/g)].map((m) => m[1]), ['30', '90']);
  assert.equal(el('grid').innerHTML, '', 'an empty window still drew cards');
});

await boot(KEY, { live: { ok: true, window_days: 7, newest_attachment_at: daysAgo(120), attachments: [], messages: [] } });
t('when even 90 days would come back empty, no "Show N days" button pretends otherwise', () => {
  const s = el('state').innerHTML;
  assert.match(s, /No attachments in the last 7 days\./);
  assert.equal(/data-days=/.test(s), false, 'offered a window that cannot reach a 120-day-old attachment');
});

// ── the same rows on the main dashboard ──────────────────────────────────
// wa_attachments rows also render in index.html: the Firestore page's live
// content cards and the WhatsApp chat detail's attachment tiles. Its fmtBytes
// ran Number.isFinite() on the raw BIGINT string, so every card printed no
// size, and the card footer named the chat by chat_id.slice(-14): a hash
// fragment for any chat keyed "h_" + 20 hex (Integrations/wa-store.js). The two
// helpers are lifted out of the page by brace matching. Neither holds a brace
// inside a string or regex, which is all this simple matcher needs;
// ip-grouping.test.mjs has the literal-aware version.
const indexHtml = readFileSync(join(ROOT, 'Frontend', 'index.html'), 'utf8');
function lift(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start !== -1, `${name}() not found in Frontend/index.html`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces while lifting ${name}()`);
}
const dash = new Function(
  'var WA_STATE = { chats: [], filter: "" }; var _waNameIndex = null, _waNameIndexSrc = null;\n' +
  lift(indexHtml, 'fmtBytes') + '\n' + lift(indexHtml, 'waChatName') + '\n' +
  'return { fmtBytes: fmtBytes, waChatName: waChatName, setChats: function (c) { WA_STATE.chats = c; } };')();
const indexCode = indexHtml.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

t('the main dashboard formats the same BIGINT-string sizes — its cards printed none at all', () => {
  assert.equal(dash.fmtBytes('48213'), '47.1 KB');
  assert.equal(dash.fmtBytes('15728640'), '15.00 MB');
  assert.equal(dash.fmtBytes(300), '300 B');
  for (const v of [null, undefined, '', 'abc', -1]) assert.equal(dash.fmtBytes(v), '', 'no size must mean no text, got one for ' + String(v));
  assert.equal(/size_bytes \/ 1024/.test(indexCode), false, 'an attachment tile still divides by 1024 itself ("0 KB", "14650 KB")');
});

t('the main dashboard names an attachment\'s chat from the inventory, never by a slice of its id', () => {
  assert.equal(dash.waChatName('h_0123456789abcdef0123'), '', 'with no inventory loaded it must say nothing, not print the id');
  dash.setChats([{ chat_id: 'h_0123456789abcdef0123', name: 'Family', kind: 'group' }, { chat_id: 42, name: 'Maa' }]);
  assert.equal(dash.waChatName('h_0123456789abcdef0123'), 'Family');
  assert.equal(dash.waChatName('42'), 'Maa', 'ids compare as strings, as they arrive from JSON');
  assert.equal(dash.waChatName('h_unknown'), '');
  dash.setChats([{ chat_id: 'h_0123456789abcdef0123', name: 'Family (renamed)' }]);
  assert.equal(dash.waChatName('h_0123456789abcdef0123'), 'Family (renamed)', 'a reloaded inventory must not serve the old index');
  assert.equal(/chat_id\.slice\(/.test(indexCode), false, 'a card still prints a slice of chat_id');
});

console.log(`\n${pass}/${total} checks passed`);
if (pass !== total) process.exitCode = 1;
