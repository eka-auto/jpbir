// HEALTH_CHECK_KEY lets CI ask /api/verify-db one question - does Neon answer
// with the full schema? - without holding the dashboard key. Pin both halves:
// it gets exactly that answer and nothing more, and it opens nothing else.
//
// No DATABASE_URL in this process, so the Postgres check reports not-ok; that
// is enough to see the shape of what the health key is shown.
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.CRON_SECRET;
process.env.STATS_KEY = 'k-test';
process.env.HEALTH_CHECK_KEY = 'h-test';

const mkRes = () => ({
  statusCode: null, payload: null, headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.statusCode = c; return this; },
  json(b) { this.payload = b; return this; },
});
const { default: handler } = await import('../../Backend/verify-db.js');
const call = async (headers, query = {}) => {
  const res = mkRes();
  await handler({ method: 'GET', headers, query }, res);
  return res;
};

let r = await call({ 'x-health-key': 'h-test' });
check('the health key reaches the Postgres check', r.statusCode === 503 && r.payload?.postgres?.ok === false,
  `got ${r.statusCode} ${JSON.stringify(r.payload)}`);
check('and is shown only the Postgres summary',
  JSON.stringify(Object.keys(r.payload || {}).sort()) === '["postgres","success"]'
    && JSON.stringify(Object.keys(r.payload.postgres).sort()) === '["birthday_active_now","newest_event_at","ok","tables_expected","tables_present"]',
  JSON.stringify(r.payload));
check('health-key payload keeps freshness fields typed and non-sensitive',
  (r.payload.postgres.newest_event_at === null || typeof r.payload.postgres.newest_event_at === 'string')
    && (r.payload.postgres.birthday_active_now === null || Number.isInteger(r.payload.postgres.birthday_active_now)),
  JSON.stringify(r.payload.postgres));

r = await call({ 'x-health-key': 'wrong' });
check('a wrong health key is refused', r.statusCode === 401, `got ${r.statusCode}`);
r = await call({}, { key: 'h-test' });
check('the health key is not a dashboard key', r.statusCode === 401, `got ${r.statusCode}`);
r = await call({ 'x-stats-key': 'h-test' });
check('nor accepted as one in the header', r.statusCode === 401, `got ${r.statusCode}`);

delete process.env.HEALTH_CHECK_KEY;
r = await call({ 'x-health-key': '' });
check('with HEALTH_CHECK_KEY unset, an empty header opens nothing', r.statusCode === 401, `got ${r.statusCode}`);

console.log(failures === 0 ? '\nhealth key verified.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
