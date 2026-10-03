// Read-only Hub / devices readout for the /agent page, proxied from the jtagent
// service (AGENT_API_URL=https://agent.jaytipargal.tech/agent) which exposes
// GET /state: { hub, status: { ok, ts, devices_active, items_total, items_24h,
// items_unprocessed }, devices: [...] }.
//
// Served at /agent/state. Same shape as jp-live-agent.js: nginx requires
// X-API-Key upstream, so AGENT_API_KEY stays server-side, and the STATS_KEY
// guard runs before the config check so an unauthenticated caller cannot learn
// whether this deployment is wired up.
import { requireKey } from './_auth.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;

// Read per request, not at import: tests (and `vercel dev`) set these after load.
const upstreamConfig = () => ({
  url: (_env['AGENT_API_' + 'URL'] || '').replace(/\/+$/, ''),
  key: _env['AGENT_API_' + 'KEY'] || '',
});

async function fetchWithTimeout(url, init = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// A state read is a couple of SQL counts upstream; nothing like generation.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireKey(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { url, key } = upstreamConfig();
  // Fails closed, same as the query proxy: an unset URL is "unconfigured", not
  // a connection error against some default that can never be right on Vercel.
  if (!url) {
    return res.status(503).json({ success: false, error: 'Agent not configured', missing: ['AGENT_API_URL'] });
  }
  const headers = { Accept: 'application/json', ...(key ? { 'X-API-Key': key } : {}) };

  try {
    const upstream = await fetchWithTimeout(`${url}/state`, { headers });
    const text = await upstream.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!upstream.ok) {
      return res.status(502).json({
        success: false,
        error: 'Agent upstream error',
        upstream_status: upstream.status,
        details: data,
      });
    }
    return res.status(200).json({ success: true, ...data });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({ success: false, error: timedOut ? 'Agent state request timed out' : (error.message || 'Agent state request failed') });
  }
}
