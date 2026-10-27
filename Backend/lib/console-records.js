// Durable records for the console sections that had none, and the readers that
// hand the console something it can actually display.
//
// Two rules shape this module.
//
// First: the database holds real records. A row exists because a source produced
// it, and it carries a reference to the authoritative record (Firestore document
// path, Blob object path, CI receipt id) next to a human-readable summary.
// Firestore and Blob stay authoritative; these tables are the database-side
// record of what they contained, not a replacement.
//
// Second: nothing raw reaches the browser. The readers select explicit columns
// and map rows to display objects - numbers stay numbers, media stays a
// reference, and the JSONB columns are unwrapped into known keys instead of
// being passed through as a payload dump. A section with no rows reads as empty
// or unavailable, never as a placeholder.
import { randomUUID } from 'node:crypto';
import { query as defaultQuery } from '../../Integrations/postgres.js';

const id = (given) => given || randomUUID();

const MEDIA_KEYS = ['kind', 'label', 'url', 'contentType'];

// Unwrap a stored JSONB value into the known keys only. An unknown key is
// dropped rather than forwarded: a panel that starts rendering whatever a
// producer stored is how raw JSON ends up in front of a human again.
export function displayRefs(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const out = {};
      for (const key of MEDIA_KEYS) if (item[key] != null) out[key] = item[key];
      return out;
    })
    .filter((item) => Object.keys(item).length > 0);
}

export function displayDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const key of ['count', 'total', 'pending', 'failed', 'lastRunAt', 'note']) {
    if (value[key] != null) out[key] = value[key];
  }
  return out;
}

const media = (kind, ref) => (kind || ref ? { kind: kind || null, ref: ref || null } : null);

/* ---------------------------------------------------------------- writers */

export async function upsertLiveFeedRecord(record, { db = defaultQuery } = {}) {
  const row = {
    id: id(record.id),
    feed: record.feed,
    kind: record.kind,
    title: record.title ?? null,
    summary: record.summary ?? null,
    source_ref: record.sourceRef ?? null,
    media_kind: record.mediaKind ?? null,
    media_ref: record.mediaRef ?? null,
    occurred_at: record.occurredAt ?? new Date().toISOString(),
    source_updated_at: record.sourceUpdatedAt ?? null
  };
  await db(
    `INSERT INTO live_feed_records
       (id, feed, kind, title, summary, source_ref, media_kind, media_ref, occurred_at, source_updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET
       kind = EXCLUDED.kind, title = EXCLUDED.title, summary = EXCLUDED.summary,
       media_kind = EXCLUDED.media_kind, media_ref = EXCLUDED.media_ref,
       occurred_at = EXCLUDED.occurred_at, source_updated_at = EXCLUDED.source_updated_at`,
    [row.id, row.feed, row.kind, row.title, row.summary, row.source_ref, row.media_kind, row.media_ref, row.occurred_at, row.source_updated_at]
  );
  return row.id;
}

