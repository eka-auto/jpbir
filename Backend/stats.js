// Dashboard statistics, served from the Neon warehouse.
//
// This route used to read Vercel Blob directly: list every object under
// analytics/, filter by uploadedAt, then fetch each object's body over HTTP
// with an 8-second budget and 40-way concurrency. Two consequences the
// dashboard lived with:
//
//   1. It was never complete. Whatever the budget did not reach was dropped
//      and the response said `partial: true` — 10,515 of 10,843 rows on a
//      normal day, with the shortfall varying per request. Two reloads a
//      minute apart disagreed about how many events existed.
//   2. It cost one HTTP round trip per event. The blob store is the ingest
//      journal, not a query engine.
//
// Every one of those rows is already mirrored into Postgres, indexed on
// (site, occurred_at). One query replaces the fan-out, and `partial` becomes
// permanently false because the window is now actually the window.
//
// The response contract is unchanged, field for field — the frontend reads
// this shape in a dozen places and none of it moves. What changed is where
// the rows come from, so the accumulation below is deliberately the same
// loop it always was, fed from a query instead of from blob fetches.
import { decodeGeo } from './lib/geo.js';
import { requireKey } from './_auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';

const CACHE_TTL = 5000;
const _cache = globalThis.__jbtStatsCache || (globalThis.__jbtStatsCache = new Map());

// The property this dashboard reports on. The blob store held exactly one
// site's analytics, so this was implicit before; in a warehouse holding
// several it has to be said out loud.
const SITE = process.env.STATS_SITE || 'jaytibirthday.in';

