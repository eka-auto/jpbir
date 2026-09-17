// The write side of the Neon warehouse, shared by every path that feeds it.
//
// There were two feeds and they did not agree. /api/jp-track wrote each event
// to DynamoDB only, and /api/db-push copied DynamoDB into Postgres later, by
// hand, stamping every row with the constant site 'jaytipargal.com'. The result
// is the state the warehouse is in today: 10,843 rows for jaytibirthday.in
// (written by the sibling project, live), 3 rows for jaytipargal.com (last
// touched 2026-08-31), and not one row for jaytipargal.tech — the domain the
// dashboard itself is served from.
//
// Three rules hold here, because breaking any one of them puts the same visit
// in the table twice under two different names:
//
//   1. `site` is derived from the page's own URL, never from a constant. One
//      deployment serves several domains; a constant can only be right for one.
//   2. The row id is `<site>:<source id>`, the shape both existing feeds
//      already use, and inserts are ON CONFLICT DO NOTHING. So mirroring an
//      event live and later re-importing the same row from DynamoDB is a
//      no-op, not a duplicate.
//   3. Rollups are RECOMPUTED from `events` for the affected key, never
//      incremented. db-push's full rebuild does exactly this over every key;
//      running the same statement scoped to one visitor keeps the live path
//      and the rebuild from ever disagreeing. The (site, visitor_id) and
//      (site, session_id) indexes make the scoped form an index lookup.
import { query } from '../../Integrations/postgres.js';

