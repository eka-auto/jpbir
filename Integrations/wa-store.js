// WhatsApp inventory: shape normalisation, upserts and the galaxy payload.
//
// Two input shapes are accepted everywhere, so one code path serves the S24
// daemon, the owner's local import and whatever the recovery tool emits next:
//   compact — what Frontend/cards_data.json already uses:
//             { n, k, u, m, e, md, au, cl, f, l, sz, id? }
//   verbose — { id?, name, kind, unresolved?, messages, encrypted?, media?,
//               audio?, calls?, first?, last?, size? }
// `kind` may be 'group' | 'direct' or the short 'g' | 'd'.
//
// The pure functions take no connection. The ones that write take a `query`
// function, so the ingest handler, the import script and the tests share the
// same statements with different plumbing (pooled client, direct client, or a
// stub that records the SQL).
import crypto from 'node:crypto';

export const KINDS = { g: 'group', group: 'group', d: 'direct', direct: 'direct' };
const MSG_KINDS = new Set(['text', 'media', 'audio', 'call', 'system', 'other']);

// Rows per statement. Neon handles a few hundred comfortably and a Vercel
// function has ~10s, so 862 chats become five round trips instead of 862.
export const CHUNK = 200;

const str = (v) => (v == null ? '' : String(v)).trim();
const int = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0; };
const intOrNull = (v) => (v == null || v === '' ? null : int(v));
const BAD_SENDERS = new Set([
  '[object object]', '<undefined>', 'undefined', '[undefined]',
  '<null>', 'null', '[null]',
]);

const cleanSenderText = (value) => {
  const text = str(value);
  return text && !BAD_SENDERS.has(text.toLowerCase()) ? text : null;
};

/** A stable WhatsApp address from either a string jid or WhatsApp's id object. */
export function whatsappAddress(value, depth = 0) {
  if (value == null || depth > 4) return null;
  if (typeof value === 'string' || typeof value === 'number') return cleanSenderText(value);
  if (typeof value !== 'object') return null;

  for (const candidate of [value._serialized, value.jid, value.wid, value.id]) {
    if (candidate === value) continue;
    const address = whatsappAddress(candidate, depth + 1);
    if (address) return address;
  }
  const user = cleanSenderText(value.user);
  const server = cleanSenderText(value.server);
  return user ? (server ? `${user}@${server}` : user) : null;
}

/** A displayable sender, never JavaScript's object/undefined sentinel strings. */
export function normalizeSender(value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    for (const candidate of [
      value.name, value.pushname, value.pushName, value.shortName,
      value.formattedName, value.notifyName, value.notify_name,
    ]) {
      const name = cleanSenderText(candidate);
      if (name) return name;
    }
    return whatsappAddress(value);
  }
  const text = cleanSenderText(value);
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return text;
  try { return normalizeSender(JSON.parse(text)); } catch { return text; }
}

/** Human label for legacy and current WhatsApp message rows. */
export function messageSenderLabel(message = {}) {
  if (message.kind === 'system') return 'System';
  if (message.from_me === true) return 'You';
  const sender = normalizeSender(message.sender);
  if (sender) return sender;
  const chatName = normalizeSender(message.chat_name);
  if (message.chat_kind === 'direct' && chatName) return chatName;
  return message.chat_kind === 'group' ? 'Unknown participant' : 'Unknown sender';
}

// The body a sealed recovery-dump record is stored with. It is a display hint,
// not message text, so upsertMessages must never let it replace a body a chat
// export already supplied (see the ON CONFLICT clause there).
export const ENCRYPTED_PLACEHOLDER = '[Encrypted — export chat to read]';

// These values describe a recovered row, not a readable message body. Keep
// the test independent of the legacy `encrypted` flag: the first real chat
// exports were imported into rows whose flag remained true, so trusting that
// flag hid valid text already present in Neon.
export const MESSAGE_BODY_PLACEHOLDERS = Object.freeze([
  ENCRYPTED_PLACEHOLDER,
  '[System message]',
  '[Media — image/video]',
  '[Audio message]',
  '[Call]',
  '[Other]',
]);

export function isReadableMessageBody(message = {}) {
  const body = typeof message.body === 'string' ? message.body.trim() : '';
  return Boolean(body) && !MESSAGE_BODY_PLACEHOLDERS.includes(body);
}

