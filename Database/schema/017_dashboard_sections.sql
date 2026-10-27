-- Additive current-state storage; existing analytics and source history stay intact.
CREATE TABLE IF NOT EXISTS dashboard_sync_state (
  section_id text NOT NULL,
  source text NOT NULL,
  scope text NOT NULL,
  generation text NOT NULL,
  complete_generation text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  complete boolean NOT NULL DEFAULT false,
  PRIMARY KEY (section_id, source, scope)
);
CREATE TABLE IF NOT EXISTS dashboard_current_records (
  section_id text NOT NULL,
  source text NOT NULL,
  scope text NOT NULL,
  record_id text NOT NULL,
  source_revision text NOT NULL,
  content_hash text NOT NULL,
  display_values jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (section_id, source, scope, record_id)
);
CREATE INDEX IF NOT EXISTS dashboard_current_observed_idx ON dashboard_current_records(section_id, observed_at DESC);
CREATE TABLE IF NOT EXISTS dashboard_sync_cursors (
  section_id text NOT NULL,source text NOT NULL,scope text NOT NULL,
  generation text NOT NULL,cursor text NOT NULL,
  PRIMARY KEY(section_id,source,scope)
);
CREATE TABLE IF NOT EXISTS dashboard_sync_members (
  section_id text NOT NULL,source text NOT NULL,scope text NOT NULL,
  record_id text NOT NULL,generation text NOT NULL,
  PRIMARY KEY(section_id,source,scope,record_id)
);
CREATE TABLE IF NOT EXISTS tg_chats (
  chat_id text PRIMARY KEY, name text, kind text, source_updated_at timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tg_messages (
  chat_id text NOT NULL REFERENCES tg_chats(chat_id), msg_id text NOT NULL,
  body text, sender text, from_me boolean, sent_at timestamptz,
  source_updated_at timestamptz, PRIMARY KEY(chat_id, msg_id)
);
CREATE INDEX IF NOT EXISTS tg_messages_time_idx ON tg_messages(chat_id, sent_at DESC);
CREATE TABLE IF NOT EXISTS tg_sync_runs (
  source text PRIMARY KEY, last_success_at timestamptz, record_count bigint,
  status text NOT NULL
);
CREATE TABLE IF NOT EXISTS dashboard_agent_exchanges (
  section_id text NOT NULL CHECK (section_id IN ('agent','jayti-agent')),
  conversation_id text NOT NULL, request_id text NOT NULL,
  question text NOT NULL, answer text NOT NULL,
  outcome text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(section_id, conversation_id, request_id),
  CHECK (length(question) BETWEEN 1 AND 16000),
  CHECK (length(answer) BETWEEN 1 AND 200000)
);
CREATE INDEX IF NOT EXISTS dashboard_agent_conversation_idx ON dashboard_agent_exchanges(section_id, conversation_id, created_at DESC);

-- These are private operator records. Backend owner connections may read them;
-- inherited/default grants must not make them readable through the Data API.
ALTER TABLE dashboard_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_current_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_sync_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_sync_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_agent_exchanges ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_sync_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE dashboard_sync_state,dashboard_current_records,dashboard_sync_cursors,
  dashboard_sync_members,dashboard_agent_exchanges,tg_chats,tg_messages,tg_sync_runs FROM PUBLIC;
