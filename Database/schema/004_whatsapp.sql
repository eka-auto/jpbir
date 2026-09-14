-- WhatsApp inventory behind the dashboard's WhatsApp section.
--
-- A JSON of 862 real contact names has no place in git, so nothing about a
-- contact enters this repository. Database/scripts/wa-build-inventory.mjs
-- turns a recovery dump into an inventory file on the owner's machine,
-- Database/scripts/wa-import.mjs loads it straight into Neon, and
-- /api/wa-galaxy serves it to the dashboard behind the same STATS_KEY as
-- every other analytics endpoint.
--
-- Numbered 004 because this database is shared with jaytibirthday-site, which
-- has already applied 001_init, 002_enrich_events and 003_fix_city_decode.
-- The runner keys on filename, so the two projects' migrations interleave
-- safely as long as the numbers keep advancing.
--
-- wa_chats is the unit the section renders. wa_messages is optional detail the
-- same import accepts when an export carries it, so the per-chat counts can be
-- re-derived and the page can grow message-level views without another
-- migration. wa_sync_runs records each push so a partial sync is visible.

CREATE TABLE IF NOT EXISTS wa_sync_runs (
  run_id          TEXT        PRIMARY KEY,
  device_id       TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  chats_seen      INTEGER     NOT NULL DEFAULT 0,
  messages_seen   INTEGER     NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'running',   -- running | done
  note            TEXT
);

CREATE TABLE IF NOT EXISTS wa_chats (
  -- the export's own id (jid) when it has one, else a hash of kind + name
  chat_id         TEXT        PRIMARY KEY,
  name            TEXT        NOT NULL,
  kind            TEXT        NOT NULL CHECK (kind IN ('group', 'direct')),
  unresolved      BOOLEAN     NOT NULL DEFAULT false,   -- a number with no saved contact
  msg_count       INTEGER     NOT NULL DEFAULT 0,
  enc_count       INTEGER     NOT NULL DEFAULT 0,       -- bodies still sealed, metadata only
  media_count     INTEGER     NOT NULL DEFAULT 0,
  audio_count     INTEGER     NOT NULL DEFAULT 0,
  call_count      INTEGER     NOT NULL DEFAULT 0,
  member_count    INTEGER,
  first_at        DATE,
  last_at         DATE,
  device_id       TEXT,
  run_id          TEXT,
  source_system   TEXT        NOT NULL,
  raw             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_chats_kind_idx ON wa_chats (kind, msg_count DESC);
CREATE INDEX IF NOT EXISTS wa_chats_last_idx ON wa_chats (last_at DESC);

CREATE TABLE IF NOT EXISTS wa_messages (
  msg_id          TEXT        PRIMARY KEY,   -- <chat_id>:<message key>
  chat_id         TEXT        NOT NULL REFERENCES wa_chats (chat_id) ON DELETE CASCADE,
  sent_at         TIMESTAMPTZ,
  from_me         BOOLEAN,
  sender          TEXT,
  kind            TEXT        NOT NULL DEFAULT 'text',  -- text | media | audio | call | system | other
  encrypted       BOOLEAN     NOT NULL DEFAULT false,   -- body not recovered
  body            TEXT,
  device_id       TEXT,
  run_id          TEXT,
  source_system   TEXT        NOT NULL,
  raw             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_messages_chat_idx ON wa_messages (chat_id, sent_at DESC);
