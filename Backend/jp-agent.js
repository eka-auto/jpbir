import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { list } from '@vercel/blob';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const STATS_KEY = _env['STATS_' + 'KEY'];
const AWS_ACCESS_KEY_ID = _env['JP_AWS_' + 'ACCESS_KEY_ID'];
const AWS_SECRET_ACCESS_KEY = _env['JP_AWS_' + 'SECRET_ACCESS_KEY'];
const AWS_REGION = _env['JP_AWS_' + 'REGION'] || 'us-west-2';
const TABLE = _env['JP_TELEMETRY_' + 'TABLE'] || 'jaytipargal_telemetry';
const GEMINI_KEY = _env['GEMINI_' + 'API_KEY'];
const ANTHROPIC_KEY = _env['ANTHROPIC_' + 'API_KEY'];
const BLOB_TOKEN = _env['BLOB_' + 'READ_WRITE_TOKEN'];

const IDENTITY_MAP = {
  'jbtv_1788609338910_nwc1wtunc': { canonical: 'samsung-s24-ultra', label: 'S24 Ultra (SM-S928B)', ip: '157.49.23.247' },
  'jbtv_1787941629418_yn7aswqg7': { canonical: 'samsung-s24-ultra', label: 'S24 Ultra (SM-S928B)', ip: '210.16.82.193' },
  'samsung-s24-ultra': { canonical: 'samsung-s24-ultra', label: 'S24 Ultra (SM-S928B)', ip: '157.49.23.247' },
  'jbtv_1788026445435_74eqr76hi': { canonical: 'iphone-london', label: 'iPhone (iOS 18.7)', ip: '172.226.0.6' },
};

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

function resolveIdentity(visitorId) {
  const m = IDENTITY_MAP[visitorId];
  if (m) return m;
  return { canonical: visitorId, label: visitorId, ip: null };
}

async function gatherContext(question) {
  const ctx = { devices: [], ips: [], history: [], siteEvents: [] };
  const q = (question || '').toLowerCase();

  try {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({
      region: AWS_REGION,
      credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY }
    }));
    const items = await scanAll(client);
    const cutoff = Date.now() - 30 * 86400000;

    const deviceMap = new Map();
    for (const d of items) {
      if (!d.epoch || d.epoch < cutoff) continue;
      const idn = resolveIdentity(d.visitorId);
      const dev = idn.canonical;
      const cur = deviceMap.get(dev) || { device: dev, label: idn.label, events: 0, types: {}, first: null, last: null, ip: idn.ip || null };
      cur.events++;
      cur.types[d.eventType || 'unknown'] = (cur.types[d.eventType || 'unknown'] || 0) + 1;
      if (d.timestamp) {
        if (!cur.first || d.timestamp < cur.first) cur.first = d.timestamp;
        if (!cur.last || d.timestamp > cur.last) cur.last = d.timestamp;
      }
      if (!cur.ip && d.ip) cur.ip = d.ip;
      deviceMap.set(dev, cur);
    }
    ctx.devices = [...deviceMap.values()];

    for (const d of items) {
      if (!d.epoch || d.epoch < cutoff) continue;
      if (d.eventType === 'browser_history' || d.eventType === 'device_history') {
        const data = d.eventData || {};
        const list = Array.isArray(data.entries) ? data.entries : (Array.isArray(data.history) ? data.history : []);
        for (const e of list) {
          ctx.history.push({ url: e.url, title: e.title, visitedAt: e.visitedAt || d.timestamp, device: resolveIdentity(d.visitorId).label });
        }
      }
    }
    ctx.history = ctx.history.slice(0, 200);
  } catch (e) {
    ctx.dynamoError = e.message;
  }

  try {
    if (BLOB_TOKEN) {
      const { blobs } = await list({ token: BLOB_TOKEN, limit: 1000, prefix: 'analytics/' });
      const recent = (blobs || []).slice(0, 300);
      const ipSet = new Map();
      for (const b of recent) {
        try {
          const r = await fetch(b.url, { headers: { authorization: `Bearer ${BLOB_TOKEN}` } });
          if (!r.ok) continue;
          const j = await r.json();
          const ip = j.server_location && j.server_location.ip;
          if (ip && ip !== 'unknown') {
            const cur = ipSet.get(ip) || { ip, events: 0, country: null, city: null, last: null };
            cur.events++;
            cur.country = j.server_location.country || cur.country;
            cur.city = j.server_location.city || cur.city;
            if (j.receivedAt && (!cur.last || j.receivedAt > cur.last)) cur.last = j.receivedAt;
            ipSet.set(ip, cur);
          }
        } catch {}
      }
      ctx.ips = [...ipSet.values()].sort((a, b) => b.events - a.events).slice(0, 50);
    }
  } catch (e) {
    ctx.blobError = e.message;
  }

  return ctx;
}

function buildPrompt(question, ctx) {
  const devices = ctx.devices.map(d =>
    `- ${d.label} (${d.device}): ${d.events} events, types ${JSON.stringify(d.types)}, ip ${d.ip || 'unknown'}, first ${d.first}, last ${d.last}`
  ).join('\n') || '- none';
  const ips = ctx.ips.map(i =>
    `- ${i.ip}: ${i.events} events, ${i.country || '?'}/${i.city || '?'}, last ${i.last}`
  ).join('\n') || '- none';
  const history = ctx.history.map(h => `- ${h.visitedAt} | ${h.title || h.url} | ${h.device}`).join('\n') || '- none';

  return `You are the device-intelligence agent for the jaytipargal.tech analytics dashboard.
Answer the user's question using ONLY the context below. Be concise and factual.
If the answer is not in the context, say so plainly.

DEVICES (last 30 days, DynamoDB telemetry):
${devices}

IPS (birthday-site analytics, Vercel Blob):
${ips}

BROWSER HISTORY (own-device sync):
${history}

USER QUESTION: ${question}`;
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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY not configured' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const question = String(body.question || '').trim();
  if (!question) {
    return res.status(400).json({ success: false, error: 'question required' });
  }

  try {
    const ctx = await gatherContext(question);
    const prompt = buildPrompt(question, ctx);

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return res.status(502).json({ success: false, error: 'AI error: ' + errText.slice(0, 200) });
    }
    const g = await aiRes.json();
    const answer = (g.content && g.content[0] && g.content[0].text) || 'No answer produced.';

    return res.status(200).json({
      success: true,
      answer,
      context: {
        devices: ctx.devices.length,
        ips: ctx.ips.length,
        history: ctx.history.length,
      },
    });
  } catch (error) {
    console.error('[jp-agent] error:', error);
    return res.status(500).json({ success: false, error: error.message || 'agent failed' });
  }
}
