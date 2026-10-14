// Ingest logic for the local-first S24 sync, kept out of the HTTP handler so
// it can be tested without a request or a database.
//
// The upload is a batch: one run header, a status row per dataset, and the
// records. Everything is upserted on a natural key, so re-running a pull after
// a partial failure converges rather than duplicating.

export const MAX_RECORDS_PER_BATCH = 5000;
export const S24_DEVICE_ID = 'samsung-s24-ultra';

const DATASET_STATUSES = new Set(['ok', 'empty', 'unavailable', 'denied', 'error']);

function asIso(v) {
  if (v == null || v === '') return null;
  // Phone timestamps come as epoch ms about as often as ISO strings.
  const d = typeof v === 'number' || /^\d{10,16}$/.test(String(v))
    ? new Date(Number(v) > 1e12 ? Number(v) : Number(v) * 1000)
    : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function str(v, max) {
  if (v == null) return null;
  const s = String(v);
  return max && s.length > max ? s.slice(0, max) : s;
}

function number(v, integer = false) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return integer ? Math.trunc(n) : n;
}

function bool(v) {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return null;
}

function dateFrom(payload, keys, fallback = null) {
  for (const key of keys) {
    const parsed = asIso(payload?.[key]);
    if (parsed) return parsed;
  }
  return asIso(fallback);
}

export function specializedTableForDataset(dataset) {
  if (dataset === 'device_document') return 's24_device_snapshots';
  if (dataset === 'direct_call_logs' || dataset === 'firestore_callLogs') return 's24_calls';
  if (dataset === 'direct_sms' || dataset === 'firestore_sms') return 's24_sms';
  if (dataset === 'direct_location') return 's24_locations';
  if (dataset === 'firestore_agents') return 's24_agents';
  if (dataset === 'firestore_commands') return 's24_commands';
  if (dataset === 'firestore_files') return 's24_files';
  if (dataset === 'firestore_queue') return 's24_queue_items';
  return null;
}

