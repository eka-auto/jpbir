import assert from 'node:assert/strict';
import test from 'node:test';

import { ingestBatch, specializedTableForDataset } from '../../Integrations/s24-store.js';

test('every known S24 dataset has a typed destination', () => {
  const expected = {
    device_document: 's24_device_snapshots',
    direct_call_logs: 's24_calls',
    firestore_callLogs: 's24_calls',
    direct_sms: 's24_sms',
    firestore_sms: 's24_sms',
    direct_location: 's24_locations',
    firestore_agents: 's24_agents',
    firestore_commands: 's24_commands',
    firestore_files: 's24_files',
    firestore_queue: 's24_queue_items',
  };
  for (const [dataset, table] of Object.entries(expected)) {
    assert.equal(specializedTableForDataset(dataset), table);
  }
  assert.equal(specializedTableForDataset('future_dataset'), null);
});

test('normalized call durations keep the live daemon duration_seconds field including zero', async () => {
  for (const duration_seconds of [0, 37]) {
    let parameters;
    await ingestBatch(async (sql, params) => {
      if (sql.includes('INSERT INTO s24_calls')) parameters = params;
      return { rowCount: 1, rows: [] };
    }, {
      run: { run_id: 'duration-test', device_id: 'samsung-s24-ultra', started_at: '2026-10-01T00:00:00Z' },
      upload: { batch_index: 1, batch_count: 1 },
      datasets: [{ dataset: 'direct_call_logs', status: 'ok', record_count: 1 }],
      records: [{ dataset: 'direct_call_logs', record_id: 'test-call', payload: { duration_seconds, duration: 999 } }],
    }, { keyId: 'test' });
    assert.equal(parameters[8], duration_seconds);
  }
});

test('ingest keeps every record in JSON and mirrors known datasets into typed tables', async () => {
  const records = [
    { dataset: 'device_document', record_id: 'device', payload: { model: 'SM-S928B' } },
    { dataset: 'firestore_callLogs', record_id: 'call', payload: { number: 'private', duration: '4' } },
    { dataset: 'direct_sms', record_id: 'sms', payload: { sender: 'private', body: 'private' } },
    { dataset: 'direct_location', record_id: 'loc', payload: { latitude: 1, longitude: 2 } },
    { dataset: 'firestore_agents', record_id: 'agent', payload: { agent_name: 'worker' } },
    { dataset: 'firestore_commands', record_id: 'command', payload: { action: 'status-only' } },
    { dataset: 'firestore_files', record_id: 'file', payload: { filename: 'result.json' } },
    { dataset: 'firestore_queue', record_id: 'queue', payload: { command: 'heartbeat' } },
    { dataset: 'future_dataset', record_id: 'future', payload: { retained: true } },
  ];
  const statements = [];
  const query = async (sql) => { statements.push(sql); return { rowCount: 1, rows: [] }; };
  await ingestBatch(query, {
    run: { run_id: 'typed-test', device_id: 'samsung-s24-ultra', started_at: '2026-09-14T00:00:00Z' },
    upload: { batch_index: 1, batch_count: 1 },
    datasets: records.map((r) => ({ dataset: r.dataset, status: 'ok', record_count: 1 })),
    records,
  }, { keyId: 'test' });

  const sql = statements.join('\n');
  assert.equal((sql.match(/INSERT INTO s24_records/g) || []).length, records.length);
  for (const table of [
    's24_device_snapshots', 's24_calls', 's24_sms', 's24_locations',
    's24_agents', 's24_commands', 's24_files', 's24_queue_items',
  ]) assert.match(sql, new RegExp(`INSERT INTO ${table}`));
});