/** Explain sealed recovery rows honestly while preserving real imported text. */
export function displayMessageBody(message = {}) {
  const body = typeof message.body === 'string' ? message.body.trim() : '';
  if (isReadableMessageBody(message)) return body;
  if (message.kind === 'system') return 'System event — details were not present in the recovery metadata.';
  if (message.kind === 'media') return 'Media metadata only — attachment content was not present in the recovery dump.';
  if (message.kind === 'audio') return 'Audio metadata only — audio content was not present in the recovery dump.';
  if (message.kind === 'call') return 'Call metadata only — call details were not present in the recovery dump.';
  if (message.encrypted === true || body) return 'Encrypted message — text was not present in the recovery dump.';
  return '(message content unavailable)';
}
// A calendar-invalid date (2024-02-31) would make Postgres reject the whole
// chunk it rides in, so only a value that survives a UTC round trip counts.
const dateOrNull = (v) => {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
};
const flag = (v) => v === true || v === 1 || v === '1' || v === 'true';

const hashId = (s) => 'h_' + crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);
const explicitId = (rec) => str(rec.id ?? rec.jid ?? rec.chat_id);
const kindName = (rec) => `${KINDS[str(rec.k ?? rec.kind).toLowerCase()] || ''}:${str(rec.n ?? rec.name)}`;

/** Stable id: the export's own id when present, else a hash of kind + name. */
export function chatIdFor(rec) {
  return explicitId(rec) || hashId(kindName(rec));
}

/**
 * Give every record in a list an id before it is keyed. Explicit ids pass
 * through untouched. Two distinct chats can share a display name (two groups
 * called "Family"), and a key from kind + name alone would make them one row —
 * or, inside one statement, a cardinality violation that aborts the whole
 * chunk. So the n-th id-less record with the same kind + name is keyed on
 * `kind:name#n`; the first keeps the plain hash, so rows ingested before this
 * stay where they are. Deterministic for a given export, so a re-run still
 * updates in place — which is also why a same-name pair has to arrive in one
 * list: split across two requests, each half would be "the first". That is
 * why /api/wa-ingest refuses a chat without its own id (idlessChats below):
 * a caller that posts in several requests (the daemon) sends the export's ids.
 */
export function assignChatIds(records) {
  const seen = new Map();
  return (records || []).map((rec) => {
    if (!rec || typeof rec !== 'object' || explicitId(rec)) return rec;
    const base = kindName(rec);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { ...rec, id: n === 1 ? hashId(base) : hashId(`${base}#${n}`) };
  });
}

/**
 * Indexes of the chat records that carry no id of their own. The derived key
 * is safe only over one whole list, so the endpoint, which sees one batch at
 * a time, refuses these instead of guessing. Non-objects are not listed —
 * normalizeChat drops those as unusable anyway.
 */
export function idlessChats(records) {
  const out = [];
  (records || []).forEach((rec, i) => {
    if (rec && typeof rec === 'object' && !explicitId(rec)) out.push(i);
  });
  return out;
}

/** One chat in canonical form, or null when the record cannot be a chat. */
export function normalizeChat(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const name = str(rec.n ?? rec.name);
  const kind = KINDS[str(rec.k ?? rec.kind).toLowerCase()];
  if (!name || !kind) return null;
  const msg = int(rec.m ?? rec.messages);
  return {
    chat_id: chatIdFor(rec),
    name,
    kind,
    unresolved: flag(rec.u ?? rec.unresolved),
    msg_count: msg,
    // a chat cannot have more sealed bodies than messages
    enc_count: Math.min(msg, int(rec.e ?? rec.encrypted)),
    media_count: int(rec.md ?? rec.media),
    audio_count: int(rec.au ?? rec.audio),
    call_count: int(rec.cl ?? rec.calls),
    member_count: intOrNull(rec.sz ?? rec.size ?? rec.members),
    first_at: dateOrNull(rec.f ?? rec.first),
    last_at: dateOrNull(rec.l ?? rec.last),
  };
}

