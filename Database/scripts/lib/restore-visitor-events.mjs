// Restore preserved warehouse rows without replaying them through live ingest:
// ingestion would replace their timestamps and can generate new event IDs.
import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

const encode = (value) => JSON.stringify(canonical(value));
const digest = (value) => createHash('sha256').update(encode(value)).digest('hex');
const IDENTITY = ['id', 'site', 'event_type', 'occurred_at', 'session_id', 'visitor_id', 'page_url'];

export function planVisitorRestore(sourceRows, targetRows, { site, since, until, maxRows = 5000 }) {
  if (site !== 'jaytibirthday.in') throw new Error('restore is restricted to the birthday property');
  const start = Date.parse(since), end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('invalid restore window');
  if (sourceRows.length > maxRows) throw new Error('restore row limit exceeded');
  const byId = new Map();
  for (const row of sourceRows) {
    const at = Date.parse(row.occurred_at);
    if (!row.id || typeof row.id !== 'string' || row.site !== site || !row.id.startsWith(site + ':') ||
        !row.event_type || !Number.isFinite(at) || at < start || at >= end) {
      throw new Error('source contains an invalid or out-of-scope event');
    }
    if (byId.has(row.id)) throw new Error('source contains duplicate event IDs');
    byId.set(row.id, row);
  }
  const existing = new Map(targetRows.map((row) => [row.id, row]));
  for (const row of sourceRows) {
    const target = existing.get(row.id);
    if (target && IDENTITY.some((key) => encode(row[key] ?? null) !== encode(target[key] ?? null))) {
      throw new Error('an existing event has conflicting identity fields');
    }
  }
  const ordered = [...sourceRows].sort((a, b) => a.id.localeCompare(b.id));
  const missing = ordered.filter((row) => !existing.has(row.id));
  const payload = JSON.stringify(missing);
  if (Buffer.byteLength(payload) > 20 * 1024 * 1024) throw new Error('restore payload limit exceeded');
  return {
    site, since, until, sourceDigest: digest(ordered), missingDigest: digest(missing),
    sourceCount: ordered.length, existingCount: ordered.length - missing.length,
    missingCount: missing.length, rows: missing,
  };
}

export function restoreSummary(plan) {
  const { rows, ...summary } = plan;
  return summary;
}

async function refreshRollups(db, site, visitors, sessions) {
  if (visitors.length) await db(
    `INSERT INTO visitors (visitor_id,site,first_seen_at,last_seen_at,event_count,session_count,
       country,region,city,timezone,user_agent,device_type,browser,os,fingerprint)
     SELECT a.visitor_id,a.site,a.first_seen_at,a.last_seen_at,a.event_count,a.session_count,
       l.country,l.region,l.city,l.timezone,l.user_agent,l.device_type,l.browser,l.os,l.fingerprint
     FROM (SELECT site,visitor_id,MIN(occurred_at) first_seen_at,MAX(occurred_at) last_seen_at,
       COUNT(*)::int event_count,COUNT(DISTINCT session_id)::int session_count FROM events
       WHERE site=$1 AND visitor_id=ANY($2::text[]) GROUP BY site,visitor_id) a
     JOIN LATERAL (SELECT country,region,city,timezone,user_agent,device_type,browser,os,fingerprint
       FROM events e WHERE e.site=a.site AND e.visitor_id=a.visitor_id ORDER BY occurred_at DESC,id DESC LIMIT 1) l ON true
     ON CONFLICT (site,visitor_id) DO UPDATE SET
       first_seen_at=EXCLUDED.first_seen_at,last_seen_at=EXCLUDED.last_seen_at,
       event_count=EXCLUDED.event_count,session_count=EXCLUDED.session_count,
       country=COALESCE(EXCLUDED.country,visitors.country),region=COALESCE(EXCLUDED.region,visitors.region),
       city=COALESCE(EXCLUDED.city,visitors.city),timezone=COALESCE(EXCLUDED.timezone,visitors.timezone),
       user_agent=COALESCE(EXCLUDED.user_agent,visitors.user_agent),device_type=COALESCE(EXCLUDED.device_type,visitors.device_type),
       browser=COALESCE(EXCLUDED.browser,visitors.browser),os=COALESCE(EXCLUDED.os,visitors.os),
       fingerprint=COALESCE(EXCLUDED.fingerprint,visitors.fingerprint)`, [site, visitors]);
  if (sessions.length) await db(
    `INSERT INTO sessions (session_id,site,visitor_id,started_at,last_event_at,event_count,entry_page,exit_page)
     SELECT session_id,site,MIN(visitor_id),MIN(occurred_at),MAX(occurred_at),COUNT(*),
       (ARRAY_AGG(page_url ORDER BY occurred_at ASC,id ASC))[1],
       (ARRAY_AGG(page_url ORDER BY occurred_at DESC,id DESC))[1]
     FROM events WHERE site=$1 AND session_id=ANY($2::text[]) GROUP BY site,session_id
     ON CONFLICT (site,session_id) DO UPDATE SET visitor_id=EXCLUDED.visitor_id,
       started_at=EXCLUDED.started_at,last_event_at=EXCLUDED.last_event_at,event_count=EXCLUDED.event_count,
       entry_page=EXCLUDED.entry_page,exit_page=EXCLUDED.exit_page`, [site, sessions]);
}

