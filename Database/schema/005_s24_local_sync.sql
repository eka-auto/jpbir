-- Local-first S24 sync: phone -> this laptop -> Vercel -> Neon.
--
-- The phone is pulled over ADB by a process on the laptop, written to JSON on
-- disk, and only then uploaded. Nothing on the phone talks to the cloud, and
-- nothing writes here except a signed upload that survived signature checking.
--
-- Shape, and why it is this and not a table per dataset:
--
-- What a phone will hand over changes with the Android version, the granted
-- permissions, and whether a given provider is readable at all. A table per
-- dataset means every one of those changes is a migration, and the usual
-- failure is that a dataset silently stops arriving and no one notices because
-- there is no row and no error either. So records land in one JSONB table
-- keyed by dataset, and every run writes a status ledger saying what it tried,
-- what it got, and why anything is missing. A gap is then a visible row with a
-- reason, not an absence.

CREATE TABLE IF NOT EXISTS s24_sync_runs (
  run_id          TEXT        PRIMARY KEY,
  device_id       TEXT        NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ,
  -- Proof-of-origin, carried through from the signed upload.
  key_id          TEXT        NOT NULL,
  host            TEXT,
  adb_serial      TEXT,
  android_version TEXT,
  model           TEXT,
  -- Set by the ingest endpoint, never by the client.
  record_count    INTEGER     NOT NULL DEFAULT 0,
  uploaded_records INTEGER    NOT NULL DEFAULT 0,
  upload_status   TEXT        NOT NULL DEFAULT 'uploading'
                              CHECK (upload_status IN ('uploading', 'complete')),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS s24_sync_runs_started_idx ON s24_sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS s24_sync_runs_device_idx ON s24_sync_runs (device_id, started_at DESC);

-- One row per dataset per run, ALWAYS written — including for datasets that
-- returned nothing. status tells the difference between "the phone has no SMS"
-- and "the SMS provider refused us", which a bare row count cannot.
CREATE TABLE IF NOT EXISTS s24_sync_datasets (
  run_id       TEXT        NOT NULL REFERENCES s24_sync_runs(run_id) ON DELETE CASCADE,
  dataset      TEXT        NOT NULL,
  status       TEXT        NOT NULL CHECK (status IN ('ok', 'empty', 'unavailable', 'denied', 'error')),
  record_count INTEGER     NOT NULL DEFAULT 0,
  source       TEXT,                   -- the adb command or provider it came from
  detail       TEXT,                   -- the error, when there is one
  collected_at TIMESTAMPTZ,
  PRIMARY KEY (run_id, dataset)
);
CREATE INDEX IF NOT EXISTS s24_sync_datasets_dataset_idx ON s24_sync_datasets (dataset, collected_at DESC);

-- The records themselves. record_id is whatever the phone calls the row (a
-- call_log _id, a package name, a contact id); it only has to be stable within
-- its dataset, which is what makes re-running a pull idempotent.
CREATE TABLE IF NOT EXISTS s24_records (
  device_id   TEXT        NOT NULL,
  dataset     TEXT        NOT NULL,
  record_id   TEXT        NOT NULL,
  run_id      TEXT        NOT NULL REFERENCES s24_sync_runs(run_id) ON DELETE CASCADE,
  -- Pulled out of the payload so the common questions do not need a JSONB scan.
  occurred_at TIMESTAMPTZ,
  label       TEXT,
  payload     JSONB       NOT NULL,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, dataset, record_id)
);
CREATE INDEX IF NOT EXISTS s24_records_dataset_idx  ON s24_records (device_id, dataset, occurred_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS s24_records_run_idx      ON s24_records (run_id);
CREATE INDEX IF NOT EXISTS s24_records_payload_idx  ON s24_records USING gin (payload);

-- A run may span several Vercel requests. This ledger distinguishes a complete
-- upload from one that stopped after its first successful chunk.
CREATE TABLE IF NOT EXISTS s24_sync_batches (
  run_id       TEXT        NOT NULL REFERENCES s24_sync_runs(run_id) ON DELETE CASCADE,
  batch_index  INTEGER     NOT NULL CHECK (batch_index > 0),
  batch_count  INTEGER     NOT NULL CHECK (batch_count > 0 AND batch_index <= batch_count),
  record_count INTEGER     NOT NULL CHECK (record_count >= 0),
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, batch_index)
);

-- Replay guard. The signature proves who sent a body; it does not stop the
-- same body being sent twice. request_id is single-use, and old rows are
-- pruned by the endpoint rather than kept forever.
CREATE TABLE IF NOT EXISTS s24_ingest_seen (
  request_id TEXT        PRIMARY KEY,
  key_id     TEXT        NOT NULL,
  body_sha256 TEXT       NOT NULL,
  seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS s24_ingest_seen_at_idx ON s24_ingest_seen (seen_at);