/** One message in canonical form, or null when it cannot be keyed. */
export function normalizeMessage(rec, chatId) {
  if (!rec || typeof rec !== 'object') return null;
  const chat = str(rec.chat_id ?? rec.chat ?? chatId);
  const key = str(rec.id ?? rec.key ?? rec.msg_id);
  if (!chat || !key) return null;
  const kind = str(rec.kind ?? rec.type ?? 'text').toLowerCase();
  const ts = rec.sent_at ?? rec.ts ?? rec.timestamp ?? rec.t;
  // exports carry epoch seconds, epoch millis or ISO strings; treat small numbers as seconds
  const when = ts == null ? null : new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
  const body = rec.body ?? rec.text ?? null;
  const fromMe = rec.from_me ?? rec.fromMe;
  const encrypted = rec.encrypted != null || rec.sealed != null
    ? flag(rec.encrypted ?? rec.sealed)
    : body == null;
  return {
    msg_id: `${chat}:${key}`,
    chat_id: chat,
    sent_at: when && !Number.isNaN(when.getTime()) ? when.toISOString() : null,
    from_me: fromMe == null ? null : flag(fromMe),
    sender: normalizeSender(rec.sender) || normalizeSender(rec.author) || normalizeSender(rec.from),
    kind: MSG_KINDS.has(kind) ? kind : 'other',
    encrypted,
    // Encrypted recovery-dump records that carry no body get a placeholder so
    // the dashboard does not render empty message bubbles. When the export
    // parser later runs with actual chat .txt files, it overwrites these via
    // the ON CONFLICT clause (or by matching sent_at+sender+direction). The
    // reverse never happens: a placeholder arriving after a real body keeps the
    // real body (upsertMessages).
    body: body == null
      ? (encrypted ? ENCRYPTED_PLACEHOLDER : null)
      : String(body),
  };
}

const chunks = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** Upsert chats in chunks. Returns how many rows were written and how many records were unusable. */
export async function upsertChats(query, records, meta = {}) {
  // Keyed by chat_id: ON CONFLICT DO UPDATE cannot touch the same row twice in
  // one statement, so a repeated id keeps its first slot and its last values.
  const rows = new Map();
  let skipped = 0, duplicates = 0;
  for (const rec of assignChatIds(records)) {
    const c = normalizeChat(rec);
    if (!c) { skipped++; continue; }
    if (rows.has(c.chat_id)) duplicates++;
    rows.set(c.chat_id, { ...c, raw: JSON.stringify(rec) });
  }
  const col = (batch, k) => batch.map((r) => r[k]);
  for (const batch of chunks([...rows.values()], CHUNK)) {
    await query(
      `INSERT INTO wa_chats (chat_id, name, kind, unresolved, msg_count, enc_count, media_count,
                             audio_count, call_count, member_count, first_at, last_at,
                             device_id, run_id, source_system, raw)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::boolean[], $5::int[], $6::int[],
                            $7::int[], $8::int[], $9::int[], $10::int[], $11::date[], $12::date[],
                            $13::text[], $14::text[], $15::text[], $16::jsonb[])
       ON CONFLICT (chat_id) DO UPDATE SET
         name          = EXCLUDED.name,
         kind          = EXCLUDED.kind,
         unresolved    = EXCLUDED.unresolved,
         msg_count     = EXCLUDED.msg_count,
         enc_count     = EXCLUDED.enc_count,
         media_count   = EXCLUDED.media_count,
         audio_count   = EXCLUDED.audio_count,
         call_count    = EXCLUDED.call_count,
         member_count  = COALESCE(EXCLUDED.member_count, wa_chats.member_count),
         first_at      = COALESCE(EXCLUDED.first_at, wa_chats.first_at),
         last_at       = COALESCE(EXCLUDED.last_at, wa_chats.last_at),
         device_id     = COALESCE(EXCLUDED.device_id, wa_chats.device_id),
         run_id        = EXCLUDED.run_id,
         source_system = EXCLUDED.source_system,
         raw           = EXCLUDED.raw,
         updated_at    = now()`,
      [
        col(batch, 'chat_id'), col(batch, 'name'), col(batch, 'kind'), col(batch, 'unresolved'),
        col(batch, 'msg_count'), col(batch, 'enc_count'), col(batch, 'media_count'),
        col(batch, 'audio_count'), col(batch, 'call_count'), col(batch, 'member_count'),
        col(batch, 'first_at'), col(batch, 'last_at'),
        batch.map(() => meta.device || null), batch.map(() => meta.runId || null),
        batch.map(() => meta.source || 'wa-ingest'), col(batch, 'raw'),
      ]
    );
  }
  return { upserted: rows.size, skipped, duplicates };
}

