// Per-chat detail for the dashboard's WhatsApp section: what one chat's
// 110,398-row message history looks like, without the chat's identity.
//
// The caller addresses a chat by the opaque handle `h` that /api/wa-galaxy
// already put on every row, never by jid. The handle is resolved here by
// hashing the chat ids we hold and matching — 862 rows, one indexless pass —
// rather than by asking Postgres for a digest, so this needs no extension.
//
// What it deliberately does NOT return: the chat_id, and the `sender` column.
// Both are phone numbers. Group senders are counted, never listed.
//
// There is no message text to return. Every one of the bodies in the recovery
// dump is sealed, so wa_messages carries metadata only and `encrypted` is true
// on every row; the payload says so explicitly rather than showing empty
// bubbles that look like a loading failure.
import { requireKey } from './_auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';
import { handleFor } from '../Integrations/wa-store.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'GET only' });
  }
  if (!requireKey(req, res)) return;

  // Shape before state: a malformed handle is refused without touching the
  // store, so a bad request never reports on whether the database is reachable.
  const wanted = String(req.query.h || '').trim();
  if (!/^[0-9a-f]{16}$/.test(wanted)) {
    return res.status(400).json({ ok: false, error: 'h must be a 16-character chat handle' });
  }

  if (!isConfigured()) {
    return res.status(500).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  }

  try {
    const chats = await query(
      `SELECT chat_id, name, kind, unresolved, msg_count, enc_count, media_count, audio_count,
              call_count, member_count,
              to_char(first_at, 'YYYY-MM-DD') AS first_at,
              to_char(last_at,  'YYYY-MM-DD') AS last_at
         FROM wa_chats`
    );
    const row = chats.rows.find((c) => handleFor(c.chat_id) === wanted);
    if (!row) return res.status(404).json({ ok: false, error: 'no such chat' });

    const [kinds, direction, months, span] = await Promise.all([
      query('SELECT kind, count(*)::int n FROM wa_messages WHERE chat_id = $1 GROUP BY kind ORDER BY n DESC', [row.chat_id]),
      query('SELECT from_me, count(*)::int n FROM wa_messages WHERE chat_id = $1 GROUP BY from_me', [row.chat_id]),
      query(
        `SELECT to_char(date_trunc('month', sent_at), 'YYYY-MM') AS month, count(*)::int n
           FROM wa_messages
          WHERE chat_id = $1 AND sent_at IS NOT NULL
          GROUP BY 1 ORDER BY 1`,
        [row.chat_id]
      ),
      query(
        `SELECT min(sent_at)::text AS first_at, max(sent_at)::text AS last_at,
                count(*) FILTER (WHERE sent_at IS NULL)::int AS undated,
                count(DISTINCT sender)::int AS senders,
                count(*)::int AS rows_held
           FROM wa_messages WHERE chat_id = $1`,
        [row.chat_id]
      ),
    ]);

    const sent = direction.rows.find((d) => d.from_me === true);
    const received = direction.rows.find((d) => d.from_me === false);

    return res.status(200).json({
      ok: true,
      chat: {
        h: wanted,
        n: row.name,
        k: row.kind,
        u: row.unresolved ? 1 : 0,
        m: row.msg_count | 0,
        md: row.media_count | 0,
        au: row.audio_count | 0,
        cl: row.call_count | 0,
        sz: row.member_count == null ? 0 : row.member_count | 0,
        f: row.first_at || '',
        l: row.last_at || '',
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
      // Stated, not implied: the dump is metadata. Nothing here can show text.
      bodies: { available: false, reason: 'the recovery dump carries no message bodies — every message is sealed' },
    });
  } catch (err) {
    if (err && err.code === '42P01') {
      return res.status(200).json({ ok: true, empty: true, reason: 'store not migrated yet', howTo: ['npm run db:migrate'] });
    }
    console.error('[wa-chat]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
