// Admin-side per-chat detail for jaytipargal.tech's WhatsApp panel.
//
// Same shape as /api/wa-chat (the handle-based route on jaytibirthday-site)
// but addressed by raw chat_id and returning raw names — so it is gated on
// STATS_KEY, before it touches the store.
//
// The site-level gate is a browser gate: vercel.json dispatches straight to
// this handler, so anyone who knew a chat_id (a WhatsApp jid — a phone
// number) could read a chat's names and metadata without ever loading the
// dashboard. Authentication has to live here, in the handler.
//
// What it reads: wa_chats + wa_messages, both populated by the S24 daemon
// and the owner's wa-import. Message bodies land here later (path 2, chat
// export ingest); attachments land here later (path 3, Vercel Blob).
import { requireKey } from './_auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');

  // Raw names, chat ids and message statistics are private. Authenticate
  // before validating identifiers or reporting database configuration.
  if (!requireKey(req, res)) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  const chatId = String(req.query.chat_id || '').trim();
  if (!chatId) return res.status(400).json({ ok: false, error: 'chat_id required' });
  if (chatId.length > 200) return res.status(400).json({ ok: false, error: 'chat_id too long' });

  if (!isConfigured()) {
    return res.status(503).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  }

  try {
    const chatRes = await query(
      `SELECT chat_id, name, kind, unresolved, msg_count, enc_count, media_count, audio_count,
              call_count, member_count,
              to_char(first_at, 'YYYY-MM-DD') AS first_at,
              to_char(last_at,  'YYYY-MM-DD') AS last_at,
              device_id, source_system, ingested_at, updated_at
         FROM wa_chats WHERE chat_id = $1`,
      [chatId]
    );
    if (!chatRes.rows.length) return res.status(404).json({ ok: false, error: 'no such chat' });
    const row = chatRes.rows[0];

    const [kinds, direction, months, span, bodyStats] = await Promise.all([
      query('SELECT kind, count(*)::int n FROM wa_messages WHERE chat_id = $1 GROUP BY kind ORDER BY n DESC', [chatId]),
      query('SELECT from_me, count(*)::int n FROM wa_messages WHERE chat_id = $1 GROUP BY from_me', [chatId]),
      query(
        `SELECT to_char(date_trunc('month', sent_at), 'YYYY-MM') AS month, count(*)::int n
           FROM wa_messages
          WHERE chat_id = $1 AND sent_at IS NOT NULL
          GROUP BY 1 ORDER BY 1`,
        [chatId]
      ),
      query(
        `SELECT min(sent_at)::text AS first_at, max(sent_at)::text AS last_at,
                count(*) FILTER (WHERE sent_at IS NULL)::int AS undated,
                count(DISTINCT sender)::int AS senders,
                count(*)::int AS rows_held
           FROM wa_messages WHERE chat_id = $1`,
        [chatId]
      ),
      query(
        `SELECT count(*) FILTER (WHERE encrypted IS FALSE AND body IS NOT NULL AND body <> '') ::int AS readable,
                count(*) FILTER (WHERE encrypted IS TRUE)::int AS encrypted,
                 count(*)::int AS total
            FROM wa_messages WHERE chat_id = $1`,
        [chatId]
      ),
    ]);

    const sent = direction.rows.find((d) => d.from_me === true);
    const received = direction.rows.find((d) => d.from_me === false);
    const bs = bodyStats.rows[0] || { readable: 0, encrypted: 0, total: 0 };

    return res.status(200).json({
      ok: true,
      chat: {
        chat_id: row.chat_id,
        name: row.name,
        kind: row.kind,
        unresolved: !!row.unresolved,
        msg_count: row.msg_count | 0,
        enc_count: row.enc_count | 0,
        media_count: row.media_count | 0,
        audio_count: row.audio_count | 0,
        call_count: row.call_count | 0,
        member_count: row.member_count == null ? null : (row.member_count | 0),
        first_at: row.first_at || '',
        last_at: row.last_at || '',
        device_id: row.device_id || null,
        source_system: row.source_system || null,
        ingested_at: row.ingested_at,
        updated_at: row.updated_at,
      },
      detail: {
        rows_held: span.rows[0].rows_held | 0,
        sent: sent ? sent.n : 0,
        received: received ? received.n : 0,
        undated: span.rows[0].undated | 0,
        distinct_senders: span.rows[0].senders | 0,
        first_at: span.rows[0].first_at,
        last_at: span.rows[0].last_at,
        kinds: kinds.rows,
        months: months.rows,
      },
      bodies: {
        with_body: bs.readable | 0,
        encrypted: bs.encrypted | 0,
        total: bs.total | 0,
        available: (bs.readable | 0) > 0,
        reason: (bs.readable | 0) > 0 ? null : 'message text is not present in the recovery metadata; import a WhatsApp Chat Export',
      },
    });
  } catch (err) {
    if (err && err.code === '42P01') {
      return res.status(200).json({ ok: true, empty: true, reason: 'store not migrated yet' });
    }
    console.error('[jp-wa-chat]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