export async function applyVisitorRestore(client, sourceRows, options, expectedPlan, { beforeCommit } = {}) {
  const db = client.query.bind(client);
  await db('BEGIN');
  try {
    await db("SET LOCAL statement_timeout = '30s'");
    await db("SET LOCAL lock_timeout = '5s'");
    await db('SELECT pg_advisory_xact_lock(hashtext($1))', ['visitor-restore:' + options.site]);
    // A short table write lock coordinates with ordinary ingestion too, not
    // only with other restores. Two batch rollups keep this hold bounded.
    await db('LOCK TABLE events, visitors, sessions IN SHARE ROW EXCLUSIVE MODE');
    const ids = sourceRows.map((row) => row.id);
    const existing = (await db('SELECT to_jsonb(e) AS row FROM events e WHERE id = ANY($1::text[]) FOR UPDATE', [ids])).rows.map((r) => r.row);
    const plan = planVisitorRestore(sourceRows, existing, options);
    if (plan.sourceDigest !== expectedPlan.sourceDigest || plan.missingDigest !== expectedPlan.missingDigest) {
      throw new Error('source or target changed since the reviewed restore plan');
    }
    if (!plan.missingCount) {
      await db('ROLLBACK');
      return { inserted: 0, visitorsRefreshed: 0, sessionsRefreshed: 0 };
    }
    const visitors = [...new Set(plan.rows.map((r) => r.visitor_id).filter(Boolean))];
    const sessions = [...new Set(plan.rows.map((r) => r.session_id).filter(Boolean))];
    const rollupImages = async () => ({
      visitors: (await db('SELECT to_jsonb(v) AS row FROM visitors v WHERE site=$1 AND visitor_id=ANY($2::text[])', [plan.site, visitors])).rows.map((r) => r.row),
      sessions: (await db('SELECT to_jsonb(s) AS row FROM sessions s WHERE site=$1 AND session_id=ANY($2::text[])', [plan.site, sessions])).rows.map((r) => r.row),
    });
    const before = beforeCommit ? await rollupImages() : null;
    const inserted = (await db(
      `INSERT INTO events
       SELECT (jsonb_populate_record(NULL::events, value)).*
         FROM jsonb_array_elements($1::jsonb)
       ON CONFLICT (id) DO NOTHING
       RETURNING id, visitor_id, session_id`,
      [JSON.stringify(plan.rows)],
    )).rows;
    if (inserted.length !== plan.missingCount) throw new Error('concurrent restore changed the insert count');
    await refreshRollups(db, plan.site, visitors, sessions);
    const restored = (await db('SELECT to_jsonb(e) AS row FROM events e WHERE id = ANY($1::text[])', [inserted.map((r) => r.id)])).rows.map((r) => r.row);
    const expected = new Map(plan.rows.map((r) => [r.id, r]));
    if (restored.some((r) => encode(r) !== encode(expected.get(r.id)))) throw new Error('restored rows differ from their preserved source');
    if (beforeCommit) await beforeCommit({ plan, visitors, sessions, before, after: await rollupImages() });
    await db('COMMIT');
    return { inserted: inserted.length, visitorsRefreshed: visitors.length, sessionsRefreshed: sessions.length };
  } catch (error) {
    await db('ROLLBACK');
    throw error;
  }
}
