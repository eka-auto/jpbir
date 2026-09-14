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
