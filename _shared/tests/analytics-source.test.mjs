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
const blobReaders = readFileSync
  ? (await import('node:fs')).readdirSync(BACKEND)
      .filter((f) => f.endsWith('.js') && !MEDIA_ROUTES.has(f))
      .filter((f) => readFileSync(join(BACKEND, f), 'utf8').includes('@vercel/blob'))
  : [];
check('no analytics route reads the blob journal',
  blobReaders.every((f) => f === 'visitor.js'),
  `unexpected blob readers: ${blobReaders.filter((f) => f !== 'visitor.js').join(', ')}`);

// visitor.js is deliberately still on Blob: the warehouse does not preserve
// the payload it serves. The blob rows carry 12 fields; projectEvent reads
// ~37 — web vitals (lcp/cls/inp/ttfb), screen_info, network_info,
// ua_client_hints, pwa_state, battery_info, memory_info and the utm_* set are
// absent from raw_payload entirely. Migrating that read path today would blank
// most of the visitor dossier. It moves once ingestion archives the whole
// event, not before.
check('visitor.js is documented as the remaining blob reader',
  readFileSync(join(BACKEND, 'visitor.js'), 'utf8').includes('@vercel/blob'),
  'visitor.js changed store — check the payload actually survives the move');

console.log(`\n${failures ? `${failures} check(s) failed` : 'all checks passed'}`);
process.exitCode = failures ? 1 : 0;
