// Which store answers the dashboard's analytics reads.
//
// /api/stats used to list every object under analytics/ in Vercel Blob and
// fetch each one over HTTP inside an 8-second budget. Whatever the budget did
// not reach was dropped, and the response said so with `partial: true` — 2,420
// of 2,752 events in a 7-day window, varying per request. It now reads the
// warehouse, where the same rows are indexed on (site, occurred_at).
//
// This pins the direction of travel. A future edit that reaches for the blob
// journal from an analytics read path fails here rather than quietly
// reintroducing a sampled dashboard.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'Backend');

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};

const stats = readFileSync(join(BACKEND, 'stats.js'), 'utf8');

check('stats reads the warehouse',
  /Integrations\/postgres\.js/.test(stats), 'no postgres import');
check('stats no longer lists the blob journal',
  !/@vercel\/blob/.test(stats), 'still imports @vercel/blob');
check('stats scopes to a property',
  /WHERE site = \$1/.test(stats), 'the query is not site-scoped — one warehouse holds several properties');
check('stats reports which store answered',
  /source: 'postgres'/.test(stats), "no `source` field on the response");

// The contract the frontend reads. Renaming any of these silently blanks a
// panel on the dashboard, which is a bug nobody sees until they look.
for (const field of [
  'success', 'window_days', 'partial', 'generated_at', 'totals', 'active_sessions',
  'daily', 'hourly', 'latest_heartbeats', 'latest_events', 'top', 'sessions',
]) {
  check(`response keeps \`${field}\``, new RegExp(`\\b${field}:`).test(stats), 'field missing from the response body');
}
for (const counter of [
  'events_in_window', 'events_by_type', 'unique_ips', 'unique_sessions', 'page_views',
  'heartbeats', 'email_opens', 'events_with_detail', 'active_now', 'avg_time_on_page', 'peak_hour',
]) {
  check(`totals keeps \`${counter}\``, new RegExp(`\\b${counter}:`).test(stats), 'counter missing');
}

// Blob is still the right store for media and for the ingest journal itself.
// This is about the analytics READ paths only.
const MEDIA_ROUTES = new Set(['wa-blob-upload.js', 'wa-media.js', 'jp-agent.js']);
const { readdirSync } = await import('node:fs');
const blobReaders = readdirSync(BACKEND)
  .filter((f) => f.endsWith('.js') && !MEDIA_ROUTES.has(f))
  .filter((f) => readFileSync(join(BACKEND, f), 'utf8').includes('@vercel/blob'));
check('no analytics route reads the blob journal', blobReaders.length === 0,
  `blob readers: ${blobReaders.join(', ')}`);

// visitor.js moved too, and the move was worth more than speed. The blob path
// answered from a per-visitor index capped at 200 events; for the visitor this
// was verified against it returned 25 of a 2,476-event trail spanning 34
// sessions and 7 addresses. The dossier was not slow, it was wrong.
const visitor = readFileSync(join(BACKEND, 'visitor.js'), 'utf8');
check('visitor reads the warehouse', /Integrations\/postgres\.js/.test(visitor), 'no postgres import');
check('visitor looks the trail up by key rather than scanning',
  /WHERE site = \$1/.test(visitor), 'no indexed lookup');
check('the per-visitor index machinery is gone',
  !/writeIndexFromEvents|loadViaIndex|SCAN_BUDGET_MS/.test(visitor),
  'index or scan-budget code survives — it has nothing left to accelerate');

// raw_payload archives the original event in two shapes: at the top level for
// rows imported from Blob, nested under `event` for the live feed. A reader
// that handles only the first silently drops every rich field on current
// traffic — the mistake that made this migration look impossible at first.
check('visitor reads both archive shapes',
  /archived\.event && typeof archived\.event === 'object'/.test(visitor),
  'only one raw_payload shape is handled');

for (const rich of ['web_vitals', 'screen_info', 'network_info', 'battery_info', 'ua_client_hints']) {
  check(`the dossier still projects \`${rich}\``, new RegExp(`\\b${rich}:`).test(visitor), 'field dropped');
}

console.log(`\n${failures ? `${failures} check(s) failed` : 'all checks passed'}`);
process.exitCode = failures ? 1 : 0;
