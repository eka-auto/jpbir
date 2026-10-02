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

const { siteFor, botLike, insertEvent, recordEvent, rollupVisitors, rollupSessions } =
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
  // Found in production: a preview build someone opened once had already added
  // `jayti-dashboard-a8ajkprgy-jayti.vercel.app` to the property selector.
  ['https://jayti-dashboard-a8ajkprgy-jayti.vercel.app/db', null, null,
    'a generated preview host is not a property'],
  ['https://jayti-dashboard.vercel.app/', null, null,
    'the stable .vercel.app alias is not one either — the custom domains are'],
  [null, 'https://jpbirrestructured.vercel.app', null,
    'a deployment host is rejected as a fallback too, not just as a page URL'],
  ['https://jaytipargal.tech/db', 'https://x-abc-jayti.vercel.app', 'jaytipargal.tech',
    'a real page URL still wins over a deployment-host fallback'],
  // The allow-list, driven directly. A single-suffix deny-list let all of these
  // into the warehouse; each is the actual junk the Neon query surfaced.
  ['https://jaytibirthday.in/', null, 'jaytibirthday.in',
    'the largest real property is accepted'],
  ['https://agent.jaytipargal.tech/x', null, 'agent.jaytipargal.tech',
    'a subdomain of a property is itself a property'],
  ['https://my-app-xyz.v0.build/', null, null,
    'a v0.build sandbox is not a property — the deny-list let it through'],
  ['https://something.vercel.run/', null, null,
    'a vercel.run sandbox is not a property either'],
  ['device://samsung-s24-ultra', null, null,
    'a device id filed as a page URL is not a website — device: is not http(s)'],
  ['device://samsung-s24-ultra', 'https://jaytipargal.tech', null,
    'a non-http(s) page URL is final: it does not fall through to the request host'],
  ['https://evil.example.com/jaytipargal.tech', null, null,
    'the property name in a path does not make an unrelated host a property'],
]) {
  const got = siteFor(pageUrl, fallback);
  check(`siteFor: ${why}`, got === want, `siteFor(${JSON.stringify(pageUrl)}, ${JSON.stringify(fallback)}) = ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
}

// botLike gates the warehouse WRITE, because visitors/sessions are recomputed
// from events — a crawler counted there inflates every rollup off it. A false
// positive silently discards a real visit, so the contract cuts both ways:
// self-identifying automation is dropped, ordinary browsers never are, and a
// missing UA is not treated as proof of a bot.
for (const [ua, want, why] of [
  ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', true, 'a self-identifying crawler is a bot'],
  ['curl/8.4.0', true, 'a CLI client is a bot'],
  ['python-requests/2.31.0', true, 'a scripting library is a bot'],
  ['GPTBot/1.0', true, 'an AI crawler is a bot'],
  ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', false, 'a real desktop browser is not a bot — even Desktop/Linux, which the junk data over-reported'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', false, 'a real mobile browser is not a bot'],
  ['', false, 'an empty UA is not proof of a bot (privacy tools strip it) — do not discard a real visit on absence alone'],
  [null, false, 'a missing UA is not a bot'],
]) {
  check(`botLike: ${why}`, botLike(ua) === want, `botLike(${JSON.stringify(ua)}) = ${botLike(ua)}, wanted ${want}`);
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
  // Both trackers feed one table. jp-tracker says `pageview`, the warehouse's
  // 347 existing rows and db-api's Page views card say `page_view`; the stray
  // spelling made a property report 0 page views against its own pageviews.
  const { db, calls } = recorder();
  await insertEvent({ ...ITEM, eventType: 'pageview' }, { site: 'x.test', sourceSystem: 'site-api', db });
  check('the pageview/page_view dialect is folded in at ingestion',
    calls[0].params[2] === 'page_view', `event_type param was ${calls[0].params[2]}`);
}

{
  const { db, calls } = recorder();
  await insertEvent({ ...ITEM, eventType: 'device_probe' }, { site: 'x.test', sourceSystem: 'site-api', db });
  check('an event type with no alias is left exactly as sent',
    calls[0].params[2] === 'device_probe', `event_type param was ${calls[0].params[2]}`);
}

// `screen` is read back with ->>, so a non-JSON value does not cost one label:
// Postgres aborts the statement, and Overview returns 500 with every card on it.
for (const [input, want, why] of [
  ['1280x720 (DPR:1.5)', { width: 1280, height: 720, dpr: 1.5, raw: '1280x720 (DPR:1.5)' }, 'jp-tracker\'s WxH string is parsed into the column\'s JSON dialect'],
  ['1920x1080', { width: 1920, height: 1080, raw: '1920x1080' }, 'the DPR suffix is optional'],
  ['{"width": 1280, "height": 720}', null, 'a value that is already JSON is passed through untouched'],
]) {
  const { db, calls } = recorder();
  await insertEvent({ ...ITEM, screen: input }, { site: 'x.test', sourceSystem: 'site-api', db });
  const got = calls[0].params[20];
  const ok = want ? JSON.stringify(want) === got : got === input;
  check(`screen: ${why}`, ok, `stored ${got}`);
}

{
  const { db, calls } = recorder();
  await insertEvent({ ...ITEM, screen: { width: 800, height: 600 } }, { site: 'x.test', sourceSystem: 'site-api', db });
  check('screen: an object is serialised, as before',
    calls[0].params[20] === '{"width":800,"height":600}', `stored ${calls[0].params[20]}`);
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

for (const origin of ['https://jaytipargal.tech', 'https://www.jaytipargal.tech', 'https://jaytibirthday.in']) {
  check(`${origin} is an allowed origin`, trackSrc.includes(`'${origin}'`),
    'beacons from this deployment\'s own pages would be dropped by the browser');
}

// The ACAO pick reads Origin, never Referer: Origin is scheme+host (what the
// Set holds) while Referer is a full URL, so a referer-only request could never
// match and the fallback only ever echoed the wrong default. Assert the dead
// fallback is gone rather than trusting the comment beside it.
check('the Access-Control-Allow-Origin pick does not fall back to Referer',
  /const origin = req\.headers\.origin \|\| '';/.test(trackSrc) && !/const origin = req\.headers\.origin \|\| req\.headers\.referer/.test(trackSrc),
  'jp-track still ORs req.headers.referer into the origin used for ACAO');

// The write path drops obvious bots. Grep is enough here: the behavioural
// contract for botLike itself is driven directly in layer 1 above; this only
// pins that jp-track actually calls it before mirroring, so the guard is wired
// in and not merely exported.
check('jp-track gates the warehouse mirror on botLike',
  /botLike\(item\.userAgent\)/.test(trackSrc),
  'jp-track imports botLike but never calls it, so crawlers still reach the rollups');

check('db-push no longer stamps every row with one hardcoded site',
  !/`\$\{SITE\}:\$\{it\.id\}`/.test(pushSrc) && /siteFor\(/.test(pushSrc),
  'db-push still builds ids from a constant site');

check('db-push does not invent a property when the row has no site',
  !/FALLBACK_SITE/.test(pushSrc) && /if \(!site\) return false/.test(pushSrc),
  'a row with no derivable site is still filed under a constant property');

check('both feeds insert through the same module',
  /lib\/warehouse\.js/.test(pushSrc) && /lib\/warehouse\.js/.test(trackSrc),
  'one of the two feeds has its own copy of the INSERT');

// The read side has to survive a value the write side never saw. Normalising
// at ingestion fixes every future row; it cannot fix a row already in the
// table, and one of those is enough to 500 the whole Overview view.
const apiSrc = readFileSync(join(BACKEND, 'db-api.js'), 'utf8')
  // Comments explain the guard and name the cast; counting them as casts makes
  // the check fail on its own documentation.
  .replace(/^\s*\/\/.*$/gm, ' ')
  .replace(/\s+/g, ' ');
const casts = (apiSrc.match(/screen::jsonb/g) || []).length;
const guarded = (apiSrc.match(/CASE WHEN screen ~ [^ ]+ THEN screen::jsonb/g) || []).length;
check('every screen::jsonb in db-api is behind a JSON-shape guard',
  casts > 0 && casts === guarded,
  `${casts} cast(s), ${guarded} guarded — an unguarded one aborts Overview for the whole property`);

// ── /api/jp-stats must agree with the mirror about what a property is ────
// jp-stats scanned the whole telemetry table and narrowed on time alone, so the
// selector's "jaytipargal.com" option reported every property's events added
// together under that one name. It is scoped now -- and it reuses siteFor from
// this same module rather than re-deriving the rule, because three different
// answers to "which site is this" is how one visit gets counted twice.
const { effectiveSite } = await import('../../Backend/jp-stats.js');

check('effectiveSite prefers the site jp-track already stored on the row',
  effectiveSite({ site: 'jaytipargal.com', pageUrl: 'https://jaytibirthday.in/x' }) === 'jaytipargal.com',
  'the stored field is authoritative; re-deriving it would disagree with db-push');

check('a row written before the site field existed is derived the same way the mirror derives it',
  effectiveSite({ pageUrl: 'https://jaytipargal.com/page' }) === siteFor('https://jaytipargal.com/page', null),
  'jp-stats must not have its own opinion about what a property is');

check('a preview deployment is not a property, here either',
  effectiveSite({ pageUrl: 'https://jayti-dashboard-a8ajk.vercel.app/x' }) === null,
  'otherwise every preview build invents a property, the bug siteFor exists to prevent');

check('a row with nothing to go on classifies as null rather than guessing',
  effectiveSite({}) === null && effectiveSite(null) === null,
  'a guess here silently files a visit under the wrong property');

check('www. is stripped so one property is not split in two',
  effectiveSite({ pageUrl: 'https://www.jaytipargal.com/x' }) === effectiveSite({ pageUrl: 'https://jaytipargal.com/x' }),
  'www and bare host must collapse to one property');

console.log(`\n${failures ? `${failures} check(s) failed` : 'all checks passed'}`);
process.exitCode = failures ? 1 : 0;
