// Server-side proxy from the dashboard to the EKA RAG agent (eka_agent_cloud.py
// behind nginx on the VPS: AGENT_API_URL=https://agent.jaytipargal.tech/agent).
//
// Served at /api/jp-live-agent, and at /agent/query + /agent/health for the
// /agent chat page. nginx requires X-API-Key upstream, so AGENT_API_KEY holds
// that key and never reaches the browser. Every call spends
// Anthropic credits upstream, so it is gated on STATS_KEY like every other
// privileged route here, and the guard runs before the config check so an
// unauthenticated caller cannot learn whether this deployment is wired up.
import { requireKey } from './_auth.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;

// Read per request, not at import: tests (and `vercel dev`) set these after load.
const upstreamConfig = () => ({
  url: (_env['AGENT_API_' + 'URL'] || '').replace(/\/+$/, ''),
  key: _env['AGENT_API_' + 'KEY'] || '',
});

// Generation on the VPS can take tens of seconds; the default 300s is plenty but
// state it so it is not silently lowered.
export const config = { maxDuration: 300 };

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireKey(req, res)) return;

  const { url, key } = upstreamConfig();
  // Fails closed. The old default of http://127.0.0.1:8000 can never be right on
  // Vercel, so an unset URL is reported as unconfigured rather than as a
  // confusing connection error.
  if (!url) {
    return res.status(503).json({ success: false, error: 'Agent not configured', missing: ['AGENT_API_URL'] });
  }
  // nginx on the VPS checks X-API-Key for /agent/*; sent only when configured so
  // a keyless upstream (local dev) still works.
  const headers = { 'Content-Type': 'application/json', ...(key ? { 'X-API-Key': key } : {}) };

  const op = req.query?.op === 'health' || req.method === 'GET' ? 'health' : 'query';
  if (op === 'health') {
    try {
      const upstream = await fetch(`${url}/health`, { headers });
      const data = await upstream.json().catch(() => ({}));
      return res.status(upstream.ok ? 200 : 502).json({ success: upstream.ok, ...data });
    } catch (error) {
      return res.status(502).json({ success: false, error: error.message || 'Agent health check failed' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const query = String(body.query || body.question || '').trim();
  if (!query) {
    return res.status(400).json({ success: false, error: 'query required' });
  }

  const payload = {
    query,
    top_k: num(body.top_k, 5),
    max_tokens: num(body.max_tokens, 1024),
    temperature: num(body.temperature, 0.7),
    use_rag: body.use_rag === undefined ? true : Boolean(body.use_rag),
  };

  try {
    const upstream = await fetch(`${url}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

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
    return res.status(502).json({ success: false, error: error.message || 'Agent request failed' });
  }
}