// SQL literal for the placeholder. The constant holds no quote, so interpolating
// it cannot change the statement's shape; it stays out of the parameter list so
// the positional params callers and tests assert on are unchanged.
const PLACEHOLDER_SQL = `'${ENCRYPTED_PLACEHOLDER.replace(/'/g, "''")}'`;

/**
 * Upsert messages in chunks. A message whose chat is unknown is dropped by the FK, not the whole batch.
 *
 * body/encrypted on conflict: the recovery dump is re-sent on every S24 sync and
 * carries no text, so each of its records arrives as ENCRYPTED_PLACEHOLDER.
 * `body = COALESCE(EXCLUDED.body, wa_messages.body)` took any non-null value, so
 * that placeholder overwrote the text a chat export had already imported, and
 * the next sync after an export erased it. A real body now wins over anything;
 * a placeholder or NULL only fills a row that has no body yet. `encrypted`
 * follows whichever body is kept, so a restored message is not re-flagged sealed.
 */
export async function upsertMessages(query, records, meta = {}) {
  const list = records || [];
  const rows = new Map(); // same rule as chats: one row per msg_id in a statement
  let skipped = 0, duplicates = 0;
  for (const rec of list) {
    const m = normalizeMessage(rec, meta.chatId);
    if (!m) { skipped++; continue; }
    if (rows.has(m.msg_id)) duplicates++;
    rows.set(m.msg_id, { ...m, raw: JSON.stringify(rec) });
  }
  const normalized = rows.size;
  const col = (batch, k) => batch.map((r) => r[k]);
  let upserted = 0;
  for (const batch of chunks([...rows.values()], CHUNK * 2)) {
    const result = await query(
      `INSERT INTO wa_messages (msg_id, chat_id, sent_at, from_me, sender, kind, encrypted, body,
                                device_id, run_id, source_system, raw)
       SELECT u.* FROM UNNEST($1::text[], $2::text[], $3::timestamptz[], $4::boolean[], $5::text[],
                              $6::text[], $7::boolean[], $8::text[], $9::text[], $10::text[],
                              $11::text[], $12::jsonb[]) AS u(msg_id, chat_id, sent_at, from_me,
                              sender, kind, encrypted, body, device_id, run_id, source_system, raw)
        WHERE EXISTS (SELECT 1 FROM wa_chats c WHERE c.chat_id = u.chat_id)
       ON CONFLICT (msg_id) DO UPDATE SET
         sent_at   = COALESCE(EXCLUDED.sent_at, wa_messages.sent_at),
         from_me   = COALESCE(EXCLUDED.from_me, wa_messages.from_me),
         sender    = COALESCE(EXCLUDED.sender, wa_messages.sender),
         kind      = EXCLUDED.kind,
         encrypted = CASE
                       WHEN (EXCLUDED.body IS NULL OR EXCLUDED.body = ${PLACEHOLDER_SQL})
                        AND wa_messages.body IS NOT NULL AND wa_messages.body <> ${PLACEHOLDER_SQL}
                       THEN wa_messages.encrypted
                       ELSE EXCLUDED.encrypted
                     END,
         body      = CASE
                       WHEN EXCLUDED.body IS NULL OR EXCLUDED.body = ${PLACEHOLDER_SQL}
                       THEN COALESCE(wa_messages.body, EXCLUDED.body)
                       ELSE EXCLUDED.body
                     END,
         run_id    = EXCLUDED.run_id,
         raw       = EXCLUDED.raw`,
      [
        col(batch, 'msg_id'), col(batch, 'chat_id'), col(batch, 'sent_at'), col(batch, 'from_me'),
        col(batch, 'sender'), col(batch, 'kind'), col(batch, 'encrypted'), col(batch, 'body'),
        batch.map(() => meta.device || null), batch.map(() => meta.runId || null),
        batch.map(() => meta.source || 'wa-ingest'), col(batch, 'raw'),
      ]
    );
    // WHERE EXISTS drops messages for chats never ingested — report what was stored, not what was sent
    upserted += Number.isInteger(result && result.rowCount) ? result.rowCount : 0;
  }
  // A normalized message whose chat_id is not in wa_chats is dropped by the
  // WHERE EXISTS guard above — the same silent path upsertAttachments surfaces
  // as `orphaned`. It is not a skip (nothing was wrong with the record), so
  // `upserted` alone could not tell "the S24 chat-export arrived" from "every
  // line was thrown away because its chat_id did not byte-match the
  // recovered-dump jid" — the most common reason a chat still reads 0-readable
  // after an export was run, and until now it left no trace anywhere.
  const orphaned = Math.max(0, normalized - upserted);
  return { received: list.length, normalized, upserted, skipped, duplicates, orphaned };
}

