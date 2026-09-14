// Read API for the dashboard, served entirely from Neon Postgres.
//
// Replaces the three-system fan-out the dashboard used to do per page load:
// a full-table DynamoDB Scan (jp-stats/jp-visitor/jp-device), a Vercel Blob
// list + per-object fetch (stats/visitor), and Firestore reads (jp-devices).
// Every view below is one indexed query against one database.
//
// Two rules hold across every view, because breaking either produces numbers
// that quietly disagree with each other on the same screen:
//   1. If a table has a `site` column, the view filters on it. Otherwise the
//      property selector silently does nothing on that page.
//   2. If a view is windowed, EVERY query inside it is windowed. One unwindowed
//      query puts two cards in the same grid on different denominators.
//
// Read-only: nothing here writes. The ingest paths still write to Blob and
// Firestore as before, and mirror into Postgres.
import { query, isConfigured } from '../Integrations/postgres.js';
import { checkKey } from './_auth.js';

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
              -- time_on_page arrives in MILLISECONDS, and the tail is abandoned
              -- tabs, so the mean is meaningless. Median over the events that
              -- recorded any time at all, reported in seconds.
              ROUND((percentile_cont(0.5) WITHIN GROUP (
                ORDER BY time_on_page) FILTER (WHERE time_on_page > 0) / 1000)::numeric, 1)::float median_seconds_on_page,
              ROUND((MAX(time_on_page) / 1000)::numeric, 0)::float longest_seconds_on_page,
              MAX(occurred_at) last_event_at
         FROM events
        WHERE site = $1 AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}`,
      params
    )).rows[0];

    // One helper, so every breakdown is windowed, site-scoped and noise-filtered
    // identically. Hand-writing each of these is what put Top pages and
    // Referrers — side by side in one grid — on different denominators.
    const breakdown = (col, extraWhere) => query(
      `SELECT ${col} AS label, COUNT(*)::int n, COUNT(DISTINCT visitor_id)::int visitors
         FROM events
        WHERE site = $1 AND ${col} IS NOT NULL ${extraWhere || ''}
          AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}
        GROUP BY 1 ORDER BY n DESC LIMIT 15`, params);

    const [daily, byType, topPages, countries, cities, browsers, oses, devices,
           referrers, utm, languages, isps, timezones, domains, screens] = await Promise.all([
      query(`SELECT date_trunc('day', occurred_at)::date AS day,
                    COUNT(*)::int events,
                    COUNT(DISTINCT visitor_id)::int visitors,
                    COUNT(DISTINCT session_id)::int sessions
               FROM events
              WHERE site = $1 AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}
              GROUP BY 1 ORDER BY 1`, params),
      // Deliberately unfiltered: this card is how the user sees what the noise
      // toggle is hiding, so it has to show every type.
      query(`SELECT event_type AS label, COUNT(*)::int n FROM events
              WHERE site = $1 AND occurred_at > now() - ($2 || ' days')::interval
              GROUP BY 1 ORDER BY n DESC`, [site, days]),
      breakdown('page_url'),
      breakdown('country'),
      query(`SELECT city AS label, country, COUNT(*)::int n, COUNT(DISTINCT visitor_id)::int visitors
               FROM events WHERE site = $1 AND city IS NOT NULL
                AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}
              GROUP BY 1,2 ORDER BY n DESC LIMIT 15`, params),
      breakdown('browser'),
      breakdown('os'),
      breakdown('device_type'),
      breakdown('referrer', "AND referrer <> ''"),
      query(`SELECT utm_source, utm_medium, utm_campaign, COUNT(*)::int n FROM events
              WHERE site = $1 AND utm_source IS NOT NULL
                AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}
              GROUP BY 1,2,3 ORDER BY n DESC LIMIT 10`, params),
      breakdown('language'),
      breakdown('asn_org'),
      breakdown('timezone'),
      breakdown('page_domain'),
      // `screen` holds the raw screen_info JSON; the label a human wants is WxH.
      query(`SELECT (screen::jsonb ->> 'width') || ' x ' || (screen::jsonb ->> 'height') AS label,
                    COUNT(*)::int n, COUNT(DISTINCT visitor_id)::int visitors
               FROM events
              WHERE site = $1 AND screen IS NOT NULL AND screen <> ''
                AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}
              GROUP BY 1 ORDER BY n DESC LIMIT 12`, params),
    ]);

    // Real scroll depth is how far a session got, not the mean across every
    // event — most events fire at 0% before the reader has scrolled at all.
    const scroll = (await query(
      `SELECT ROUND(AVG(deepest)::numeric, 1)::float avg_session_scroll,
              MAX(deepest)::float max_session_scroll,
              COUNT(*) FILTER (WHERE deepest > 0)::int sessions_that_scrolled,
              COUNT(*)::int sessions_measured
         FROM (SELECT session_id, MAX(scroll_percent) deepest
                 FROM events
                WHERE site = $1 AND scroll_percent IS NOT NULL
                  AND occurred_at > now() - ($2 || ' days')::interval
                GROUP BY session_id) s`, [site, days])).rows[0];

    // All 24 buckets, zero-filled. Dropping empty hours spread the bars evenly
    // across the width and left the labels sitting on the wrong hour.
    const hourly = (await query(
      `SELECT h AS hour_of_day, COALESCE(e.n, 0)::int n
         FROM generate_series(0, 23) h
         LEFT JOIN (
           SELECT EXTRACT(hour FROM occurred_at)::int hr, COUNT(*)::int n
             FROM events
            WHERE site = $1 AND occurred_at > now() - ($2 || ' days')::interval ${noiseClause}
            GROUP BY 1
         ) e ON e.hr = h
        ORDER BY h`, params)).rows;

    return {
      totals: Object.assign({}, totals, scroll),
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
      languages: languages.rows,
      isps: isps.rows,
      timezones: timezones.rows,
      domains: domains.rows,
      screens: screens.rows,
    };
  },

  async sites() {
    return (await query(
      `SELECT site, COUNT(*)::int events, COUNT(DISTINCT visitor_id)::int visitors,
              MIN(occurred_at) first_event_at, MAX(occurred_at) last_event_at
         FROM events GROUP BY site ORDER BY events DESC`)).rows;
  },

  async visitors({ site, days, limit, offset }) {
    const where = "WHERE site = $1 AND last_seen_at > now() - ($2 || ' days')::interval";
    const rows = (await query(
      `SELECT visitor_id, first_seen_at, last_seen_at, event_count, session_count,
              country, region, city, timezone, browser, os, device_type,
              utm_source, utm_medium, fingerprint, user_agent
         FROM visitors ${where}
        ORDER BY last_seen_at DESC LIMIT $3 OFFSET $4`, [site, days, limit, offset])).rows;
    const total = (await query(`SELECT COUNT(*)::int n FROM visitors ${where}`, [site, days])).rows[0].n;
    return { total, limit, offset, rows };
  },

  async visitor({ site, id }) {
    if (!id) throw new Error('id required');
    const profile = (await query('SELECT * FROM visitors WHERE site = $1 AND visitor_id = $2', [site, id])).rows[0] || null;
    const sessions = (await query(
      `SELECT session_id, started_at, last_event_at, event_count, entry_page, exit_page
         FROM sessions WHERE site = $1 AND visitor_id = $2 ORDER BY started_at DESC`, [site, id])).rows;
    const eventTotal = (await query(
      'SELECT COUNT(*)::int n FROM events WHERE site = $1 AND visitor_id = $2', [site, id])).rows[0].n;
    const events = (await query(
      `SELECT id, event_type, occurred_at, page_url, page_title, referrer, time_on_page,
              scroll_percent, interactions, city, country, browser, os, device_type
         FROM events WHERE site = $1 AND visitor_id = $2
        ORDER BY occurred_at DESC LIMIT 500`, [site, id])).rows;
    return { profile, sessions, events, eventTotal, eventLimit: 500 };
  },

  async sessions({ site, days, limit, offset }) {
    const where = "WHERE site = $1 AND started_at > now() - ($2 || ' days')::interval";
    const rows = (await query(
      `SELECT session_id, visitor_id, started_at, last_event_at, event_count, entry_page, exit_page,
              EXTRACT(epoch FROM (last_event_at - started_at))::int duration_seconds
         FROM sessions ${where} ORDER BY started_at DESC LIMIT $3 OFFSET $4`,
      [site, days, limit, offset])).rows;
    const total = (await query(`SELECT COUNT(*)::int n FROM sessions ${where}`, [site, days])).rows[0].n;
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

  async events({ site, days, limit, offset, type, includeNoise }) {
    const where = ['site = $1', "occurred_at > now() - ($2 || ' days')::interval"];
    const params = [site, days];
    if (type) { params.push(type); where.push(`event_type = $${params.length}`); }
    else if (!includeNoise) { params.push(NOISE_TYPES); where.push(`event_type <> ALL($${params.length})`); }
    const clause = where.join(' AND ');
    const rows = (await query(
      `SELECT id, event_type, occurred_at, visitor_id, session_id, page_url, page_title,
              referrer, country, region, city, timezone, browser, os, device_type,
              time_on_page, scroll_percent, interactions, utm_source, utm_medium,
              asn, asn_org, language, page_domain, fingerprint, ip
         FROM events WHERE ${clause}
        ORDER BY occurred_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      params.concat([limit, offset]))).rows;
    const total = (await query(`SELECT COUNT(*)::int n FROM events WHERE ${clause}`, params)).rows[0].n;
    return { total, limit, offset, rows };
  },

  async event({ id }) {
    if (!id) throw new Error('id required');
    return (await query('SELECT * FROM events WHERE id = $1', [id])).rows[0] || null;
  },

  async video({ site, limit, offset }) {
    const rows = (await query(
      `SELECT event_id, video_event, occurred_at, site, country, city, visitor_device,
              recorded_by, source_system, ingested_at
         FROM video_events WHERE site = $1
        ORDER BY occurred_at DESC LIMIT $2 OFFSET $3`, [site, limit, offset])).rows;
    const total = (await query('SELECT COUNT(*)::int n FROM video_events WHERE site = $1', [site])).rows[0].n;
    const byClip = (await query(
      `SELECT video_event AS label, COUNT(*)::int n, MAX(occurred_at) last_at
         FROM video_events WHERE site = $1 GROUP BY 1 ORDER BY n DESC`, [site])).rows;
    const byPlace = (await query(
      `SELECT COALESCE(city, country, 'unknown') AS label, COUNT(*)::int n
         FROM video_events WHERE site = $1 GROUP BY 1 ORDER BY n DESC LIMIT 15`, [site])).rows;
    return { total, limit, offset, rows, byClip, byPlace };
  },

  async devices() {
    return (await query(
      `SELECT device_id, display_name, online, last_seen_at, daemon_version, platform,
              info, source_system, synced_at,
              CASE
                WHEN last_seen_at IS NULL THEN 'unknown'
                WHEN last_seen_at > now() - interval '2 minutes' THEN 'online'
                WHEN last_seen_at > now() - interval '1 hour'    THEN 'stale'
                ELSE 'offline'
              END AS freshness
         FROM devices ORDER BY last_seen_at DESC NULLS LAST`)).rows;
  },

  async letters({ site }) {
    // jsonb_array_length throws on a non-array, and one malformed row would 500
    // the whole view — the worst failure mode for the only surviving record of
    // a letter, since the blob copy is destroyed on read.
    return (await query(
      `SELECT token, site, created_at, read_at, deleted_at, source_system, ingested_at, body,
              body ->> 'email'     AS email,
              body ->> 'expiresAt' AS expires_at,
              body ->> 'viewed'    AS viewed,
              CASE WHEN jsonb_typeof(body -> 'views') = 'array'
                   THEN jsonb_array_length(body -> 'views') ELSE 0 END AS view_count
         FROM letters WHERE site = $1 ORDER BY created_at DESC`, [site])).rows;
  },

  async emails({ limit, offset }) {
    const rows = (await query(
      `SELECT id, email, opened_at, ip, country, city, user_agent, payload, source_system, ingested_at
         FROM email_opens ORDER BY opened_at DESC LIMIT $1 OFFSET $2`, [limit, offset])).rows;
    const total = (await query('SELECT COUNT(*)::int n FROM email_opens')).rows[0].n;
    const byRecipient = (await query(
      `SELECT email AS label, COUNT(*)::int n, MAX(opened_at) last_at
         FROM email_opens GROUP BY 1 ORDER BY n DESC`)).rows;
    return { total, limit, offset, rows, byRecipient };
  },

  // Private phone data. Unlike aggregate site analytics, this can contain
  // names, numbers, message text and file paths, so the handler gates this view
  // with STATS_KEY before any query runs.
  async s24({ limit, offset, dataset, section }) {
    const tableCheck = await query(
      "SELECT to_regclass('public.s24_sync_runs') AS runs, to_regclass('public.s24_records') AS records, to_regclass('public.s24_calls') AS normalized"
    );
    if (!tableCheck.rows[0].runs || !tableCheck.rows[0].records) {
      return { migrated: false, total: 0, limit, offset, rows: [], datasets: [], runs: [] };
    }

    const normalized = Boolean(tableCheck.rows[0].normalized);
    const selected = ['overview', 'calls', 'sms', 'locations', 'agents', 'commands', 'files', 'queue', 'all'].includes(section)
      ? section : 'overview';

    const rawParams = ['samsung-s24-ultra'];
    const rawWhere = ['device_id = $1'];
    if (dataset && selected === 'all') { rawParams.push(dataset); rawWhere.push(`dataset = $${rawParams.length}`); }
    const rawClause = rawWhere.join(' AND ');
    const rawRows = async () => (await query(
      `SELECT device_id, dataset, record_id, run_id, occurred_at, label, payload,
              first_seen, last_seen
         FROM s24_records WHERE ${rawClause}
        ORDER BY occurred_at DESC NULLS LAST, last_seen DESC
        LIMIT $${rawParams.length + 1} OFFSET $${rawParams.length + 2}`,
      rawParams.concat([limit, offset])
    )).rows;
    const rawTotal = async () => (await query(
      `SELECT COUNT(*)::int n FROM s24_records WHERE ${rawClause}`, rawParams)).rows[0].n;

    const sectionSql = {
      calls: {
        count: 'SELECT COUNT(*)::int n FROM s24_calls',
        rows: `SELECT source_dataset AS dataset, record_id, run_id, called_at, contact_name,
                      phone_number, call_type, duration_sec, backed_up_at, raw_payload AS payload, last_seen
                 FROM s24_calls ORDER BY called_at DESC NULLS LAST, last_seen DESC LIMIT $1 OFFSET $2`,
      },
      sms: {
        count: 'SELECT COUNT(*)::int n FROM s24_sms',
        rows: `SELECT source_dataset AS dataset, record_id, run_id, sent_at, correspondent,
                      message_type, body, raw_payload AS payload, last_seen
                 FROM s24_sms ORDER BY sent_at DESC NULLS LAST, last_seen DESC LIMIT $1 OFFSET $2`,
      },
      locations: {
        count: 'SELECT COUNT(*)::int n FROM s24_locations',
        rows: `SELECT source_dataset AS dataset, record_id, run_id, observed_at, latitude,
                      longitude, accuracy_m, provider, raw_payload AS payload, last_seen
                 FROM s24_locations ORDER BY observed_at DESC NULLS LAST, last_seen DESC LIMIT $1 OFFSET $2`,
      },
      agents: {
        count: 'SELECT COUNT(*)::int n FROM s24_agents',
        rows: `SELECT 'firestore_agents' AS dataset, record_id, run_id, agent_name, status,
                      model, api_enabled, bridged, port, registered_at, activated_at,
                      raw_payload AS payload, last_seen
                 FROM s24_agents ORDER BY activated_at DESC NULLS LAST, last_seen DESC LIMIT $1 OFFSET $2`,
      },
      commands: {
        count: 'SELECT COUNT(*)::int n FROM s24_commands',
        rows: `SELECT source_dataset AS dataset, record_id, run_id, action, command_type,
                      status, priority, requested_at, resolved_at, requested_by,
                      raw_payload AS payload, last_seen
                 FROM s24_commands ORDER BY requested_at DESC NULLS LAST, last_seen DESC LIMIT $1 OFFSET $2`,
      },
      files: {
        count: 'SELECT COUNT(*)::int n FROM s24_files',
        rows: `SELECT 'firestore_files' AS dataset, record_id, run_id, filename, file_type,
                      status, size_bytes, created_at, uploaded_at, content,
                      raw_payload AS payload, last_seen
                 FROM s24_files ORDER BY uploaded_at DESC NULLS LAST, last_seen DESC LIMIT $1 OFFSET $2`,
      },
      queue: {
        count: 'SELECT COUNT(*)::int n FROM s24_queue_items',
        rows: `SELECT 'firestore_queue' AS dataset, record_id, run_id, action, item_type,
                      status, priority, description, created_at, raw_payload AS payload, last_seen
                 FROM s24_queue_items ORDER BY created_at DESC NULLS LAST, last_seen DESC LIMIT $1 OFFSET $2`,
      },
    };

    let rows;
    let total;
    if (normalized && sectionSql[selected]) {
      rows = (await query(sectionSql[selected].rows, [limit, offset])).rows;
      total = (await query(sectionSql[selected].count)).rows[0].n;
    } else {
      rows = await rawRows();
      total = await rawTotal();
    }

    const datasets = (await query(
      `WITH latest_run AS (
         SELECT run_id FROM s24_sync_runs
          WHERE device_id = $1 ORDER BY started_at DESC LIMIT 1
       ), stored AS (
         SELECT dataset, COUNT(*)::int stored_records, MAX(last_seen) last_seen
           FROM s24_records WHERE device_id = $1 GROUP BY dataset
       )
       SELECT d.dataset, d.status, d.record_count, d.source, d.detail, d.collected_at,
              COALESCE(s.stored_records, 0)::int stored_records, s.last_seen
         FROM s24_sync_datasets d
         JOIN latest_run l ON l.run_id = d.run_id
         LEFT JOIN stored s ON s.dataset = d.dataset
        ORDER BY d.dataset`, ['samsung-s24-ultra'])).rows;

    const runs = (await query(
      `SELECT run_id, started_at, finished_at, key_id, host, adb_serial,
              android_version, model, record_count, uploaded_records, upload_status, uploaded_at, notes
         FROM s24_sync_runs WHERE device_id = $1
        ORDER BY started_at DESC LIMIT 25`, ['samsung-s24-ultra'])).rows;
    const statusCounts = (await query(
      `SELECT status AS label, COUNT(*)::int n
         FROM s24_sync_datasets
        WHERE run_id = (SELECT run_id FROM s24_sync_runs WHERE device_id = $1 ORDER BY started_at DESC LIMIT 1)
        GROUP BY status ORDER BY n DESC`, ['samsung-s24-ultra'])).rows;
    let counts = { all: await rawTotal() };
    let device = null;
    if (normalized) {
      counts = (await query(
        `SELECT
          (SELECT COUNT(*)::int FROM s24_records) AS all,
          (SELECT COUNT(*)::int FROM s24_calls) AS calls,
          (SELECT COUNT(*)::int FROM s24_sms) AS sms,
          (SELECT COUNT(*)::int FROM s24_locations) AS locations,
          (SELECT COUNT(*)::int FROM s24_agents) AS agents,
          (SELECT COUNT(*)::int FROM s24_commands) AS commands,
          (SELECT COUNT(*)::int FROM s24_files) AS files,
          (SELECT COUNT(*)::int FROM s24_queue_items) AS queue`)).rows[0];
      device = (await query(
        `SELECT observed_at, agent_version, android_version, model, manufacturer,
                battery_level, status, connection_method, heartbeat_auth, source_type,
                runtime_is_android, live_device_verified, last_seen
           FROM s24_device_snapshots ORDER BY observed_at DESC NULLS LAST LIMIT 1`)).rows[0] || null;
    }
    return { migrated: true, normalized, section: selected, total, limit, offset, rows, datasets, runs, statusCounts, counts, device };
  },

  // Every table, every column — the "is anything missing" panel.
  async health({ site }) {
    const tables = [
      'events', 'visitors', 'sessions', 'letters', 'email_opens', 'video_events', 'devices',
      // 004_whatsapp: shared with jaytibirthday-site's galaxy read path.
      'wa_chats', 'wa_messages', 'wa_sync_runs',
      's24_sync_runs', 's24_sync_datasets', 's24_sync_batches', 's24_records', 's24_ingest_seen',
      's24_device_snapshots', 's24_calls', 's24_sms', 's24_locations',
      's24_agents', 's24_commands', 's24_files', 's24_queue_items',
    ];
    const counts = {};
    const countsForSite = {};
    for (const t of tables) {
      // A table that hasn't been migrated yet reads as null here rather than
      // crashing the whole panel — Health is meant to surface what's missing,
      // not to fail on it.
      try {
        counts[t] = (await query(`SELECT COUNT(*)::int n FROM ${t}`)).rows[0].n;
      } catch (err) {
        if (err && err.code === '42P01') { counts[t] = null; countsForSite[t] = null; continue; }
        throw err;
      }
      // Only some tables carry `site`. The nav badges have to match the
      // site-filtered pages they label, or they read as a bug.
      const hasSite = (await query(
        "SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'site'", [t])).rowCount;
      countsForSite[t] = hasSite
        ? (await query(`SELECT COUNT(*)::int n FROM ${t} WHERE site = $1`, [site])).rows[0].n
        : counts[t];
    }

    // Coverage is generated from information_schema rather than a hand-kept
    // list, so a column added by a future migration appears here by itself
    // instead of silently having neither a panel nor a coverage row.
    const cols = (await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'events' AND table_schema = 'public'
          AND column_name NOT IN ('id','site','ingested_at','raw_payload','event_data')
        ORDER BY ordinal_position`)).rows.map((r) => r.column_name);
    const expr = cols.map((c) => `COUNT("${c}")::int AS "${c}"`).join(', ');
    const coverage = (await query(
      `SELECT COUNT(*)::int AS total, ${expr} FROM events WHERE site = $1`, [site])).rows[0];

    const sources = (await query(
      `SELECT source_system, COUNT(*)::int n, MIN(occurred_at) oldest, MAX(occurred_at) newest
         FROM events GROUP BY 1 ORDER BY n DESC`)).rows;
    const span = (await query('SELECT MIN(occurred_at) oldest, MAX(occurred_at) newest FROM events')).rows[0];
    return { counts, countsForSite, coverage, sources, span };
  },
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  // Every view, not only s24, and before any state is reported. The rest of
  // this API reads the same visitor analytics the dashboard shows — sessions,
  // IPs, user agents, per-visitor trails — and none of it belongs to the
  // public; only the archive was ever gated, so everything else was readable
  // by anyone who called the route.
  const auth = checkKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, view: String(req.query.view || 'overview'), error: auth.error });
  }

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
      dataset: req.query.dataset ? String(req.query.dataset).slice(0, 80) : null,
      section: req.query.section ? String(req.query.section).slice(0, 40) : null,
      includeNoise: req.query.noise === '1',
    });
    return res.status(200).json({ ok: true, view, data });
  } catch (err) {
    console.error('[db-api]', view, err);
    return res.status(500).json({ ok: false, view, error: err.message });
  }
}