async function writeSpecialized(query, run, record) {
  const table = specializedTableForDataset(record.dataset);
  if (!table) return;
  const p = record.payload;
  const base = [str(run.run_id, 200), str(run.device_id, 120)];

  if (table === 's24_device_snapshots') {
    await query(
      `INSERT INTO s24_device_snapshots
         (run_id, device_id, observed_at, agent_version, android_version, model,
          manufacturer, battery_level, status, connection_method, heartbeat_auth,
          source_type, runtime_is_android, live_device_verified, last_seen, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (run_id) DO UPDATE SET
         observed_at=EXCLUDED.observed_at, agent_version=EXCLUDED.agent_version,
         android_version=EXCLUDED.android_version, model=EXCLUDED.model,
         manufacturer=EXCLUDED.manufacturer, battery_level=EXCLUDED.battery_level,
         status=EXCLUDED.status, connection_method=EXCLUDED.connection_method,
         heartbeat_auth=EXCLUDED.heartbeat_auth, source_type=EXCLUDED.source_type,
         runtime_is_android=EXCLUDED.runtime_is_android,
         live_device_verified=EXCLUDED.live_device_verified,
         last_seen=EXCLUDED.last_seen, raw_payload=EXCLUDED.raw_payload`,
      base.concat([
        asIso(record.occurred_at), str(p.agentVersion, 160), str(p.androidVersion, 40),
        str(p.model, 120), str(p.manufacturer, 120), number(p.batteryLevel ?? p.battery),
        str(p.status, 80), str(p.connectionMethod, 120), str(p.heartbeatAuth, 120),
        str(p.sourceType, 120), bool(p.runtimeIsAndroid), bool(p.liveDeviceVerified),
        dateFrom(p, ['lastSeen'], record.occurred_at), JSON.stringify(p),
      ])
    );
    return;
  }

  if (table === 's24_calls') {
    await query(
      `INSERT INTO s24_calls
         (source_dataset, record_id, run_id, device_id, called_at, contact_name,
          phone_number, call_type, duration_sec, backed_up_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (source_dataset, record_id) DO UPDATE SET
         run_id=EXCLUDED.run_id, called_at=COALESCE(EXCLUDED.called_at,s24_calls.called_at),
         contact_name=COALESCE(EXCLUDED.contact_name,s24_calls.contact_name),
         phone_number=COALESCE(EXCLUDED.phone_number,s24_calls.phone_number),
         call_type=COALESCE(EXCLUDED.call_type,s24_calls.call_type),
         duration_sec=COALESCE(EXCLUDED.duration_sec,s24_calls.duration_sec),
         backed_up_at=COALESCE(EXCLUDED.backed_up_at,s24_calls.backed_up_at),
         raw_payload=EXCLUDED.raw_payload, last_seen=now()`,
      [str(record.dataset, 80), str(record.record_id, 400), ...base,
       dateFrom(p, ['date', 'timestamp'], record.occurred_at), str(p.name, 400),
       str(p.number ?? p.address, 200), str(p.type, 80), number(p.duration_seconds ?? p.duration, true),
       dateFrom(p, ['backed_up_at']), JSON.stringify(p)]
    );
    return;
  }

  if (table === 's24_sms') {
    await query(
      `INSERT INTO s24_sms
         (source_dataset, record_id, run_id, device_id, sent_at, correspondent,
          message_type, body, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (source_dataset, record_id) DO UPDATE SET
         run_id=EXCLUDED.run_id, sent_at=COALESCE(EXCLUDED.sent_at,s24_sms.sent_at),
         correspondent=COALESCE(EXCLUDED.correspondent,s24_sms.correspondent),
         message_type=COALESCE(EXCLUDED.message_type,s24_sms.message_type),
         body=COALESCE(EXCLUDED.body,s24_sms.body), raw_payload=EXCLUDED.raw_payload,
         last_seen=now()`,
      [str(record.dataset, 80), str(record.record_id, 400), ...base,
       dateFrom(p, ['date', 'timestamp'], record.occurred_at),
       str(p.sender ?? p.address ?? p.number, 200), str(p.type ?? p.message_type, 80),
       str(p.body ?? p.text ?? p.message, 100000), JSON.stringify(p)]
    );
    return;
  }

  if (table === 's24_locations') {
    await query(
      `INSERT INTO s24_locations
         (source_dataset, record_id, run_id, device_id, observed_at, latitude,
          longitude, accuracy_m, provider, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (source_dataset, record_id) DO UPDATE SET
         run_id=EXCLUDED.run_id, observed_at=COALESCE(EXCLUDED.observed_at,s24_locations.observed_at),
         latitude=COALESCE(EXCLUDED.latitude,s24_locations.latitude),
         longitude=COALESCE(EXCLUDED.longitude,s24_locations.longitude),
         accuracy_m=COALESCE(EXCLUDED.accuracy_m,s24_locations.accuracy_m),
         provider=COALESCE(EXCLUDED.provider,s24_locations.provider),
         raw_payload=EXCLUDED.raw_payload, last_seen=now()`,
      [str(record.dataset, 80), str(record.record_id, 400), ...base,
       dateFrom(p, ['timestamp', 'time'], record.occurred_at), number(p.latitude ?? p.lat),
       number(p.longitude ?? p.lng ?? p.lon), number(p.accuracy), str(p.provider, 100), JSON.stringify(p)]
    );
    return;
  }

  if (table === 's24_agents') {
    await query(
      `INSERT INTO s24_agents
         (record_id, run_id, device_id, agent_name, status, model, api_enabled,
          bridged, port, registered_at, activated_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (record_id) DO UPDATE SET
         run_id=EXCLUDED.run_id, agent_name=EXCLUDED.agent_name, status=EXCLUDED.status,
         model=EXCLUDED.model, api_enabled=EXCLUDED.api_enabled, bridged=EXCLUDED.bridged,
         port=EXCLUDED.port, registered_at=EXCLUDED.registered_at,
         activated_at=EXCLUDED.activated_at, raw_payload=EXCLUDED.raw_payload, last_seen=now()`,
      [str(record.record_id, 400), ...base, str(p.agent_name, 300), str(p.status, 80),
       str(p.api_model, 160), bool(p.api_enabled), bool(p.bridged), number(p.port, true),
       dateFrom(p, ['registered_at']), dateFrom(p, ['activated_at']), JSON.stringify(p)]
    );
    return;
  }

  if (table === 's24_commands') {
    await query(
      `INSERT INTO s24_commands
         (source_dataset, record_id, run_id, device_id, action, command_type,
          status, priority, requested_at, resolved_at, requested_by, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (source_dataset, record_id) DO UPDATE SET
         run_id=EXCLUDED.run_id, action=EXCLUDED.action, command_type=EXCLUDED.command_type,
         status=EXCLUDED.status, priority=EXCLUDED.priority,
         requested_at=COALESCE(EXCLUDED.requested_at,s24_commands.requested_at),
         resolved_at=COALESCE(EXCLUDED.resolved_at,s24_commands.resolved_at),
         requested_by=COALESCE(EXCLUDED.requested_by,s24_commands.requested_by),
         raw_payload=EXCLUDED.raw_payload, last_seen=now()`,
      [str(record.dataset, 80), str(record.record_id, 400), ...base,
       str(p.action ?? p.command ?? p.cmd, 500), str(p.type, 100), str(p.status, 80),
       str(p.priority, 80), dateFrom(p, ['requestedAt', 'createdAt'], record.occurred_at),
       dateFrom(p, ['resolvedAt', 'cancelledAt']), str(p.requestedBy, 300), JSON.stringify(p)]
    );
    return;
  }

  if (table === 's24_files') {
    await query(
      `INSERT INTO s24_files
         (record_id, run_id, device_id, filename, file_type, status, size_bytes,
          created_at, uploaded_at, content, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (record_id) DO UPDATE SET
         run_id=EXCLUDED.run_id, filename=EXCLUDED.filename, file_type=EXCLUDED.file_type,
         status=EXCLUDED.status, size_bytes=EXCLUDED.size_bytes,
         created_at=COALESCE(EXCLUDED.created_at,s24_files.created_at),
         uploaded_at=COALESCE(EXCLUDED.uploaded_at,s24_files.uploaded_at),
         content=EXCLUDED.content, raw_payload=EXCLUDED.raw_payload, last_seen=now()`,
      [str(record.record_id, 400), ...base, str(p.filename, 1000), str(p.type, 120),
       str(p.status, 80), number(p.size, true), dateFrom(p, ['created_at']),
       dateFrom(p, ['uploaded_at']), str(p.content, 1000000), JSON.stringify(p)]
    );
    return;
  }

  await query(
    `INSERT INTO s24_queue_items
       (record_id, run_id, device_id, action, item_type, status, priority,
        description, created_at, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (record_id) DO UPDATE SET
       run_id=EXCLUDED.run_id, action=EXCLUDED.action, item_type=EXCLUDED.item_type,
       status=EXCLUDED.status, priority=EXCLUDED.priority,
       description=EXCLUDED.description,
       created_at=COALESCE(EXCLUDED.created_at,s24_queue_items.created_at),
       raw_payload=EXCLUDED.raw_payload, last_seen=now()`,
    [str(record.record_id, 400), ...base, str(p.command ?? p.action, 500),
     str(p.type, 100), str(p.status, 80), str(p.priority, 80), str(p.description, 2000),
     dateFrom(p, ['created_at'], record.occurred_at), JSON.stringify(p)]
  );
}

