// One visitor's or session's full trail, served from the Neon warehouse.
//
// This route used to answer by brute force: list every object under
// analytics/ in Vercel Blob, fetch each one over HTTP inside a 15-second
// budget, and keep the ones whose visitor_id matched. Finding one visitor cost
// a read of every event ever recorded, so a per-visitor index was written into
// Blob to dodge the scan, and that index then needed its own backfill path,
// its own truncation caps and its own staleness story.
//
// Postgres indexes (site, visitor_id, occurred_at) and (site, session_id,
// occurred_at). The scan, the index, the budgets and the backfill are all one
// query now.
//
// What made this possible — and what made it look impossible at first — is
// that `raw_payload` archives the whole original event, in two shapes:
//
//   vercel-blob rows: the tracker's payload sits at the top level
//   site-api rows:    the same payload nested under `event`
//
// A first pass at this looked only at top-level keys on the newest rows (all
// site-api) and concluded the rich telemetry — web vitals, screen_info,
// network_info, battery_info, the utm_* set — had been dropped by the mirror.
// It had not; it was one level down. asEvent() below reads either shape, which
// is why projectEvent and summarize could be kept exactly as they were.
import { requireKey } from './_auth.js';
import { decodeGeo } from './lib/geo.js';
import { query, isConfigured } from '../Integrations/postgres.js';

// The property this dossier covers, matching /api/stats.
const SITE = process.env.STATS_SITE || 'jaytibirthday.in';

// Rebuilds the event exactly as the blob scan used to hand it over. The
// archived payload wins; the indexed columns fill anything it lacks, which
// matters for rows written by feeds that never carried the full object.
function asEvent(row) {
  const archived = row.raw_payload || {};
  const base = archived.event && typeof archived.event === 'object' ? archived.event : archived;
  const at = row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at;

  return {
    ...base,
    event_type: base.event_type ?? row.event_type,
    session_id: base.session_id ?? row.session_id,
    visitor_id: base.visitor_id ?? row.visitor_id,
    page_url: base.page_url ?? row.page_url,
    referrer: base.referrer ?? row.referrer,
    time_on_page: base.time_on_page ?? (typeof row.time_on_page === 'number' ? row.time_on_page : undefined),
    scroll_percent: base.scroll_percent ?? (typeof row.scroll_percent === 'number' ? row.scroll_percent : undefined),
    device_fingerprint: base.device_fingerprint ?? row.fingerprint,
    timestamp: base.timestamp ?? at,
    // summarize() and the drawer both order on receivedAt; occurred_at is the
    // column that ordering is indexed on, so they agree by construction.
    receivedAt: at,
    server_location: archived.server_location ?? base.server_location ?? {
      ip: row.ip, country: row.country, region: row.region, city: row.city, timezone: row.timezone,
    },
    server_request_meta: archived.server_request_meta ?? base.server_request_meta ?? {
      userAgent: row.user_agent, referer: row.referrer,
    },
  };
}

function projectEvent(d) {
  return {
    event_type: d.event_type,
    page_url: d.page_url,
    page_title: d.page_title,
    // The tracker has always sent the real document.referrer and the UTM set,
    // but this projection dropped them - so the drawer fell back to
    // server_request_meta.referer, which is the Referer of the tracker's own
    // POST to /api/track and therefore always the page itself. That is why
    // every visitor appeared to be a self-referral.
    referrer: d.referrer,
    referrer_hostname: d.referrer_hostname,
    utm: [d.utm_source, d.utm_medium, d.utm_campaign, d.utm_term, d.utm_content].some(Boolean)
      ? { source: d.utm_source, medium: d.utm_medium, campaign: d.utm_campaign, term: d.utm_term, content: d.utm_content }
      : undefined,
    timestamp: d.timestamp,
    receivedAt: d.receivedAt,
    time_on_page: d.time_on_page,
    scroll_percent: d.scroll_percent,
    session_id: d.session_id,
    visitor_id: d.visitor_id,
    device_fingerprint: d.device_fingerprint,
    // Decoded on read: rows written before the ingestion fix still hold
    // percent-encoded geo ("Son%C4%ABpat"), and they cannot be rewritten.
    server_location: decodeGeo(d.server_location),
    server_request_meta: d.server_request_meta,
    ua_client_hints: d.ua_client_hints,
    storage_estimate: d.storage_estimate,
    refresh_rate: d.refresh_rate,
    frame_rate: d.frame_rate,
    memory_info: d.memory_info,
    input_type: d.input_type,
    pwa_state: d.pwa_state,
    advanced_capabilities: d.advanced_capabilities,
    network_info: d.network_info,
    browser_info: d.browser_info,
    screen_info: d.screen_info,
    battery_info: d.battery_info,
    web_vitals: d.event_type === 'web_vitals' ? {
      lcp: d.lcp, cls: d.cls, inp: d.inp, fid: d.fid, ttfb: d.ttfb, reason: d.reason
    } : undefined,
    interactions: d.interactions,
  };
}

