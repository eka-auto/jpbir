// Read API for the dashboard, served entirely from Neon Postgres.
//
// Replaces the three-system fan-out the dashboard used to do per page load:
// a full-table DynamoDB Scan (jp-stats/jp-visitor/jp-device), a Vercel Blob
// list + per-object fetch (stats/visitor), and Firestore reads (jp-devices).
// Every view below is one indexed query against one database.
//
// Read-only: nothing here writes. The ingest paths still write to Blob and
// Firestore as before, and mirror into Postgres.
import { query, isConfigured } from '../Integrations/postgres.js';

const DEFAULT_SITE = 'jaytibirthday.in';

function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

// Heartbeats outnumber real pageviews ~20:1, so anything user-facing has to be
// able to exclude them or every chart is just the heartbeat timer.
const NOISE_TYPES = ['heartbeat', 'interaction_batch', 'window_blur', 'window_focus', 'page_hidden', 'page_visible'];

const VIEWS = {
  async overview({ site, days, includeNoise }) {
    const noiseClause = includeNoise ? '' : 'AND event_type <> ALL($3)';
    const params = includeNoise ? [site, days] : [site, days, NOISE_TYPES];

    const totals = (await query(
      `SELECT COUNT(*)::int events,
              COUNT(DISTINCT visitor_id)::int visitors,
              COUNT(DISTINCT session_id)::int sessions,
              COUNT(*) FILTER (WHERE event_type = 'page_view')::int page_views,
              COUNT(DISTINCT country)::int countries,
              COUNT(DISTINCT city)::int cities,
              ROUND(AVG(time_on_page)::numeric, 1)::float avg_time_on_page,
              ROUND(AVG(scroll_percent)::numeric, 1)::float avg_scroll,
              MAX(occurred_at) last_event_at
         FROM events
        WHERE site = $1 AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}`,
      params
    )).rows[0];

    const [daily, byType, topPages, countries, cities, browsers, oses, devices, referrers, utm] = await Promise.all([
      query(`SELECT date_trunc('day', occurred_at)::date AS day,
                    COUNT(*)::int events,
                    COUNT(DISTINCT visitor_id)::int visitors,
                    COUNT(DISTINCT session_id)::int sessions
               FROM events
              WHERE site = $1 AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}
              GROUP BY 1 ORDER BY 1`, params),
      query(`SELECT event_type AS label, COUNT(*)::int n FROM events
              WHERE site = $1 AND occurred_at > now() - ($2 || ' days')::interval
              GROUP BY 1 ORDER BY n DESC`, [site, days]),
      query(`SELECT page_url AS label, COUNT(*)::int n, COUNT(DISTINCT visitor_id)::int visitors
               FROM events WHERE site = $1 AND page_url IS NOT NULL
                AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}
              GROUP BY 1 ORDER BY n DESC LIMIT 15`, params),
      query(`SELECT country AS label, COUNT(*)::int n, COUNT(DISTINCT visitor_id)::int visitors
               FROM events WHERE site = $1 AND country IS NOT NULL
                AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}
              GROUP BY 1 ORDER BY n DESC LIMIT 15`, params),
      query(`SELECT city AS label, country, COUNT(*)::int n, COUNT(DISTINCT visitor_id)::int visitors
               FROM events WHERE site = $1 AND city IS NOT NULL
                AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}
              GROUP BY 1,2 ORDER BY n DESC LIMIT 15`, params),
      query(`SELECT browser AS label, COUNT(*)::int n FROM events
              WHERE site = $1 AND browser IS NOT NULL
                AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}
              GROUP BY 1 ORDER BY n DESC LIMIT 10`, params),
      query(`SELECT os AS label, COUNT(*)::int n FROM events
              WHERE site = $1 AND os IS NOT NULL
                AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}
              GROUP BY 1 ORDER BY n DESC LIMIT 10`, params),
      query(`SELECT device_type AS label, COUNT(*)::int n FROM events
              WHERE site = $1 AND device_type IS NOT NULL
                AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}
              GROUP BY 1 ORDER BY n DESC LIMIT 10`, params),
      query(`SELECT referrer AS label, COUNT(*)::int n FROM events
              WHERE site = $1 AND referrer IS NOT NULL AND referrer <> ''
                AND occurred_at > now() - ($2 || ' days')::interval
              GROUP BY 1 ORDER BY n DESC LIMIT 10`, [site, days]),
      query(`SELECT utm_source, utm_medium, utm_campaign, COUNT(*)::int n FROM events
              WHERE site = $1 AND utm_source IS NOT NULL
                AND occurred_at > now() - ($2 || ' days')::interval
              GROUP BY 1,2,3 ORDER BY n DESC LIMIT 10`, [site, days]),
    ]);

    // Hour-of-day profile, so the UI can show when this site is actually read.
    const hourly = (await query(
      `SELECT EXTRACT(hour FROM occurred_at)::int AS hour_of_day, COUNT(*)::int n
         FROM events WHERE site = $1 AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}
        GROUP BY 1 ORDER BY 1`, params)).rows;

    return {
      totals,
      daily: daily.rows,
      hourly,
      byType: byType.rows,
      topPages: topPages.rows,
      countries: countries.rows,
      cities: cities.rows,
      browsers: browsers.rows,
      oses: oses.rows,
      devices: devices.rows,
      referrers: referrers.rows,
      utm: utm.rows,
    };
  },

  async sites() {
    return (await query(
      `SELECT site, COUNT(*)::int events, COUNT(DISTINCT visitor_id)::int visitors,
              MIN(occurred_at) first_event_at, MAX(occurred_at) last_event_at
         FROM events GROUP BY site ORDER BY events DESC`)).rows;
  },

  async visitors({ site, limit, offset }) {
    const rows = (await query(
      `SELECT v.visitor_id, v.first_seen_at, v.last_seen_at, v.event_count, v.session_count,
              v.country, v.region, v.city, v.timezone, v.browser, v.os, v.device_type,
              v.utm_source, v.utm_medium, v.fingerprint, v.user_agent
         FROM visitors v WHERE v.site = $1
        ORDER BY v.last_seen_at DESC LIMIT $2 OFFSET $3`, [site, limit, offset])).rows;
    const total = (await query('SELECT COUNT(*)::int n FROM visitors WHERE site = $1', [site])).rows[0].n;
    return { total, limit, offset, rows };
  },

  async visitor({ site, id }) {
    if (!id) throw new Error('id required');
    const profile = (await query('SELECT * FROM visitors WHERE site = $1 AND visitor_id = $2', [site, id])).rows[0] || null;
    const sessions = (await query(
      `SELECT session_id, started_at, last_event_at, event_count, entry_page, exit_page
         FROM sessions WHERE site = $1 AND visitor_id = $2 ORDER BY started_at DESC`, [site, id])).rows;
    const events = (await query(
      `SELECT id, event_type, occurred_at, page_url, page_title, referrer, time_on_page,
              scroll_percent, interactions, city, country, browser, os, device_type
         FROM events WHERE site = $1 AND visitor_id = $2
        ORDER BY occurred_at DESC LIMIT 500`, [site, id])).rows;
    return { profile, sessions, events };
  },

  async sessions({ site, limit, offset }) {
    const rows = (await query(
      `SELECT session_id, visitor_id, started_at, last_event_at, event_count, entry_page, exit_page,
              EXTRACT(epoch FROM (last_event_at - started_at))::int duration_seconds
         FROM sessions WHERE site = $1 ORDER BY started_at DESC LIMIT $2 OFFSET $3`,
      [site, limit, offset])).rows;
    const total = (await query('SELECT COUNT(*)::int n FROM sessions WHERE site = $1', [site])).rows[0].n;
    return { total, limit, offset, rows };
  },

  async session({ site, id }) {
    if (!id) throw new Error('id required');
    const meta = (await query('SELECT * FROM sessions WHERE site = $1 AND session_id = $2', [site, id])).rows[0] || null;
    const events = (await query(
      `SELECT id, event_type, occurred_at, page_url, page_title, time_on_page, scroll_percent,
              interactions, event_data
         FROM events WHERE site = $1 AND session_id = $2 ORDER BY occurred_at ASC`, [site, id])).rows;
    return { meta, events };
  },

  async events({ site, limit, offset, type, includeNoise }) {
    const where = ['site = $1'];
    const params = [site];
    if (type) { params.push(type); where.push(`event_type = $${params.length}`); }
    else if (!includeNoise) { params.push(NOISE_TYPES); where.push(`event_type <> ALL($${params.length})`); }
    params.push(limit, offset);
    const rows = (await query(
      `SELECT id, event_type, occurred_at, visitor_id, session_id, page_url, page_title,
              referrer, country, city, browser, os, device_type, time_on_page, scroll_percent,
              interactions, utm_source, utm_medium, asn_org, ip
         FROM events WHERE ${where.join(' AND ')}
        ORDER BY occurred_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
    const total = (await query(
      `SELECT COUNT(*)::int n FROM events WHERE ${where.join(' AND ')}`, params.slice(0, -2))).rows[0].n;
    return { total, limit, offset, rows };
  },

  async event({ id }) {
    if (!id) throw new Error('id required');
    return (await query('SELECT * FROM events WHERE id = $1', [id])).rows[0] || null;
  },

  async video() {
    const rows = (await query(
      `SELECT event_id, video_event, occurred_at, country, city, visitor_device, recorded_by, source_system
         FROM video_events ORDER BY occurred_at DESC LIMIT 300`)).rows;
    const byClip = (await query(
      `SELECT video_event AS label, COUNT(*)::int n, MAX(occurred_at) last_at
         FROM video_events GROUP BY 1 ORDER BY n DESC`)).rows;
    const byPlace = (await query(
      `SELECT COALESCE(city, country, 'unknown') AS label, COUNT(*)::int n
         FROM video_events GROUP BY 1 ORDER BY n DESC LIMIT 15`)).rows;
    return { rows, byClip, byPlace };
  },

  async devices() {
    return (await query(
      `SELECT device_id, display_name, online, last_seen_at, daemon_version, platform,
              info, synced_at,
              CASE
                WHEN last_seen_at IS NULL THEN 'unknown'
                WHEN last_seen_at > now() - interval '2 minutes' THEN 'online'
                WHEN last_seen_at > now() - interval '1 hour'    THEN 'stale'
                ELSE 'offline'
              END AS freshness
         FROM devices ORDER BY last_seen_at DESC NULLS LAST`)).rows;
  },

  async letters() {
    return (await query(
      `SELECT token, created_at, read_at, deleted_at, source_system,
              body -> 'email'      AS email,
              body -> 'expiresAt'  AS expires_at,
              body -> 'viewed'     AS viewed,
              jsonb_array_length(COALESCE(body -> 'views', '[]'::jsonb)) AS view_count
         FROM letters ORDER BY created_at DESC`)).rows;
  },

  async emails() {
    const rows = (await query(
      `SELECT id, email, opened_at, ip, country, city, user_agent
         FROM email_opens ORDER BY opened_at DESC LIMIT 300`)).rows;
    const byRecipient = (await query(
      `SELECT email AS label, COUNT(*)::int n, MAX(opened_at) last_at
         FROM email_opens GROUP BY 1 ORDER BY n DESC`)).rows;
    return { rows, byRecipient };
  },

  // Every table, every row count — the "is anything missing" panel.
  async health() {
    const tables = ['events', 'visitors', 'sessions', 'letters', 'email_opens', 'video_events', 'devices'];
    const counts = {};
    for (const t of tables) counts[t] = (await query(`SELECT COUNT(*)::int n FROM ${t}`)).rows[0].n;
    const coverage = (await query(
      `SELECT COUNT(*)::int total,
              COUNT(visitor_id)::int with_visitor, COUNT(session_id)::int with_session,
              COUNT(page_url)::int with_page, COUNT(country)::int with_country,
              COUNT(city)::int with_city, COUNT(browser)::int with_browser,
              COUNT(os)::int with_os, COUNT(device_type)::int with_device,
              COUNT(user_agent)::int with_ua, COUNT(asn)::int with_asn,
              COUNT(referrer)::int with_referrer, COUNT(utm_source)::int with_utm,
              COUNT(time_on_page)::int with_time, COUNT(scroll_percent)::int with_scroll
         FROM events`)).rows[0];
    const sources = (await query(
      `SELECT source_system, COUNT(*)::int n, MIN(occurred_at) oldest, MAX(occurred_at) newest
         FROM events GROUP BY 1 ORDER BY n DESC`)).rows;
    const span = (await query('SELECT MIN(occurred_at) oldest, MAX(occurred_at) newest FROM events')).rows[0];
    return { counts, coverage, sources, span };
  },
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  if (!isConfigured()) {
    return res.status(500).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  }

  const view = String(req.query.view || 'overview');
  const fn = VIEWS[view];
  if (!fn) {
    return res.status(400).json({ ok: false, error: `unknown view ${view}`, views: Object.keys(VIEWS) });
  }

  try {
    const data = await fn({
      site: String(req.query.site || DEFAULT_SITE),
      days: clampInt(req.query.days, 30, 1, 3650),
      limit: clampInt(req.query.limit, 100, 1, 1000),
      offset: clampInt(req.query.offset, 0, 0, 1_000_000),
      id: req.query.id ? String(req.query.id) : null,
      type: req.query.type ? String(req.query.type) : null,
      includeNoise: req.query.noise === '1',
    });
    return res.status(200).json({ ok: true, view, data });
  } catch (err) {
    console.error('[db-api]', view, err);
    return res.status(500).json({ ok: false, view, error: err.message });
  }
}
