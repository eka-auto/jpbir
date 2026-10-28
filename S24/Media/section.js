// Media - the attachments WhatsApp carried.
//
// Self-contained by design: its own key gate, its own connection pool and its
// own SQL. It imports nothing from another section.
//
// Only descriptive fields leave this endpoint: a file name, its type, its size
// and when it was sent. No bytes, no storage path and no blob URL, so a listing
// can never be turned into a download of someone's private media.
//
//   GET /api/s24-media?key=<STATS_KEY>

import pg from 'pg';
import { createHash, timingSafeEqual } from 'node:crypto';

export const meta = {
  slug: 'media',
  title: 'Media',
  endpoint: '/api/s24-media',
  tables: ['wa_attachments'],
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
    if (err && err.code === '42P01') return { rows: [], _missing: true };
    throw err;
  }
}

export async function load(query) {
  const recent = await safe(query, 
    `select att_id, file_name, mime, size_bytes, kind, sent_at
       from wa_attachments order by sent_at desc nulls last limit 10`,
  );
  if (recent._missing) return { migrated: false, count: 0, bytes: 0, attachments: [] };

  const total = await safe(query, `select count(*)::int as c, coalesce(sum(size_bytes), 0)::bigint as b from wa_attachments`);
  const row = (total.rows || [{}])[0];

  return {
    count: n(row.c),
    bytes: n(row.b),
    attachments: (recent.rows || []).map((r) => ({
      name: r.file_name || '(unnamed)',
      mime: r.mime || null,
      kind: r.kind || null,
      size_bytes: n(r.size_bytes),
      sent_at: iso(r.sent_at),
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