function summarize(events, fallbackVisitor) {
  const ips = new Set();
  const countries = {};
  const sessions = new Set();
  const fingerprints = new Set();
  const uas = new Set();
  const pages = new Set();
  let first = null;
  let last = null;
  let maxTimeOnPage = 0;
  let latestNetwork = null;

  for (const d of events) {
    const ip = d.server_location && d.server_location.ip;
    if (ip) ips.add(ip);
    const c = d.server_location && d.server_location.country;
    if (c) countries[c] = (countries[c] || 0) + 1;
    if (d.session_id) sessions.add(d.session_id);
    if (d.device_fingerprint) fingerprints.add(d.device_fingerprint);
    const ua = d.server_request_meta && d.server_request_meta.userAgent;
    if (ua) uas.add(ua);
    if (d.page_url) pages.add(d.page_url);
    if (typeof d.time_on_page === 'number' && d.time_on_page > maxTimeOnPage) maxTimeOnPage = d.time_on_page;
    if (d.receivedAt) {
      if (!first || d.receivedAt < first) first = d.receivedAt;
      if (!last || d.receivedAt > last) last = d.receivedAt;
      latestNetwork = d.server_location || latestNetwork;
    }
  }

  return {
    visitor_id: fallbackVisitor || (events[0] && events[0].visitor_id) || null,
    device_fingerprints: [...fingerprints],
    sessions: [...sessions],
    ips: [...ips],
    ips_truncated: false,   // the scan path returns every address it saw
    countries: Object.entries(countries).sort((a, b) => b[1] - a[1]),
    user_agents: [...uas],
    pages: [...pages],
    first_seen: first,
    last_seen: last,
    total_events: events.length,
    max_time_on_page: maxTimeOnPage,
    // Raw blob rows, not projectEvent output, so decode here or the drawer
    // shows the city decoded in the timeline and encoded in Network & location.
    // Once after the loop, not inside it - only the last row survives anyway.
    network: decodeGeo(latestNetwork),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireKey(req, res)) return;
  const visitor = req.query.visitor;
  const session = req.query.session;
  if (!visitor && !session) {
    return res.status(400).json({ success: false, error: 'visitor or session required' });
  }

  if (!isConfigured()) {
    return res.status(503).json({ success: false, error: 'DATABASE_URL not set on this deployment' });
  }

  const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 90);

  try {
    // One indexed lookup. The old path read every event in the window to find
    // these, which is why it needed a budget and reported `partial`.
    const rows = (await query(
      `SELECT raw_payload, occurred_at, event_type, session_id, visitor_id, page_url,
              referrer, ip, country, region, city, timezone, user_agent,
              time_on_page, scroll_percent, fingerprint
         FROM events
        WHERE site = $1
          AND ${visitor ? 'visitor_id' : 'session_id'} = $2
          AND occurred_at > now() - ($3 || ' days')::interval
        ORDER BY occurred_at ASC`,
      [SITE, visitor || session, days]
    )).rows;

    const events = rows.map(asEvent);

    return res.status(200).json({
      success: true,
      // Nothing is sampled now, so nothing can be missing.
      partial: false,
      source: 'postgres',
      query: { visitor, session },
      summary: summarize(events, visitor),
      events: events.map(projectEvent),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'visitor lookup failed' });
  }
}