export async function recordProviderSnapshot(snapshot, { db = defaultQuery } = {}) {
  const row = {
    id: id(snapshot.id),
    provider: snapshot.provider,
    status: snapshot.status,
    summary: snapshot.summary ?? null,
    source_ref: snapshot.sourceRef ?? null,
    details: JSON.stringify(snapshot.details ?? {}),
    captured_at: snapshot.capturedAt ?? new Date().toISOString()
  };
  await db(
    `INSERT INTO provider_snapshots (id, provider, status, summary, source_ref, details, captured_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [row.id, row.provider, row.status, row.summary, row.source_ref, row.details, row.captured_at]
  );
  return row.id;
}

export async function startAgentRun(run, { db = defaultQuery } = {}) {
  const row = {
    id: id(run.id),
    agent: run.agent,
    status: 'running',
    title: run.title ?? null,
    input_summary: run.inputSummary ?? null,
    refs: JSON.stringify(run.refs ?? [])
  };
  await db(
    `INSERT INTO agent_runs (id, agent, status, title, input_summary, refs, started_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())`,
    [row.id, row.agent, row.status, row.title, row.input_summary, row.refs]
  );
  return row.id;
}

export async function appendAgentMessage(message, { db = defaultQuery } = {}) {
  const row = {
    id: id(message.id),
    run_id: message.runId,
    seq: message.seq,
    role: message.role,
    content_text: message.text ?? '',
    media_kind: message.mediaKind ?? null,
    media_ref: message.mediaRef ?? null,
    refs: JSON.stringify(message.refs ?? [])
  };
  await db(
    `INSERT INTO agent_messages (id, run_id, seq, role, content_text, media_kind, media_ref, refs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (run_id, seq) DO UPDATE SET
       content_text = EXCLUDED.content_text,
       media_kind = EXCLUDED.media_kind,
       media_ref = EXCLUDED.media_ref,
       refs = EXCLUDED.refs`,
    [row.id, row.run_id, row.seq, row.role, row.content_text, row.media_kind, row.media_ref, row.refs]
  );
  return row.id;
}

export async function finishAgentRun(runId, outcome = {}, { db = defaultQuery } = {}) {
  const endedAt = outcome.endedAt ?? new Date().toISOString();
  await db(
    `UPDATE agent_runs
        SET status = $2, output_text = $3, error_text = $4, ended_at = $5,
            duration_ms = GREATEST(0, EXTRACT(EPOCH FROM ($5::timestamptz - started_at)) * 1000)::int,
            updated_at = now()
      WHERE id = $1`,
    [runId, outcome.status || 'succeeded', outcome.outputText ?? null, outcome.errorText ?? null, endedAt]
  );
}

export async function recordEvidence(record, { db = defaultQuery } = {}) {
  const row = {
    id: id(record.id),
    check_name: record.checkName,
    subject: record.subject ?? null,
    verdict: record.verdict,
    summary: record.summary ?? null,
    evidence_ref: record.evidenceRef ?? null,
    revision: record.revision ?? null,
    produced_by: record.producedBy ?? null,
    produced_at: record.producedAt ?? null
  };
  await db(
    `INSERT INTO engineering_evidence
       (id, check_name, subject, verdict, summary, evidence_ref, revision, produced_by, produced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET
       verdict = EXCLUDED.verdict, summary = EXCLUDED.summary,
       evidence_ref = EXCLUDED.evidence_ref, revision = EXCLUDED.revision,
       produced_by = EXCLUDED.produced_by, produced_at = EXCLUDED.produced_at`,
    [row.id, row.check_name, row.subject, row.verdict, row.summary, row.evidence_ref, row.revision, row.produced_by, row.produced_at]
  );
  return row.id;
}

export async function upsertTelegramChat(chat, { db = defaultQuery } = {}) {
  const row = {
    id: id(chat.id),
    source_ref: chat.sourceRef ?? null,
    title: chat.title ?? null,
    participant_count: chat.participantCount ?? null,
    last_message_at: chat.lastMessageAt ?? null
  };
  await db(
    `INSERT INTO telegram_chats (id, source_ref, title, participant_count, last_message_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title, participant_count = EXCLUDED.participant_count,
       last_message_at = EXCLUDED.last_message_at, updated_at = now()`,
    [row.id, row.source_ref, row.title, row.participant_count, row.last_message_at]
  );
  return row.id;
}

export async function appendTelegramMessage(message, { db = defaultQuery } = {}) {
  const row = {
    id: id(message.id),
    chat_id: message.chatId,
    seq: message.seq,
    direction: message.direction,
    sender: message.sender ?? null,
    text: message.text ?? null,
    media_kind: message.mediaKind ?? null,
    media_ref: message.mediaRef ?? null,
    sent_at: message.sentAt ?? null
  };
  await db(
    `INSERT INTO telegram_messages (id, chat_id, seq, direction, sender, text, media_kind, media_ref, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (chat_id, seq) DO UPDATE SET
       text = EXCLUDED.text, media_kind = EXCLUDED.media_kind,
       media_ref = EXCLUDED.media_ref, sent_at = EXCLUDED.sent_at`,
    [row.id, row.chat_id, row.seq, row.direction, row.sender, row.text, row.media_kind, row.media_ref, row.sent_at]
  );
  return row.id;
}

/* ---------------------------------------------------------------- readers */

export async function readLiveFeed({ feed = null, limit = 50, db = defaultQuery } = {}) {
  const params = [];
  let where = '';
  if (feed) { params.push(feed); where = 'WHERE feed = $1'; }
  params.push(limit);
  const { rows } = await db(
    `SELECT id, feed, kind, title, summary, source_ref, media_kind, media_ref, occurred_at, source_updated_at
       FROM live_feed_records ${where}
      ORDER BY occurred_at DESC
      LIMIT $${params.length}`,
    params
  );
  return rows.map((r) => ({
    id: r.id,
    feed: r.feed,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    sourceRef: r.source_ref,
    media: media(r.media_kind, r.media_ref),
    occurredAt: r.occurred_at,
    sourceUpdatedAt: r.source_updated_at
  }));
}

export async function readProviderSnapshots({ limit = 20, db = defaultQuery } = {}) {
  const { rows } = await db(
    `SELECT id, provider, status, summary, source_ref, details, captured_at
       FROM provider_snapshots
      ORDER BY captured_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    status: r.status,
    summary: r.summary,
    sourceRef: r.source_ref,
    details: displayDetails(r.details),
    capturedAt: r.captured_at
  }));
}

export async function readAgentRuns({ agent = null, limit = 20, db = defaultQuery } = {}) {
  const params = [];
  let where = '';
  if (agent) { params.push(agent); where = 'WHERE agent = $1'; }
  params.push(limit);
  const { rows } = await db(
    `SELECT id, agent, status, title, input_summary, output_text, error_text, refs,
            started_at, ended_at, duration_ms
       FROM agent_runs ${where}
      ORDER BY started_at DESC
      LIMIT $${params.length}`,
    params
  );
  return rows.map((r) => ({
    id: r.id,
    agent: r.agent,
    status: r.status,
    title: r.title,
    inputSummary: r.input_summary,
    outputText: r.output_text,
    errorText: r.error_text,
    refs: displayRefs(r.refs),
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationMs: r.duration_ms
  }));
}

export async function readAgentMessages({ runId, db = defaultQuery } = {}) {
  const { rows } = await db(
    `SELECT id, run_id, seq, role, content_text, media_kind, media_ref, refs, created_at
       FROM agent_messages
      WHERE run_id = $1
      ORDER BY seq ASC`,
    [runId]
  );
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    seq: r.seq,
    role: r.role,
    text: r.content_text,
    media: media(r.media_kind, r.media_ref),
    refs: displayRefs(r.refs),
    createdAt: r.created_at
  }));
}

