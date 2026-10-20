// Telegram inventory + messages for the jaytipargal.tech dashboard.
//
// The Telegram panel is the same client as the WhatsApp panel, pointed at
// tg_* tables instead of wa_* tables. The tables do not exist yet and there
// is no Telegram data anywhere on the box, so this route reports
// migrated:false with a specific note. That distinction matters: an empty
// list reads as "no messages found", which is a different claim from
// "nothing has been captured yet".
//
// Same privacy posture as jp-whatsapp.js: the payload would carry real
// contact names and chat ids, so the route is gated on STATS_KEY and the
// response is never cached.
//
// Schema this expects (apply before it lights up):
//   tg_chats   (chat_id pk, name, kind, unread_count, msg_count, enc_count,
//               media_count, member_count, first_at, last_at, updated_at)
//   tg_messages(msg_id pk, chat_id fk, body, sender, sender_label, kind,
//               encrypted, from_me, sent_at, seq)
import { requireKey } from './_auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';

const MAX_LIMIT = 500;

async function safe(sql, params = []) {
  try {
    return await query(sql, params);
  } catch (err) {
    // 42P01 = undefined_table. The tg_* tables are not applied yet, so this
    // is the expected first-run path, not a failure to report as an error.
    if (err && err.code === '42P01') return { rows: [], _missing: true };
    throw err;
  }
}

/* Postgres returns DATE as a JS Date, and String(date).slice(0, 10) gives
   "Tue Oct 20" rather than an ISO day. The client sorts and groups on this
   value, so it has to be a real YYYY-MM-DD. */
