// Recent-content roll-up for the dashboard's Firestore / live-data panel.
//
// Existing endpoints all key on a single chat (jp-wa-messages, jp-wa-attachments)
// so the dashboard couldn't ask "what has arrived recently across every chat?"
// without opening a per-chat request per chat. This endpoint answers that in
// one round trip, both attachments and messages, restricted to a rolling
// time window so the UI never shows two-month-old rows just because someone
// slow-synced a legacy dump.
//
//   GET /api/jp-live-content?key=<STATS_KEY>&days=<n>&limit=<n>
//
// Same STATS_KEY gate as every other read route; the Postgres store is the
// same one jp-wa-messages / jp-wa-attachments read; the DB URL comes from
// DATABASE_URL, unchanged.

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
  if (!isConfigured()) {
    return res.status(503).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  }

  // Rolling time window in days. Clamps: 1..90. Default 7 — the point is
  // "live", so old syncs never surface here regardless of the store's history.
  const rawDays = Number(req.query.days || 7);
  const days = Number.isFinite(rawDays) ? Math.min(90, Math.max(1, Math.trunc(rawDays))) : 7;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  // Per-list cap. Bounded low because this feeds a poll-and-replace UI:
  // showing 500 rows every 10 s is neither useful nor cheap.
  const rawLimit = Number(req.query.limit || 40);
  const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.trunc(rawLimit))) : 40;

  try {
    // Attachments: newest first, only within the window. NULLS LAST because
    // rows can arrive without sent_at (e.g. daemon backfill) — we still want
    // the ones that DO have timestamps at the top.
    const att = await query(
      `SELECT att_id, chat_id, msg_id, kind, mime, file_name, size_bytes,
              duration_sec, width, height, blob_url, sent_at, device_id, ingested_at
         FROM wa_attachments
        WHERE (sent_at IS NULL AND ingested_at >= $1::timestamptz)
           OR sent_at >= $1::timestamptz
        ORDER BY sent_at DESC NULLS LAST, ingested_at DESC
        LIMIT $2`,
      [cutoff, limit]
    );

    // Same window for messages. Attachments-only rows are already covered
    // above, so kind='image'|'video'|etc rows appearing here are OK — they
    // just also have body text.
    const msgs = await query(
      `SELECT msg_id, chat_id, sent_at, from_me, sender, kind, body, ingested_at
         FROM wa_messages
        WHERE (sent_at IS NULL AND ingested_at >= $1::timestamptz)
           OR sent_at >= $1::timestamptz
        ORDER BY sent_at DESC NULLS LAST, ingested_at DESC
        LIMIT $2`,
      [cutoff, limit]
    );

    return res.status(200).json({
      ok: true,
      generated_at: new Date().toISOString(),
      window_days: days,
      attachments: att.rows.map((a) => ({
        att_id: a.att_id,
        chat_id: a.chat_id,
        msg_id: a.msg_id,
        kind: a.kind,
        mime: a.mime,
        file_name: a.file_name,
        size_bytes: a.size_bytes,
        duration_sec: a.duration_sec,
        width: a.width,
        height: a.height,
        blob_url: a.blob_url,
        sent_at: a.sent_at,
        ingested_at: a.ingested_at,
        device_id: a.device_id,
      })),
      messages: msgs.rows.map((m) => ({
        msg_id: m.msg_id,
        chat_id: m.chat_id,
        sent_at: m.sent_at,
        from_me: m.from_me,
        sender: m.sender,
        kind: m.kind,
        body: m.body,
        ingested_at: m.ingested_at,
      })),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'jp-live-content failed' });
  }
}
