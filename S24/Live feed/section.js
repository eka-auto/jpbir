// Live feed - the newest messages and the newest site events, side by side.
//
// Self-contained by design: its own key gate, its own connection pool and its
// own SQL. It imports nothing from another section.
//
// This is the "what just happened" panel, so it reads the two tails directly
// rather than aggregating. Message bodies are shown because the panel exists to
// be read by the operator who already holds the dashboard key; nothing else
// about a message leaves here.
//
//   GET /api/s24-live?key=<STATS_KEY>

import pg from 'pg';
import { createHash, timingSafeEqual } from 'node:crypto';

export const meta = {
  slug: 'live',
  title: 'Live feed',
  endpoint: '/api/s24-live',
  tables: ['wa_messages', 'events'],
};

const iso = (v) => (v ? new Date(v).toISOString() : null);

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
  const messages = await safe(query, 
    `select sender, body, sent_at from wa_messages order by sent_at desc nulls last limit 10`,
  );
  const events = await safe(query, 
    `select event_type, occurred_at, country, city from events order by occurred_at desc nulls last limit 10`,
  );
  if (messages._missing && events._missing) return { migrated: false, messages: [], events: [] };

  return {
    messages: (messages.rows || []).map((r) => ({
      sender: r.sender || null,
      text: r.body || null,
      sent_at: iso(r.sent_at),
    })),
    events: (events.rows || []).map((r) => ({
      type: r.event_type || null,
      at: iso(r.occurred_at),
      place: [r.city, r.country].filter(Boolean).join(', ') || null,
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
