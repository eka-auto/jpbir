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
delete process.env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'];

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
  { file: 'jp-live-content.js', method: 'GET', refuses: 401 },
  // Proxies to the agent runtime (shell). Gated before the config check.
  { file: 'jp-live-agent.js', method: 'POST', refuses: 401, body: {} },
  { file: 'wa-galaxy.js', method: 'GET', refuses: 401 },
  { file: 'wa-chat.js', method: 'GET', refuses: 401, query: { h: 'a'.repeat(16) } },
  { file: 'wa-ingest.js', method: 'POST', refuses: 404, body: {} },
  { file: 'jp-wa-chat.js', method: 'GET', refuses: 401, query: { chat_id: '1@c.us' } },
  { file: 'jp-wa-attachments.js', method: 'GET', refuses: 401, query: { chat_id: '1@c.us' } },
  { file: 'jp-wa-messages.js', method: 'GET', refuses: 401, query: { chat_id: '1@c.us' } },
  // Private-blob media proxy: gated on STATS_KEY before it ever looks up a row.
  { file: 'wa-media.js', method: 'GET', refuses: 401, query: { att_id: 'x' } },
  // Write side: its own key, and 404 so a scanner cannot confirm it exists.
  { file: 'wa-blob-upload.js', method: 'POST', refuses: 404, body: {} },
  // The analytics reads. These were open too — the same defect, a wider blast
  // radius: visitor IPs, user agents, session trails, the device roster, raw
  // telemetry rows, and this project's own Vercel identifiers.
  { file: 'db-api.js', method: 'GET', refuses: 401 },
  { file: 'jp-debug.js', method: 'GET', refuses: 401 },
  { file: 'jp-device.js', method: 'GET', refuses: 401 },
  { file: 'jp-devices.js', method: 'GET', refuses: 401 },
  { file: 'jp-stats.js', method: 'GET', refuses: 401 },
  { file: 'stats.js', method: 'GET', refuses: 401 },
  { file: 'vercel-analytics.js', method: 'GET', refuses: 401 },
  // Shipped as "open dashboard - no authentication required" and answered 200
  // to anyone with the DynamoDB table name, the GCP project id, the Firestore
  // database name and a live device count. Its CRON_SECRET branch only ran when
  // an Authorization header was present, so sending none skipped the check.
  { file: 'verify-db.js', method: 'GET', refuses: 401 },
  // Spends Anthropic credit and answers with device/IP telemetry; was open, so
  // adding ANTHROPIC_API_KEY would have published it.
  { file: 'jp-agent.js', method: 'POST', refuses: 401, body: { question: 'x' } },
  // Sends alert email and patches Firestore; its authorized() returned true.
  { file: 'check-stale.js', method: 'GET', refuses: 401 },
  // Referenced an undeclared STATS_KEY, so it 500'd for everyone - including
  // the owner - instead of refusing.
  { file: 'connect.js', method: 'GET', refuses: 401 },
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

