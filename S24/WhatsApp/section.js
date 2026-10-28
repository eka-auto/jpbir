// WhatsApp - volume and the busiest chats.
//
// Self-contained by design: its own key gate, its own connection pool and its
// own SQL. It imports nothing from another section.
//
// Counts are exact and come from the tables themselves; the list is the ten
// busiest chats, so the panel answers "how much" and "with whom" without
// paging through every message.
//
//   GET /api/s24-whatsapp?key=<STATS_KEY>

import pg from 'pg';
import { createHash, timingSafeEqual } from 'node:crypto';

export const meta = {
  slug: 'whatsapp',
  title: 'WhatsApp',
  endpoint: '/api/s24-whatsapp',
  tables: ['wa_chats', 'wa_messages', 'wa_attachments'],
};

const iso = (v) => (v ? new Date(v).toISOString() : null);
const n = (v) => (v == null ? 0 : Number(v));

let _pool = null;

function connectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
}

function pool() {
  const url = connectionString();
  if (!url) throw new Error('storage unavailable');
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: url.replace(/([?&]sslmode=)(?:prefer|require|verify-ca)(?=&|$)/, '$1verify-full'),
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: /[?&]sslmode=disable(?:&|$)/.test(url) ? false : { rejectUnauthorized: true },
    });
  }
  return _pool;
}

async function safe(query, sql, params = []) {
  try {
    return await query(sql, params);
  } catch (err) {
    // 42P01 = undefined_table, 42703 = undefined_column: both mean this deployment's
    // warehouse does not carry what the section asked for, so the section reports
    // that honestly instead of failing the whole panel.
    if (err && (err.code === '42P01' || err.code === '42703')) return { rows: [], _missing: true };
    throw err;
  }
}

export async function load(query) {
  const totals = await safe(query, 
    `select
       (select count(*) from wa_chats)::int as chats,
       (select count(*) from wa_messages)::int as messages,
       (select count(*) from wa_attachments)::int as attachments,
       (select max(last_at) from wa_chats) as newest_chat`,
  );
  if (totals._missing) return { migrated: false, chats: 0, messages: 0, attachments: 0, top_chats: [] };

  const top = await safe(query, 
    `select name, kind, msg_count, media_count, last_at
       from wa_chats order by msg_count desc nulls last limit 10`,
  );

  const row = ((totals.rows || [])[0] || {});
  return {
    chats: n(row.chats),
    messages: n(row.messages),
    attachments: n(row.attachments),
    newest_chat: iso(row.newest_chat),
    top_chats: (top.rows || []).map((r) => ({
      chat: r.name || '(unnamed)',
      kind: r.kind || null,
      messages: n(r.msg_count),
      media: n(r.media_count),
      last_at: iso(r.last_at),
    })),
  };
}

export function authorised(req) {
  const key = process.env.STATS_KEY || '';
  if (!key) {
    return { ok: false, status: 503, code: 'auth_not_configured', error: 'STATS_KEY is not configured on the server' };
  }
  const supplied = (req.query && req.query.key) || (req.headers && req.headers['x-stats-key']) || '';
  if (!supplied) return { ok: false, status: 401, code: 'auth_missing', error: 'missing key' };
  const digest = (v) => createHash('sha256').update(String(v), 'utf8').digest();
  return timingSafeEqual(digest(supplied), digest(key))
    ? { ok: true }
    : { ok: false, status: 401, code: 'auth_invalid', error: 'invalid key' };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });

  const auth = authorised(req);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, code: auth.code, error: auth.error });
  if (!connectionString()) return res.status(503).json({ ok: false, error: 'storage unavailable' });

  try {
    const data = await load((sql, params) => pool().query(sql, params));
    return res.status(200).json({ ok: true, section: meta.slug, title: meta.title, data });
  } catch {
    return res.status(503).json({ ok: false, error: 'storage unavailable' });
  }
}
