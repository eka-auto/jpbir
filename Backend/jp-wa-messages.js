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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'GET only' });
  }
  if (!requireKey(req, res)) return;

  const chatId = String(req.query.chat_id || '').trim();
  if (!chatId) return res.status(400).json({ ok: false, error: 'chat_id required' });
  if (chatId.length > 200) return res.status(400).json({ ok: false, error: 'chat_id too long' });

  const rawLimit = Number(req.query.limit || 100);
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.trunc(rawLimit))) : 100;
  const before = String(req.query.before || '').trim();
  const q = String(req.query.q || '').trim().slice(0, 200);

  if (!isConfigured()) {
    return res.status(500).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  }

  try {
    const conds = ['chat_id = $1', 'body IS NOT NULL', "body <> ''"];
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
        conds.push(`(sent_at IS NULL OR sent_at < $${params.length}::timestamptz)`);
      } else if (curSent) {
        params.push(curSent); const sIdx = params.length;
        params.push(curId); const tIdx = params.length;
        conds.push(`((sent_at IS NOT NULL AND (sent_at, msg_id) < ($${sIdx}::timestamptz, $${tIdx})) OR sent_at IS NULL)`);
      } else {
        params.push(curId);
        conds.push(`(sent_at IS NULL AND msg_id < $${params.length})`);
      }
    }
    if (q) { params.push(`%${q}%`); conds.push(`body ILIKE $${params.length}`); }
    params.push(limit);

    const r = await query(
      `SELECT msg_id, sent_at, from_me, sender, kind, body, ingested_at
         FROM wa_messages
        WHERE ${conds.join(' AND ')}
        ORDER BY sent_at DESC NULLS LAST, msg_id DESC
        LIMIT $${params.length}`,
      params
    );

    const rows = r.rows.map((m) => ({
      msg_id: m.msg_id,
      sent_at: m.sent_at ? new Date(m.sent_at).toISOString() : null,
      from_me: m.from_me,
      sender: m.sender,
      kind: m.kind,
      body: m.body,
    }));

    // The composite cursor the parser above expects. Emitting sent_at alone
    // would leave the fix unreachable, since no client would ever send one.
    const last = rows.length === limit ? rows[rows.length - 1] : null;
    const cursor = last ? `${last.sent_at || ''}|${last.msg_id}` : null;

    return res.status(200).json({
      ok: true, chat_id: chatId, count: rows.length, next_before: cursor, q: q || null,
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
