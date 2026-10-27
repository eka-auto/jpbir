-- Console coverage: durable records for the console sections that had no home.
--
-- The operator console at jaytipargal.tech reads several stores: the Neon
-- warehouse (analytics, email opens, WhatsApp), Firestore (the device fleet and
-- its live state), Blob (media) and Vercel (deployments). Three of the
-- console's sections had no durable record in the database at all - the live
-- feed, provider snapshots, and agent conversations/runs - and engineering
-- evidence existed only as signed documents in CI. Telegram had been dropped
-- from the warehouse (migration 013) and its panel has been mirroring
-- WhatsApp ever since.
--
-- These tables hold REAL records only. A row exists because a source produced
-- it, and every row carries a human-readable summary plus a reference to the
-- authoritative record (a Firestore document path, a Blob object path, a CI
-- receipt id). A section with no rows renders as empty or unavailable: never a
-- placeholder row, never a raw JSON dump of something else.
--
-- Firestore and Blob remain authoritative. These tables are the database-side
-- record of what those stores contained, plus the references needed to fetch
-- the original - not a replacement for them.
--
-- Idempotent: running it twice changes nothing the second time.

CREATE TABLE IF NOT EXISTS live_feed_records (
  id                TEXT PRIMARY KEY,
  feed              TEXT NOT NULL,
  kind              TEXT NOT NULL,
  title             TEXT,
  summary           TEXT,
  source_ref        TEXT,
  media_kind        TEXT,
  media_ref         TEXT,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_updated_at TIMESTAMPTZ,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_feed_records_feed_time
  ON live_feed_records (feed, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS live_feed_records_source_ref
  ON live_feed_records (feed, source_ref);

CREATE TABLE IF NOT EXISTS provider_snapshots (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('ok', 'degraded', 'unavailable')),
  summary     TEXT,
  source_ref  TEXT,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_snapshots_provider_time
  ON provider_snapshots (provider, captured_at DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
  id            TEXT PRIMARY KEY,
  agent         TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  title         TEXT,
  input_summary TEXT,
  output_text   TEXT,
  error_text    TEXT,
  refs          JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  duration_ms   INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_agent_time
  ON agent_runs (agent, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content_text TEXT NOT NULL,
  media_kind   TEXT,
  media_ref    TEXT,
  refs         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);
CREATE INDEX IF NOT EXISTS agent_messages_run_seq
  ON agent_messages (run_id, seq);

CREATE TABLE IF NOT EXISTS engineering_evidence (
  id           TEXT PRIMARY KEY,
  check_name   TEXT NOT NULL,
  subject      TEXT,
  verdict      TEXT NOT NULL CHECK (verdict IN ('pass', 'fail', 'unproven', 'skip')),
  summary      TEXT,
  evidence_ref TEXT,
  revision     TEXT,
  produced_by  TEXT,
  produced_at  TIMESTAMPTZ,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS engineering_evidence_check_time
  ON engineering_evidence (check_name, produced_at DESC);

CREATE TABLE IF NOT EXISTS telegram_chats (
  id                TEXT PRIMARY KEY,
  source_ref        TEXT,
  title             TEXT,
  participant_count INTEGER,
  last_message_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_messages (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES telegram_chats (id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  direction  TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  sender     TEXT,
  text       TEXT,
  media_kind TEXT,
  media_ref  TEXT,
  sent_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chat_id, seq)
);
CREATE INDEX IF NOT EXISTS telegram_messages_chat_seq
  ON telegram_messages (chat_id, seq);