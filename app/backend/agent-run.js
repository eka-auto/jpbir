// Server-side proxy from jaytipargal.tech to the jp-agent droplet.
//
// This exists so the droplet's bearer token stays out of the browser. The page
// authenticates to Vercel with the dashboard key; Vercel authenticates to the
// droplet with JP_AGENT_TOKEN. A visitor never sees the second credential, and
// the droplet only ever trusts a caller holding it.
//
// The agent can run shell commands, so this is the most sensitive route on the
// dashboard. It is gated by the same STATS_KEY check as the visitor dossier and
// fails closed if anything is unconfigured.

import { requireKey } from './_auth.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const AGENT_URL = (_env['JP_AGENT_' + 'URL'] || '').replace(/\/+$/, '');
const AGENT_TOKEN = _env['JP_AGENT_' + 'TOKEN'] || '';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  }
  if (!requireKey(req, res)) return;

  // 503 rather than 500: an unconfigured deployment is an operator problem, and
  // saying so plainly beats a generic failure that sends someone into the logs.
  if (!AGENT_URL || !AGENT_TOKEN) {
    return res.status(503).json({
      ok: false,
      error: 'agent is not configured on this deployment',
      missing: [!AGENT_URL && 'JP_AGENT_URL', !AGENT_TOKEN && 'JP_AGENT_TOKEN'].filter(Boolean),
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const prompt = (body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ ok: false, error: 'prompt is required' });

  // A single agent task can legitimately run for minutes. Abort well before the
  // function's own ceiling so the client gets a clean error rather than a
  // truncated stream with no explanation.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 280000);

  try {
    const upstream = await fetch(`${AGENT_URL}/ask`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${AGENT_TOKEN}`,
      },
      body: JSON.stringify({ prompt, session_id: body?.session_id }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 300);
      return res.status(502).json({ ok: false, error: `agent returned ${upstream.status}`, detail });
    }

    // Pass the SSE stream straight through so the page can render progress as
    // it happens. Re-buffering here would reintroduce the spinner-and-wait that
    // streaming exists to avoid.
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    const aborted = err.name === 'AbortError';
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: aborted ? 'timed out' : err.message })}\n\n`);
      return res.end();
    }
    return res.status(aborted ? 504 : 502).json({ ok: false, error: aborted ? 'agent timed out' : err.message });
  } finally {
    clearTimeout(timeout);
  }
}