/* ---------- the 2026-09-20 S24 auth flip-flop ---------- */
// f372da6 removed requireKey from /api/jp-devices and /api/jp-device so the
// keyless /s24 page would load — publishing IP/SSID/command bodies with it —
// and its parent merge b2c1778 restored the gate on BOTH, breaking the
// supposedly-public page again. The settled contract, in both directions:
//   * Backend/jp-devices.js (both of its url-branching routes) MUST refuse a
//     keyless request with 401. The CI health-check treats that 401 as the
//     healthy posture for this route.
//   * Backend/s24-public.js MUST NOT 401 a keyless request. In this test
//     process FIREBASE_SERVICE_ACCOUNT_JSON is deleted above, so its deepest
//     reachable keyless branch is its own config check: 503
//     'FIREBASE_SERVICE_ACCOUNT_JSON not configured'. That 503 is the PROOF
//     auth was not the blocker — the request walked past every gate and only
//     the missing credentials stopped it. A 401 here means someone re-added
//     requireKey() to the route that exists precisely because requiring the
//     key was wrong; a 200 would mean this process suddenly holds real
//     Firestore credentials. Both are breaks; on /api/s24-public, 401 = red.
{
  const { default: roster } = await import(new URL('../../Backend/jp-devices.js', import.meta.url).href);
  const { default: s24Public } = await import(new URL('../../Backend/s24-public.js', import.meta.url).href);
  const mkReq = (url, key) => ({
    method: 'GET', url,
    headers: key ? { 'x-stats-key': key } : {},
    query: key ? { key } : {},
    body: undefined,
  });
  const NOT_CONFIGURED = /FIREBASE_SERVICE_ACCOUNT_JSON not configured/;

  // Both branches of the single default export, driven by req.url the way
  // vercel.json does: /api/jp-devices* -> the keyed roster, /api/jp-device* ->
  // the keyed history. A data-bearing query must not be a way through either.
  for (const url of ['/api/jp-devices?full=1&subcollections=1', '/api/jp-device?days=30&device=samsung-s24-ultra']) {
    const res = mkRes();
    await roster(mkReq(url), res);
    check(`the roster handler refuses keyless GET ${url} with 401 before config or credentials`,
      res.statusCode === 401 && res.payload && res.payload.code === 'auth_missing',
      `got ${res.statusCode} ${JSON.stringify(res.payload)}`);
    check(`the roster handler leaks no device data on the keyless ${url} refusal`,
      !/devices|ssid|bssid|observedIp|publicIp|commandQueue|full_payload/.test(JSON.stringify(res.payload || {})),
      JSON.stringify(res.payload).slice(0, 200));
  }

  const anon = mkRes();
  await s24Public(mkReq('/api/s24-public'), anon);
  check('s24-public answers a keyless request with 503 config — prove it is public BY DESIGN, never re-adding requireKey —',
    anon.statusCode === 503 && anon.statusCode !== 401 && anon.statusCode !== 200 &&
    NOT_CONFIGURED.test(anon.payload && anon.payload.error || ''),
    `got ${anon.statusCode} ${JSON.stringify(anon.payload)}`);

  // A WRONG key must behave exactly like a missing one: precision downgrades,
  // service is never denied. The one case where an auth failure may reach the
  // response is auth_not_configured, and this route cannot even surface that.
  const badKey = mkRes();
  await s24Public(mkReq('/api/s24-public', 'wrong'), badKey);
  check('s24-public treats a wrong key as anonymous: the same 503 config, never a 401 denial',
    badKey.statusCode === 503 && NOT_CONFIGURED.test(badKey.payload && badKey.payload.error || ''),
    `got ${badKey.statusCode} ${JSON.stringify(badKey.payload)}`);

  const keyed = mkRes();
  await s24Public(mkReq('/api/s24-public', 'k-test'), keyed);
  check('s24-public with the valid key still cannot 200 credential-free: 503 config is the same for authenticated callers',
    keyed.statusCode === 503,
    `got ${keyed.statusCode} ${JSON.stringify(keyed.payload)}`);

  // One line, both routes, both directions of the flip-flop at once: this is
  // the assertion that fails the day someone "fixes" /s24 by reopening
  // jp-devices, or "fixes" the 401 storm by gating s24-public.
  const rosterRes = mkRes();
  const publicRes = mkRes();
  await roster(mkReq('/api/jp-devices'), rosterRes);
  await s24Public(mkReq('/api/s24-public'), publicRes);
  check('the 2026-09-20 flip-flop stays pinned: jp-devices 401s keyless while s24-public does not',
    rosterRes.statusCode === 401 && publicRes.statusCode !== 401 &&
    publicRes.statusCode === 503 && NOT_CONFIGURED.test(publicRes.payload && publicRes.payload.error || ''),
    `jp-devices ${rosterRes.statusCode}, s24-public ${publicRes.statusCode}`);
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
