-- Additive, typed projections of the canonical s24_records JSON archive.
-- s24_records remains the lossless source for every current and future dataset;
-- these tables make the known phone datasets queryable and easy to present.

CREATE TABLE IF NOT EXISTS s24_device_snapshots (
  run_id               TEXT PRIMARY KEY REFERENCES s24_sync_runs(run_id) ON DELETE CASCADE,
  device_id            TEXT NOT NULL,
  observed_at          TIMESTAMPTZ,
  agent_version        TEXT,
  android_version      TEXT,
  model                TEXT,
  manufacturer         TEXT,
  battery_level        NUMERIC,
  status               TEXT,
  connection_method    TEXT,
  heartbeat_auth       TEXT,
  source_type          TEXT,
  runtime_is_android   BOOLEAN,
  live_device_verified BOOLEAN,
  last_seen            TIMESTAMPTZ,
  raw_payload          JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS s24_device_snapshots_observed_idx ON s24_device_snapshots (observed_at DESC);

CREATE TABLE IF NOT EXISTS s24_calls (
  source_dataset TEXT NOT NULL,
  record_id      TEXT NOT NULL,
  run_id         TEXT NOT NULL REFERENCES s24_sync_runs(run_id) ON DELETE CASCADE,
  device_id      TEXT NOT NULL,
  called_at      TIMESTAMPTZ,
  contact_name   TEXT,
  phone_number   TEXT,
  call_type      TEXT,
  duration_sec   INTEGER,
  backed_up_at   TIMESTAMPTZ,
  raw_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_dataset, record_id)
);
CREATE INDEX IF NOT EXISTS s24_calls_called_idx ON s24_calls (called_at DESC);
CREATE INDEX IF NOT EXISTS s24_calls_number_idx ON s24_calls (phone_number);

CREATE TABLE IF NOT EXISTS s24_sms (
  source_dataset TEXT NOT NULL,
  record_id      TEXT NOT NULL,
  run_id         TEXT NOT NULL REFERENCES s24_sync_runs(run_id) ON DELETE CASCADE,
  device_id      TEXT NOT NULL,
  sent_at        TIMESTAMPTZ,
  correspondent  TEXT,
  message_type   TEXT,
  body           TEXT,
  raw_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_dataset, record_id)
);
CREATE INDEX IF NOT EXISTS s24_sms_sent_idx ON s24_sms (sent_at DESC);
CREATE INDEX IF NOT EXISTS s24_sms_correspondent_idx ON s24_sms (correspondent);

CREATE TABLE IF NOT EXISTS s24_locations (
  source_dataset TEXT NOT NULL,
  record_id      TEXT NOT NULL,
  run_id         TEXT NOT NULL REFERENCES s24_sync_runs(run_id) ON DELETE CASCADE,
  device_id      TEXT NOT NULL,
  observed_at    TIMESTAMPTZ,
  latitude       DOUBLE PRECISION,
  longitude      DOUBLE PRECISION,
  accuracy_m     DOUBLE PRECISION,
  provider       TEXT,
  raw_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_dataset, record_id)
);
CREATE INDEX IF NOT EXISTS s24_locations_observed_idx ON s24_locations (observed_at DESC);

CREATE TABLE IF NOT EXISTS s24_agents (
  record_id      TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES s24_sync_runs(run_id) ON DELETE CASCADE,
  device_id      TEXT NOT NULL,
  agent_name     TEXT,
  status         TEXT,
  model          TEXT,
  api_enabled    BOOLEAN,
  bridged        BOOLEAN,
  port           INTEGER,
  registered_at  TIMESTAMPTZ,
  activated_at   TIMESTAMPTZ,
  raw_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS s24_agents_status_idx ON s24_agents (status);

CREATE TABLE IF NOT EXISTS s24_commands (
  source_dataset TEXT NOT NULL,
  record_id      TEXT NOT NULL,
  run_id         TEXT NOT NULL REFERENCES s24_sync_runs(run_id) ON DELETE CASCADE,
  device_id      TEXT NOT NULL,
  action         TEXT,
  command_type   TEXT,
  status         TEXT,
  priority       TEXT,
  requested_at   TIMESTAMPTZ,
  resolved_at    TIMESTAMPTZ,
  requested_by   TEXT,
  raw_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_dataset, record_id)
);
CREATE INDEX IF NOT EXISTS s24_commands_requested_idx ON s24_commands (requested_at DESC);
CREATE INDEX IF NOT EXISTS s24_commands_status_idx ON s24_commands (status);

