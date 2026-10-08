import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import test from 'node:test';
import { sanitizeS24Rows } from '../../Backend/db-api.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'Frontend', 'db.html'), 'utf8');
const api = readFileSync(join(root, 'Backend', 'db-api.js'), 'utf8');
const migration = readFileSync(join(root, 'Database', 'schema', '006_s24_normalized.sql'), 'utf8');

test('database dashboard inline JavaScript parses', () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, 'inline script not found');
  assert.doesNotThrow(() => new Script(script[1]));
});

test('review sections expose queryable records without a file browser', () => {
  for (const id of ['overview', 'calls', 'sms', 'locations', 'agents', 'commands', 'queue', 'all']) {
    assert.match(html, new RegExp(`\\['${id}',`), `missing ${id} dashboard section`);
  }
  assert.doesNotMatch(html, /\['files', 'Files'/);
  assert.match(html, /Review the records, not the storage layer/);
  assert.match(html, /Run query/);
  assert.match(api, /function isReviewableDataset/);
  assert.match(api, /rows = sanitizeS24Rows\(rows\)/);
});

test('S24 review response masks identifiers and strips storage artifacts', () => {
  const rows = sanitizeS24Rows([
    {
      dataset: 'firestore_callLogs', record_id: 'record-123456', run_id: 'run-private',
      contact_name: 'Aarav', phone_number: '+91 98765 43210', payload: { raw: 'private' },
    },
    { dataset: 'firestore_files', record_id: 'file-123', filename: 'private.json', content: 'do not return' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dataset, 'Call');
  assert.equal(rows[0].record_id, 'rec••••456');
  assert.equal(rows[0].contact_name, 'A•••');
  assert.equal(rows[0].phone_number, '•••• •••• 3210');
  assert.equal('payload' in rows[0], false);
  assert.equal('run_id' in rows[0], false);
  assert.equal('filename' in rows[0], false);
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

test('agent records are never presented as ready solely because their rows loaded', () => {
  assert.match(html, /agent record/);
  assert.doesNotMatch(html, /state\.s24Query \? ' matched' : ' ready'/);
  assert.match(api, /COALESCE\(activated_at, registered_at\) >= now\(\) - interval '1 hour'/);
  assert.doesNotMatch(api, /status = 'active' AND last_seen < now\(\) - interval '1 hour'/);
});
