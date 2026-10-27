// Prove that a credential names the production warehouse, before anything is
// written to it.
//
// Two checks, and both have to pass:
//
//   1. The credential's Neon project, branch and database are the ones
//      project/targets.json records. A freshness comparison on its own cannot
//      tell two byte-identical copies of a database apart - and on
//      2026-10-27 there were exactly two, one of them the one production
//      wrote to and the other the one the repository's secrets named. The
//      manifest is what makes the answer unambiguous.
//
//   2. The credential's database and the deployed application agree on the
//      newest event for the tracked property, so the credential is not
//      pointed at a copy the application stopped writing to.
//
// Only identifiers, counts and timestamps are printed. No secret value is.

import pg from 'pg';

import {
  DEFAULT_TARGET_NAME,
  compareFreshness,
  compareTarget,
  findTarget,
  readManifest,
} from './warehouse-target.mjs';

const { DATABASE_URL, STATS_KEY, TARGET_NAME = DEFAULT_TARGET_NAME } = process.env;

if (!DATABASE_URL) {
  console.error('::error::DATABASE_URL is not set');
  process.exit(1);
}

const target = findTarget(readManifest(), TARGET_NAME);

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});
await client.connect();
const id = await client.query(`
  select current_setting('neon.project_id', true) project_id,
         current_setting('neon.branch_id', true) branch_id,
         current_setting('neon.endpoint_id', true) endpoint_id,
         current_database() database`);
const events = await client.query(`
  select count(*)::int n, max(occurred_at) newest
  from events where site = 'jaytibirthday.in'`);
await client.end();

const actual = id.rows[0];
const newest = events.rows[0].newest;

let apiNewest = null;
if (STATS_KEY) {
  const live = await fetch('https://jaytipargal.tech/api/stats?site=jaytibirthday.in', {
    headers: { 'x-stats-key': STATS_KEY },
  });
  const body = await live.json();
  const api = body.latest_events || [];
  apiNewest = api.length ? api[0].receivedAt : null;
} else {
  // The comparison with the deployed application needs the application's own
  // key. Without it that half of the check did not run, and saying so is
  // better than letting it look like it passed.
  console.log('::warning::STATS_KEY is not set - the deployed-application comparison was not made');
}

console.log('manifest target : ' + target.name);
console.log('neon project    : ' + actual.project_id + ' (manifest: ' + target.project_id + ')');
console.log('neon branch     : ' + actual.branch_id + ' (manifest: ' + target.branch_id + ')');
console.log('neon endpoint   : ' + actual.endpoint_id);
console.log('database        : ' + actual.database + ' (manifest: ' + target.database + ')');
console.log('db events       : ' + events.rows[0].n + ' (newest ' + newest + ')');
console.log('api newest      : ' + (apiNewest ?? 'not compared'));

const reasons = [];
if (!events.rows[0].n) {
  reasons.push('the target has no events for the tracked property - is this the production warehouse?');
}
reasons.push(...compareTarget(target, actual).reasons);
reasons.push(...compareFreshness(newest, apiNewest).reasons);

if (reasons.length) {
  for (const reason of reasons) console.error('::error::' + reason);
  console.error('::error::the credential does not name the production warehouse recorded in project/targets.json');
  process.exit(1);
}

console.log('target verified as the production warehouse');