/**
 * Validate a batch without touching the database.
 * Returns { ok: true, batch } or { ok: false, error, detail }.
 */
export function validateBatch(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };

  const run = body.run;
  if (!run || typeof run !== 'object') return { ok: false, error: 'run header is required' };
  if (!run.run_id) return { ok: false, error: 'run.run_id is required' };
  if (run.device_id !== S24_DEVICE_ID) return { ok: false, error: `run.device_id must be ${S24_DEVICE_ID}` };
  if (!asIso(run.started_at)) return { ok: false, error: 'run.started_at must be a timestamp' };
  if (String(run.run_id).length > 200) return { ok: false, error: 'run.run_id is too long' };

  const upload = body.upload == null ? { batch_index: 1, batch_count: 1 } : body.upload;
  if (!upload || !Number.isInteger(upload.batch_index) || !Number.isInteger(upload.batch_count) ||
      upload.batch_index < 1 || upload.batch_count < 1 || upload.batch_index > upload.batch_count) {
    return { ok: false, error: 'upload needs valid batch_index and batch_count' };
  }

  const datasets = Array.isArray(body.datasets) ? body.datasets : [];
  if (!datasets.length) return { ok: false, error: 'at least one dataset status is required' };
  const datasetNames = new Set();
  for (const [i, d] of datasets.entries()) {
    if (!d || !d.dataset) return { ok: false, error: `datasets[${i}].dataset is required` };
    if (String(d.dataset).length > 80) return { ok: false, error: `datasets[${i}].dataset is too long` };
    if (datasetNames.has(d.dataset)) return { ok: false, error: `duplicate dataset status: ${d.dataset}` };
    datasetNames.add(d.dataset);
    if (!DATASET_STATUSES.has(d.status)) {
      return { ok: false, error: `datasets[${i}].status must be one of ${[...DATASET_STATUSES].join(', ')}` };
    }
    if (d.record_count != null && (!Number.isInteger(d.record_count) || d.record_count < 0)) {
      return { ok: false, error: `datasets[${i}].record_count must be a non-negative integer` };
    }
  }

  const records = Array.isArray(body.records) ? body.records : [];
  if (records.length > MAX_RECORDS_PER_BATCH) {
    return { ok: false, error: `batch too large: ${records.length} > ${MAX_RECORDS_PER_BATCH}` };
  }
  const bad = [];
  for (const [i, r] of records.entries()) {
    if (!r || !r.dataset || r.record_id == null) bad.push(i);
    else if (String(r.dataset).length > 80 || String(r.record_id).length > 400) bad.push(i);
  }
  if (bad.length) {
    return { ok: false, error: 'records need dataset and record_id', detail: bad.slice(0, 20) };
  }

  // A record naming a dataset with no status row would be invisible on the
  // coverage page, which is the one thing this shape exists to prevent.
  const undeclared = [...new Set(records.map((r) => r.dataset))].filter((d) => !datasetNames.has(d));
  if (undeclared.length) {
    return { ok: false, error: 'records reference datasets with no status row', detail: undeclared };
  }
  const invalidPayloads = records
    .map((r, i) => (!r.payload || typeof r.payload !== 'object' || Array.isArray(r.payload)) ? i : null)
    .filter((i) => i != null);
  if (invalidPayloads.length) {
    return { ok: false, error: 'records need an object payload', detail: invalidPayloads.slice(0, 20) };
  }

  return { ok: true, batch: { run, datasets, records, upload } };
}

