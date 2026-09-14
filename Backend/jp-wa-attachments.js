// Admin-side attachments listing for jaytipargal.tech's WhatsApp drill-down.
//
// Serves wa_attachments rows for one chat, paged and optionally filtered by
// kind, with raw chat_id, blob_url and file names — so it is gated on
// STATS_KEY before it touches the store.
//
// The site gate is a browser gate: vercel.json dispatches straight here, so
// without this check anyone who knew a chat_id (a WhatsApp jid — a phone
// number) could pull that chat's private media URLs without ever loading the
// dashboard.
//
//   GET /api/jp-wa-attachments?chat_id=<id>&kind=<kind>&limit=<n>&before=<iso>
import { requireKey } from './_auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';

const KINDS = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker', 'other']);

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
    // Keyset pagination over the WHOLE ordering key. A cursor of sent_at alone
    // was wrong three ways: rows sharing the boundary timestamp were skipped by
    // the strict `<`, every undated row was re-included on each page by the
    // `sent_at IS NULL OR` disjunct, and a page ending on a NULL sent_at
    // produced a null cursor so paging stopped with rows still unread.
    // The cursor is "<sent_at iso|''>|<ingested_at iso>", opaque to the client.
    if (before) {
      const sep = before.indexOf('|');
      const curSent = sep === -1 ? before : before.slice(0, sep);
      const curTie = sep === -1 ? '' : before.slice(sep + 1);
      if (!curTie) {
        // A cursor issued before this change: a bare timestamp. Honour it.
        params.push(curSent);
        conds.push(`(sent_at IS NULL OR sent_at < $${params.length}::timestamptz)`);
      } else if (curSent) {
        params.push(curSent); const s = params.length;
        params.push(curTie); const t = params.length;
        // Still inside the dated rows; undated ones all sort after them.
        conds.push(`((sent_at IS NOT NULL AND (sent_at, ingested_at) < ($${s}::timestamptz, $${t}::timestamptz)) OR sent_at IS NULL)`);
      } else {
        params.push(curTie);
        // Past the dated rows: only older undated ones remain.
        conds.push(`(sent_at IS NULL AND ingested_at < $${params.length}::timestamptz)`);
      }
    }
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

    // The composite cursor the `before` parser above expects, built from the
    // raw row because ingested_at is deliberately not carried on the mapped
    // rows. Emitting sent_at alone here is what kept the original bug alive:
    // the parser understood a full ordering key, but no client was ever handed
    // one, so same-timestamp rows were still skipped and NULL-dated pages still
    // dead-ended.
    const last = rows.length === limit ? r.rows[r.rows.length - 1] : null;
    const cursor = last
      ? `${last.sent_at ? new Date(last.sent_at).toISOString() : ''}|${new Date(last.ingested_at).toISOString()}`
      : null;

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
