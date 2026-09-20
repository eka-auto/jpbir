// The WhatsApp ingest endpoint, guards only — the store-writing path is
// exercised by wa-store.test.mjs's ingestBatch coverage.
// Run: node _shared/tests/wa-ingest.test.mjs
//
// NOTE ON 503 vs 500: an unconfigured deployment answers 503, not 500.
// Backend/_auth.js has always drawn that line for STATS_KEY -- 503 for "this
// server was never set up", 401 for "wrong key" -- so an operator can tell the
// two apart instead of hunting for a bug in the browser. The store-backed
// handlers used 500 for the same condition, splitting the behaviour for no
// reason: Frontend/db.html keys its gate off 401/503, so a 500 from db-api left
// the page stuck. All 21 such responses moved to 503; these assertions moved
// with them.
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const mkRes = () => ({
  statusCode: null,
  payload: null,
  headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.statusCode = c; return this; },
  json(b) { this.payload = b; return this; },
});

// The endpoint reads WA_INGEST_KEY into a module-level constant at import
// time, so the environment has to be right before the import.
delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL;
process.env.WA_INGEST_KEY = 'ing-test';
const { default: ingest } = await import('../../Backend/wa-ingest.js');

/* ---------- key gate: 404, not 401, keeps the route undiscoverable ---------- */
let res = mkRes(); await ingest({ method: 'POST', headers: {}, query: {}, body: {} }, res);
check('no key is 404', res.statusCode === 404 && res.payload.error === 'not found', String(res.statusCode));

res = mkRes(); await ingest({ method: 'POST', headers: { 'x-wa-ingest-key': 'wrong' }, query: {}, body: {} }, res);
check('wrong key is 404', res.statusCode === 404, String(res.statusCode));

res = mkRes(); await ingest({ method: 'GET', headers: { 'x-wa-ingest-key': 'ing-test' }, query: {} }, res);
check('wrong method is 405', res.statusCode === 405 && res.headers['Allow'] === 'POST', String(res.statusCode));

/* ---------- key can travel in the query string too, for the phone script's
   simpler urllib.request path ---------- */
res = mkRes(); await ingest({ method: 'POST', headers: {}, query: { key: 'ing-test' }, body: { chats: [] } }, res);
check('key is accepted from the query string', res.statusCode !== 404, String(res.statusCode));

/* ---------- with the key: id-less chats fail before the store is touched ---------- */
res = mkRes(); await ingest({
  method: 'POST',
  headers: { 'x-wa-ingest-key': 'ing-test' },
  query: {},
  body: { chats: [{ id: 'j1', n: 'A', k: 'd', m: 1 }, { n: 'B', k: 'd', m: 1 }, { n: 'C', k: 'g', m: 1 }] },
}, res);
check('id-less chats are refused with 400 and named, before the store is touched',
  res.statusCode === 400 && eq(res.payload.missing, [1, 2]) && /id/.test(res.payload.error),
  `${res.statusCode} ${JSON.stringify(res.payload)}`);

/* ---------- with the key and all chats keyed: the store check runs ---------- */
res = mkRes(); await ingest({
  method: 'POST',
  headers: { 'x-wa-ingest-key': 'ing-test' },
  query: {},
  body: { chats: [{ id: 'j1', n: 'A', k: 'd', m: 1 }] },
}, res);
check('a well-formed batch reaches the store check (DATABASE_URL unset here → 503)',
  res.statusCode === 503 && /DATABASE_URL/.test(res.payload.error),
  `${res.statusCode} ${JSON.stringify(res.payload)}`);

/* ---------- body handling: a string body is parsed; a non-JSON string is 400 ---------- */
res = mkRes(); await ingest({
  method: 'POST',
  headers: { 'x-wa-ingest-key': 'ing-test' },
  query: {},
  body: 'not json at all',
}, res);
check('a non-JSON body is 400 with a clear error', res.statusCode === 400 && /body is not JSON/.test(res.payload.error),
  `${res.statusCode} ${JSON.stringify(res.payload)}`);

res = mkRes(); await ingest({
  method: 'POST',
  headers: { 'x-wa-ingest-key': 'ing-test' },
  query: {},
  body: JSON.stringify({ chats: [{ id: 'j1', n: 'A', k: 'd', m: 1 }] }),
}, res);
check('a stringified JSON body is parsed and reaches the store check',
  res.statusCode === 503 && /DATABASE_URL/.test(res.payload.error),
  `${res.statusCode} ${JSON.stringify(res.payload)}`);

/* ---------- with no WA_INGEST_KEY on the server: the route is closed, not open ---------- */
delete process.env.WA_INGEST_KEY;
const { default: ingest2 } = await import('../../Backend/wa-ingest.js?no-ingest-key');
res = mkRes(); await ingest2({
  method: 'POST',
  headers: { 'x-wa-ingest-key': 'anything' },
  query: {},
  body: { chats: [] },
}, res);
check('a server with no WA_INGEST_KEY set answers 404 (fails closed)', res.statusCode === 404, String(res.statusCode));

/* ---------- never let a shared cache hold anything from this route ---------- */
res = mkRes(); await ingest({
  method: 'POST',
  headers: { 'x-wa-ingest-key': 'ing-test' },
  query: {},
  body: { chats: [] },
}, res);
check('Cache-Control is no-store on every response', res.headers['Cache-Control'] === 'no-store',
  JSON.stringify(res.headers));

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
