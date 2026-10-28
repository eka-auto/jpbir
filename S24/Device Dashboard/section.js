// Device Dashboard - the phone's record beside its telemetry history.
//
// Self-contained by design: its own key gate, its own connection pool and its
// own SQL. It imports nothing from another section.
//
// This is the panel an operator opens when a device is quiet, so it shows the
// three things that answer "why": how old the record is, how many commands are
// queued and unacknowledged, and the last few telemetry rows the device wrote.
//
//   GET /api/device-dashboard?key=<STATS_KEY>

import pg from 'pg';
import { createHash, timingSafeEqual } from 'node:crypto';

export const meta = {
  slug: 'device',
  title: 'Device Dashboard',
  endpoint: '/api/device-dashboard',
  tables: ['devices', 'device_telemetry', 'device_commands'],
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
  const record = await safe(query, 
    `select device_id, display_name, online, last_seen_at, daemon_version, platform
       from devices where device_id = $1 limit 1`,
    [DEVICE],
  );
  if (record._missing) return { device: DEVICE, migrated: false };

  const telemetry = await safe(query, 
    `select kind, display_name, model, os_version, agent_version, online, last_seen_at,
            battery_level, cpu_temp_c, carrier, network_type, public_ip, observed_at
       from device_telemetry where device_id = $1 order by observed_at desc nulls last limit 10`,
    [DEVICE],
  );

  // A queued command that was never acknowledged is the clearest evidence that
  // the device is not listening. It is reported, never hidden.
  const queued = await safe(query, 
    `select count(*)::int as waiting from device_commands
      where device_id = $1 and acknowledged_at is null`,
    [DEVICE],
  );

  const row = (record.rows || [])[0] || null;
  const seen = row && row.last_seen_at ? new Date(row.last_seen_at) : null;
  const ageSeconds = seen ? Math.max(0, Math.round((Date.now() - seen.getTime()) / 1000)) : null;

  return {
    device: DEVICE,
    present: Boolean(row),
    name: row ? row.display_name || null : null,
    online_field: row ? row.online === true : null,
    last_seen: row ? iso(row.last_seen_at) : null,
    age_seconds: ageSeconds,
    stale: ageSeconds == null ? true : ageSeconds > 900,
    daemon_version: row ? row.daemon_version || null : null,
    platform: row ? row.platform || null : null,
    commands_waiting: n((queued.rows || [{}])[0].waiting),
    telemetry_missing: telemetry._missing === true,
    telemetry: (telemetry.rows || []).map((t) => ({
      kind: t.kind || null,
      name: t.display_name || null,
      model: t.model || null,
      os: t.os_version || null,
      agent: t.agent_version || null,
      online: t.online === true,
      last_seen: iso(t.last_seen_at),
      battery: n(t.battery_level),
      cpu_temp_c: n(t.cpu_temp_c),
      carrier: t.carrier || null,
      network: t.network_type || null,
      public_ip: t.public_ip || null,
      observed_at: iso(t.observed_at),
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
