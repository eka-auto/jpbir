import { decodeOne } from './lib/geo.js';
import { siteFor, recordEvent, botLike } from './lib/warehouse.js';
import { isConfigured } from '../Integrations/postgres.js';

const ALLOWED_ORIGINS = new Set([
  'https://jaytipargal.com',
  'https://www.jaytipargal.com',
  'https://dfa5i945koq3k.cloudfront.net',
  'https://jaytipargal.tech',
  'https://www.jaytipargal.tech',
  'https://agent.jaytipargal.tech',
  'https://jaytibirthday.in',
  'https://www.jaytibirthday.in',
]);

function getClientIP(req) {
  return req.headers['x-vercel-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.has(origin) ? origin : 'https://jaytipargal.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!isConfigured()) {
    return res.status(503).json({ success: false, error: 'DATABASE_URL not set on this deployment' });
  }

  try {
    let event = req.body || {};
    if (typeof event === 'string') {
      try { event = JSON.parse(event); } catch { event = { raw: event }; }
    }
    const now = new Date();
    const item = {
      id: `${now.toISOString()}_${Math.random().toString(36).slice(2, 10)}`,
      eventType: event.event_type || event.eventType || 'event',
      epoch: now.getTime(),
      timestamp: now.toISOString(),
      sessionId: event.session_id || event.sessionId || 'anon',
      visitorId: event.visitor_id || event.visitorId || event.device_id || event.deviceId || 'anon',
      pageUrl: event.page_url || event.pageUrl || null,
      pageTitle: event.page_title || event.pageTitle || null,
      referrer: event.referrer || null,
      ip: getClientIP(req),
      country: decodeOne(req.headers['x-vercel-ip-country']) || null,
      region: decodeOne(req.headers['x-vercel-ip-country-region']) || null,
      city: decodeOne(req.headers['x-vercel-ip-city']) || null,
      latitude: req.headers['x-vercel-ip-latitude'] || null,
      longitude: req.headers['x-vercel-ip-longitude'] || null,
      timezone: decodeOne(req.headers['x-vercel-ip-timezone']) || null,
      postalCode: null,
      userAgent: req.headers['user-agent'] || null,
      language: req.headers['accept-language'] || null,
      screen: event.screen || null,
      deviceType: event.device_type || null,
      browser: event.browser || null,
      os: event.os || null,
      network: event.network || null,
      timeOnPage: typeof event.time_on_page === 'number' ? event.time_on_page : null,
      scrollPercent: typeof event.scroll_percent === 'number' ? event.scroll_percent : null,
      fingerprint: event.device_fingerprint || null,
      eventData: event.event_data || event.eventData || {},
      rawPayload: typeof event === 'object' && event.raw ? event.raw : null,
    };
    const site = siteFor(item.pageUrl, req.headers.origin || req.headers.referer || req.headers.host);
    if (!site) {
      return res.status(202).json({ success: true, id: item.id, persisted: false, ignored: true, reason: 'unknown property' });
    }
    if (botLike(item.userAgent)) {
      return res.status(202).json({ success: true, id: item.id, persisted: false, ignored: true, site, reason: 'automated client' });
    }
    const { inserted } = await recordEvent(item, { site, sourceSystem: 'site-api' });
    return res.status(200).json({ success: true, id: item.id, persisted: true, warehouse: { site, inserted } });
  } catch (err) {
    console.error('[jp-track] neon write failed:', err);
    return res.status(500).json({ success: false, error: 'failed to persist telemetry' });
  }
}
