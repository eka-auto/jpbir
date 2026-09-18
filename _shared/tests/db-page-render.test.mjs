// Every page in the /db explorer has to actually render.
//
// The page is one 1,000-line inline script, so a renderer that calls a helper
// that does not exist — `statusClass()` when the file defines `s24Status()` —
// parses cleanly, ships, and throws only when a human clicks that nav item.
// No suite covered it: the frontend tests until now checked the BUILD, not the
// page's behaviour.
//
// This loads the page's own script into a stub DOM, hands every view an empty
// but correctly-shaped payload, and drives each RENDER function. Nothing here
// touches the database: the point is that the code paths run, not that they
// find data. It also pins the three-way agreement a new page has to satisfy —
// a nav entry, a <section> to draw into, and a renderer — because missing any
// one of them produces a blank tab rather than an error.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'Frontend', 'db.html'), 'utf8');

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};

// Shapes only — the renderers each assume their own view's structure, and a
// wrong shape here would fail the suite for a reason that is not a real bug.
const EMPTY = {
  overview: { totals: {}, daily: [], hourly: [], byType: [], topPages: [], countries: [], cities: [],
              browsers: [], oses: [], devices: [], referrers: [], utm: [], languages: [], isps: [],
              timezones: [], domains: [], screens: [] },
  sites: [],
  visitors: { total: 0, limit: 100, offset: 0, rows: [] },
  sessions: { total: 0, limit: 100, offset: 0, rows: [] },
  events: { total: 0, limit: 100, offset: 0, rows: [], types: [] },
  video: { total: 0, limit: 100, offset: 0, rows: [], byClip: [], byPlace: [] },
  devices: [],
  letters: [],
  emails: { total: 0, limit: 100, offset: 0, rows: [], byRecipient: [] },
  s24: { migrated: false, normalized: false, section: 'overview', total: 0, limit: 100, offset: 0,
         rows: [], datasets: [], runs: [], sections: [], snapshot: null, counts: {} },
  whatsapp: { total: 0, limit: 100, offset: 0, rows: [], totals: {}, byKind: [], runs: [] },
  health: { counts: {}, countsForSite: {}, coverage: { total: 0 }, sources: [], span: {} },
};

const elements = new Map();
const mkEl = (id) => ({
  id, innerHTML: '', textContent: '', value: '', disabled: false,
  classList: { add() {}, remove() {}, toggle() {} },
  addEventListener() {}, getAttribute: () => null, setAttribute() {},
  querySelectorAll: () => [],
});
const doc = {
  getElementById(id) { if (!elements.has(id)) elements.set(id, mkEl(id)); return elements.get(id); },
  querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.document = doc;
globalThis.window = { location: { search: '' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
const storage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = storage;
globalThis.localStorage = storage;
globalThis.setInterval = () => 0;
globalThis.setTimeout = () => 0;

const asked = new Set();
globalThis.fetch = async (url) => {
  const q = Object.fromEntries(new URL(url, 'https://x.test').searchParams.entries());
  asked.add(q.view);
  const data = EMPTY[q.view] ?? {};
  return { ok: true, status: 200, json: async () => ({ ok: true, view: q.view, data }), text: async () => '' };
};

const script = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
// RENDER, state and PAGES are private to the page's IIFE. The suite needs them;
// the browser does not, so the export is added to this copy only.
const instrumented = script.replace(/\}\)\(\);\s*$/, 'globalThis.__dbg = { RENDER: RENDER, state: state, PAGES: PAGES };\n})();');
check('the page script could be instrumented', /globalThis.__dbg/.test(instrumented), 'the trailing IIFE shape changed');
new Function(instrumented)();

const { RENDER, PAGES } = globalThis.__dbg;

for (const [id, label, countTable] of PAGES) {
  check(`${label}: has a renderer`, typeof RENDER[id] === 'function', `RENDER.${id} is ${typeof RENDER[id]}`);
  check(`${label}: has a <section id="page-${id}">`, html.includes(`id="page-${id}"`), 'the nav entry would open a blank tab');
  if (countTable) {
    check(`${label}: names a table for its badge`, /^[a-z0-9_]+$/.test(countTable), `got ${countTable}`);
  }
}

for (const [id, label] of PAGES) {
  if (typeof RENDER[id] !== 'function') continue;
  try {
    await RENDER[id]();
    const out = doc.getElementById(`page-${id}`).innerHTML;
    check(`${label}: renders with an empty result set`, out.length > 0, 'wrote nothing');
  } catch (e) {
    failures++;
    console.log(`FAIL  ${label}: renderer threw\n      ${e.message}\n      ${(e.stack || '').split('\n')[1] || ''}`);
  }
}

check('the WhatsApp page asks the API for its own view', asked.has('whatsapp'), [...asked].join(', '));

console.log(`\n${failures ? `${failures} check(s) failed` : 'all checks passed'}`);
process.exitCode = failures ? 1 : 0;
