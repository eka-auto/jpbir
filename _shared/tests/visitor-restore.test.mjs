import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { rollupVisitors } from '../../Backend/lib/warehouse.js';
import { planVisitorRestore, applyVisitorRestore, restoreSummary } from '../../Database/scripts/lib/restore-visitor-events.mjs';

const options = { site: 'jaytibirthday.in', since: '2026-10-10T00:00:00Z', until: '2026-10-20T00:00:00Z' };
const row = (id, extra = {}) => ({
  id: 'jaytibirthday.in:' + id, site: 'jaytibirthday.in', event_type: 'page_view',
  occurred_at: '2026-10-11T04:00:00+00:00', session_id: 'session-' + id,
  visitor_id: 'visitor-' + id, page_url: 'https://jaytibirthday.in/', ...extra,
});
let pass = 0;
function test(name, fn) { fn(); pass++; console.log('PASS  ' + name); }
const kept = row('kept'), missing = row('missing');
test('the preserved event ID and timestamp survive planning', () => {
  const plan = planVisitorRestore([kept, missing], [kept], options);
  assert.equal(plan.missingCount, 1);
  assert.deepEqual(plan.rows, [missing]);
  assert.equal('rows' in restoreSummary(plan), false);
});
test('a second restore has no missing rows', () => {
  assert.equal(planVisitorRestore([kept, missing], [kept, missing], options).missingCount, 0);
});
test('foreign property and out-of-window rows stop the whole restore', () => {
  assert.throws(() => planVisitorRestore([missing, row('foreign', { site: 'jaytipargal.tech' })], [], options));
  assert.throws(() => planVisitorRestore([row('old', { occurred_at: '2026-10-01T00:00:00Z' })], [], options));
  assert.throws(() => planVisitorRestore([missing], [], { ...options, site: 'example.com' }));
});
test('conflicting IDs and duplicate source IDs cannot become silent skips', () => {
  assert.throws(() => planVisitorRestore([kept], [row('kept', { session_id: 'different' })], options));
  assert.throws(() => planVisitorRestore([kept, kept], [], options));
});
test('the plan is stable across row order and changes with preserved data', () => {
  const a = planVisitorRestore([kept, missing], [], options);
  const b = planVisitorRestore([missing, kept], [], options);
  assert.equal(a.sourceDigest, b.sourceDigest);
  assert.notEqual(a.sourceDigest, planVisitorRestore([kept, { ...missing, city: 'different' }], [], options).sourceDigest);
});
test('row limits fail closed', () => assert.throws(() => planVisitorRestore([kept, missing], [], { ...options, maxRows: 1 })));

