-- The scheduled DynamoDB repair is intentionally bounded so it can finish in
-- a serverless invocation. Vercel cron does not replay a response's nextKey,
-- therefore the cursor must be durable: without this row, every daily run
-- restarts at page one and events after the first bounded slice never reach
-- the Neon warehouse.
CREATE TABLE IF NOT EXISTS warehouse_sync_state (
  name       TEXT PRIMARY KEY,
  cursor     JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
