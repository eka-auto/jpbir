import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { scanBounded } from './lib/ddb-scan.js';
import { decodeOne } from './lib/geo.js';
import { requireKey } from './_auth.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const AWS_ACCESS_KEY_ID = _env['JP_AWS_' + 'ACCESS_KEY_ID'];
const AWS_SECRET_ACCESS_KEY = _env['JP_AWS_' + 'SECRET_ACCESS_KEY'];
const AWS_REGION = _env['JP_AWS_' + 'REGION'] || 'us-west-2';
const TABLE = _env['JP_TELEMETRY_' + 'TABLE'] || 'jaytipargal_telemetry';

const CACHE_TTL = 5000;
const _cache = globalThis.__jpStatsCache || (globalThis.__jpStatsCache = new Map());

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


export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Before the credential check and before the cache: an unauthenticated
  // caller learns nothing, not even whether this deployment is configured.
  if (!requireKey(req, res)) return;
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return res.status(503).json({ success: false, error: 'AWS credentials not configured' });
  }

  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 90);
  const cacheKey = 'd' + days;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return res.status(200).json({ ...cached.body, cached: true });
  }

  const cutoff = Date.now() - days * 86400000;

  try {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({
      region: AWS_REGION,
      credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY }
    }));

    // `truncated` is surfaced, not swallowed. A page ceiling or the time budget
    // can stop the scan before the table ends, and a partial total presented as
    // a complete one is worse than an error because nothing looks wrong.
    const scan = await scanBounded(client, TABLE);
    const items = scan.items;
    const inWindow = items.filter(i => i.epoch && i.epoch >= cutoff);

    const byType = {};
    const daily = {};
    const hourly = {};
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
    const sessionMaxTime = new Map();
    const now = Date.now();
    const activeSessions = new Map();

    for (const d of inWindow) {
      const type = d.eventType || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
      const t = new Date(d.epoch);
      const day = t.toISOString().slice(0, 10);
      daily[day] = (daily[day] || 0) + 1;
      const hourKey = t.toISOString().slice(0, 13);
      hourly[hourKey] = (hourly[hourKey] || 0) + 1;

      const ip = d.ip;
      if (ip && ip !== 'unknown') ips.add(ip);
      // jp-track stores the `x-vercel-ip-*` headers percent-encoded. Decode once
      // per row and use these below: tallying the raw value would count
      // `Son%C4%ABpat` and `Sonīpat` as two separate cities.
      const geoCountry = decodeOne(d.country);
      const geoCity = decodeOne(d.city);
      const geoTimezone = decodeOne(d.timezone);
      if (geoCountry && geoCountry !== 'Unknown') countries[geoCountry] = (countries[geoCountry] || 0) + 1;
      if (geoCity && geoCity !== 'Unknown') cities[geoCity] = (cities[geoCity] || 0) + 1;
      const ref = d.referrer;
      if (ref && ref !== 'Direct') {
        try { const h = new URL(ref).hostname; referrers[h] = (referrers[h] || 0) + 1; } catch {}
      }
      const parsed = parseUA(d.userAgent);
      browsers[parsed.browser] = (browsers[parsed.browser] || 0) + 1;
      oses[parsed.os] = (oses[parsed.os] || 0) + 1;
      devices[parsed.device] = (devices[parsed.device] || 0) + 1;

      if (typeof d.timeOnPage === 'number' && d.timeOnPage > 0) {
        const sid = d.sessionId || 'no-session';
        if (!sessionMaxTime.has(sid) || d.timeOnPage > sessionMaxTime.get(sid)) {
          sessionMaxTime.set(sid, d.timeOnPage);
        }
      }

      const sid = d.sessionId || 'no-session';
      if (!sessions.has(sid)) sessions.set(sid, {
        first: d.timestamp, last: d.timestamp, count: 0, ip, types: {},
        // PII fields carried per session so the dashboard's sessions table can
        // render them alongside the id/ip/count columns without a second RTT
        // per row into /api/jp-visitor. Same auth gate (STATS_KEY via
        // requireKey above), same DynamoDB row that was already being read.
        visitor_id: d.visitorId,
        city: geoCity && geoCity !== 'Unknown' ? geoCity : null,
        country: geoCountry && geoCountry !== 'Unknown' ? geoCountry : null,
        timezone: geoTimezone && geoTimezone !== 'Unknown' ? geoTimezone : null,
        userAgent: d.userAgent,
        referrer: ref && ref !== 'Direct' ? ref : null,
        fingerprint: d.fingerprint,
        page_url: d.pageUrl,
        ips: new Set(ip && ip !== 'unknown' ? [ip] : []),
        user_agents: new Set(d.userAgent ? [d.userAgent] : []),
        cities: new Set(geoCity && geoCity !== 'Unknown' ? [geoCity] : []),
      });
      const s = sessions.get(sid);
      s.count++;
      s.types[type] = (s.types[type] || 0) + 1;
      // Fold subsequent events' PII into the session so a visitor whose IP
      // rotates or whose city is only decoded on a later row still shows the
      // full set. First-write-wins for the singular fields (they already
      // captured the first sighting); accumulate the *_s Sets for the drawer.
      if (ip && ip !== 'unknown') s.ips.add(ip);
      if (d.userAgent) s.user_agents.add(d.userAgent);
      if (geoCity && geoCity !== 'Unknown') s.cities.add(geoCity);
      if (!s.visitor_id && d.visitorId) s.visitor_id = d.visitorId;
      if (!s.city && geoCity && geoCity !== 'Unknown') s.city = geoCity;
      if (!s.country && geoCountry && geoCountry !== 'Unknown') s.country = geoCountry;
      if (!s.timezone && geoTimezone && geoTimezone !== 'Unknown') s.timezone = geoTimezone;
      if (!s.userAgent && d.userAgent) s.userAgent = d.userAgent;
      if (!s.referrer && ref && ref !== 'Direct') s.referrer = ref;
      if (!s.fingerprint && d.fingerprint) s.fingerprint = d.fingerprint;
      if (!s.page_url && d.pageUrl) s.page_url = d.pageUrl;
      if (d.timestamp) {
        if (!s.first || d.timestamp < s.first) s.first = d.timestamp;
        if (!s.last || d.timestamp > s.last) s.last = d.timestamp;
        const age = now - new Date(d.timestamp).getTime();
        if (age < 120000) {
          const cur = activeSessions.get(sid) || { session_id: sid, last_seen: d.timestamp, events: 0 };
          cur.last_seen = d.timestamp;
          cur.events++;
          cur.visitor_id = d.visitorId || cur.visitor_id;
          cur.ip = ip || cur.ip;
          cur.country = geoCountry || cur.country;
          cur.city = geoCity || cur.city;
          cur.timezone = geoTimezone || cur.timezone;
          cur.userAgent = d.userAgent || cur.userAgent;
          cur.page_url = d.pageUrl || cur.page_url;
          cur.device_fingerprint = d.fingerprint || cur.device_fingerprint;
          if (typeof d.timeOnPage === 'number' && d.timeOnPage > (cur.time_on_page || 0)) {
            cur.time_on_page = d.timeOnPage;
          }
          if (typeof d.scrollPercent === 'number') cur.scroll_percent = d.scrollPercent;
          if (type === 'heartbeat') cur.last_heartbeat = d.timestamp;
          activeSessions.set(sid, cur);
        }
      }

      const ev = {
        event_type: type,
        session_id: d.sessionId,
        visitor_id: d.visitorId,
        page_url: d.pageUrl,
        timestamp: d.timestamp,
        time_on_page: d.timeOnPage,
        scroll_percent: d.scrollPercent,
        ip: ip,
        country: geoCountry,
        city: geoCity,
        timezone: geoTimezone,
        userAgent: d.userAgent,
        referer: ref,
        receivedAt: d.timestamp,
        device_fingerprint: d.fingerprint,
        event_data: d.eventData,
        raw: d.rawPayload
      };
      if (type === 'heartbeat') heartbeatEvents.push(ev);
      recentEvents.push(ev);
    }

    heartbeatEvents.sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));
    recentEvents.sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));

    const sessionList = [...sessions.entries()]
      .map(([id, s]) => ({
        id, ip: s.ip, count: s.count, types: s.types, first: s.first, last: s.last,
        durationSec: s.first && s.last ? Math.round((new Date(s.last) - new Date(s.first)) / 1000) : 0,
        // PII fields (STATS_KEY gate applies to the whole endpoint).
        visitor_id: s.visitor_id || null,
        city: s.city || null,
        country: s.country || null,
        timezone: s.timezone || null,
        userAgent: s.userAgent || null,
        referrer: s.referrer || null,
        fingerprint: s.fingerprint || null,
        page_url: s.page_url || null,
        ips: [...s.ips],
        user_agents: [...s.user_agents],
        cities: [...s.cities],
      }))
      .sort((a, b) => (b.last || '').localeCompare(a.last || ''));

    const sortDesc = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);

    const hourlySorted = Object.entries(hourly).sort((a, b) => a[0].localeCompare(b[0]));
    const last24h = hourlySorted.slice(-24);
    const peakHour = hourlySorted.length ? hourlySorted.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;

    const sessionMaxTimes = [...sessionMaxTime.values()];
    const avgTimeOnPage = sessionMaxTimes.length
      ? Math.round(sessionMaxTimes.reduce((a, b) => a + b, 0) / sessionMaxTimes.length)
      : 0;

    const body = {
      success: true,
      source: 'dynamodb',
      window_days: days,
      generated_at: new Date().toISOString(),
      totals: {
        events_in_window: inWindow.length,
        events_by_type: sortDesc(byType),
        unique_ips: ips.size,
        unique_sessions: sessions.size,
        page_views: byType['pageview'] || 0,
        heartbeats: byType['heartbeat'] || 0,
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
      },
      sessions: sessionList,
    };

    _cache.set(cacheKey, { at: Date.now(), body });
    if (scan.truncated) body.truncated = true;
    return res.status(200).json(body);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'jp stats failed' });
  }
}
