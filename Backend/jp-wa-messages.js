// Admin-side message body listing for jaytipargal.tech's WhatsApp drill-down.
//
// Serves wa_messages rows with body IS NOT NULL (i.e. lines imported by
// Devices/S24/wa_export_import.py). Paged newest-first, kind-filterable,
// simple text search, with raw chat_id and raw message bodies — so it is
// gated on STATS_KEY before it touches the store.
//
// The site gate is a browser gate: vercel.json dispatches straight here, so
// without this check anyone who knew a chat_id (a WhatsApp jid — a phone
// number) could read up to 500 private message bodies without ever loading
// the dashboard.
//
//   GET /api/jp-wa-messages?chat_id=<id>&limit=<n>&before=<cursor>&q=<text>
import { requireKey } from './_auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';
import {
  MESSAGE_BODY_PLACEHOLDERS,
  displayMessageBody,
  isReadableMessageBody,
  messageSenderLabel,
  normalizeSender,
} from '../Integrations/wa-store.js';

export function presentMessageRow(m) {
  const readable = isReadableMessageBody(m);
  return {
    msg_id: m.msg_id,
    sent_at: m.sent_at ? new Date(m.sent_at).toISOString() : null,
    from_me: m.from_me,
    sender: normalizeSender(m.sender),
    sender_label: messageSenderLabel(m),
    kind: m.kind,
    encrypted: m.encrypted === true,
    readable,
    body: m.body,
    display_body: displayMessageBody(m),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');

  // Message bodies and sender identifiers are private. The guard must run
  // before validation and before checking whether Neon is configured.
  if (!requireKey(req, res)) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  const chatId = String(req.query.chat_id || '').trim();
  if (!chatId) return res.status(400).json({ ok: false, error: 'chat_id required' });
  if (chatId.length > 200) return res.status(400).json({ ok: false, error: 'chat_id too long' });

  const rawLimit = Number(req.query.limit || 100);
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.trunc(rawLimit))) : 100;
  const before = String(req.query.before || '').trim();
  const q = String(req.query.q || '').trim().slice(0, 200);
  const readableFirst = String(req.query.readable_first || '1') !== '0';

  if (!isConfigured()) {
    return res.status(503).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  }

  try {
    const baseConds = ['m.chat_id = $1', 'm.body IS NOT NULL', "btrim(m.body) <> ''"];
    const conds = baseConds.slice();
    const params = [chatId];
    // Keyset pagination over the whole ordering key (sent_at DESC NULLS LAST,
    // msg_id DESC). A cursor of sent_at alone skipped every row sharing the
    // boundary timestamp, re-included all undated rows on each page via the
    // `sent_at IS NULL OR` disjunct, and dead-ended once a page finished on a
    // NULL sent_at. Cursor is "<sent_at iso|''>|<msg_id>", opaque to clients.
    if (before) {
      const sep = before.indexOf('|');
      const curSent = sep === -1 ? before : before.slice(0, sep);
      const curId = sep === -1 ? '' : before.slice(sep + 1);
      if (!curId) {
        // A cursor issued before this change: a bare timestamp. Honour it.
        params.push(curSent);
        conds.push(`(m.sent_at IS NULL OR m.sent_at < $${params.length}::timestamptz)`);
      } else if (curSent) {
        params.push(curSent); const sIdx = params.length;
        params.push(curId); const tIdx = params.length;
        conds.push(`((m.sent_at IS NOT NULL AND (m.sent_at, m.msg_id) < ($${sIdx}::timestamptz, $${tIdx})) OR m.sent_at IS NULL)`);
      } else {
        params.push(curId);
        conds.push(`(m.sent_at IS NULL AND m.msg_id < $${params.length})`);
      }
    }
    if (q) { params.push(`%${q}%`); conds.push(`m.body ILIKE $${params.length}`); }
    if (readableFirst) params.push(MESSAGE_BODY_PLACEHOLDERS);
    params.push(limit);

    const countConds = baseConds.slice();
    const countParams = [chatId, MESSAGE_BODY_PLACEHOLDERS];
    if (q) { countParams.push(`%${q}%`); countConds.push(`m.body ILIKE $${countParams.length}`); }
    const readableBody = 'm.body <> ALL($2::text[])';

    const [r, totalsResult] = await Promise.all([
      query(
        `SELECT m.msg_id, m.sent_at, m.from_me, m.sender, m.kind, m.encrypted, m.body,
                m.ingested_at, c.name AS chat_name, c.kind AS chat_kind
           FROM wa_messages m
           JOIN wa_chats c ON c.chat_id = m.chat_id
          WHERE ${conds.join(' AND ')}
          ORDER BY ${readableFirst ? `CASE WHEN m.body <> ALL($${params.length - 1}::text[]) THEN 0 ELSE 1 END,` : ''}
                   m.sent_at DESC NULLS LAST, m.msg_id DESC
          LIMIT $${params.length}`,
        params
      ),
      query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE ${readableBody})::int AS readable,
                count(*) FILTER (WHERE NOT (${readableBody}))::int AS metadata_only
           FROM wa_messages m
          WHERE ${countConds.join(' AND ')}`,
        countParams
      ),
    ]);

    const rows = r.rows.map(presentMessageRow);
    const totals = totalsResult.rows[0] || { total: 0, readable: 0, metadata_only: 0 };

    // The composite cursor the parser above expects. Emitting sent_at alone
    // would leave the fix unreachable, since no client would ever send one.
    const last = rows.length === limit ? rows[rows.length - 1] : null;
    const cursor = last ? `${last.sent_at || ''}|${last.msg_id}` : null;

    return res.status(200).json({
      ok: true, chat_id: chatId, count: rows.length, next_before: cursor, q: q || null,
      readable_count: rows.filter((m) => m.readable).length,
      encrypted_count: rows.filter((m) => !m.readable).length,
      total_count: totals.total | 0,
      total_readable_count: totals.readable | 0,
      total_metadata_count: totals.metadata_only | 0,
      messages: rows,
    });
  } catch (err) {
    if (err && err.code === '42P01') {
      return res.status(200).json({ ok: true, migrated: false, messages: [], count: 0 });
    }
    console.error('[jp-wa-messages]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
