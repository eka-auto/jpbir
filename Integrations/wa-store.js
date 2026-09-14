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
  return {
    msg_id: `${chat}:${key}`,
    chat_id: chat,
    sent_at: when && !Number.isNaN(when.getTime()) ? when.toISOString() : null,
    from_me: fromMe == null ? null : flag(fromMe),
    sender: str(rec.sender ?? rec.from) || null,
    kind: MSG_KINDS.has(kind) ? kind : 'other',
    encrypted: rec.encrypted != null || rec.sealed != null ? flag(rec.encrypted ?? rec.sealed) : body == null,
    body: body == null ? null : String(body),
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

/** Upsert messages in chunks. A message whose chat is unknown is dropped by the FK, not the whole batch. */
export async function upsertMessages(query, records, meta = {}) {
  const rows = new Map(); // same rule as chats: one row per msg_id in a statement
  let skipped = 0, duplicates = 0;
  for (const rec of records || []) {
    const m = normalizeMessage(rec, meta.chatId);
    if (!m) { skipped++; continue; }
    if (rows.has(m.msg_id)) duplicates++;
    rows.set(m.msg_id, { ...m, raw: JSON.stringify(rec) });
  }
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
         encrypted = EXCLUDED.encrypted,
         body      = COALESCE(EXCLUDED.body, wa_messages.body),
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
  return { upserted, skipped, duplicates };
}

/**
 * One ingest call: `{ device?, run_id?, chats?: [], messages?: [], done?: bool, note? }`.
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

  const c = await upsertChats(query, chats, { device, runId, source });
  const m = await upsertMessages(query, messages, { device, runId, source, chatId: b.chat_id });

  // Non-additive accounting: the tallies are the rows that carry this run_id
  // right now, so a retried batch (same run_id, idempotent upserts above)
  // reports the same numbers instead of doubling them.
  await query(
    `INSERT INTO wa_sync_runs (run_id, device_id, chats_seen, messages_seen, status, note, finished_at)
     VALUES ($1, $2,
             (SELECT COUNT(*)::int FROM wa_chats    WHERE run_id = $1),
             (SELECT COUNT(*)::int FROM wa_messages WHERE run_id = $1),
             $3, $4, $5)
     ON CONFLICT (run_id) DO UPDATE SET
       device_id     = COALESCE(EXCLUDED.device_id, wa_sync_runs.device_id),
       chats_seen    = EXCLUDED.chats_seen,
       messages_seen = EXCLUDED.messages_seen,
       status        = EXCLUDED.status,
       note          = COALESCE(EXCLUDED.note, wa_sync_runs.note),
       finished_at   = COALESCE(EXCLUDED.finished_at, wa_sync_runs.finished_at)`,
    [runId, device, b.done ? 'done' : 'running', str(b.note) || null,
      b.done ? new Date().toISOString() : null]
  );

  return { run_id: runId, device, chats: c, messages: m, done: Boolean(b.done) };
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