export async function readEngineeringEvidence({ limit = 50, db = defaultQuery } = {}) {
  const { rows } = await db(
    `SELECT id, check_name, subject, verdict, summary, evidence_ref, revision, produced_by, produced_at
       FROM engineering_evidence
      ORDER BY produced_at DESC NULLS LAST
      LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    checkName: r.check_name,
    subject: r.subject,
    verdict: r.verdict,
    summary: r.summary,
    evidenceRef: r.evidence_ref,
    revision: r.revision,
    producedBy: r.produced_by,
    producedAt: r.produced_at
  }));
}

export async function readTelegramChats({ limit = 50, db = defaultQuery } = {}) {
  const { rows } = await db(
    `SELECT id, source_ref, title, participant_count, last_message_at, updated_at
       FROM telegram_chats
      ORDER BY last_message_at DESC NULLS LAST
      LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    sourceRef: r.source_ref,
    title: r.title,
    participantCount: r.participant_count,
    lastMessageAt: r.last_message_at,
    updatedAt: r.updated_at
  }));
}

export async function readTelegramMessages({ chatId, db = defaultQuery } = {}) {
  const { rows } = await db(
    `SELECT id, chat_id, seq, direction, sender, text, media_kind, media_ref, sent_at
       FROM telegram_messages
      WHERE chat_id = $1
      ORDER BY seq ASC`,
    [chatId]
  );
  return rows.map((r) => ({
    id: r.id,
    chatId: r.chat_id,
    seq: r.seq,
    direction: r.direction,
    sender: r.sender,
    text: r.text,
    media: media(r.media_kind, r.media_ref),
    sentAt: r.sent_at
  }));
}
