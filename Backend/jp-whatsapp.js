// WhatsApp inventory for the jaytipargal.tech dashboard.
//
// Reads wa_chats (and wa_sync_runs when it exists) from the shared Neon store
// — the same tables jaytibirthday-site's /api/wa-ingest writes to, so one
// ingest from the owner's machine populates both sites.
//
// This is the owner's private admin dashboard, so names come back as they are
// stored, not redacted — which is exactly why the route is gated on STATS_KEY,
// the same key every other analytics endpoint here uses. It previously had no
// check at all: noindex and an obscure hostname are not access control, and
// this payload is 862 real contact names together with their chat_ids, which
// are WhatsApp jids — phone numbers. Anyone who guessed the path had all of it.
// jaytibirthday-site's /api/galaxy keeps its own separate redaction gate.
//
// If the wa_* tables have not been created yet (the schema in
// jaytibirthday-site's Database/schema/002_whatsapp.sql has not been applied),
// this answers with an empty payload flagged migrated:false so the dashboard
// can show a "run the migration" hint instead of a broken panel.
import { requireKey } from './_auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';
import { MESSAGE_BODY_PLACEHOLDERS } from '../Integrations/wa-store.js';

const iso = (v) => (v ? new Date(v).toISOString() : null);
const dayStr = (v) => (v ? String(v).slice(0, 10) : '');

async function safe(sql, params = []) {
  try {
    return await query(sql, params);
  } catch (err) {
    // 42P01 = undefined_table. The other queries would fail too — surface once.
    if (err && err.code === '42P01') return { rows: [], _missing: true };
    throw err;
  }
}

export default async function handler(req, res) {
  // Real names travel in this response, so never let a shared cache hold it.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');

  // Before anything touches the store: no key, no inventory.
  if (!requireKey(req, res)) return;

  if (!isConfigured()) {
    return res.status(503).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  }

  try {
    const chatsRes = await safe(
      `SELECT c.chat_id, c.name, c.kind, c.unresolved, c.msg_count,
              c.enc_count AS flagged_enc_count,
              COALESCE(b.readable_count, 0)::int AS readable_count,
              COALESCE(b.metadata_count, 0)::int AS enc_count,
              COALESCE(b.stored_count, 0)::int AS stored_count,
              c.media_count, c.audio_count, c.call_count, c.member_count,
              to_char(c.first_at, 'YYYY-MM-DD') AS first_at,
              to_char(c.last_at,  'YYYY-MM-DD') AS last_at,
              c.device_id, c.run_id, c.source_system,
              c.ingested_at, c.updated_at
         FROM wa_chats c
         LEFT JOIN (
           SELECT chat_id,
                  count(*) FILTER (
                    WHERE body IS NOT NULL AND btrim(body) <> '' AND body <> ALL($1::text[])
                  )::int AS readable_count,
                  count(*) FILTER (
                    WHERE body IS NULL OR btrim(body) = '' OR body = ANY($1::text[])
                  )::int AS metadata_count,
                  count(*)::int AS stored_count
             FROM wa_messages
            GROUP BY chat_id
         ) b ON b.chat_id = c.chat_id
        ORDER BY c.msg_count DESC NULLS LAST, c.name`,
      [MESSAGE_BODY_PLACEHOLDERS]
    );

    if (chatsRes._missing) {
      return res.status(200).json({
        ok: true,
        migrated: false,
        chats: [],
        totals: { chats: 0, groups: 0, direct: 0, msgs: 0, stored: 0, missing: 0, readable: 0, media: 0, audio: 0, calls: 0, enc: 0, undated: 0 },
        runs: [],
        note: 'WhatsApp tables are not fully migrated — run npm run db:migrate before loading data.',
      });
    }

    const chats = chatsRes.rows;
    const totals = { chats: chats.length, groups: 0, direct: 0, msgs: 0, stored: 0, missing: 0, readable: 0, media: 0, audio: 0, calls: 0, enc: 0, undated: 0 };
    for (const c of chats) {
      if (c.kind === 'group') totals.groups++; else totals.direct++;
      totals.msgs += c.msg_count || 0;
      totals.stored += c.stored_count || 0;
      totals.readable += c.readable_count || 0;
      totals.media += c.media_count || 0;
      totals.audio += c.audio_count || 0;
      totals.calls += c.call_count || 0;
      totals.enc  += c.enc_count  || 0;
      if (!c.first_at || !c.last_at) totals.undated++;
    }
    totals.missing = Math.max(0, totals.msgs - totals.stored);

    // Last few sync runs, so the panel shows when the S24 last pushed.
    const runsRes = await safe(
      `SELECT run_id, device_id, chats_seen, messages_seen, status, note,
              started_at, finished_at
         FROM wa_sync_runs
        ORDER BY started_at DESC NULLS LAST
        LIMIT 20`
    );

    return res.status(200).json({
      ok: true,
      migrated: true,
      generated_at: new Date().toISOString(),
      totals,
      // Compact fields the dashboard renders. Kept flat for a table.
      chats: chats.map((c) => ({
        chat_id: c.chat_id,
        name: c.name,
        kind: c.kind,
        unresolved: !!c.unresolved,
        msg_count: c.msg_count | 0,
        stored_count: c.stored_count | 0,
        readable_count: c.readable_count | 0,
        enc_count: c.enc_count | 0,
        flagged_enc_count: c.flagged_enc_count | 0,
        media_count: c.media_count | 0,
        audio_count: c.audio_count | 0,
        call_count: c.call_count | 0,
        member_count: c.member_count == null ? null : (c.member_count | 0),
        first_at: dayStr(c.first_at),
        last_at: dayStr(c.last_at),
        device_id: c.device_id || null,
        source_system: c.source_system || null,
        ingested_at: iso(c.ingested_at),
        updated_at: iso(c.updated_at),
      })),
      runs: (runsRes.rows || []).map((r) => ({
        run_id: r.run_id,
        device_id: r.device_id || null,
        chats_seen: r.chats_seen | 0,
        messages_seen: r.messages_seen | 0,
        status: r.status || null,
        note: r.note || null,
        started_at: iso(r.started_at),
        finished_at: iso(r.finished_at),
      })),
    });
  } catch (err) {
    console.error('[jp-whatsapp] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
