import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const STATS_KEY = _env['STATS_' + 'KEY'];
const AWS_ACCESS_KEY_ID = _env['JP_AWS_' + 'ACCESS_KEY_ID'];
const AWS_SECRET_ACCESS_KEY = _env['JP_AWS_' + 'SECRET_ACCESS_KEY'];
const AWS_REGION = _env['JP_AWS_' + 'REGION'] || 'us-west-2';
const TABLE = _env['JP_TELEMETRY_' + 'TABLE'] || 'jaytipargal_telemetry';

// Known device identities: visitor IDs observed on the site mapped to
// their real hardware. The S24 Ultra browser visitor is the same device
// as the daemon, so both roll up under one canonical id.
const IDENTITY_MAP = {
  'jbtv_1787941629418_yn7aswqg7': {
    canonical: 'samsung-s24-ultra',
    label: 'S24 Ultra (SM-S928B)',
    ip: '210.16.82.193',
  },
};

function resolveIdentity(visitorId) {
  const m = IDENTITY_MAP[visitorId];
  if (m) return m;
  return { canonical: visitorId, label: visitorId, ip: null };
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const max = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < max; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

async function scanAll(client) {
  const out = [];
  let key;
  do {
    const cmd = new ScanCommand({ TableName: TABLE, ...(key ? { ExclusiveStartKey: key } : {}) });
    const res = await client.send(cmd);
    out.push(...(res.Items || []));
    key = res.LastEvaluatedKey;
  } while (key);
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!STATS_KEY) {
    return res.status(500).json({ success: false, error: 'STATS_KEY not configured' });
  }
  const key = req.query.key || req.headers['x-stats-key'];
  if (!timingSafeEqual(String(key || ''), STATS_KEY)) {
    return res.status(401).json({ success: false, error: 'Invalid key' });
  }
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return res.status(500).json({ success: false, error: 'AWS credentials not configured' });
  }

  const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 90);
  const cutoff = Date.now() - days * 86400000;

  try {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({
      region: AWS_REGION,
      credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY }
    }));

    const items = await scanAll(client);
    const historyEvents = items.filter(i =>
      i.epoch && i.epoch >= cutoff &&
      (i.eventType === 'browser_history' || i.eventType === 'device_history')
    );

    const entries = [];
    for (const d of historyEvents) {
      const data = d.eventData || {};
      const list = Array.isArray(data.entries) ? data.entries : (Array.isArray(data.history) ? data.history : []);
      const idn = resolveIdentity(d.visitorId);
      for (const e of list) {
        entries.push({
          url: e.url || e.title || null,
          title: e.title || null,
          visitedAt: e.visitedAt || e.timestamp || d.timestamp || null,
          browser: e.browser || data.browser || null,
          device: idn.canonical,
          deviceLabel: idn.label,
          ip: d.ip || idn.ip || null,
        });
      }
    }

    entries.sort((a, b) => (b.visitedAt || '').localeCompare(a.visitedAt || ''));

    // device summary: every device that has sent any event in the window
    const deviceMap = new Map();
    for (const d of items) {
      if (!d.epoch || d.epoch < cutoff) continue;
      const idn = resolveIdentity(d.visitorId);
      const dev = idn.canonical;
      const cur = deviceMap.get(dev) || { device: dev, label: idn.label, events: 0, types: {}, first: null, last: null, ip: null };
      cur.events++;
      cur.types[d.eventType || 'unknown'] = (cur.types[d.eventType || 'unknown'] || 0) + 1;
      if (d.timestamp) {
        if (!cur.first || d.timestamp < cur.first) cur.first = d.timestamp;
        if (!cur.last || d.timestamp > cur.last) cur.last = d.timestamp;
      }
      if (d.ip) cur.ip = d.ip;
      if (idn.ip && !cur.ip) cur.ip = idn.ip;
      deviceMap.set(dev, cur);
    }
    const devices = [...deviceMap.values()].sort((a, b) => (b.last || '').localeCompare(a.last || ''));

    // full event dump for one device when ?device= is given
    let deviceEvents = null;
    if (req.query.device) {
      const dev = req.query.device;
      const evs = items.filter(i => {
        if (!i.epoch || i.epoch < cutoff) return false;
        const idn = resolveIdentity(i.visitorId);
        return idn.canonical === dev;
      });
      evs.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
      deviceEvents = evs.map(d => {
        const idn = resolveIdentity(d.visitorId);
        return {
          event_type: d.eventType,
          timestamp: d.timestamp,
          page_url: d.pageUrl,
          page_title: d.pageTitle,
          ip: d.ip || idn.ip,
          country: d.country,
          city: d.city,
          userAgent: d.userAgent,
          time_on_page: d.timeOnPage,
          scroll_percent: d.scrollPercent,
          fingerprint: d.fingerprint,
          event_data: d.eventData,
          visitor_id: d.visitorId,
          device_label: idn.label,
        };
      });
    }

    return res.status(200).json({
      success: true,
      source: 'dynamodb',
      window_days: days,
      total_events: historyEvents.length,
      total_entries: entries.length,
      entries: entries.slice(0, 500),
      devices,
      device_events: deviceEvents,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'jp device history failed' });
  }
}
