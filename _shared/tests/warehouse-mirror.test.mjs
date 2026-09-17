// The live mirror from /api/jp-track into the Neon warehouse.
//
// Two feeds write the same telemetry: jp-track mirrors each event as it
// arrives, db-push bulk-imports the same rows from DynamoDB later. If they
// disagree about the row id, the site or what a rollup counts, one visit lands
// in the table twice under two names — which is how the warehouse ended up
// holding 3 rows for jaytipargal.com and none at all for jaytipargal.tech.
//
// Layer 1 drives the shared module with an injected query function, so every
// statement and its parameters are asserted without a database. Layer 2 reads
// jp-track.js and db-push.js as text, because the invariants that keep a
// tracking beacon safe — mirror after the DynamoDB write, never let a Postgres
// failure reach the visitor — are about where the call sits, not what it
// returns.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND = join(ROOT, 'Backend');

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

const { siteFor, insertEvent, recordEvent, rollupVisitors, rollupSessions } =
  await import('../../Backend/lib/warehouse.js');

// Records every statement instead of running it.
function recorder(rowCount = 1) {
  const calls = [];
  const db = async (sql, params) => { calls.push({ sql, params }); return { rowCount, rows: [] }; };
  return { db, calls };
}

const ITEM = {
  id: '2026-09-18T04:00:00.000Z_abc123',
  eventType: 'page_view',
  epoch: 1789700000000,
  timestamp: '2026-09-18T04:00:00.000Z',
  sessionId: 'jps_1',
  visitorId: 'jpv_1',
  pageUrl: 'https://www.jaytipargal.tech/db?utm_source=newsletter&utm_medium=email&utm_campaign=sept',
  pageTitle: 'DB',
  ip: '1.2.3.4',
  country: 'IN',
  city: 'Sonipat',
  eventData: {},
};

// ---------------------------------------------------------------- layer 1 --

