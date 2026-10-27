import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import { reconcileSnapshot, reconcilePage, SECTION_DEFINITIONS } from '../../Integrations/dashboard-store.js';

assert.equal(SECTION_DEFINITIONS.length, 19);
assert.equal(new Set(SECTION_DEFINITIONS.map(s => s.id)).size, 19);
// The declared environment supplies an isolated database, never a production URL.
assert.match(process.env.DATABASE_URL || '', /^postgres:\/\/jpbir:jpbir@db:5432\/jpbir$/);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const c = await pool.connect();
try {
  const sql = await fs.readFile(new URL('../../Database/schema/017_dashboard_sections.sql', import.meta.url), 'utf8');
  await c.query('BEGIN');
  await c.query(sql); await c.query(sql);
  const security=(await c.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.dashboard_current_records'::regclass")).rows[0];
  assert.equal(security.relrowsecurity,true,'private current-state tables must deny non-owner Data API reads');
  const source = 'test-' + crypto.randomUUID();
  const snapshot = (generation, records, complete = true) => ({ section: 'firestore', source, scope: 'devices/test/sms', generation, records, complete });
  const rec = (id, revision, body) => ({ id, revision, values: { text: body, count: 0 } });
  assert.equal((await reconcileSnapshot(c, snapshot('2026-01-01T00:00:00.000000001Z', [rec('a', '2026-01-01T00:00:00.000000001Z', 'first')]))).inserted, 1);
  assert.equal((await reconcileSnapshot(c, snapshot('2026-01-01T00:00:01Z', [rec('a', '2026-01-01T00:00:00.000000001Z', 'first')]))).unchanged, 1);
  await reconcileSnapshot(c, snapshot('2026-01-01T00:00:02Z', [rec('a', '2026-01-01T00:00:00.000000002Z', 'new')]));
  await reconcileSnapshot(c, snapshot('2026-01-01T00:00:03Z', [rec('a', '2026-01-01T00:00:00.000000001Z', 'late')]));
  let rows = (await c.query('SELECT display_values FROM dashboard_current_records WHERE source=$1', [source])).rows;
  assert.deepEqual(rows[0].display_values, { text: 'new', count: 0 });
  assert.equal((await reconcileSnapshot(c, snapshot('2026-01-01T00:00:04Z', [], false))).removed, 0);
  assert.equal((await reconcileSnapshot(c, snapshot('2025-12-31T00:00:00Z', []))).removed, 0);
  assert.equal((await reconcileSnapshot(c, snapshot('2026-01-01T00:00:05Z', []))).removed, 1);
  await reconcileSnapshot(c, snapshot('2026-01-01T00:00:06Z', [rec('a', '2026-01-01T00:00:00.000000001Z', 'resurrected late')]));
  assert.equal((await c.query('SELECT count(*)::int AS n FROM dashboard_current_records WHERE source=$1', [source])).rows[0].n, 0);
  await assert.rejects(reconcileSnapshot(c, snapshot('2026-01-01T00:00:07Z', [rec('a', null, 'invalid')])), /revision/);
  const pageGen='2026-02-01T00:00:00Z';
  await reconcilePage(c,{...snapshot(pageGen,[rec('x',pageGen,'page one')]),nextPageToken:'cursor-2'});
  await reconcilePage(c,{...snapshot(pageGen,[rec('x',pageGen,'stale replay')]),cursor:'',nextPageToken:'wrong-cursor'});
  assert.equal((await c.query('SELECT cursor FROM dashboard_sync_cursors WHERE source=$1',[source])).rows[0].cursor,'cursor-2');
  await reconcilePage(c,{...snapshot(pageGen,[rec('y',pageGen,'page two')]),cursor:'cursor-2',nextPageToken:''});
  assert.equal((await c.query('SELECT count(*)::int AS n FROM dashboard_current_records WHERE source=$1',[source])).rows[0].n,2);
  assert.equal((await c.query('SELECT count(*)::int AS n FROM dashboard_sync_cursors WHERE source=$1',[source])).rows[0].n,0);
  await reconcilePage(c,{...snapshot(pageGen,[rec('x',pageGen,'late page')]),nextPageToken:'cursor-2'});
  assert.equal((await c.query('SELECT count(*)::int AS n FROM dashboard_sync_cursors WHERE source=$1',[source])).rows[0].n,0);
  await c.query('CREATE ROLE dashboard_test_reader NOLOGIN');
  await c.query('GRANT SELECT ON dashboard_current_records TO dashboard_test_reader');
  await c.query('SET LOCAL ROLE dashboard_test_reader');
  assert.equal((await c.query('SELECT count(*)::int AS n FROM dashboard_current_records')).rows[0].n,0,'an explicit SELECT grant cannot bypass row security');
  await c.query('RESET ROLE');
  console.log('dashboard current-state: replay, nanosecond ordering, late update, partial/deletion and migration rerun passed');
} finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
