// Admin-side attachments listing for jaytipargal.tech's WhatsApp drill-down.
//
// Serves wa_attachments rows for one chat, paged and optionally filtered by
// kind. The dashboard is site-gated, so this uses raw chat_id and returns
// raw blob_url + file names — no redaction.
//
//   GET /api/jp-wa-attachments?chat_id=<id>&kind=<kind>&limit=<n>&before=<iso>
import { query, isConfigured } from '../Integrations/postgres.js';
import { requireKey } from './_auth.js';

const KINDS = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker', 'other']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');

  // Blob URLs and filenames are private; fail closed before any route or store
  // detail is exposed.
  if (!requireKey(req, res)) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  const chatId = String(req.query.chat_id || '').trim();
  if (!chatId) return res.status(400).json({ ok: false, error: 'chat_id required' });
  if (chatId.length > 200) return res.status(400).json({ ok: false, error: 'chat_id too long' });

  const kind = String(req.query.kind || '').toLowerCase();
  if (kind && !KINDS.has(kind)) return res.status(400).json({ ok: false, error: 'unknown kind' });

  const rawLimit = Number(req.query.limit || 60);
  const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.trunc(rawLimit))) : 60;

  const before = String(req.query.before || '').trim();

  if (!isConfigured()) {
    return res.status(500).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  }

  try {
    const conds = ['chat_id = $1'];
    const params = [chatId];
    if (kind) { params.push(kind); conds.push(`kind = $${params.length}`); }
    if (before) { params.push(before); conds.push(`(sent_at IS NULL OR sent_at < $${params.length}::timestamptz)`); }
    params.push(limit);

    const r = await query(
      `SELECT att_id, chat_id, msg_id, kind, mime, file_name, size_bytes,
              duration_sec, width, height, blob_url, sent_at, device_id, ingested_at
         FROM wa_attachments
        WHERE ${conds.join(' AND ')}
        ORDER BY sent_at DESC NULLS LAST, ingested_at DESC
        LIMIT $${params.length}`,
      params
    );

    const byKind = await query(
      `SELECT kind, count(*)::int n FROM wa_attachments WHERE chat_id = $1 GROUP BY kind`,
      [chatId]
    );

    const rows = r.rows.map((a) => ({
      att_id: a.att_id,
      msg_id: a.msg_id,
      kind: a.kind,
      mime: a.mime,
      file_name: a.file_name,
      size_bytes: a.size_bytes == null ? null : Number(a.size_bytes),
      duration_sec: a.duration_sec,
      width: a.width,
      height: a.height,
      blob_url: a.blob_url,
      sent_at: a.sent_at ? new Date(a.sent_at).toISOString() : null,
      device_id: a.device_id || null,
    }));

    const cursor = rows.length === limit ? rows[rows.length - 1].sent_at : null;

    return res.status(200).json({
      ok: true,
      chat_id: chatId,
      kind: kind || null,
      by_kind: Object.fromEntries(byKind.rows.map((r) => [r.kind, r.n | 0])),
      total: byKind.rows.reduce((a, b) => a + (b.n | 0), 0),
      attachments: rows,
      next_before: cursor,
    });
  } catch (err) {
    if (err && err.code === '42P01') {
      return res.status(200).json({
        ok: true, migrated: false,
        note: 'wa_attachments table does not exist yet — apply Database/schema/005_wa_attachments.sql (npm run db:migrate).',
        attachments: [], by_kind: {}, total: 0,
      });
    }
    console.error('[jp-wa-attachments]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