export async function ingestBatch(query, batch, meta = {}) {
  const { run, datasets, records, upload } = batch;

  await query(
    `INSERT INTO s24_sync_runs (run_id, device_id, started_at, finished_at, key_id,
                                host, adb_serial, android_version, model, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (run_id) DO UPDATE SET
       finished_at = COALESCE(EXCLUDED.finished_at, s24_sync_runs.finished_at),
       notes       = COALESCE(EXCLUDED.notes, s24_sync_runs.notes)`,
    [
      str(run.run_id, 200), str(run.device_id, 120), asIso(run.started_at), asIso(run.finished_at),
      str(meta.keyId, 64) || 'unknown', str(run.host, 200), str(run.adb_serial, 120),
      str(run.android_version, 40), str(run.model, 120), str(run.notes, 2000),
    ]
  );

  await query(
    `INSERT INTO s24_sync_batches (run_id, batch_index, batch_count, record_count)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (run_id, batch_index) DO UPDATE SET
       batch_count = EXCLUDED.batch_count,
       record_count = EXCLUDED.record_count,
       received_at = now()`,
    [str(run.run_id, 200), upload.batch_index, upload.batch_count, records.length]
  );

  for (const d of datasets) {
    await query(
      `INSERT INTO s24_sync_datasets (run_id, dataset, status, record_count, source, detail, collected_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (run_id, dataset) DO UPDATE SET
         status       = EXCLUDED.status,
          -- record_count is the total in the local manifest, not this HTTP
          -- chunk's size. Replacing it keeps retries and chunked uploads
          -- idempotent instead of inflating the coverage ledger.
          record_count = EXCLUDED.record_count,
         source       = COALESCE(EXCLUDED.source, s24_sync_datasets.source),
         detail       = COALESCE(EXCLUDED.detail, s24_sync_datasets.detail),
         collected_at = COALESCE(EXCLUDED.collected_at, s24_sync_datasets.collected_at)`,
      [
        str(run.run_id, 200), str(d.dataset, 80), d.status,
        Number.isFinite(d.record_count) ? d.record_count : 0,
        str(d.source, 400), str(d.detail, 2000), asIso(d.collected_at) || asIso(run.started_at),
      ]
    );
  }

  let written = 0;
  for (const r of records) {
    await query(
      `INSERT INTO s24_records (device_id, dataset, record_id, run_id, occurred_at, label, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (device_id, dataset, record_id) DO UPDATE SET
         run_id      = EXCLUDED.run_id,
         occurred_at = COALESCE(EXCLUDED.occurred_at, s24_records.occurred_at),
         label       = COALESCE(EXCLUDED.label, s24_records.label),
         payload     = EXCLUDED.payload,
         last_seen   = now()`,
      [
        str(run.device_id, 120), str(r.dataset, 80), str(r.record_id, 400), str(run.run_id, 200),
        asIso(r.occurred_at), str(r.label, 400), JSON.stringify(r.payload ?? r),
      ]
    );
    await writeSpecialized(query, run, r);
    written++;
  }

  await query(
    `UPDATE s24_sync_runs r
        SET record_count = COALESCE((
              SELECT SUM(record_count)::int FROM s24_sync_datasets WHERE run_id = $1
            ), 0),
            uploaded_records = COALESCE((
              SELECT SUM(record_count)::int FROM s24_sync_batches WHERE run_id = $1
            ), 0),
            upload_status = CASE
              WHEN (SELECT COUNT(*) FROM s24_sync_batches WHERE run_id = $1) =
                   (SELECT MAX(batch_count) FROM s24_sync_batches WHERE run_id = $1)
               AND COALESCE((SELECT SUM(record_count) FROM s24_sync_batches WHERE run_id = $1), 0) >=
                   COALESCE((SELECT SUM(record_count) FROM s24_sync_datasets WHERE run_id = $1), 0)
              THEN 'complete' ELSE 'uploading' END
      WHERE r.run_id = $1`,
    [str(run.run_id, 200)]
  );

  return { runId: run.run_id, batchIndex: upload.batch_index, batchCount: upload.batch_count, datasets: datasets.length, records: written };
}
