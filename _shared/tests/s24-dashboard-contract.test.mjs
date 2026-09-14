import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'Frontend', 'db.html'), 'utf8');
const api = readFileSync(join(root, 'Backend', 'db-api.js'), 'utf8');
const migration = readFileSync(join(root, 'Database', 'schema', '006_s24_normalized.sql'), 'utf8');
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));

test('database dashboard inline JavaScript parses', () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, 'inline script not found');
  assert.doesNotThrow(() => new Script(script[1]));
});

test('all known and fallback S24 sections are present', () => {
  for (const id of ['overview', 'calls', 'sms', 'locations', 'agents', 'commands', 'files', 'queue', 'all']) {
    assert.match(html, new RegExp(`\\['${id}',`), `missing ${id} dashboard section`);
  }
  assert.match(html, /Complete source record/);
});

test('typed S24 tables are covered by migration, API, and health inventory', () => {
  for (const table of [
    's24_device_snapshots', 's24_calls', 's24_sms', 's24_locations',
    's24_agents', 's24_commands', 's24_files', 's24_queue_items',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(api, new RegExp(table));
  }
});

test('the signed S24 ingest handler is included in explicit Vercel builds', () => {
  assert.ok(vercel.builds.some((build) => build.src === 'Backend/s24-ingest.js'));
});