const iso = (v) => {
  if (!v) return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (v == null ? null : String(v));

// Bare host, lowercased. 'www.' is stripped because the dashboard's property
// selector lists DISTINCT site: keeping the prefix would split one property
// into two rows that each hold half its traffic.
function normaliseHost(host) {
  if (!host) return null;
  const clean = String(host).trim().toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
  return clean || null;
}

/**
 * The property an event belongs to. Prefers the page's own URL — that is the
 * only field that survives a proxy, a beacon replayed from another origin, or
 * a later re-import from DynamoDB, so it is the only one that gives the same
 * answer every time the same event is processed.
 *
 * @param {string|null} pageUrl  the tracked page's absolute URL
 * @param {string|null} fallback  request Host/Origin, used when there is no URL
 */
export function siteFor(pageUrl, fallback) {
  if (typeof pageUrl === 'string' && pageUrl) {
    try {
      const host = normaliseHost(new URL(pageUrl).hostname);
      if (host) return host;
    } catch {
      // Relative or malformed page_url; fall through to the request's own host.
    }
  }
  if (typeof fallback === 'string' && fallback) {
    try {
      return normaliseHost(new URL(fallback).hostname);
    } catch {
      return normaliseHost(fallback);
    }
  }
  return null;
}

// The two trackers feeding this table name the same event differently:
// jaytibirthday-site sends `page_view` (347 rows and counting), jp-tracker.js
// sends `pageview`. db-api's Overview counts the first spelling for its Page
// views card, so a .tech property reported 0 page views while its own pageview
// rows sat in the table. Folded in at ingestion rather than taught to every
// reader — and to the noise filter, and to anything written later.
const EVENT_TYPE_ALIASES = { pageview: 'page_view' };

const normaliseEventType = (type) => {
  const name = type || 'event';
  return EVENT_TYPE_ALIASES[name] || name;
};

// `screen` is read as JSON: db-api digs out width/height with ->>. jaytibirthday's
// tracker stores screen_info JSON, jp-tracker sends the string "1280x720 (DPR:1.5)",
// and ONE such row used to abort the Overview query for the whole property —
// Postgres fails the statement, so a stray value cost every card on the page,
// not one label on the Screens card. Parse it into the dialect the column
// already speaks, keeping the original under `raw`.
function normaliseScreen(screen) {
  if (screen == null || screen === '') return null;
  if (typeof screen === 'object') return JSON.stringify(screen);

  const text = String(screen);
  if (/^\s*\{/.test(text)) return text;

  const m = /^(\d+)\s*x\s*(\d+)(?:\s*\(DPR:\s*([\d.]+)\))?/i.exec(text);
  if (!m) return text;
  return JSON.stringify({
    width: Number(m[1]),
    height: Number(m[2]),
    ...(m[3] ? { dpr: Number(m[3]) } : {}),
    raw: text,
  });
}

function campaignOf(pageUrl) {
  try {
    const p = new URL(pageUrl).searchParams;
    return { source: p.get('utm_source'), medium: p.get('utm_medium'), campaign: p.get('utm_campaign') };
  } catch {
    return { source: null, medium: null, campaign: null };
  }
}

/**
 * Inserts one telemetry item. `item` is the camelCase shape jp-track builds and
 * stores in DynamoDB, so both feeds hand over the same object.
 *
 * @returns {Promise<boolean>} true when a new row was written; false when the
 *   row already existed or carried no usable timestamp.
 */
export async function insertEvent(item, { site, sourceSystem, db = query }) {
  const at = iso(item.timestamp || item.epoch);
  if (!at || !site) return false;

  const pageUrl = str(item.pageUrl);
  const utm = pageUrl ? campaignOf(pageUrl) : { source: null, medium: null, campaign: null };
  // page_domain is what the dashboard's "Domains" card groups on. Deriving it
  // here means the card finally covers live rows, not only the 2026 blob import.
  let pageDomain = null;
  if (pageUrl) {
    try { pageDomain = normaliseHost(new URL(pageUrl).hostname); } catch { pageDomain = null; }
  }

  const result = await db(
    `INSERT INTO events (
       id, site, event_type, occurred_at, epoch_ms, session_id, visitor_id,
       page_url, page_title, referrer, ip, country, region, city, latitude,
       longitude, timezone, postal_code, user_agent, language, screen,
       device_type, browser, os, network, time_on_page, scroll_percent,
       fingerprint, event_data, raw_payload, source_system,
       page_domain, utm_source, utm_medium, utm_campaign)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
     ON CONFLICT (id) DO NOTHING`,
    [
      `${site}:${item.id}`, site, normaliseEventType(item.eventType), at,
      Number.isFinite(item.epoch) ? item.epoch : Date.parse(at),
      str(item.sessionId), str(item.visitorId), pageUrl, str(item.pageTitle),
      str(item.referrer), str(item.ip), str(item.country), str(item.region), str(item.city),
      str(item.latitude), str(item.longitude), str(item.timezone), str(item.postalCode),
      str(item.userAgent), str(item.language),
      normaliseScreen(item.screen),
      str(item.deviceType), str(item.browser), str(item.os),
      item.network ? JSON.stringify(item.network) : null,
      num(item.timeOnPage), num(item.scrollPercent), str(item.fingerprint),
      JSON.stringify(item.eventData || {}), JSON.stringify(item), sourceSystem,
      pageDomain, utm.source, utm.medium, utm.campaign,
    ]
  );
  return result.rowCount > 0;
}

// Both rollups are the same statement whether they rebuild the whole table or
// one key: the scope only narrows the aggregate's input. Written once so the
// live path and db-push's rebuild cannot drift into reporting different counts
// for the same visitor.
export async function rollupVisitors({ site, visitorId, db = query } = {}) {
  const scoped = Boolean(site && visitorId);
  await db(
    `INSERT INTO visitors (visitor_id, site, first_seen_at, last_seen_at, event_count,
                           session_count, country, region, city, timezone, user_agent,
                           device_type, browser, os, fingerprint)
     SELECT a.visitor_id, a.site, a.first_seen_at, a.last_seen_at, a.event_count,
            a.session_count, l.country, l.region, l.city, l.timezone, l.user_agent,
            l.device_type, l.browser, l.os, l.fingerprint
       FROM (
         SELECT site, visitor_id,
                MIN(occurred_at) AS first_seen_at,
                MAX(occurred_at) AS last_seen_at,
                COUNT(*)::int    AS event_count,
                COUNT(DISTINCT session_id)::int AS session_count
           FROM events
          WHERE visitor_id IS NOT NULL ${scoped ? 'AND site = $1 AND visitor_id = $2' : ''}
          GROUP BY site, visitor_id
       ) a
       JOIN LATERAL (
         SELECT country, region, city, timezone, user_agent, device_type,
                browser, os, fingerprint
           FROM events e
          WHERE e.site = a.site AND e.visitor_id = a.visitor_id
          ORDER BY e.occurred_at DESC LIMIT 1
       ) l ON true
     ON CONFLICT (site, visitor_id) DO UPDATE SET
       first_seen_at = LEAST(visitors.first_seen_at, EXCLUDED.first_seen_at),
       last_seen_at  = GREATEST(visitors.last_seen_at, EXCLUDED.last_seen_at),
       event_count   = EXCLUDED.event_count,
       session_count = EXCLUDED.session_count,
       country       = COALESCE(EXCLUDED.country, visitors.country),
       region        = COALESCE(EXCLUDED.region, visitors.region),
       city          = COALESCE(EXCLUDED.city, visitors.city),
       timezone      = COALESCE(EXCLUDED.timezone, visitors.timezone),
       user_agent    = COALESCE(EXCLUDED.user_agent, visitors.user_agent),
       device_type   = COALESCE(EXCLUDED.device_type, visitors.device_type),
       browser       = COALESCE(EXCLUDED.browser, visitors.browser),
       os            = COALESCE(EXCLUDED.os, visitors.os),
       fingerprint   = COALESCE(EXCLUDED.fingerprint, visitors.fingerprint)`,
    scoped ? [site, visitorId] : []
  );
}

export async function rollupSessions({ site, sessionId, db = query } = {}) {
  const scoped = Boolean(site && sessionId);
  await db(
    `INSERT INTO sessions (session_id, site, visitor_id, started_at, last_event_at,
                           event_count, entry_page, exit_page)
     SELECT session_id, site, MIN(visitor_id), MIN(occurred_at), MAX(occurred_at), COUNT(*),
            (ARRAY_AGG(page_url ORDER BY occurred_at ASC))[1],
            (ARRAY_AGG(page_url ORDER BY occurred_at DESC))[1]
       FROM events
      WHERE session_id IS NOT NULL ${scoped ? 'AND site = $1 AND session_id = $2' : ''}
      GROUP BY site, session_id
     ON CONFLICT (site, session_id) DO UPDATE SET
       last_event_at = GREATEST(sessions.last_event_at, EXCLUDED.last_event_at),
       event_count   = EXCLUDED.event_count,
       exit_page     = EXCLUDED.exit_page`,
    scoped ? [site, sessionId] : []
  );
}

/**
 * Mirrors one event and refreshes only the two rollup rows it can affect.
 *
 * Awaited by the caller rather than fired and forgotten: a serverless instance
 * is frozen the moment it responds, so a promise left running is a promise that
 * may never finish. Three indexed statements is the price of that guarantee.
 */
export async function recordEvent(item, { site, sourceSystem, db = query }) {
  // A duplicate insert means this exact event was already rolled up; redoing
  // the aggregates would cost two index scans to write the numbers back
  // unchanged.
  const inserted = await insertEvent(item, { site, sourceSystem, db });
  if (!inserted) return { inserted: false };

  if (item.visitorId) await rollupVisitors({ site, visitorId: String(item.visitorId), db });
  if (item.sessionId) await rollupSessions({ site, sessionId: String(item.sessionId), db });
  return { inserted: true };
}
