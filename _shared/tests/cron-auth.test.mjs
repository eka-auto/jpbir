// The DynamoDB -> Postgres migration is now driven by a schedule, so its gate
// has to accept Vercel's cron bearer without becoming reachable by anyone else.
//
// /api/db-push answers 404 rather than 401 on purpose — the route should not be
// discoverable — which means a broken credential check looks exactly like a
// route that does not exist. That is the failure this pins: "the cron silently
// 404s every night" and "the cron works" are indistinguishable from outside.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};

process.env.CRON_SECRET = 'cron-test-secret';
process.env.DB_ADMIN_KEY = 'admin-test-key';
// No store and no AWS: every request that gets PAST the gate must fail on
// configuration, which is how the suite tells "authorised" from "refused"
// when both sides of the gate return an error.
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.JP_AWS_ACCESS_KEY_ID;
delete process.env.JP_AWS_SECRET_ACCESS_KEY;

const { cronAuthorized, secretEquals } = await import('../../Backend/lib/cron-auth.js');
const dbPush = (await import('../../Backend/db-push.js')).default;

const mkRes = () => ({
  statusCode: null, payload: null,
  setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.payload = b; return this; },
});
const call = async (headers) => {
  const res = mkRes();
  await dbPush({ headers, query: {} }, res);
  return res;
};

// ---- the helper ----------------------------------------------------------
check('a matching bearer is authorised',
  cronAuthorized({ headers: { authorization: 'Bearer cron-test-secret' } }) === true, 'rejected the real secret');
check('a wrong bearer is refused',
  cronAuthorized({ headers: { authorization: 'Bearer nope' } }) === false, 'accepted a wrong secret');
check('a bearer of a different length is refused, not a crash',
  cronAuthorized({ headers: { authorization: 'Bearer ' + 'x'.repeat(200) } }) === false, 'threw or accepted');
check('no Authorization header is refused', cronAuthorized({ headers: {} }) === false, 'accepted an empty header');
check('a non-Bearer scheme is refused',
  cronAuthorized({ headers: { authorization: 'Basic cron-test-secret' } }) === false, 'accepted Basic');
check('secretEquals refuses when either side is empty',
  secretEquals('', 'x') === false && secretEquals('x', '') === false && secretEquals('x', undefined) === false,
  'empty compared equal');
check('secretEquals matches on equal values', secretEquals('abc', 'abc') === true, 'equal values compared unequal');

// ---- the route -----------------------------------------------------------
{
  const res = await call({});
  check('db-push with no credential is 404, not 401',
    res.statusCode === 404 && res.payload?.error === 'not found', JSON.stringify(res.payload));
}
{
  const res = await call({ authorization: 'Bearer wrong-secret' });
  check('db-push with a wrong cron bearer is 404', res.statusCode === 404, JSON.stringify(res.payload));
}
{
  const res = await call({ 'x-db-admin-key': 'wrong-key' });
  check('db-push with a wrong admin key is 404', res.statusCode === 404, JSON.stringify(res.payload));
}
{
  // Past the gate: the handler gets as far as the store check.
  const res = await call({ authorization: 'Bearer cron-test-secret' });
  check('db-push accepts the cron bearer and proceeds',
    res.statusCode === 500 && /DATABASE_URL/.test(res.payload?.error || ''),
    `status ${res.statusCode} ${JSON.stringify(res.payload)}`);
}
{
  const res = await call({ 'x-db-admin-key': 'admin-test-key' });
  check('db-push still accepts the admin key',
    res.statusCode === 500 && /DATABASE_URL/.test(res.payload?.error || ''),
    `status ${res.statusCode} ${JSON.stringify(res.payload)}`);
}

// ---- the schedule --------------------------------------------------------
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const cron = (vercel.crons || []).find((c) => c.path.startsWith('/api/db-push'));
check('vercel.json schedules the migration', Boolean(cron), JSON.stringify(vercel.crons || null));
if (cron) {
  check('the schedule is a five-field cron expression',
    /^(\S+\s+){4}\S+$/.test(cron.schedule), cron.schedule);
  check('the scheduled path is routed to the handler',
    (vercel.routes || []).some((r) => new RegExp('^' + r.src + '$').test('/api/db-push')),
    'no route matches /api/db-push');
  check('the handler it routes to is in builds',
    (vercel.builds || []).some((b) => b.src === 'Backend/db-push.js'),
    'Backend/db-push.js is not built, so the cron would hit a static 404');
}

console.log(`\n${failures ? `${failures} check(s) failed` : 'all checks passed'}`);
process.exitCode = failures ? 1 : 0;