for (const [pageUrl, fallback, want, why] of [
  ['https://jaytipargal.tech/db', null, 'jaytipargal.tech', 'the page URL wins'],
  ['https://www.jaytipargal.com/', null, 'jaytipargal.com', 'www. is stripped so one property is not split in two'],
  ['/relative', 'https://jaytipargal.tech', 'jaytipargal.tech', 'a relative URL falls back to the request origin'],
  [null, 'jaytipargal.tech', 'jaytipargal.tech', 'a bare Host header works as the fallback'],
  ['https://JAYTIPARGAL.TECH:443/x', null, 'jaytipargal.tech', 'case and port are normalised'],
  [null, null, null, 'nothing to derive from is null, not a guess'],
]) {
  const got = siteFor(pageUrl, fallback);
  check(`siteFor: ${why}`, got === want, `siteFor(${JSON.stringify(pageUrl)}, ${JSON.stringify(fallback)}) = ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
}

{
  const { db, calls } = recorder();
  await insertEvent(ITEM, { site: 'jaytipargal.tech', sourceSystem: 'site-api', db });
  const [{ sql, params }] = calls;
  check('insert keys the row as <site>:<source id>, the shape db-push already uses',
    params[0] === `jaytipargal.tech:${ITEM.id}`, `id param was ${params[0]}`);
  check('insert is ON CONFLICT DO NOTHING, so a later re-import is a no-op',
    /ON CONFLICT \(id\) DO NOTHING/.test(sql), sql.slice(-120));
  check('site column carries the derived site, not a constant',
    params[1] === 'jaytipargal.tech', `site param was ${params[1]}`);
  check('source_system marks the live feed',
    params.includes('site-api'), 'site-api missing from params');
  check('page_domain is derived, so the dashboard Domains card covers live rows',
    params[31] === 'jaytipargal.tech', `page_domain param was ${params[31]}`);
  check('utm_* are parsed off the page URL',
    params[32] === 'newsletter' && params[33] === 'email' && params[34] === 'sept',
    `utm params were ${JSON.stringify(params.slice(32, 35))}`);
}

{
  const { db, calls } = recorder();
  const wrote = await insertEvent({ ...ITEM, timestamp: null, epoch: null }, { site: 'x.test', sourceSystem: 'site-api', db });
  check('an event with no usable timestamp is skipped without touching the database',
    wrote === false && calls.length === 0, `wrote=${wrote} calls=${calls.length}`);
}

{
  const { db, calls } = recorder();
  const wrote = await insertEvent(ITEM, { site: null, sourceSystem: 'site-api', db });
  check('an event with no derivable site is skipped rather than filed under a guess',
    wrote === false && calls.length === 0, `wrote=${wrote} calls=${calls.length}`);
}

{
  const { db, calls } = recorder(1);
  await recordEvent(ITEM, { site: 'jaytipargal.tech', sourceSystem: 'site-api', db });
  check('a new event refreshes exactly its own visitor and session rollups',
    calls.length === 3 &&
    /INSERT INTO visitors/.test(calls[1].sql) && calls[1].params.join('|') === 'jaytipargal.tech|jpv_1' &&
    /INSERT INTO sessions/.test(calls[2].sql) && calls[2].params.join('|') === 'jaytipargal.tech|jps_1',
    calls.map((c) => `${c.sql.slice(0, 28).replace(/\s+/g, ' ')} ${JSON.stringify(c.params)}`).join('\n      '));
  check('the scoped rollup narrows on the indexed columns',
    /AND site = \$1 AND visitor_id = \$2/.test(calls[1].sql) && /AND site = \$1 AND session_id = \$2/.test(calls[2].sql),
    'scope predicate missing');
}

{
  // rowCount 0 = ON CONFLICT DO NOTHING fired: this exact event is already in
  // the table and already counted.
  const { db, calls } = recorder(0);
  const result = await recordEvent(ITEM, { site: 'jaytipargal.tech', sourceSystem: 'site-api', db });
  check('a duplicate event does not redo the rollups',
    result.inserted === false && calls.length === 1, `inserted=${result.inserted} calls=${calls.length}`);
}

{
  const { db, calls } = recorder();
  await rollupVisitors({ db });
  await rollupSessions({ db });
  check('unscoped rollups rebuild every key and pass no parameters',
    calls.every((c) => c.params.length === 0) &&
    !calls.some((c) => /AND site = \$1/.test(c.sql)),
    calls.map((c) => JSON.stringify(c.params)).join(' '));
}

// ---------------------------------------------------------------- layer 2 --

const trackSrc = readFileSync(join(BACKEND, 'jp-track.js'), 'utf8');
const pushSrc = readFileSync(join(BACKEND, 'db-push.js'), 'utf8');

check('jp-track mirrors AFTER the DynamoDB write, never instead of it',
  trackSrc.indexOf('PutCommand') < trackSrc.indexOf('recordEvent'),
  'recordEvent appears before the DynamoDB PutCommand');

check('a warehouse failure cannot turn a tracked pageview into a 500',
  /try\s*\{[\s\S]{0,400}recordEvent[\s\S]{0,400}\}\s*catch/.test(trackSrc),
  'recordEvent is not wrapped in try/catch');

check('the tracking response reports whether the mirror ran',
  /warehouse,/.test(trackSrc) && /mirrored: (true|false)/.test(trackSrc),
  'no warehouse field on the 200 response');

for (const origin of ['https://jaytipargal.tech', 'https://www.jaytipargal.tech']) {
  check(`${origin} is an allowed origin`, trackSrc.includes(`'${origin}'`),
    'beacons from this deployment\'s own pages would be dropped by the browser');
}

check('db-push no longer stamps every row with one hardcoded site',
  !/`\$\{SITE\}:\$\{it\.id\}`/.test(pushSrc) && /siteFor\(/.test(pushSrc),
  'db-push still builds ids from a constant site');

check('both feeds insert through the same module',
  /lib\/warehouse\.js/.test(pushSrc) && /lib\/warehouse\.js/.test(trackSrc),
  'one of the two feeds has its own copy of the INSERT');

console.log(`\n${failures ? `${failures} check(s) failed` : 'all checks passed'}`);
process.exitCode = failures ? 1 : 0;
