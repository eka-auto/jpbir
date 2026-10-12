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

test('database dashboard inline JavaScript parses', () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, 'inline script not found');
  assert.doesNotThrow(() => new Script(script[1]));
});

test('every S24 and warehouse table is read whole: SELECT *, no masking helper', () => {
  for (const id of ['overview', 'calls', 'sms', 'locations', 'agents', 'commands', 'queue', 'all']) {
    assert.match(html, new RegExp(`\\['${id}',`), `missing ${id} dashboard section`);
  }
  assert.match(html, /Review the records, not the storage layer/);
  assert.match(html, /Run query/);
  // Whole rows, one statement per table. A column list here is a promise to
  // keep it in step with the schema, and this is where that promise broke:
  // 008 added wa_sync_runs.attachments_seen and no list named it.
  for (const table of ['s24_records', 's24_calls', 's24_sms', 's24_locations', 's24_commands',
    's24_queue_items', 's24_sync_runs', 's24_device_snapshots', 'wa_chats', 'wa_messages',
    'wa_attachments', 'wa_sync_runs', 'events', 'visitors', 'sessions', 'letters', 'email_opens',
    'video_events', 'devices']) {
    const hits = [];
    for (let i = api.indexOf('FROM ' + table); i !== -1; i = api.indexOf('FROM ' + table, i + 1)) hits.push(i);
    assert.ok(hits.length, `${table} is not read by any view`);
    assert.ok(hits.some((i) => api.slice(Math.max(0, i - 400), i).includes('SELECT *')),
      `${table} is read with a column list, not SELECT *`);
  }
  // Tables with a derived column keep it ALONGSIDE the stored one.
  assert.match(api, /SELECT \*,/);
  assert.doesNotMatch(api, /maskPhone|maskPerson|maskIdentifier|coarseCoordinate|sanitizeS24Rows|isReviewableDataset/);
});

test('nothing on this path masks, rounds, truncates or filters a stored value', () => {
  assert.doesNotMatch(api, /maskPhone|maskPerson|maskIdentifier|coarseCoordinate|sanitizeS24Rows|isReviewableDataset/);
  assert.doesNotMatch(html, /maskPhone|maskPerson|maskRecordRef|reviewableRows/);
  assert.doesNotMatch(html, /Sensitive identifiers, message content and precise locations are masked/);
  assert.doesNotMatch(html, /Number\(r\.latitude\)\.toFixed/);
  assert.doesNotMatch(api, /dataset <> 'firestore_files'/);
  assert.doesNotMatch(html, /dataset !== 'firestore_files'/);
  // No tree, cell or file cap left: every one of these replaced a stored value
  // with a note about the value.
  assert.match(html, /var TREE_MAX_DEPTH = Infinity;/);
  assert.match(html, /var TREE_MAX_ENTRIES = Infinity;/);
  assert.match(html, /var TREE_MAX_NODES = Infinity;/);
  assert.doesNotMatch(html, /'Not shown/);
  assert.doesNotMatch(html, /CONTENT_PREVIEW_CHARS/);
  assert.doesNotMatch(html, /class="[^"]*trunc/);
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