const ATT_KINDS = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker', 'other']);
const isoOrNull = (v) => {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * Attachment shape:
 *   { att_id?, chat_id, msg_id?, kind, mime?, file_name?, size_bytes?,
 *     duration_sec?, width?, height?, blob_url, sent_at?, raw? }
 * att_id is deterministic (chat_id:msg_key:hash) when the S24 daemon supplies
 * it; when absent, hash blob_url so a re-run reuses the same key.
 */
// Why an attachment record cannot become a row, or null when it can. Split out
// so the drop is COUNTED with a reason instead of vanishing: every discard here
// used to be a silent `return null`, which is how wa_attachments stayed empty
// against 18,232 media messages with nothing in the run summary to show it.
//   missing-blob-url is the load-bearing one — media bytes must already be in
//   Vercel Blob before a row can exist, so a producer that sends metadata
//   without uploading first has every record rejected here.
export function attachmentSkipReason(rec) {
  if (!rec || typeof rec !== 'object') return 'not-an-object';
  if (!str(rec.chat_id)) return 'missing-chat-id';
  if (!str(rec.blob_url)) return 'missing-blob-url';
  if (!ATT_KINDS.has(str(rec.kind).toLowerCase())) return 'unknown-kind';
  return null;
}

export function normalizeAttachment(rec) {
  if (attachmentSkipReason(rec)) return null;
  const chatId = str(rec.chat_id);
  const blobUrl = str(rec.blob_url);
  const kind = str(rec.kind).toLowerCase();
  const attId = str(rec.att_id) || hashId(`${chatId}:${str(rec.msg_id) || blobUrl}`);
  return {
    att_id: attId,
    chat_id: chatId,
    msg_id: str(rec.msg_id) || null,
    kind,
    mime: str(rec.mime) || null,
    file_name: str(rec.file_name) || null,
    size_bytes: rec.size_bytes == null ? null : Number(rec.size_bytes) || 0,
    duration_sec: intOrNull(rec.duration_sec),
    width: intOrNull(rec.width),
    height: intOrNull(rec.height),
    blob_url: blobUrl,
    sent_at: isoOrNull(rec.sent_at),
  };
}

export async function upsertAttachments(query, records, meta = {}) {
  const list = records || [];
  const rows = new Map();
  const skippedReasons = {};
  let skipped = 0;
  for (const rec of list) {
    const reason = attachmentSkipReason(rec);
    if (reason) {
      skipped++;
      skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
      continue;
    }
    const a = normalizeAttachment(rec);
    rows.set(a.att_id, { ...a, raw: JSON.stringify(rec) });
  }
  const normalized = rows.size;
  const col = (batch, k) => batch.map((r) => r[k]);
  let upserted = 0;
  for (const batch of chunks([...rows.values()], CHUNK)) {
    const result = await query(
      `INSERT INTO wa_attachments (att_id, chat_id, msg_id, kind, mime, file_name, size_bytes,
                                   duration_sec, width, height, blob_url, sent_at,
                                   device_id, run_id, source_system, raw)
       SELECT u.* FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                              $7::bigint[], $8::int[], $9::int[], $10::int[], $11::text[],
                              $12::timestamptz[], $13::text[], $14::text[], $15::text[], $16::jsonb[]) AS u(
                              att_id, chat_id, msg_id, kind, mime, file_name, size_bytes,
                              duration_sec, width, height, blob_url, sent_at,
                              device_id, run_id, source_system, raw)
        WHERE EXISTS (SELECT 1 FROM wa_chats c WHERE c.chat_id = u.chat_id)
       ON CONFLICT (att_id) DO UPDATE SET
         msg_id       = COALESCE(EXCLUDED.msg_id, wa_attachments.msg_id),
         kind         = EXCLUDED.kind,
         mime         = COALESCE(EXCLUDED.mime, wa_attachments.mime),
         file_name    = COALESCE(EXCLUDED.file_name, wa_attachments.file_name),
         size_bytes   = COALESCE(EXCLUDED.size_bytes, wa_attachments.size_bytes),
         duration_sec = COALESCE(EXCLUDED.duration_sec, wa_attachments.duration_sec),
         width        = COALESCE(EXCLUDED.width, wa_attachments.width),
         height       = COALESCE(EXCLUDED.height, wa_attachments.height),
         blob_url     = EXCLUDED.blob_url,
         sent_at      = COALESCE(EXCLUDED.sent_at, wa_attachments.sent_at),
         run_id       = EXCLUDED.run_id,
         raw          = EXCLUDED.raw`,
      [
        col(batch, 'att_id'), col(batch, 'chat_id'), col(batch, 'msg_id'), col(batch, 'kind'),
        col(batch, 'mime'), col(batch, 'file_name'), col(batch, 'size_bytes'),
        col(batch, 'duration_sec'), col(batch, 'width'), col(batch, 'height'),
        col(batch, 'blob_url'), col(batch, 'sent_at'),
        batch.map(() => meta.device || null), batch.map(() => meta.runId || null),
        batch.map(() => meta.source || 'wa-ingest'), col(batch, 'raw'),
      ]
    );
    upserted += Number.isInteger(result && result.rowCount) ? result.rowCount : 0;
  }
  // A normalized attachment whose chat_id is not in wa_chats is dropped by the
  // WHERE EXISTS guard above — a THIRD silent path, distinct from a skip. It is
  // not counted in `skipped` (nothing was wrong with the record), so surface it
  // as `orphaned` rather than let normalized > upserted go unexplained.
  const orphaned = Math.max(0, normalized - upserted);
  return { received: list.length, normalized, upserted, skipped, orphaned, skippedReasons };
}

/**
 * One ingest call: `{ device?, run_id?, chats?: [], messages?: [], attachments?: [], done?: bool, note? }`.
 * Records the run, upserts what is present, and closes the run when `done` is
 * set. Idempotent: the same batch twice writes the same rows.
 */
export async function ingestBatch(query, body, meta = {}) {
  const b = body && typeof body === 'object' ? body : {};
  // a caller that sends no run_id gets its own run — a timestamp would merge two pushes in the same second
  const runId = str(b.run_id ?? b.runId ?? meta.runId) || `run_${crypto.randomUUID()}`;
  const device = str(b.device ?? b.device_id ?? meta.device) || null;
  const source = meta.source || 'wa-ingest';
  const chats = Array.isArray(b.chats) ? b.chats : [];
  const messages = Array.isArray(b.messages) ? b.messages : [];
  const attachments = Array.isArray(b.attachments) ? b.attachments : [];

  const c = await upsertChats(query, chats, { device, runId, source });
  const m = await upsertMessages(query, messages, { device, runId, source, chatId: b.chat_id });
  const a = attachments.length
    ? await upsertAttachments(query, attachments, { device, runId, source })
    : { received: 0, normalized: 0, upserted: 0, skipped: 0, orphaned: 0, skippedReasons: {} };

  // Non-additive accounting: the seen tallies are the rows that carry this
  // run_id right now, so a retried batch (same run_id, idempotent upserts
  // above) reports the same numbers instead of doubling them. attachments_seen
  // joins them — a run that landed zero attachments while messages_seen climbed
  // is now visibly a drop, not a perfect sync. attachments_skipped is this
  // batch's discards (rejected + orphaned); there is no table to recount it
  // from, so it overwrites rather than adds, which keeps the idempotent retry
  // stable and, for the common single-batch run, is exact.
  // A chat-export message whose chat_id is not yet in wa_chats is dropped by
  // upsertMessages' WHERE EXISTS guard (m.orphaned). wa_sync_runs grows no
  // messages_orphaned column here: the run INSERT's positional params are
  // asserted (attachments_skipped must stay the last one), so the count rides
  // in `note` — which the dashboard already renders — merged with any caller
  // note. Without this, a mismatched export mapping failed in total silence:
  // the run just showed fewer msgs and said nothing about why.
  const orphanNote = m.orphaned > 0
    ? `${m.orphaned} message${m.orphaned === 1 ? '' : 's'} dropped: chat_id not in wa_chats — the chat-export mapping does not match an ingested chat`
    : null;
  const runNote = [str(b.note) || null, orphanNote].filter(Boolean).join(' · ') || null;
  await query(
    `INSERT INTO wa_sync_runs (run_id, device_id, chats_seen, messages_seen, attachments_seen, status, note, finished_at, attachments_skipped)
     VALUES ($1, $2,
             (SELECT COUNT(*)::int FROM wa_chats       WHERE run_id = $1),
             (SELECT COUNT(*)::int FROM wa_messages    WHERE run_id = $1),
             (SELECT COUNT(*)::int FROM wa_attachments WHERE run_id = $1),
             $3, $4, $5, $6)
     ON CONFLICT (run_id) DO UPDATE SET
       device_id           = COALESCE(EXCLUDED.device_id, wa_sync_runs.device_id),
       chats_seen          = EXCLUDED.chats_seen,
       messages_seen       = EXCLUDED.messages_seen,
       attachments_seen    = EXCLUDED.attachments_seen,
       status              = EXCLUDED.status,
       note                = COALESCE(EXCLUDED.note, wa_sync_runs.note),
       finished_at         = COALESCE(EXCLUDED.finished_at, wa_sync_runs.finished_at),
       attachments_skipped = EXCLUDED.attachments_skipped`,
    [runId, device, b.done ? 'done' : 'running', runNote,
      b.done ? new Date().toISOString() : null, a.skipped + a.orphaned]
  );

  return { run_id: runId, device, chats: c, messages: m, attachments: a, done: Boolean(b.done) };
}

/** The read side: every chat in the compact shape the galaxy page renders. */
export const CHAT_SELECT = `
  SELECT chat_id, name, kind, unresolved, msg_count, enc_count, media_count, audio_count,
         call_count, member_count,
         to_char(first_at, 'YYYY-MM-DD') AS first_at,
         to_char(last_at,  'YYYY-MM-DD') AS last_at
    FROM wa_chats
   ORDER BY name, chat_id`;

// No chat_id in the payload: a WhatsApp jid is a phone number for a person.
// `h` is an opaque handle for it — enough for the dashboard to ask for one
// chat's detail, without the number itself ever reaching the browser. It is a
// truncated digest, so it is not a secret (the phone-number space is small
// enough to enumerate); it only avoids publishing the number outright, and it
// never leaves the key-gated route.
export const handleFor = (chatId) => crypto.createHash('sha256').update(String(chatId)).digest('hex').slice(0, 16);

export function toCompact(row) {
  const d = (v) => (v ? String(v).slice(0, 10) : '');
  return {
    h: handleFor(row.chat_id),
    n: row.name,
    k: row.kind,
    u: row.unresolved ? 1 : 0,
    m: row.msg_count | 0,
    e: row.enc_count | 0,
    md: row.media_count | 0,
    au: row.audio_count | 0,
    cl: row.call_count | 0,
    f: d(row.first_at),
    l: d(row.last_at),
    sz: row.member_count == null ? 0 : row.member_count | 0,
  };
}

/**
 * The same rows with names replaced by numbered placeholders in encounter
 * order — the scheme Frontend/cards_data.json uses. Order is untouched, so a
 * later full payload from the same query lines up index for index.
 */
export function redactChats(chats) {
  let g = 0, p = 0;
  return chats.map((c) => ({
    ...c,
    n: c.k === 'group' ? `Group ${String(++g).padStart(3, '0')}` : `Person ${String(++p).padStart(3, '0')}`,
  }));
}

/**
 * `{ totals, chats }` exactly as Frontend/cards_data.json lays it out, plus
 * provenance. `names: 'redacted'` is what the endpoint serves by default;
 * `sample` mirrors it so the page shows its unlock box for redacted data.
 */
export function galaxyPayload(rows, { names = 'full', generatedAt = new Date().toISOString() } = {}) {
  const full = names === 'full';
  const chats = full ? rows.map(toCompact) : redactChats(rows.map(toCompact));
  const totals = { chats: chats.length, groups: 0, direct: 0, msgs: 0, media: 0, audio: 0, calls: 0, enc: 0, undated: 0 };
  for (const c of chats) {
    if (c.k === 'group') totals.groups++; else totals.direct++;
    totals.msgs += c.m; totals.media += c.md; totals.audio += c.au; totals.calls += c.cl; totals.enc += c.e;
    if (!c.f || !c.l) totals.undated++;
  }
  return { totals, sample: !full, names: full ? 'full' : 'redacted', source: 'neon', generated_at: generatedAt, chats };
}
