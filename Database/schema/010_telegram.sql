-- Telegram inventory behind the dashboard's Telegram section.
--
-- The Telegram panel is the same client as the WhatsApp panel, pointed at
-- these tables. Nothing is imported yet: there is no Telegram app data on
-- the box and no capture path, so the tables start empty and the panel says
-- so explicitly rather than showing a plausible-looking zero.
--
-- The schema is created now so the read path is real and the ingest path has
-- somewhere to land when a capture lands. Applying it is not the same as
-- having data: /api/jp-telegram reports migrated:true with zero chats, and
-- the dashboard renders that as "no Telegram data captured yet".
--
-- Numbered 010 because this database is shared with jaytibirthday-site and
-- the runner keys on filename, so the numbers have to keep advancing.
--
-- tg_chats is the unit the section renders. tg_messages holds one row per
-- message, with body NULL when the text is not recoverable (Telegram's local
-- database is not encrypted at rest the way WhatsApp's is, so a captured
-- export should yield readable text; a NULL body means the row was recovered
-- without its payload and must not be shown as if it were readable).
--
-- No contact names, phone numbers or message text enter this repository.
-- The import runs on the owner's machine, exactly like the WhatsApp import.

CREATE TABLE IF NOT EXISTS tg_chats (
  -- the export's own id, else a hash of kind + name
  chat_id         TEXT        PRIMARY KEY,
  name            TEXT        NOT NULL,
  kind            TEXT        NOT NULL CHECK (kind IN ('group', 'direct')),
  unresolved      BOOLEAN     NOT NULL DEFAULT false,   -- a number with no saved contact
  msg_count       INTEGER     NOT NULL DEFAULT 0,
  enc_count       INTEGER     NOT NULL DEFAULT 0,       -- bodies sealed, metadata only
  media_count     INTEGER     NOT NULL DEFAULT 0,
  member_count    INTEGER,
  unread_count    INTEGER     NOT NULL DEFAULT 0,
  first_at        DATE,
  last_at         DATE,
  device_id       TEXT,
  run_id          TEXT,
  source_system   TEXT        NOT NULL,
  raw             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tg_chats_kind_idx ON tg_chats (kind, msg_count DESC);
CREATE INDEX IF NOT EXISTS tg_chats_last_idx ON tg_chats (last_at DESC);

CREATE TABLE IF NOT EXISTS tg_messages (
  msg_id          TEXT        PRIMARY KEY,
  chat_id         TEXT        NOT NULL REFERENCES tg_chats(chat_id) ON DELETE CASCADE,
  body            TEXT,                                 -- NULL: text not recoverable
  sender          TEXT,
  sender_label    TEXT,
  kind            TEXT        NOT NULL DEFAULT 'text',
  encrypted       BOOLEAN     NOT NULL DEFAULT false,
  from_me         BOOLEAN     NOT NULL DEFAULT false,
  sent_at         TIMESTAMPTZ,
  seq             BIGINT,
  raw             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The thread query pages on (sent_at DESC, msg_id DESC) with a keyset cursor,
-- so the index has to match that ordering exactly.
CREATE INDEX IF NOT EXISTS tg_messages_thread_idx ON tg_messages (chat_id, sent_at DESC NULLS LAST, msg_id DESC);
CREATE INDEX IF NOT EXISTS tg_messages_sent_idx ON tg_messages (sent_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS tg_sync_runs (
  run_id          TEXT        PRIMARY KEY,
  device_id       TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  chats_seen      INTEGER     NOT NULL DEFAULT 0,
  messages_seen   INTEGER     NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'running',   -- running | done
  note            TEXT
);
