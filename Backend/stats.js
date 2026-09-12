import { list } from '@vercel/blob';
import { decodeGeo } from './lib/geo.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const TOKEN = _env['BLOB_' + 'READ_WRITE_TOKEN'];
const CACHE_TTL = 5000;
const _cache = globalThis.__jbtStatsCache || (globalThis.__jbtStatsCache = new Map());

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

async function listAll(prefix) {
  let cursor;
  const out = [];
  let page = 0;
  do {
    const opts = { token: TOKEN, limit: 1000, prefix };
    if (cursor) opts.cursor = cursor;
    const res = await list(opts);
    out.push(...res.blobs);
    cursor = res.cursor;
    if (++page > 200) break;
  } while (cursor);
  return out;
}

async function mapWithBudget(items, limit, budgetMs, worker) {
  const results = [];
  const start = Date.now();
  let i = 0;
  let timedOut = false;
  async function run() {
    while (i < items.length) {
      if (Date.now() - start > budgetMs) { timedOut = true; return; }
      const idx = i++;
      try { results[idx] = await worker(items[idx]); } catch { results[idx] = null; }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(workers);
  return { results, timedOut };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 90);
  const cacheKey = 'd' + days;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return res.status(200).json({ ...cached.body, cached: true });
  }

  const cutoff = Date.now() - days * 86400000;

  try {
    const [analyticsBlobs, emailBlobs] = await Promise.all([
      listAll('analytics/'),
      listAll('email_opens/'),
    ]);

    const inWindow = analyticsBlobs
      .filter(b => b.uploadedAt && b.uploadedAt.getTime() >= cutoff)
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
    const byType = {};
    const daily = {};
    const hourly = {};
    for (const b of inWindow) {
      const parts = b.pathname.split('/');
      const type = parts[1] || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
      const t = b.uploadedAt;
      const day = t.toISOString().slice(0, 10);
      daily[day] = (daily[day] || 0) + 1;
      const hourKey = t.toISOString().slice(0, 13);
      hourly[hourKey] = (hourly[hourKey] || 0) + 1;
    }

    const budgetMs = 8000;
    const { results, timedOut } = await mapWithBudget(
      inWindow, 40, budgetMs,
      async (b) => {
        const r = await fetch(b.url, { headers: { authorization: `Bearer ${TOKEN}` } });
        if (!r.ok) return null;
        return r.json();
      }
    );

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
      // Decode once per row. Doing it here rather than at each use also keeps
      // the countries/cities tallies from splitting one place across two keys
      // ("Sonipat" and "Son%C4%ABpat") depending on when the row was written.
      const loc = decodeGeo(d.server_location) || {};
      const ip = loc.ip;
      if (ip && ip !== 'unknown') ips.add(ip);
      const country = loc.country;
      if (country) countries[country] = (countries[country] || 0) + 1;
      const city = loc.city;
      if (city) cities[city] = (cities[city] || 0) + 1;
      const ref = d.server_request_meta && d.server_request_meta.referer;
      if (ref) {
        try { const h = new URL(ref).hostname; referrers[h] = (referrers[h] || 0) + 1; } catch {}
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

    const emailOpens = emailBlobs.filter(b => b.uploadedAt && b.uploadedAt.getTime() >= cutoff);
    const emailByRecipient = {};
    for (const b of emailBlobs) {
      const parts = b.pathname.split('/');
      const who = parts[1] || 'unknown';
      if (b.uploadedAt && b.uploadedAt.getTime() >= cutoff) {
        emailByRecipient[who] = (emailByRecipient[who] || 0) + 1;
      }
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
      totals: {
        events_in_window: inWindow.length,
        events_by_type: sortDesc(byType),
        unique_ips: ips.size,
        unique_sessions: sessions.size,
        page_views: byType['page_view'] || 0,
        heartbeats: byType['heartbeat'] || 0,
        email_opens: emailOpens.length,
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
