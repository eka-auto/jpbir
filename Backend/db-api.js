// Read API for the dashboard, served entirely from Neon Postgres.
//
// Provides the indexed Neon query surface for dashboard data views.
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

// Every table this app reads, in one place. It is the allow-list for the
// generic `table` view below, and the row + column inventory on Health.
//
// Deliberately a list rather than "whatever is in public": this Neon database
// is shared with the sibling jaytibirthday-site deployment, so a dashboard that
// enumerated the schema would report -- and serve -- another project's tables.
// A new table is added here once, and from then on it is browsable, counted and
// covered without another frontend change.
const APP_TABLES = [
  'events', 'visitors', 'sessions', 'letters', 'email_opens', 'video_events', 'devices',
  // Sibling-owned (009_device_telemetry.sql in jaytibirthday-site). Read-only
  // here, and guarded by to_regclass so an unmigrated database reports it as
  // absent instead of failing the page.
  'device_telemetry',
  'wa_chats', 'wa_messages', 'wa_attachments', 'wa_sync_runs',
  's24_sync_runs', 's24_sync_datasets', 's24_sync_batches', 's24_records', 's24_ingest_seen',
  's24_device_snapshots', 's24_calls', 's24_sms', 's24_locations',
  's24_agents', 's24_commands', 's24_files', 's24_queue_items',
];

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
      //
      // Guarded, because the column is whatever a tracker put in it. jp-tracker
      // sends the string "1280x720 (DPR:1.5)", and an unguarded screen::jsonb
      // on one such row aborts the whole statement — taking Overview, every
      // card on it, down with a 500 rather than dropping one Screens label.
      // The CASE keeps the cast from being evaluated on a row the regex
      // rejects; the matching WHERE clause keeps those rows out entirely.
      query(`SELECT (CASE WHEN screen ~ '^\\s*\\{' THEN screen::jsonb END ->> 'width') || ' x ' ||
                    (CASE WHEN screen ~ '^\\s*\\{' THEN screen::jsonb END ->> 'height') AS label,
                    COUNT(*)::int n, COUNT(DISTINCT visitor_id)::int visitors
               FROM events
              WHERE site = $1 AND screen IS NOT NULL AND screen ~ '^\\s*\\{'
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
      // SELECT *: a column list here is a promise to keep it in step with the
      // schema, and every list that made that promise has already fallen behind
      // it once. The row is returned whole; the page decides what to show.
      `SELECT * FROM visitors ${where}
        ORDER BY last_seen_at DESC LIMIT $3 OFFSET $4`, [site, days, limit, offset])).rows;
    const total = (await query(`SELECT COUNT(*)::int n FROM visitors ${where}`, [site, days])).rows[0].n;
    return { total, limit, offset, rows };
  },

  async visitor({ site, id }) {
    if (!id) throw new Error('id required');
    const profile = (await query('SELECT * FROM visitors WHERE site = $1 AND visitor_id = $2', [site, id])).rows[0] || null;
    const sessions = (await query(
      `SELECT * FROM sessions WHERE site = $1 AND visitor_id = $2 ORDER BY started_at DESC`, [site, id])).rows;
    const eventTotal = (await query(
      'SELECT COUNT(*)::int n FROM events WHERE site = $1 AND visitor_id = $2', [site, id])).rows[0].n;
    const events = (await query(
      `SELECT * FROM events WHERE site = $1 AND visitor_id = $2
        ORDER BY occurred_at DESC LIMIT 500`, [site, id])).rows;
    return { profile, sessions, events, eventTotal, eventLimit: 500 };
  },

  async sessions({ site, days, limit, offset }) {
    const where = "WHERE site = $1 AND started_at > now() - ($2 || ' days')::interval";
    const rows = (await query(
      `SELECT *, EXTRACT(epoch FROM (last_event_at - started_at))::int duration_seconds
         FROM sessions ${where} ORDER BY started_at DESC LIMIT $3 OFFSET $4`,
      [site, days, limit, offset])).rows;
    const total = (await query(`SELECT COUNT(*)::int n FROM sessions ${where}`, [site, days])).rows[0].n;
    return { total, limit, offset, rows };
  },

  async session({ site, id }) {
    if (!id) throw new Error('id required');
    const meta = (await query('SELECT * FROM sessions WHERE site = $1 AND session_id = $2', [site, id])).rows[0] || null;
    const events = (await query(
      `SELECT * FROM events WHERE site = $1 AND session_id = $2 ORDER BY occurred_at ASC`, [site, id])).rows;
    return { meta, events };
  },

  async events({ site, days, limit, offset, type, includeNoise }) {
    const where = ['site = $1', "occurred_at > now() - ($2 || ' days')::interval"];
    const params = [site, days];
    if (type) { params.push(type); where.push(`event_type = $${params.length}`); }
    else if (!includeNoise) { params.push(NOISE_TYPES); where.push(`event_type <> ALL($${params.length})`); }
    const clause = where.join(' AND ');
    const rows = (await query(
      `SELECT * FROM events WHERE ${clause}
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
      `SELECT * FROM video_events WHERE site = $1
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
      `SELECT *,
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
      `SELECT *,
              body ->> 'email'     AS email,
              body ->> 'expiresAt' AS expires_at,
              body ->> 'viewed'    AS viewed,
              CASE WHEN jsonb_typeof(body -> 'views') = 'array'
                   THEN jsonb_array_length(body -> 'views') ELSE 0 END AS view_count
         FROM letters WHERE site = $1 ORDER BY created_at DESC`, [site])).rows;
  },

  async emails({ limit, offset }) {
    const rows = (await query(
      `SELECT * FROM email_opens ORDER BY opened_at DESC LIMIT $1 OFFSET $2`, [limit, offset])).rows;
    const total = (await query('SELECT COUNT(*)::int n FROM email_opens')).rows[0].n;
    const byRecipient = (await query(
      `SELECT email AS label, COUNT(*)::int n, MAX(opened_at) last_at
         FROM email_opens GROUP BY 1 ORDER BY n DESC`)).rows;
    return { total, limit, offset, rows, byRecipient };
  },

  // Private phone data. Unlike aggregate site analytics, this can contain
  // names, numbers, message text and file paths, so the handler gates this view
  // with STATS_KEY before any query runs -- and once past that gate it returns
  // the rows whole. Nothing here renames a value, drops a column, rounds a
  // coordinate or filters a dataset out: a field that was worth storing is worth
  // showing, and a "review surface" that hides half of a row is how a column
  // that never arrived looks exactly like a column that was never selected.
  async s24({ limit, offset, dataset, section }) {
    const tableCheck = await query(
      "SELECT to_regclass('public.s24_sync_runs') AS runs, to_regclass('public.s24_records') AS records, to_regclass('public.s24_calls') AS normalized, to_regclass('public.s24_sync_batches') AS batches"
    );
    if (!tableCheck.rows[0].runs || !tableCheck.rows[0].records) {
      return { migrated: false, total: 0, limit, offset, rows: [], datasets: [], runs: [] };
    }

    const normalized = Boolean(tableCheck.rows[0].normalized);
    const selected = ['overview', 'calls', 'sms', 'locations', 'agents', 'commands', 'queue', 'all'].includes(section)
      ? section : 'overview';

    const rawParams = ['samsung-s24-ultra'];
    const rawWhere = ['device_id = $1'];
    if (dataset && selected === 'all') {
      rawParams.push(dataset);
      rawWhere.push(`dataset = $${rawParams.length}`);
    }
    const rawClause = rawWhere.join(' AND ');
    const rawRows = async () => (await query(
      `SELECT * FROM s24_records WHERE ${rawClause}
        ORDER BY occurred_at DESC NULLS LAST, last_seen DESC
        LIMIT $${rawParams.length + 1} OFFSET $${rawParams.length + 2}`,
      rawParams.concat([limit, offset])
    )).rows;
    const rawTotal = async () => (await query(
      `SELECT COUNT(*)::int n FROM s24_records WHERE ${rawClause}`, rawParams)).rows[0].n;

    const sectionSql = {
      calls: {
        count: 'SELECT COUNT(*)::int n FROM s24_calls',
        rows: `SELECT * FROM s24_calls ORDER BY called_at DESC NULLS LAST, last_seen DESC LIMIT $1 OFFSET $2`,
      },
      sms: {
        count: 'SELECT COUNT(*)::int n FROM s24_sms',
        rows: `SELECT * FROM s24_sms ORDER BY sent_at DESC NULLS LAST, last_seen DESC LIMIT $1 OFFSET $2`,
      },
      locations: {
        count: 'SELECT COUNT(*)::int n FROM s24_locations',
        rows: `SELECT * FROM s24_locations ORDER BY observed_at DESC NULLS LAST, last_seen DESC LIMIT $1 OFFSET $2`,
      },
      agents: {
        count: 'SELECT COUNT(*)::int n FROM s24_agents',
        rows: `SELECT *,
                      -- last_seen is the warehouse import time and is refreshed
                      -- whenever an old snapshot is re-imported. It must not turn
                      -- an historical "active" value into a live agent. The stored
                      -- status is kept alongside it as status_stored, so the
                      -- derived value never overwrites what the phone reported.
                      CASE WHEN status = 'active'
                                  AND COALESCE(activated_at, registered_at) >= now() - interval '1 hour'
                           THEN 'active'
                           WHEN status = 'active' THEN 'stale'
                           ELSE status END AS status_stored,
                      status AS status_raw
                 FROM s24_agents ORDER BY activated_at DESC NULLS LAST, last_seen DESC LIMIT $1 OFFSET $2`,
      },
      commands: {
        count: 'SELECT COUNT(*)::int n FROM s24_commands',
        rows: `SELECT * FROM s24_commands ORDER BY requested_at DESC NULLS LAST, last_seen DESC LIMIT $1 OFFSET $2`,
      },
      queue: {
        count: 'SELECT COUNT(*)::int n FROM s24_queue_items',
        rows: `SELECT * FROM s24_queue_items ORDER BY created_at DESC NULLS LAST, last_seen DESC LIMIT $1 OFFSET $2`,
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
       SELECT d.*, COALESCE(s.stored_records, 0)::int stored_records, s.last_seen
          FROM s24_sync_datasets d
          JOIN latest_run l ON l.run_id = d.run_id
          LEFT JOIN stored s ON s.dataset = d.dataset
         ORDER BY d.dataset`, ['samsung-s24-ultra'])).rows;

    const runs = (await query(
      `SELECT * FROM s24_sync_runs WHERE device_id = $1
        ORDER BY started_at DESC LIMIT 25`, ['samsung-s24-ultra'])).rows;
    // The LIMIT above is a page, but /db rendered its length as the "Sync runs"
    // KPI -- so once 25 runs existed the tile read "25" forever, on the one
    // number an operator uses to judge whether the export automation is
    // running at all. A capped list cannot be corrected frontend-side, so the
    // true total is returned alongside it.
    const runsTotal = Number((await query(
      `SELECT COUNT(*)::int AS n FROM s24_sync_runs WHERE device_id = $1`,
      ['samsung-s24-ultra'])).rows[0].n) || 0;
    const statusCounts = (await query(
      `SELECT status AS label, COUNT(*)::int n
         FROM s24_sync_datasets
        WHERE run_id = (SELECT run_id FROM s24_sync_runs WHERE device_id = $1 ORDER BY started_at DESC LIMIT 1)
        GROUP BY status ORDER BY n DESC`, ['samsung-s24-ultra'])).rows;
    // The per-chunk ledger. s24_sync_batches records every uploaded chunk of a
    // run (batch_index of batch_count), and until now nothing read it: a run
    // that delivered 12 of 40 chunks showed its own "uploaded" status and the
    // missing 28 were only visible by counting rows in the table by hand.
    const batches = tableCheck.rows[0].batches ? (await query(
      `SELECT b.*, r.started_at AS run_started_at
         FROM s24_sync_batches b
         JOIN s24_sync_runs r ON r.run_id = b.run_id
        WHERE r.device_id = $1
        ORDER BY b.received_at DESC LIMIT 10`, ['samsung-s24-ultra'])).rows : [];
    const batchesTotal = tableCheck.rows[0].batches ? Number((await query(
      `SELECT COUNT(*)::int AS n FROM s24_sync_batches b
         JOIN s24_sync_runs r ON r.run_id = b.run_id
        WHERE r.device_id = $1`, ['samsung-s24-ultra'])).rows[0].n) || 0 : 0;
    let counts = { all: await rawTotal() };
    let device = null;
    if (normalized) {
      // Every typed table is counted, including s24_files and the snapshots.
      // A table left out of this list is a section that silently reads 0 -- the
      // one number an operator uses to decide there is nothing to look at.
      counts = (await query(
        `SELECT
          (SELECT COUNT(*)::int FROM s24_records) AS all,
          (SELECT COUNT(*)::int FROM s24_calls) AS calls,
          (SELECT COUNT(*)::int FROM s24_sms) AS sms,
          (SELECT COUNT(*)::int FROM s24_locations) AS locations,
          (SELECT COUNT(*)::int FROM s24_agents) AS agents,
          (SELECT COUNT(*)::int FROM s24_commands) AS commands,
          (SELECT COUNT(*)::int FROM s24_queue_items) AS queue,
          (SELECT COUNT(*)::int FROM s24_files) AS files,
          (SELECT COUNT(*)::int FROM s24_device_snapshots) AS snapshots`)).rows[0];
      device = (await query(
        `SELECT * FROM s24_device_snapshots ORDER BY observed_at DESC NULLS LAST LIMIT 1`)).rows[0] || null;
    }
    return { migrated: true, normalized, section: selected, total, limit, offset, rows, datasets, runs, runsTotal, statusCounts, batches, batchesTotal, counts, device };
  },

  // Every table, every column — the "is anything missing" panel.
  // The WhatsApp store is the largest thing in this database — 862 chats and
  // 110k messages — and it was the one part of it the explorer could not open.
  // Health counted the rows, every other table had a page, this had none: the
  // numbers were visible and the data behind them was not.
  //
  // Deliberately NOT site-scoped, like devices and s24: wa_* carries no `site`
  // column because one phone's export is not a web property's traffic. The page
  // says so, rather than leaving the property selector looking broken.
  async whatsapp({ limit, offset, id }) {
    if (id) {
      const chat = (await query('SELECT * FROM wa_chats WHERE chat_id = $1', [id])).rows[0] || null;
      if (!chat) throw new Error(`no such chat ${id}`);
      // SELECT * and no readable-only filter: a sealed body is still a stored
      // body, and the drawer has to be able to say so with the row in hand.
      const messages = (await query(
        `SELECT * FROM wa_messages WHERE chat_id = $1
          ORDER BY sent_at DESC NULLS LAST LIMIT 500`, [id])).rows;
      const byKind = (await query(
        `SELECT kind AS label, COUNT(*)::int n FROM wa_messages
          WHERE chat_id = $1 GROUP BY 1 ORDER BY n DESC`, [id])).rows;
      const attachments = (await query(
        `SELECT kind AS label, COUNT(*)::int n, SUM(size_bytes)::bigint bytes
           FROM wa_attachments WHERE chat_id = $1 GROUP BY 1 ORDER BY n DESC`, [id])).rows;
      // The rows behind that summary, whole: att_id, mime, file_name, blob_url,
      // width, height, duration, size and the device that uploaded it were all
      // stored and none of them were reachable from this page.
      const attachmentRows = (await query(
        `SELECT * FROM wa_attachments WHERE chat_id = $1
          ORDER BY sent_at DESC NULLS LAST LIMIT 500`, [id])).rows;
      return { chat, messages, byKind, attachments, attachmentRows };
    }

    const totals = (await query(
      `SELECT (SELECT COUNT(*) FROM wa_chats)::int        AS chats,
              (SELECT COUNT(*) FROM wa_messages)::int     AS messages,
              (SELECT COUNT(*) FROM wa_attachments)::int  AS attachments,
              (SELECT COUNT(*) FROM wa_sync_runs)::int    AS runs,
              (SELECT COUNT(*) FROM wa_chats WHERE unresolved)::int AS unresolved,
              (SELECT MIN(sent_at) FROM wa_messages)      AS oldest,
              (SELECT MAX(sent_at) FROM wa_messages)      AS newest`)).rows[0];

    // msg_count DESC, not last_at: the question this page answers first is
    // "what is actually in here", and a dormant 20k-message thread matters
    // more to that than yesterday's one-liner.
    const rows = (await query(
      `SELECT * FROM wa_chats ORDER BY msg_count DESC, name ASC LIMIT $1 OFFSET $2`, [limit, offset])).rows;

    const byKind = (await query(
      `SELECT kind AS label, COUNT(*)::int n, SUM(msg_count)::int messages
         FROM wa_chats GROUP BY 1 ORDER BY n DESC`)).rows;

    // attachments_seen/attachments_skipped arrived in
    // Database/schema/008_wa_sync_attachment_counts.sql for one reason: a run
    // that discarded every attachment -- media metadata with no blob_url, or an
    // attachment whose chat was never ingested -- read exactly like a perfect
    // run, which is how wa_attachments stayed empty against 18,232 media
    // messages without a single run ever flagging it. Both columns are nullable
    // on purpose, so rows written before that migration are "unknown" rather
    // than zero and the page must print — for them, never 0.
    const runs = (await query(
      `SELECT * FROM wa_sync_runs ORDER BY started_at DESC LIMIT 10`)).rows;

    return { total: totals.chats, limit, offset, rows, totals, byKind, runs };
  },

  // Every column of every table, one table at a time.
  //
  // The curated panels above each answer one question with a hand-picked column
  // list, and a column no panel names is invisible even though it is stored:
  // 008's wa_sync_runs.attachments_seen reached production and no screen drew
  // it. This is the floor under those panels -- SELECT * for one allow-listed
  // table plus its column list from information_schema, so the next migration's
  // column is readable on the day it lands rather than on the day someone
  // notices it is missing. The allow-list is APP_TABLES: this database is shared
  // with the sibling deployment, and the name is checked before it is ever
  // interpolated into SQL.
  async table({ name, limit, offset }) {
    const table = String(name || '');
    if (!APP_TABLES.includes(table)) {
      return { table, error: 'not an allow-listed table', allowed: APP_TABLES, columns: [], rows: [], total: 0, limit, offset };
    }
    const exists = (await query('SELECT to_regclass($1) AS t', [`public.${table}`])).rows[0].t;
    if (!exists) {
      return { table, missing: true, columns: [], rows: [], total: 0, limit, offset };
    }
    const columns = (await query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`, [table])).rows;
    const total = Number((await query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n) || 0;
    const rows = (await query(
      `SELECT * FROM ${table} ORDER BY 1 LIMIT $1 OFFSET $2`, [limit, offset])).rows;
    return { table, columns, rows, total, limit, offset };
  },

  async health({ site }) {
    // One list, shared with the generic `table` view, so a table cannot be
    // countable and unbrowsable (or the reverse). 004_whatsapp is shared with
    // jaytibirthday-site's galaxy read path; wa_attachments arrived in 005 and
    // was missing here for a while, which is how the one table the media panels
    // read became the one table Health could not see.
    const tables = APP_TABLES;
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
        ORDER BY ordinal_position`)).rows.map((r) => r.column_name);
    const expr = cols.map((c) => `COUNT("${c}")::int AS "${c}"`).join(', ');
    const coverage = (await query(
      `SELECT COUNT(*)::int AS total, ${expr} FROM events WHERE site = $1`, [site])).rows[0];

    // The card above only ever covered `events`, so the promise in the comment
    // above -- that a new migration's column would "appear here by itself" --
    // held for exactly one table. 008 added wa_sync_runs.attachments_seen and
    // nothing showed it: a column that lands in no panel and no coverage row is
    // indistinguishable from data that never arrived. One aggregate per column
    // per table, and no column is skipped: a payload or a stored file is a
    // column like any other, and a coverage row that omits it is a column this
    // page cannot report on. Scoped to APP_TABLES, so the sibling deployment's
    // tables in the same database are never counted, named or read.
    const coverageByTable = [];
    for (const t of tables) {
      if (counts[t] == null) continue; // not migrated here; Health already says so
      const tableCols = (await query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = $1 AND table_schema = 'public'
          ORDER BY ordinal_position`, [t])).rows.map((r) => r.column_name);
      if (!tableCols.length) continue;
      const row = (await query(
        `SELECT COUNT(*)::int AS total, ${tableCols.map((c) => `COUNT("${c}")::int AS "${c}"`).join(', ')} FROM ${t}`
      )).rows[0];
      coverageByTable.push({
        table: t,
        total: row.total,
        columns: tableCols.map((c) => ({ name: c, filled: row[c] })),
      });
    }

    const sources = (await query(
      `SELECT source_system, COUNT(*)::int n, MIN(occurred_at) oldest, MAX(occurred_at) newest
         FROM events GROUP BY 1 ORDER BY n DESC`)).rows;
    const span = (await query('SELECT MIN(occurred_at) oldest, MAX(occurred_at) newest FROM events')).rows[0];
    return { counts, countsForSite, coverage, coverageByTable, sources, span };
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
    return res.status(503).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
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
      // The generic table view's table name. Validated against APP_TABLES inside
      // the view, before it is interpolated into any SQL.
      name: req.query.name ? String(req.query.name).slice(0, 80) : null,
      includeNoise: req.query.noise === '1',
    });
    return res.status(200).json({ ok: true, view, data });
  } catch (err) {
    console.error('[db-api]', view, err);
    return res.status(500).json({ ok: false, view, error: err.message });
  }
}
