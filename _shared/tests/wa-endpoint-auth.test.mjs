// Every endpoint that reads the WhatsApp store must be gated.
//
// This exists because one was not. Backend/jp-whatsapp.js shipped with no key
// check at all, reasoning that the dashboard is private and the site is
// noindex — so GET /api/jp-whatsapp returned 862 real contact names, each with
// its chat_id (a WhatsApp jid, i.e. a phone number), to anyone who guessed the
// path. Obscurity is not access control.
//
// Two layers here. The first calls each handler and asserts it refuses an
// unauthenticated caller. The second greps every Backend file that touches a
// wa_ table, so a NEW unguarded endpoint fails this suite the day it is added
// rather than the day someone finds it.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'Backend');

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};

// No DATABASE_URL in this process: the guard must fire before any store access,
// so an unauthenticated caller can never even learn whether the database is up.
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.STATS_KEY = 'k-test';
process.env.WA_INGEST_KEY = 'i-test';

const mkRes = () => ({
  statusCode: null, payload: null, headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.statusCode = c; return this; },
  json(b) { this.payload = b; return this; },
});

// `refuses` is the status an unauthenticated caller must get. The read routes
// answer 401; wa-ingest answers 404 on purpose, so a scanner cannot tell the
// write route exists at all.
const ROUTES = [
  { file: 'jp-whatsapp.js', method: 'GET', refuses: 401 },
  { file: 'wa-galaxy.js', method: 'GET', refuses: 401 },
  { file: 'wa-chat.js', method: 'GET', refuses: 401, query: { h: 'a'.repeat(16) } },
  { file: 'wa-ingest.js', method: 'POST', refuses: 404, body: {} },
];

for (const route of ROUTES) {
  let handler;
  try {
    ({ default: handler } = await import(new URL(`../../Backend/${route.file}`, import.meta.url).href));
  } catch (err) {
    check(`${route.file} loads`, false, err.message);
    continue;
  }

  for (const [label, req] of [
    ['no key', { method: route.method, headers: {}, query: { ...route.query }, body: route.body }],
    ['wrong key', {
      method: route.method,
      headers: { 'x-stats-key': 'wrong', 'x-wa-ingest-key': 'wrong' },
      query: { key: 'wrong', ...route.query },
      body: route.body,
    }],
  ]) {
    const res = mkRes();
    await handler(req, res);
    check(`${route.file} refuses ${label} with ${route.refuses}`,
      res.statusCode === route.refuses,
      `got ${res.statusCode} ${JSON.stringify(res.payload)}`);
    // A refusal must never carry data, whatever the status code says.
    const body = JSON.stringify(res.payload || {});
    check(`${route.file} leaks nothing on ${label}`,
      !/"chats"\s*:\s*\[[^\]]/.test(body) && !/@(lid|c\.us|g\.us|s\.whatsapp\.net)/.test(body),
      body.slice(0, 160));
  }
}

/* ---------- the part that catches the next one ---------- */
// Anything reading a wa_ table has to prove it authenticates. Matching on the
// identifiers rather than a filename list means a new Backend/whatever.js that
// selects from wa_chats is covered without anyone remembering to add it here.
const GUARD = /requireKey|checkKey|STATS_KEY|WA_INGEST_KEY|CRON_SECRET|DB_ADMIN_KEY/;
const READS_STORE = /\bwa_(chats|messages|sync_runs|attachments)\b/;

const unguarded = [];
for (const file of readdirSync(BACKEND).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(join(BACKEND, file), 'utf8');
  if (READS_STORE.test(src) && !GUARD.test(src)) unguarded.push(file);
}
check('every Backend file touching a wa_ table authenticates',
  unguarded.length === 0,
  `unguarded: ${unguarded.join(', ')}`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