function dayStr(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function normalizeChat(row) {
  return {
    chat_id: row.chat_id,
    name: row.name || row.chat_id,
    kind: row.kind || 'direct',
    msg_count: row.msg_count || 0,
    enc_count: row.enc_count || 0,
    flagged_enc_count: row.flagged_enc_count || 0,
    media_count: row.media_count || 0,
    member_count: row.member_count || 0,
    unread_count: row.unread_count || 0,
    first_at: dayStr(row.first_at),
    last_at: dayStr(row.last_at),
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    /* These come from the message aggregate in the inventory query. They
       must not be reset here: the client uses readable_count to decide
       which chats have real text and which are metadata only. */
    readable_count: row.readable_count || 0,
    stored_count: row.stored_count || 0,
    call_count: row.call_count || 0,
    audio_count: row.audio_count || 0,
    unresolved: !!row.unresolved,
    device_id: row.device_id || 'telegram',
    source_system: row.source_system || 'tg-import',
  };
}

function normalizeMessage(m) {
  const readable = typeof m.body === 'string' && m.body.trim() !== '';
  return {
    msg_id: m.msg_id,
    sent_at: m.sent_at ? new Date(m.sent_at).toISOString() : null,
    from_me: m.from_me,
    sender: m.sender || null,
    sender_label: m.sender_label || m.sender || 'Unknown',
    kind: m.kind || 'text',
    encrypted: m.encrypted === true || !readable,
    readable,
    body: m.body,
    display_body: readable ? m.body : null,
  };
}

export default async function handler(req, res) {
  // Real names and chat ids travel in this response: never cache it.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');

  // Before anything touches the store: no key, no inventory.
  if (!requireKey(req, res)) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  if (!isConfigured()) {
    return res.status(503).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  }

  const op = String(req.query.op || 'inventory').trim();

  try {
    // ---- messages for one chat -------------------------------------------
    if (op === 'messages') {
      const chatId = String(req.query.chat_id || '').trim();
      if (!chatId) return res.status(400).json({ ok: false, error: 'chat_id required' });
      if (chatId.length > 200) return res.status(400).json({ ok: false, error: 'chat_id too long' });

      const rawLimit = Number(req.query.limit || 100);
      const limit = Number.isFinite(rawLimit) ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(rawLimit))) : 100;
      const before = String(req.query.before || '').trim();
      const q = String(req.query.q || '').trim().slice(0, 200);

      /* Keyset pagination over the whole ordering key (sent_at DESC, msg_id
         DESC), same shape as jp-wa-messages. A bare timestamp cursor would
         re-serve every row sharing the boundary time and would loop forever
         on undated rows, so the cursor carries both parts. */
      const conds = ['chat_id = $1'];
      const params = [chatId];
      if (q) { params.push(`%${q}%`); conds.push(`COALESCE(body,'') ILIKE $${params.length}`); }
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
      params.push(limit);

      const res1 = await safe(
        `SELECT msg_id, chat_id, body, sender, sender_label, kind, encrypted, from_me, sent_at
           FROM tg_messages
          WHERE ${conds.join(' AND ')}
          ORDER BY sent_at DESC NULLS LAST, msg_id DESC
          LIMIT $${params.length}`,
        params
      );
      if (res1._missing) {
        return res.status(200).json({
          ok: true, migrated: false, chat_id: chatId, messages: [],
          count: 0, total_count: 0, total_readable_count: 0, total_metadata_count: 0,
          next_before: null,
          note: 'Telegram tables are not applied yet.',
        });
      }

      const rows = res1.rows || [];
      const res2 = await safe(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE body IS NOT NULL AND btrim(body) <> '')::int AS readable
           FROM tg_messages WHERE chat_id = $1`,
        [chatId]
      );
      const tot = (res2.rows && res2.rows[0]) || { total: rows.length, readable: 0 };

      // Newest first from SQL; the client wants oldest-first for a thread.
      const messages = rows.map(normalizeMessage).reverse();
      /* The cursor must match the ordering key exactly, so it carries
         sent_at and msg_id. */
      let nextBefore = null;
      if (rows.length) {
        const last = rows[rows.length - 1];
        const sentIso = last.sent_at ? new Date(last.sent_at).toISOString() : '';
        nextBefore = sentIso + '|' + String(last.msg_id);
      }

      return res.status(200).json({
        ok: true, migrated: true, chat_id: chatId,
        messages, count: messages.length,
        total_count: tot.total || 0,
        total_readable_count: tot.readable || 0,
        total_metadata_count: (tot.total || 0) - (tot.readable || 0),
        next_before: nextBefore,
      });
    }

    // ---- chat detail ------------------------------------------------------
    if (op === 'chat') {
      const chatId = String(req.query.chat_id || '').trim();
      if (!chatId) return res.status(400).json({ ok: false, error: 'chat_id required' });
      const res1 = await safe(
        `SELECT chat_id, name, kind, msg_count, enc_count, media_count, member_count,
                unread_count, first_at, last_at, updated_at
           FROM tg_chats WHERE chat_id = $1`,
        [chatId]
      );
      if (res1._missing) {
        return res.status(200).json({ ok: true, migrated: false, chat: null, messages: [] });
      }
      return res.status(200).json({ ok: true, migrated: true, chat: res1.rows[0] || null });
    }

    // ---- inventory (default) ---------------------------------------------
    const res1 = await safe(
      `SELECT c.chat_id, c.name, c.kind, c.unresolved, c.msg_count,
              c.enc_count AS flagged_enc_count,
              COALESCE(m.readable_count, 0)::int AS readable_count,
              COALESCE(m.metadata_count, 0)::int AS enc_count,
              COALESCE(m.stored_count, 0)::int AS stored_count,
              c.media_count, c.member_count, c.unread_count,
              c.first_at, c.last_at, c.updated_at, c.device_id, c.source_system
         FROM tg_chats c
         LEFT JOIN (
           SELECT chat_id,
                  count(*) FILTER (WHERE body IS NOT NULL AND btrim(body) <> '')::int AS readable_count,
                  count(*) FILTER (WHERE body IS NULL OR btrim(body) = '')::int AS metadata_count,
                  count(*)::int AS stored_count
             FROM tg_messages GROUP BY chat_id
         ) m ON m.chat_id = c.chat_id
        ORDER BY c.msg_count DESC NULLS LAST, c.name`
    );
    if (res1._missing) {
      return res.status(200).json({
        ok: true, migrated: false, chats: [],
        totals: { chats: 0, groups: 0, direct: 0, msgs: 0, stored: 0, missing: 0,
                  readable: 0, media: 0, audio: 0, calls: 0, enc: 0, undated: 0 },
        runs: [],
        note: 'Telegram tables are not applied yet \u2014 run the Telegram migration and import before loading data.',
      });
    }

    const chats = (res1.rows || []).map(normalizeChat);
    const totals = { chats: chats.length, groups: 0, direct: 0, msgs: 0, stored: 0,
                     missing: 0, readable: 0, media: 0, audio: 0, calls: 0, enc: 0, undated: 0 };
    for (const c of chats) {
      if (c.kind === 'group') totals.groups++; else totals.direct++;
      totals.msgs += c.msg_count || 0;
      totals.stored += c.stored_count || 0;
      totals.readable += c.readable_count || 0;
      totals.media += c.media_count || 0;
      totals.enc += c.enc_count || 0;
      if (!c.first_at || !c.last_at) totals.undated++;
    }
    totals.missing = Math.max(0, totals.msgs - totals.stored);

    // Sync runs, so the panel shows when Telegram was last pushed. Empty
    // until a capture lands, which is the honest state.
    const runsRes = await safe(
      `SELECT run_id, device_id, chats_seen, messages_seen, status, note,
              started_at, finished_at
         FROM tg_sync_runs
        ORDER BY started_at DESC NULLS LAST
        LIMIT 20`
    );
    const runs = (runsRes.rows || []).map((r) => ({
      run_id: r.run_id,
      device_id: r.device_id,
      chats_seen: r.chats_seen | 0,
      messages_seen: r.messages_seen | 0,
      status: r.status,
      note: r.note,
      started_at: r.started_at ? new Date(r.started_at).toISOString() : null,
      finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    }));

    return res.status(200).json({
      ok: true, migrated: true,
      generated_at: new Date().toISOString(),
      chats, totals, runs,
    });
  } catch (err) {
    console.error('[jp-telegram] query failed', err);
    return res.status(500).json({ ok: false, error: 'telegram query failed' });
  }
}