// Real transaction coverage only runs against the isolated manifest database.
// Ordinary CI's npm test has the same db service; never accept a production URL.
if (process.env.PROJECT_ENV !== '1' || new URL(process.env.DATABASE_URL).hostname !== 'db') {
  throw new Error('visitor restore transaction tests require the isolated project db service');
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: false });
await client.connect();
const schema = 'visitor_restore_' + randomUUID().replaceAll('-', '');
try {
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  await client.query(`CREATE TABLE events (
    id text PRIMARY KEY, site text NOT NULL, event_type text NOT NULL, occurred_at timestamptz NOT NULL,
    session_id text, visitor_id text, page_url text, country text, region text, city text, timezone text,
    user_agent text, device_type text, browser text, os text, fingerprint text
  ); CREATE TABLE visitors (
    visitor_id text, site text, first_seen_at timestamptz, last_seen_at timestamptz, event_count int,
    session_count int, country text, region text, city text, timezone text, user_agent text, device_type text,
    browser text, os text, fingerprint text, PRIMARY KEY(site,visitor_id)
  ); CREATE TABLE sessions (
    session_id text, site text, visitor_id text, started_at timestamptz, last_event_at timestamptz,
    event_count int, entry_page text, exit_page text, PRIMARY KEY(site,session_id)
  )`);
  // PostgreSQL supplies the full typed row, including null columns, just as
  // source export does. This also tests JSON timestamp fidelity end to end.
  const typed = async (r) => (await client.query('SELECT to_jsonb(jsonb_populate_record(NULL::events,$1::jsonb)) AS row', [JSON.stringify(r)])).rows[0].row;
  const original = await typed(kept), restored = await typed(missing);
  await client.query('INSERT INTO events SELECT (jsonb_populate_record(NULL::events,$1::jsonb)).*', [JSON.stringify(original)]);
  const source = [original, restored];
  const plan = planVisitorRestore(source, [original], options);
  const result = await applyVisitorRestore(client, source, options, plan);
  assert.deepEqual(result, { inserted: 1, visitorsRefreshed: 1, sessionsRefreshed: 1 });
  assert.equal((await client.query('SELECT count(*)::int n FROM events')).rows[0].n, 2);
  assert.equal((await client.query('SELECT event_count FROM sessions')).rows[0].event_count, 1);
  assert.equal((await client.query('SELECT event_count FROM visitors')).rows[0].event_count, 1);
  pass++; console.log('PASS  PostgreSQL restores exact rows and both rollups atomically');
  assert.equal((await applyVisitorRestore(client, source, options, planVisitorRestore(source, source, options))).inserted, 0);
  pass++; console.log('PASS  the second PostgreSQL restore inserts zero rows');
  await client.query(`INSERT INTO sessions (session_id,site,visitor_id,started_at,last_event_at,event_count,entry_page,exit_page)
    VALUES ($1,$2,$3,$4,$4,1,$5,$5)`, [original.session_id,original.site,original.visitor_id,original.occurred_at,original.page_url]);
  const earlier = await typed(row('earlier', {
    occurred_at: '2026-10-10T04:00:00+00:00', session_id: original.session_id,
    visitor_id: original.visitor_id, page_url: 'https://jaytibirthday.in/entry',
  }));
  await applyVisitorRestore(client,[earlier],options,planVisitorRestore([earlier],[],options));
  const historicalSession = (await client.query('SELECT started_at,entry_page,event_count FROM sessions WHERE session_id=$1',[original.session_id])).rows[0];
  assert.equal(historicalSession.started_at.toISOString(),'2026-10-10T04:00:00.000Z');
  assert.equal(historicalSession.entry_page,'https://jaytibirthday.in/entry');
  assert.equal(historicalSession.event_count,2);
  pass++; console.log('PASS  restoring earlier history corrects an existing session start and entry page');
  const writer = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: false });
  await writer.connect();
  try {
    await writer.query(`SET search_path TO ${schema}`);
    const writerPid=(await writer.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    const concurrent=await typed(row('concurrent',{visitor_id:original.visitor_id,session_id:original.session_id}));
    let pending;
    await applyVisitorRestore(client,[concurrent],options,planVisitorRestore([concurrent],[],options),{
      beforeCommit: async ({before,after}) => {
        assert.equal(before.visitors[0].event_count,2);
        assert.equal(after.visitors[0].event_count,3);
        pending=rollupVisitors({site:options.site,visitorId:original.visitor_id,db:writer.query.bind(writer)});
        let blocked=false;
        for(let i=0;i<100;i++) {
          const state=(await client.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[writerPid])).rows[0];
          if(state?.wait_event_type==='Lock'){blocked=true;break;}
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.equal(blocked,true,'ordinary ingestion must wait behind the restoration lock');
      },
    });
    await pending;
    assert.equal((await client.query('SELECT event_count FROM visitors WHERE visitor_id=$1',[original.visitor_id])).rows[0].event_count,3);
    pass++; console.log('PASS  a concurrent live rollup cannot overwrite restored event counts');
  } finally {await writer.end();}
  const backupFailure=await typed(row('backup-failure'));
  await assert.rejects(applyVisitorRestore(client,[backupFailure],options,planVisitorRestore([backupFailure],[],options),{
    beforeCommit:async()=>{throw new Error('test backup failure');},
  }),/test backup failure/);
  assert.equal((await client.query('SELECT count(*)::int n FROM events')).rows[0].n,4);
  pass++; console.log('PASS  backup failure prevents the transaction from committing');
  const additional = await typed(row('rollup-failure'));
  await client.query(`CREATE FUNCTION pg_temp.refuse_rollup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollup failure'; END $$;
    CREATE TRIGGER fail_rollup BEFORE INSERT ON visitors FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_rollup()`);
  await assert.rejects(applyVisitorRestore(client, [additional], options, planVisitorRestore([additional], [], options)), /test rollup failure/);
  assert.equal((await client.query('SELECT count(*)::int n FROM events')).rows[0].n, 4);
  pass++; console.log('PASS  a failed rollup rolls back its event insert');
  const changed = await typed(row('changed'));
  const stalePlan = planVisitorRestore([changed], [], options);
  await client.query('INSERT INTO events SELECT (jsonb_populate_record(NULL::events,$1::jsonb)).*', [JSON.stringify(changed)]);
  await assert.rejects(applyVisitorRestore(client, [changed], options, stalePlan), /changed since/);
  pass++; console.log('PASS  an outdated restore plan is refused');
} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.end();
}
console.log(`\n${pass}/${pass} visitor restore checks passed`);
