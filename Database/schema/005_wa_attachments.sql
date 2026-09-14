-- WhatsApp media & audio attachments: file bytes live in Vercel Blob, one row
-- here per uploaded file recording where the blob lives and what it is.
--
-- The S24 daemon (Devices/S24/wa_media_push.py) walks WhatsApp Media/ on the
-- phone, POSTs each file to /api/wa-blob-upload, and the ingest writes the
-- returned blob URL back through /api/wa-ingest with an `attachments: [...]`
-- block. jaytipargal.tech's WhatsApp drill-down calls /api/jp-wa-attachments
-- to list them per chat and renders <img>, <video>, <audio> tags against the
-- blob URLs.

CREATE TABLE IF NOT EXISTS wa_attachments (
  att_id        TEXT        PRIMARY KEY,   -- <chat_id>:<msg_key>:<file-hash>
  chat_id       TEXT        NOT NULL REFERENCES wa_chats (chat_id) ON DELETE CASCADE,
  msg_id        TEXT,                     -- FK is soft: an attachment may arrive before its message
  kind          TEXT        NOT NULL CHECK (kind IN ('image','video','audio','ptt','document','sticker','other')),
  mime          TEXT,
  file_name     TEXT,
  size_bytes    BIGINT,
  duration_sec  INTEGER,
  width         INTEGER,
  height        INTEGER,
  blob_url      TEXT        NOT NULL,     -- Vercel Blob public URL (unguessable random suffix)
  sent_at       TIMESTAMPTZ,
  device_id     TEXT,
  run_id        TEXT,
  source_system TEXT        NOT NULL,
  raw           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_attachments_chat_idx ON wa_attachments (chat_id, sent_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS wa_attachments_kind_idx ON wa_attachments (chat_id, kind);
