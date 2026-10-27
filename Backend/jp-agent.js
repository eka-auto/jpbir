import { list } from '@vercel/blob';
import { decodeGeo } from './lib/geo.js';
import { requireKey } from './_auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';
import { exchangeIdentity, lookupExchange, persistAnswer } from '../Integrations/agent-store.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

function resolveIdentity(visitorId) {
  const labels = {
    'samsung-s24-ultra': 'S24 Ultra (SM-S928B)',
    jbtv_1789288497389_4vez00y62: 'S24 Ultra (SM-S928B)',
    jbtv_1788609338910_nwc1wtunc: 'S24 Ultra (SM-S928B)',
    jbtv_1787941629418_yn7aswqg7: 'S24 Ultra (SM-S928B)',
    jbtv_1788026445435_74eqr76hi: 'iPhone (iOS 18.7)',
  };
  return { canonical: labels[visitorId] ? (labels[visitorId].startsWith('S24') ? 'samsung-s24-ultra' : visitorId) : visitorId, label: labels[visitorId] || visitorId };
}

async function gatherContext() {
  const ctx = { devices: [], ips: [], history: [], degraded: [] };
  if (!isConfigured()) {
    ctx.degraded.push('Neon telemetry is not configured');
    return ctx;
  }
  try {
    const result = await query(
      `SELECT event_type, occurred_at, visitor_id, page_url, ip, country, city, event_data
         FROM events WHERE occurred_at > now() - interval '30 days'
         ORDER BY occurred_at DESC LIMIT 2000`
    );
    const devices = new Map();
    const ips = new Map();
    for (const row of result.rows) {
      const identity = resolveIdentity(row.visitor_id || 'unknown');
      const current = devices.get(identity.canonical) || { device: identity.canonical, label: identity.label, events: 0, types: {}, first: null, last: null };
      const occurredAt = row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at;
      current.events++;
      current.types[row.event_type || 'unknown'] = (current.types[row.event_type || 'unknown'] || 0) + 1;
      current.first = !current.first || occurredAt < current.first ? occurredAt : current.first;
      current.last = !current.last || occurredAt > current.last ? occurredAt : current.last;
      devices.set(identity.canonical, current);
      if (row.ip && row.ip !== 'unknown') {
        const currentIp = ips.get(row.ip) || { ip: row.ip, events: 0, country: null, city: null, last: null };
        currentIp.events++;
        currentIp.country ||= row.country;
        currentIp.city ||= row.city;
        currentIp.last = !currentIp.last || occurredAt > currentIp.last ? occurredAt : currentIp.last;
        ips.set(row.ip, currentIp);
      }
      if (row.event_type === 'browser_history' || row.event_type === 'device_history') {
        const entries = Array.isArray(row.event_data?.entries) ? row.event_data.entries : row.event_data?.history;
        for (const entry of Array.isArray(entries) ? entries : []) {
          ctx.history.push({ url: entry.url, title: entry.title, visitedAt: entry.visitedAt || occurredAt, device: identity.label });
        }
      }
    }
    ctx.devices = [...devices.values()];
    ctx.ips = [...ips.values()].sort((a, b) => b.events - a.events).slice(0, 50);
    ctx.history = ctx.history.slice(0, 200);
  } catch (error) {
    ctx.degraded.push('Neon telemetry could not be read');
    console.error('[jp-agent] Neon context query failed:', error);
  }
  if (BLOB_TOKEN) {
    try {
      const { blobs } = await list({ token: BLOB_TOKEN, limit: 30, prefix: 'analytics/' });
      for (const blob of blobs || []) {
        const response = await fetch(blob.url, { headers: { authorization: `Bearer ${BLOB_TOKEN}` } });
        if (!response.ok) continue;
        const data = await response.json();
        const location = decodeGeo(data.server_location) || {};
        if (location.ip && !ctx.ips.some((entry) => entry.ip === location.ip)) {
          ctx.ips.push({ ip: location.ip, events: 1, country: location.country || null, city: location.city || null, last: data.receivedAt || null });
        }
      }
    } catch (error) {
      ctx.degraded.push('Vercel Blob analytics could not be read');
      console.error('[jp-agent] Blob context query failed:', error);
    }
  }
  return ctx;
}

function buildPrompt(question, ctx) {
  const warning = ctx.degraded.length ? `\nContext limitations: ${ctx.degraded.join('; ')}.\n` : '';
  const devices = ctx.devices.map((d) => `- ${d.label}: ${d.events} events, last ${d.last}`).join('\n') || '- none';
  const ips = ctx.ips.map((i) => `- ${i.ip}: ${i.events} events, ${i.country || '?'}/${i.city || '?'}`).join('\n') || '- none';
  const history = ctx.history.map((h) => `- ${h.visitedAt} | ${h.title || h.url} | ${h.device}`).join('\n') || '- none';
  return `You are the device-intelligence agent for the jaytipargal.tech dashboard. Answer only from this context and state limits plainly.${warning}\nDEVICES:\n${devices}\n\nIPS:\n${ips}\n\nBROWSER HISTORY:\n${history}\n\nUSER QUESTION: ${question}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!requireKey(req, res)) return;
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
   const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) return res.status(400).json({ success: false, error: 'question required' });
   try { Object.assign(body, exchangeIdentity(body)); } catch { return res.status(400).json({success:false,error:'Invalid conversation identity'}); }
   if(question.length>16000) return res.status(400).json({success:false,error:'Question too long'});
   try {
     const stored=await lookupExchange('agent',body,question);
     if(stored)return res.status(200).json({success:true,...stored});
   }catch(e){return res.status(e.status===409?409:503).json({success:false,error:e.status===409?'Conflicting request identity':'Conversation storage unavailable'});}
   if (!ANTHROPIC_KEY) return res.status(503).json({ success: false, error: 'ANTHROPIC_API_KEY not configured' });
  try {
    const ctx = await gatherContext();
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 1024, messages: [{ role: 'user', content: buildPrompt(question, ctx) }] }),
    });
    if (!aiRes.ok) return res.status(502).json({ success: false, error: 'AI request failed' });
    const response = await aiRes.json();
     const answer=response.content?.[0]?.text;
     if(typeof answer!=='string'||!answer.trim()) return res.status(502).json({success:false,error:'Agent returned no answer'});
     const stored=await persistAnswer('agent',body,question,answer);
     return res.status(200).json({ success: true, ...stored, context: { devices: ctx.devices.length, ips: ctx.ips.length, history: ctx.history.length, degraded: ctx.degraded } });
  } catch (error) {
     if(error.status===409)return res.status(409).json({success:false,error:'Conflicting request identity'});
    console.error('[jp-agent] error:', error);
    return res.status(500).json({ success: false, error: 'agent failed' });
  }
}
