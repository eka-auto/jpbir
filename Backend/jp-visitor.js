import { decodeGeo } from './lib/geo.js';
import { requireKey } from './_auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';

const TELEMETRY_FIELDS = [
  'browser_info', 'network_info', 'screen_info', 'battery_info', 'input_type',
  'memory_info', 'storage_estimate', 'refresh_rate', 'frame_rate',
  'pwa_state', 'advanced_capabilities', 'interactions',
];

function projectTelemetry(eventData) {
  if (!eventData || typeof eventData !== 'object') return {};
  return Object.fromEntries(TELEMETRY_FIELDS
    .filter((key) => eventData[key] !== undefined)
    .map((key) => [key, eventData[key]]));
}

const asIso = (value) => value instanceof Date ? value.toISOString() : value || null;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireKey(req, res)) return;
  if (!isConfigured()) return res.status(503).json({ success: false, error: 'DATABASE_URL not set on this deployment' });

  const visitor = String(req.query.visitor || '').trim();
  const session = String(req.query.session || '').trim();
  if (!visitor && !session) return res.status(400).json({ success: false, error: 'visitor or session required' });

  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
  const clauses = ['occurred_at > now() - ($1 || \' days\')::interval'];
  const params = [days];
  if (visitor) { params.push(visitor); clauses.push(`visitor_id = $${params.length}`); }
  if (session) { params.push(session); clauses.push(`session_id = $${params.length}`); }

  try {
    const identifierClause = clauses.slice(1).join(' OR ');
    const result = await query(
      `SELECT event_type, occurred_at, session_id, visitor_id, page_url, page_title,
              referrer, ip, country, region, city, latitude, longitude, timezone,
              postal_code, user_agent, time_on_page, scroll_percent, fingerprint,
              event_data, raw_payload
         FROM events WHERE ${clauses[0]} AND (${identifierClause}) ORDER BY occurred_at ASC`,
      params
    );
    const events = result.rows;
    const ips = new Set();
    const countries = {};
    const sessions = new Set();
    const fingerprints = new Set();
    const uas = new Set();
    const pages = new Set();
    let maxTimeOnPage = 0;
    let latestNetwork = null;

    for (const row of events) {
      if (row.ip) ips.add(row.ip);
      if (row.country) countries[row.country] = (countries[row.country] || 0) + 1;
      if (row.session_id) sessions.add(row.session_id);
      if (row.fingerprint) fingerprints.add(row.fingerprint);
      if (row.user_agent) uas.add(row.user_agent);
      if (row.page_url) pages.add(row.page_url);
      if (typeof row.time_on_page === 'number') maxTimeOnPage = Math.max(maxTimeOnPage, row.time_on_page);
      latestNetwork = decodeGeo({
        ip: row.ip, country: row.country, countryRegion: row.region, city: row.city,
        latitude: row.latitude, longitude: row.longitude, timezone: row.timezone, postalCode: row.postal_code,
      });
    }

    return res.status(200).json({
      success: true,
      source: 'neon',
      partial: false,
      query: { visitor: visitor || null, session: session || null },
      summary: {
        visitor_id: visitor || events[0]?.visitor_id || null,
        device_fingerprints: [...fingerprints], sessions: [...sessions], ips: [...ips], ips_truncated: false,
        countries: Object.entries(countries).sort((a, b) => b[1] - a[1]),
        user_agents: [...uas], pages: [...pages],
        first_seen: asIso(events[0]?.occurred_at), last_seen: asIso(events.at(-1)?.occurred_at),
        total_events: events.length, max_time_on_page: maxTimeOnPage, network: latestNetwork,
      },
      events: events.map((row) => ({
        event_type: row.event_type, page_url: row.page_url, page_title: row.page_title,
        timestamp: asIso(row.occurred_at), receivedAt: asIso(row.occurred_at),
        time_on_page: row.time_on_page, scroll_percent: row.scroll_percent,
        session_id: row.session_id, visitor_id: row.visitor_id, device_fingerprint: row.fingerprint,
        server_location: decodeGeo({
          ip: row.ip, country: row.country, countryRegion: row.region, city: row.city,
          latitude: row.latitude, longitude: row.longitude, timezone: row.timezone, postalCode: row.postal_code,
        }),
        server_request_meta: { userAgent: row.user_agent, referer: row.referrer },
        event_data: row.event_data, ...projectTelemetry(row.event_data), raw: row.raw_payload,
        web_vitals: row.event_type === 'web_vitals' ? row.event_data : undefined,
        interactions: row.event_type === 'interaction_batch' ? row.event_data?.interactions : undefined,
      })),
    });
  } catch (err) {
    console.error('[jp-visitor] neon read failed:', err);
    return res.status(500).json({ success: false, error: 'visitor lookup failed' });
  }
}
