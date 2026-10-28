// S24 Ultra - the phone's own record.
//
// Self-contained by design: its own key gate, its own connection pool and its
// own SQL. It imports nothing from another section, so this folder can be
// lifted out of the repository and served on its own.
//
// The record is written by the phone. This section reports what the record
// holds; it never claims the phone is up, because the record cannot know that.
//
//   GET /api/s24-ultra?key=<STATS_KEY>

import pg from 'pg';
import { createHash, timingSafeEqual } from 'node:crypto';

export const meta = {
  slug: 's24',
  title: 'S24 Ultra',
  endpoint: '/api/s24-ultra',
  tables: ['devices'],
  device: 'samsung-s24-ultra',
};

const DEVICE = meta.device;

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
      // Only the sslmode parameter is rewritten, so the credentials survive
      // untouched; an explicit sslmode=disable is honoured for a local database.
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
    // 42P01 = undefined_table: the schema is not applied here yet. A panel then
    // says "run the migration" instead of breaking.
    // 42P01 = undefined_table, 42703 = undefined_column: both mean this
    // deployment's warehouse does not carry what the section asked for. The
    // section reports that honestly instead of failing the whole panel.
    if (err && (err.code === '42P01' || err.code === '42703')) return { rows: [], _missing: true };
    throw err;
  }
}

export async function load(query) {
  const { rows, _missing } = await safe(query, 
    `select * from devices where device_id = $1 limit 1`,
    [DEVICE],
  );
  if (_missing) return { device: DEVICE, migrated: false };

  const row = rows[0];
  if (!row) return { device: DEVICE, present: false };

  const seen = row.last_seen_at ? new Date(row.last_seen_at) : null;
  const ageSeconds = seen ? Math.max(0, Math.round((Date.now() - seen.getTime()) / 1000)) : null;

  return {
    device: row.device_id,
    present: true,
    name: row.display_name || null,
    online_field: row.online === true,
    last_seen: iso(row.last_seen_at),
    age_seconds: ageSeconds,
    // The record's own age, not a liveness claim.
    stale: ageSeconds == null ? true : ageSeconds > 900,
    daemon_version: row.daemon_version || null,
    platform: row.platform || null,
    battery: n(row.battery_level),
    network: row.network_type || null,
    carrier: row.carrier || null,
    public_ip: row.public_ip || null,
    recorded_at: iso(row.updated_at),
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
