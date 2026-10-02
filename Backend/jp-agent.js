import { credentialRefusal, documentClient, telemetryTable } from './lib/ddb.js';
import { scanBounded } from './lib/ddb-scan.js';
import { list } from '@vercel/blob';
import { decodeGeo } from './lib/geo.js';
import { requireKey } from './_auth.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const TABLE = telemetryTable();
const ANTHROPIC_KEY = _env['ANTHROPIC_' + 'API_KEY'];
const BLOB_TOKEN = _env['BLOB_' + 'READ_WRITE_TOKEN'];

const IDENTITY_MAP = {
  'jbtv_1789288497389_4vez00y62': { canonical: 'samsung-s24-ultra', label: 'S24 Ultra (SM-S928B)', ip: null },
  'jbtv_1788609338910_nwc1wtunc': { canonical: 'samsung-s24-ultra', label: 'S24 Ultra (SM-S928B)', ip: '157.49.23.247' },
  'jbtv_1787941629418_yn7aswqg7': { canonical: 'samsung-s24-ultra', label: 'S24 Ultra (SM-S928B)', ip: '210.16.82.193' },
  'samsung-s24-ultra': { canonical: 'samsung-s24-ultra', label: 'S24 Ultra (SM-S928B)', ip: '157.49.23.247' },
  'jbtv_1788026445435_74eqr76hi': { canonical: 'iphone-london', label: 'iPhone (iOS 18.7)', ip: '172.226.0.6' },
};


function resolveIdentity(visitorId) {
  const m = IDENTITY_MAP[visitorId];
  if (m) return m;
  return { canonical: visitorId, label: visitorId, ip: null };
}

async function gatherContext(question) {
  const ctx = { devices: [], ips: [], history: [], siteEvents: [] };
  const q = (question || '').toLowerCase();

  try {
    const client = documentClient('read');
    // `truncated` is surfaced, not swallowed. A page ceiling or the time budget
    // can stop the scan before the table ends, and a partial total presented as
    // a complete one is worse than an error because nothing looks wrong.
    const scan = await scanBounded(client, TABLE);
    if (scan.truncated) ctx.dynamoTruncated = true;
    const items = scan.items;
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
          const loc = decodeGeo(j.server_location) || {};
          const ip = loc.ip;
          if (ip && ip !== 'unknown') {
            const cur = ipSet.get(ip) || { ip, events: 0, country: null, city: null, last: null };
            cur.events++;
            cur.country = loc.country || cur.country;
            cur.city = loc.city || cur.city;
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

/**
 * Everything that made the context incomplete, in the model's own words.
 *
 * gatherContext caught DynamoDB and Blob failures into ctx.dynamoError /
 * ctx.blobError and then NOTHING read them. So a store outage produced an empty
 * device list, and the prompt below said "DEVICES: - none" -- indistinguishable
 * from a genuinely empty table. The model was instructed to answer from the
 * context and say so plainly when something is absent, and it did exactly that:
 * it reported there were no devices. Confidently, and wrongly.
 */
function degradations(ctx) {
  const out = [];
  if (ctx.dynamoError) out.push(`DynamoDB telemetry could not be read (${ctx.dynamoError})`);
  if (ctx.dynamoTruncated) out.push('DynamoDB telemetry was TRUNCATED by the scan page/time limit, so device and history counts are partial');
  if (ctx.blobError) out.push(`Vercel Blob analytics could not be read (${ctx.blobError})`);
  return out;
}

function buildPrompt(question, ctx) {
  const devices = ctx.devices.map(d =>
    `- ${d.label} (${d.device}): ${d.events} events, types ${JSON.stringify(d.types)}, ip ${d.ip || 'unknown'}, first ${d.first}, last ${d.last}`
  ).join('\n') || '- none';
  const ips = ctx.ips.map(i =>
    `- ${i.ip}: ${i.events} events, ${i.country || '?'}/${i.city || '?'}, last ${i.last}`
  ).join('\n') || '- none';
  const history = ctx.history.map(h => `- ${h.visitedAt} | ${h.title || h.url} | ${h.device}`).join('\n') || '- none';

  const degraded = degradations(ctx);
  const warning = degraded.length
    ? `\n!! THE CONTEXT BELOW IS INCOMPLETE. These data sources failed or were cut short:\n${degraded.map((d) => '  - ' + d).join('\n')}\nAn empty or short section below may mean the source failed, NOT that there is nothing to report. Say which part of the answer is unreliable and why. Never state that something does not exist when its source is listed here.\n`
    : '';

  return `You are the device-intelligence agent for the jaytipargal.tech analytics dashboard.
Answer the user's question using ONLY the context below. Be concise and factual.
If the answer is not in the context, say so plainly.
${warning}
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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  // Every call spends Anthropic credit and returns device/IP telemetry, so it
  // takes the same dashboard key as the other data routes. The page already
  // sends ?key= (Frontend/index.html).
  if (!requireKey(req, res)) return;
  if (!ANTHROPIC_KEY) {
    return res.status(503).json({ success: false, error: 'ANTHROPIC_API_KEY not configured' });
  }
  // The same guard every other DynamoDB-backed handler applies. Without it an
  // unconfigured deployment spent a paid Anthropic call reasoning over an empty
  // context and answered as though the fleet were genuinely empty.
  const awsRefusal = credentialRefusal('read');
  if (awsRefusal) {
    return res.status(503).json({ success: false, error: awsRefusal });
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
        // Non-empty when a store was unreachable or the scan was cut short, so
        // the UI can mark the answer as based on partial data instead of
        // presenting it with the same confidence as a complete one.
        degraded: degradations(ctx),
      },
    });
  } catch (error) {
    console.error('[jp-agent] error:', error);
    return res.status(500).json({ success: false, error: error.message || 'agent failed' });
  }
}