function parseUA(ua) {
  if (!ua) return { device: 'unknown', browser: 'unknown', os: 'unknown' };
  const s = ua;
  let device = 'desktop';
  if (/Mobile|Android|iPhone|iPad|iPod/i.test(s)) device = /iPad|Tablet/i.test(s) ? 'tablet' : 'mobile';
  let browser = 'other';
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/Firefox\//i.test(s)) browser = 'Firefox';
  else if (/Chrome\//i.test(s)) browser = 'Chrome';
  else if (/Safari\//i.test(s) && /Version\//i.test(s)) browser = 'Safari';
  let os = 'other';
  if (/Windows/i.test(s)) os = 'Windows';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Mac OS X/i.test(s)) os = 'macOS';
  else if (/Linux/i.test(s)) os = 'Linux';
  return { device, browser, os };
}

const iso = (v) => (v instanceof Date ? v.toISOString() : v || null);

// Reshapes a warehouse row into the object the accumulation loop below has
// always consumed. Keeping the loop and moving the source is what makes this
// swap reviewable: every tally, cut-off and sort order is the code that was
// already producing these numbers.
function asEvent(r) {
  return {
    event_type: r.event_type,
    session_id: r.session_id,
    visitor_id: r.visitor_id,
    page_url: r.page_url,
    time_on_page: typeof r.time_on_page === 'number' ? r.time_on_page : null,
    scroll_percent: typeof r.scroll_percent === 'number' ? r.scroll_percent : null,
    device_fingerprint: r.fingerprint,
    timestamp: iso(r.occurred_at),
    receivedAt: iso(r.occurred_at),
    // decodeGeo still runs over this: rows written before ingestion started
    // decoding hold percent-encoded city names, and splitting "Sonipat" from
    // "Son%C4%ABpat" across two tally keys is exactly what it prevents.
    server_location: {
      ip: r.ip,
      country: r.country,
      region: r.region,
      city: r.city,
      timezone: r.timezone,
    },
    server_request_meta: { userAgent: r.user_agent, referer: r.referrer },
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Visitor analytics: gated before the cache, so a cached body can never be
  // served to a caller who could not have earned it.
  if (!requireKey(req, res)) return;
  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 90);
  const cacheKey = 'd' + days;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return res.status(200).json({ ...cached.body, cached: true });
  }

  if (!isConfigured()) {
    return res.status(500).json({ success: false, error: 'DATABASE_URL not set on this deployment' });
  }

  try {
    const [eventRows, emailRows] = await Promise.all([
      query(
        `SELECT event_type, occurred_at, session_id, visitor_id, page_url, referrer,
                ip, country, region, city, timezone, user_agent, time_on_page,
                scroll_percent, fingerprint
           FROM events
          WHERE site = $1 AND occurred_at > now() - ($2 || ' days')::interval
          ORDER BY occurred_at DESC`,
        [SITE, days]
      ),
      query(
        `SELECT email, opened_at
           FROM email_opens
          WHERE opened_at > now() - ($1 || ' days')::interval`,
        [days]
      ),
    ]);

    const results = eventRows.rows.map(asEvent);
    const inWindow = results;

    const byType = {};
    const daily = {};
    const hourly = {};
    for (const d of results) {
      byType[d.event_type || 'unknown'] = (byType[d.event_type || 'unknown'] || 0) + 1;
      if (!d.receivedAt) continue;
      daily[d.receivedAt.slice(0, 10)] = (daily[d.receivedAt.slice(0, 10)] || 0) + 1;
      hourly[d.receivedAt.slice(0, 13)] = (hourly[d.receivedAt.slice(0, 13)] || 0) + 1;
    }

    // The window is the window now: nothing is sampled, so nothing is missing.
    const timedOut = false;

    const sessions = new Map();
    const ips = new Set();
    const countries = {};
    const cities = {};
    const referrers = {};
    const browsers = {};
    const oses = {};
    const devices = {};
    const heartbeatEvents = [];
    const recentEvents = [];
    let withContent = 0;
    const sessionMaxTime = new Map();
    const now = Date.now();
    const activeSessions = new Map();

    for (const d of results) {
      if (!d) continue;
      withContent++;
      const loc = decodeGeo(d.server_location) || {};
      const ip = loc.ip;
      if (ip && ip !== 'unknown') ips.add(ip);
      const country = loc.country;
      if (country) countries[country] = (countries[country] || 0) + 1;
      const city = loc.city;
      if (city) cities[city] = (cities[city] || 0) + 1;
      const ref = d.server_request_meta && d.server_request_meta.referer;
      if (ref) {
        try { const h = new URL(ref).hostname; referrers[h] = (referrers[h] || 0) + 1; } catch { /* not a URL */ }
      }
      const ua = d.server_request_meta && d.server_request_meta.userAgent;
      const parsed = parseUA(ua);
      browsers[parsed.browser] = (browsers[parsed.browser] || 0) + 1;
      oses[parsed.os] = (oses[parsed.os] || 0) + 1;
      devices[parsed.device] = (devices[parsed.device] || 0) + 1;

      if (typeof d.time_on_page === 'number' && d.time_on_page > 0) {
        const sid2 = d.session_id || 'no-session';
        if (!sessionMaxTime.has(sid2) || d.time_on_page > sessionMaxTime.get(sid2)) {
          sessionMaxTime.set(sid2, d.time_on_page);
        }
      }

      const sid = d.session_id || 'no-session';
      if (!sessions.has(sid)) sessions.set(sid, { first: d.receivedAt, last: d.receivedAt, count: 0, ip, types: {} });
      const s = sessions.get(sid);
      s.count++;
      s.types[d.event_type || 'unknown'] = (s.types[d.event_type || 'unknown'] || 0) + 1;
      if (d.receivedAt) {
        if (!s.first || d.receivedAt < s.first) s.first = d.receivedAt;
        if (!s.last || d.receivedAt > s.last) s.last = d.receivedAt;
        const age = now - new Date(d.receivedAt).getTime();
        if (age < 120000) {
          const cur = activeSessions.get(sid) || { session_id: sid, last_seen: d.receivedAt, events: 0 };
          cur.last_seen = d.receivedAt;
          cur.events++;
          cur.visitor_id = d.visitor_id || cur.visitor_id;
          cur.ip = ip || cur.ip;
          cur.country = country || cur.country;
          cur.city = city || cur.city;
          cur.timezone = loc.timezone || cur.timezone;
          cur.userAgent = ua || cur.userAgent;
          cur.page_url = d.page_url || cur.page_url;
          cur.device_fingerprint = d.device_fingerprint || cur.device_fingerprint;
          if (typeof d.time_on_page === 'number' && d.time_on_page > (cur.time_on_page || 0)) {
            cur.time_on_page = d.time_on_page;
          }
          if (typeof d.scroll_percent === 'number') cur.scroll_percent = d.scroll_percent;
          if (d.event_type === 'heartbeat') cur.last_heartbeat = d.receivedAt;
          activeSessions.set(sid, cur);
        }
      }
      if (d.event_type === 'heartbeat') {
        heartbeatEvents.push({
          session_id: d.session_id,
          visitor_id: d.visitor_id,
          page_url: d.page_url,
          timestamp: d.timestamp,
          time_on_page: d.time_on_page,
          scroll_percent: d.scroll_percent,
          ip: ip,
          country: country,
          city: city,
          timezone: loc.timezone,
          userAgent: ua,
          referer: ref,
          receivedAt: d.receivedAt,
        });
      }
      if (d.receivedAt) {
        recentEvents.push({
          event_type: d.event_type,
          session_id: d.session_id,
          visitor_id: d.visitor_id,
          page_url: d.page_url,
          time_on_page: d.time_on_page,
          scroll_percent: d.scroll_percent,
          ip: ip,
          country: country,
          city: city,
          userAgent: ua,
          referer: ref,
          receivedAt: d.receivedAt,
        });
      }
    }

    heartbeatEvents.sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));
    recentEvents.sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));

    const sessionList = [...sessions.entries()]
      .map(([id, s]) => ({
        id, ip: s.ip, count: s.count, types: s.types, first: s.first, last: s.last,
        durationSec: s.first && s.last ? Math.round((new Date(s.last) - new Date(s.first)) / 1000) : 0,
      }))
      .sort((a, b) => (b.last || '').localeCompare(a.last || ''));

    const sortDesc = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);

    const emailByRecipient = {};
    for (const row of emailRows.rows) {
      const who = row.email || 'unknown';
      emailByRecipient[who] = (emailByRecipient[who] || 0) + 1;
    }

    const hourlySorted = Object.entries(hourly).sort((a, b) => a[0].localeCompare(b[0]));
    const last24h = hourlySorted.slice(-24);
    const peakHour = hourlySorted.length ? hourlySorted.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;

    const sessionMaxTimes = [...sessionMaxTime.values()];
    const avgTimeOnPage = sessionMaxTimes.length
      ? Math.round(sessionMaxTimes.reduce((a, b) => a + b, 0) / sessionMaxTimes.length)
      : 0;

    const body = {
      success: true,
      window_days: days,
      partial: timedOut,
      generated_at: new Date().toISOString(),
      // Which store answered. The dashboard showed blob numbers for months;
      // when someone compares a screenshot against today's figures, this is
      // the field that explains the difference.
      source: 'postgres',
      site: SITE,
      totals: {
        events_in_window: inWindow.length,
        events_by_type: sortDesc(byType),
        unique_ips: ips.size,
        unique_sessions: sessions.size,
        page_views: byType['page_view'] || 0,
        heartbeats: byType['heartbeat'] || 0,
        email_opens: emailRows.rows.length,
        events_with_detail: withContent,
        active_now: activeSessions.size,
        avg_time_on_page: avgTimeOnPage,
        peak_hour: peakHour ? { hour: peakHour[0], count: peakHour[1] } : null,
      },
      active_sessions: [...activeSessions.values()].sort((a, b) => (b.last_seen || '').localeCompare(a.last_seen || '')),
      daily: Object.entries(daily).sort((a, b) => a[0].localeCompare(b[0])),
      hourly: last24h,
      latest_heartbeats: heartbeatEvents.slice(0, 10),
      latest_events: recentEvents.slice(0, 20),
      top: {
        countries: sortDesc(countries).slice(0, 12),
        cities: sortDesc(cities).slice(0, 12),
        referrers: sortDesc(referrers).slice(0, 12),
        browsers: sortDesc(browsers).slice(0, 10),
        os: sortDesc(oses).slice(0, 10),
        devices: sortDesc(devices),
        email_recipients: sortDesc(emailByRecipient).slice(0, 12),
      },
      sessions: sessionList,
    };

    _cache.set(cacheKey, { at: Date.now(), body });
    return res.status(200).json(body);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'stats failed' });
  }
}
