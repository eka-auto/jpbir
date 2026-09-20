// Read side of the WhatsApp inventory for the dashboard's WhatsApp section.
//
// Unlike the birthday site's public /api/galaxy — which serves numbered
// placeholders to the world and releases names only behind its own opt-in —
// this route is part of the private dashboard and is gated by the same
// STATS_KEY every other analytics endpoint uses. There is no public mode and
// no redacted mode: a caller either holds the dashboard key and sees the real
// inventory, or gets 401 and sees nothing. That keeps 862 real contact names
// off the open internet while the owner's own dashboard shows them plainly.
//
// Read-only. The rows are written from the owner's machine by
// Database/scripts/wa-import.mjs; nothing here writes.
import { requireKey } from './_auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';
import { CHAT_SELECT, galaxyPayload } from '../Integrations/wa-store.js';

export default async function handler(req, res) {
  // Real names come back here, so never let a shared cache hold a copy.
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

  try {
    const r = await query(CHAT_SELECT);
    if (!r.rows.length) {
      // Not an error: the store exists but nobody has imported into it yet.
      return res.status(200).json({
        ok: true,
        empty: true,
        reason: 'no chats imported yet',
        howTo: ['npm run wa:build -- <recovery dir>', 'npm run wa:import -- Database/wa-inventory.json'],
        totals: { chats: 0, groups: 0, direct: 0, msgs: 0, media: 0, audio: 0, calls: 0, enc: 0, undated: 0 },
        chats: [],
      });
    }
    // When the inventory was last loaded, not when this request ran. Letting
    // galaxyPayload default `generatedAt` to now() would make the section's
    // "imported ... ago" read "just now" on every page load, which is exactly
    // the opposite of what it is there to tell you.
    const stamp = await query('SELECT max(updated_at) AS at FROM wa_chats');
    const importedAt = stamp.rows[0] && stamp.rows[0].at ? new Date(stamp.rows[0].at).toISOString() : undefined;

    return res.status(200).json({ ok: true, ...galaxyPayload(r.rows, { names: 'full', generatedAt: importedAt }) });
  } catch (err) {
    // 42P01 = undefined_table: 004_whatsapp.sql has not been applied yet. That
    // is "nothing here", not a fault — report it as the setup step it is.
    if (err && err.code === '42P01') {
      return res.status(200).json({
        ok: true,
        empty: true,
        reason: 'store not migrated yet',
        howTo: ['npm run db:migrate'],
        totals: { chats: 0, groups: 0, direct: 0, msgs: 0, media: 0, audio: 0, calls: 0, enc: 0, undated: 0 },
        chats: [],
      });
    }
    console.error('[wa-galaxy]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