CREATE TABLE IF NOT EXISTS s24_files (
  record_id      TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES s24_sync_runs(run_id) ON DELETE CASCADE,
  device_id      TEXT NOT NULL,
  filename       TEXT,
  file_type      TEXT,
  status         TEXT,
  size_bytes     BIGINT,
  created_at     TIMESTAMPTZ,
  uploaded_at    TIMESTAMPTZ,
  content        TEXT,
  raw_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS s24_files_uploaded_idx ON s24_files (uploaded_at DESC);

CREATE TABLE IF NOT EXISTS s24_queue_items (
  record_id      TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES s24_sync_runs(run_id) ON DELETE CASCADE,
  device_id      TEXT NOT NULL,
  action         TEXT,
  item_type      TEXT,
  status         TEXT,
  priority       TEXT,
  description    TEXT,
  created_at     TIMESTAMPTZ,
  raw_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS s24_queue_status_idx ON s24_queue_items (status, created_at DESC);

-- Backfill every typed table from the existing lossless archive. Casts are
-- guarded so one malformed historical value cannot abort the migration.
INSERT INTO s24_device_snapshots (
  run_id, device_id, observed_at, agent_version, android_version, model,
  manufacturer, battery_level, status, connection_method, heartbeat_auth,
  source_type, runtime_is_android, live_device_verified, last_seen, raw_payload
)
SELECT run_id, device_id, occurred_at, payload->>'agentVersion', payload->>'androidVersion',
       payload->>'model', payload->>'manufacturer',
       CASE WHEN payload->>'batteryLevel' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (payload->>'batteryLevel')::numeric END,
       payload->>'status', payload->>'connectionMethod', payload->>'heartbeatAuth',
       payload->>'sourceType', CASE WHEN payload->>'runtimeIsAndroid' IN ('true','false') THEN (payload->>'runtimeIsAndroid')::boolean END,
       CASE WHEN payload->>'liveDeviceVerified' IN ('true','false') THEN (payload->>'liveDeviceVerified')::boolean END,
       occurred_at, payload
  FROM s24_records WHERE dataset = 'device_document'
ON CONFLICT (run_id) DO NOTHING;

INSERT INTO s24_calls (
  source_dataset, record_id, run_id, device_id, called_at, contact_name,
  phone_number, call_type, duration_sec, backed_up_at, raw_payload, first_seen, last_seen
)
SELECT dataset, record_id, run_id, device_id, occurred_at, payload->>'name',
       COALESCE(payload->>'number', payload->>'address'), payload->>'type',
       CASE WHEN payload->>'duration' ~ '^\d+$' THEN LEAST((payload->>'duration')::bigint, 2147483647)::int END,
       CASE WHEN payload->>'backed_up_at' ~ '^\d{4}-\d{2}-\d{2}T' THEN (payload->>'backed_up_at')::timestamptz END,
       payload, first_seen, last_seen
  FROM s24_records WHERE dataset IN ('direct_call_logs', 'firestore_callLogs')
ON CONFLICT (source_dataset, record_id) DO NOTHING;

INSERT INTO s24_sms (
  source_dataset, record_id, run_id, device_id, sent_at, correspondent,
  message_type, body, raw_payload, first_seen, last_seen
)
SELECT dataset, record_id, run_id, device_id, occurred_at,
       COALESCE(payload->>'sender', payload->>'address', payload->>'number'),
       COALESCE(payload->>'type', payload->>'message_type'),
       COALESCE(payload->>'body', payload->>'text', payload->>'message'),
       payload, first_seen, last_seen
  FROM s24_records WHERE dataset IN ('direct_sms', 'firestore_sms')
ON CONFLICT (source_dataset, record_id) DO NOTHING;

INSERT INTO s24_locations (
  source_dataset, record_id, run_id, device_id, observed_at, latitude,
  longitude, accuracy_m, provider, raw_payload, first_seen, last_seen
)
SELECT dataset, record_id, run_id, device_id, occurred_at,
       CASE WHEN COALESCE(payload->>'latitude', payload->>'lat') ~ '^-?[0-9]+(\.[0-9]+)?$'
            THEN COALESCE(payload->>'latitude', payload->>'lat')::double precision END,
       CASE WHEN COALESCE(payload->>'longitude', payload->>'lng', payload->>'lon') ~ '^-?[0-9]+(\.[0-9]+)?$'
            THEN COALESCE(payload->>'longitude', payload->>'lng', payload->>'lon')::double precision END,
       CASE WHEN payload->>'accuracy' ~ '^[0-9]+(\.[0-9]+)?$' THEN (payload->>'accuracy')::double precision END,
       payload->>'provider', payload, first_seen, last_seen
  FROM s24_records WHERE dataset = 'direct_location'
ON CONFLICT (source_dataset, record_id) DO NOTHING;

INSERT INTO s24_agents (
  record_id, run_id, device_id, agent_name, status, model, api_enabled,
  bridged, port, registered_at, activated_at, raw_payload, last_seen
)
SELECT record_id, run_id, device_id, payload->>'agent_name', payload->>'status', payload->>'api_model',
       CASE WHEN payload->>'api_enabled' IN ('true','false') THEN (payload->>'api_enabled')::boolean END,
       CASE WHEN payload->>'bridged' IN ('true','false') THEN (payload->>'bridged')::boolean END,
       CASE WHEN payload->>'port' ~ '^\d+$' THEN (payload->>'port')::int END,
       CASE WHEN payload->>'registered_at' ~ '^\d{4}-\d{2}-\d{2}T' THEN (payload->>'registered_at')::timestamptz END,
       CASE WHEN payload->>'activated_at' ~ '^\d{4}-\d{2}-\d{2}T' THEN (payload->>'activated_at')::timestamptz END,
       payload, last_seen
  FROM s24_records WHERE dataset = 'firestore_agents'
ON CONFLICT (record_id) DO NOTHING;

INSERT INTO s24_commands (
  source_dataset, record_id, run_id, device_id, action, command_type,
  status, priority, requested_at, resolved_at, requested_by, raw_payload,
  first_seen, last_seen
)
SELECT dataset, record_id, run_id, device_id,
       COALESCE(payload->>'action', payload->>'command', payload->>'cmd'), payload->>'type',
       payload->>'status', payload->>'priority',
       CASE WHEN COALESCE(payload->>'requestedAt', payload->>'createdAt') ~ '^\d{4}-\d{2}-\d{2}T'
            THEN COALESCE(payload->>'requestedAt', payload->>'createdAt')::timestamptz ELSE occurred_at END,
       CASE WHEN COALESCE(payload->>'resolvedAt', payload->>'cancelledAt') ~ '^\d{4}-\d{2}-\d{2}T'
            THEN COALESCE(payload->>'resolvedAt', payload->>'cancelledAt')::timestamptz END,
       payload->>'requestedBy', payload, first_seen, last_seen
  FROM s24_records WHERE dataset = 'firestore_commands'
ON CONFLICT (source_dataset, record_id) DO NOTHING;

INSERT INTO s24_files (
  record_id, run_id, device_id, filename, file_type, status, size_bytes,
  created_at, uploaded_at, content, raw_payload, last_seen
)
SELECT record_id, run_id, device_id, payload->>'filename', payload->>'type', payload->>'status',
       CASE WHEN payload->>'size' ~ '^\d+$' THEN (payload->>'size')::bigint END,
       CASE WHEN payload->>'created_at' ~ '^\d{4}-\d{2}-\d{2}T' THEN (payload->>'created_at')::timestamptz END,
       CASE WHEN payload->>'uploaded_at' ~ '^\d{4}-\d{2}-\d{2}T' THEN (payload->>'uploaded_at')::timestamptz END,
       payload->>'content', payload, last_seen
  FROM s24_records WHERE dataset = 'firestore_files'
ON CONFLICT (record_id) DO NOTHING;

INSERT INTO s24_queue_items (
  record_id, run_id, device_id, action, item_type, status, priority,
  description, created_at, raw_payload, last_seen
)
SELECT record_id, run_id, device_id, payload->>'command', payload->>'type',
       payload->>'status', payload->>'priority', payload->>'description',
       CASE WHEN payload->>'created_at' ~ '^\d{4}-\d{2}-\d{2}T' THEN (payload->>'created_at')::timestamptz END,
       payload, last_seen
  FROM s24_records WHERE dataset = 'firestore_queue'
ON CONFLICT (record_id) DO NOTHING;
