// Telegram - volume and the last sync runs.
//
// Self-contained by design: its own key gate, its own connection pool and its
// own SQL. It imports nothing from another section.
//
// Telegram has no writer in this estate yet, so the honest answer is usually
// zero. The sync-run list is what makes that legible: an empty table with no
// runs says "nothing has ever fed this", which is a different fact from
// "nothing has arrived lately".
//
//   GET /api/s24-telegram?key=<STATS_KEY>

import pg from 'pg';
import { createHash, timingSafeEqual } from 'node:crypto';

export const meta = {
  slug: 'telegram',
  title: 'Telegram',
  endpoint: '/api/s24-telegram',
  tables: ['tg_chats', 'tg_messages', 'tg_sync_runs'],
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
       (select count(*) from tg_chats)::int as chats,
       (select count(*) from tg_messages)::int as messages,
       (select count(*) from tg_sync_runs)::int as runs`,
  );
  if (totals._missing) return { migrated: false, chats: 0, messages: 0, runs: 0, sync_runs: [] };

  const runs = await safe(query, 
    `select source, last_success_at, record_count, status
       from tg_sync_runs order by last_success_at desc nulls last limit 10`,
  );

  const row = ((totals.rows || [])[0] || {});
  return {
    chats: n(row.chats),
    messages: n(row.messages),
    runs: n(row.runs),
    sync_runs: (runs.rows || []).map((r) => ({
      source: r.source || null,
      last_success_at: iso(r.last_success_at),
      records: n(r.record_count),
      status: r.status || null,
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
