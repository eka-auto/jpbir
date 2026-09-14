// Admin-side message body listing for jaytipargal.tech's WhatsApp drill-down.
//
// Serves wa_messages rows with body IS NOT NULL (i.e. lines imported by
// Devices/S24/wa_export_import.py). Paged newest-first, kind-filterable,
// simple text search. Dashboard is site-gated so this uses raw chat_id.
//
//   GET /api/jp-wa-messages?chat_id=<id>&limit=<n>&before=<iso>&q=<text>
import { query, isConfigured } from '../Integrations/postgres.js';
import { requireKey } from './_auth.js';

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

  if (!isConfigured()) {
    return res.status(500).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  }

  try {
    const conds = ['chat_id = $1', 'body IS NOT NULL', "body <> ''"];
    const params = [chatId];
    if (before) { params.push(before); conds.push(`(sent_at IS NULL OR sent_at < $${params.length}::timestamptz)`); }
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

    const cursor = rows.length === limit ? rows[rows.length - 1].sent_at : null;

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
