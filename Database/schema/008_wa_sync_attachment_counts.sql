-- migration. wa_sync_runs counted chats and messages but never attachments, so
-- a run that discarded every attachment — because the producer sent media
-- metadata without a blob_url, or the attachment's chat was never ingested —
-- looked identical to a perfect one. That is how wa_attachments stayed empty
-- against 18,232 media/audio messages without a single run ever flagging it.
--
-- Two columns make the drop visible. attachments_seen is how many rows actually
-- landed under a run_id (recomputed from wa_attachments, like chats_seen and
-- messages_seen, so a retried batch does not double it). attachments_skipped is
-- how many were discarded — records rejected before insert plus ones orphaned
-- by the chat-exists guard. Both are nullable with no default on purpose: rows
-- written before this migration predate the measurement and are honestly
-- "unknown", not zero.
ALTER TABLE wa_sync_runs ADD COLUMN IF NOT EXISTS attachments_seen    INTEGER;
ALTER TABLE wa_sync_runs ADD COLUMN IF NOT EXISTS attachments_skipped INTEGER;
