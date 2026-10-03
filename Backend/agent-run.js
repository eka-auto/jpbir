// Server-side proxy from jaytipargal.tech to the jp-agent droplet.
//
// This exists so the droplet's bearer token stays out of the browser. The page
// authenticates to Vercel with the dashboard key; Vercel authenticates to the
// droplet with JP_AGENT_TOKEN. A visitor never sees the second credential, and
// the droplet only ever trusts a caller holding it.
//
// The agent can run shell commands, so this is the most sensitive route on the
// dashboard. It is gated by its own OPERATOR_KEY rather than the read-only
// STATS_KEY and fails closed if anything is unconfigured.

import { randomUUID } from 'node:crypto';
import { requireOperatorKey } from './_auth.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const AGENT_URL = (_env['JP_AGENT_' + 'URL'] || '').replace(/\/+$/, '');
const AGENT_TOKEN = _env['JP_AGENT_' + 'TOKEN'] || '';

// 800s is the Pro-plan ceiling for a Node function; the default is 300s, which
// is what actually capped a dashboard turn before — not the agent's maxTurns.
// vercel.json uses `builds`, and `functions` cannot be combined with it, so the
// per-route value has to be exported from the route itself.
export const config = { maxDuration: 800 };

// Vercel retains structured function logs for the incident/audit trail. Do not
// log prompts, credentials, or remote addresses: the correlation id, outcome,
// and request shape are enough to trace an operator action without turning the
// audit stream into another sensitive-data store.
function audit(event, requestId, details = {}) {
  console.info(JSON.stringify({ event, request_id: requestId, at: new Date().toISOString(), ...details }));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const requestId = String(req.headers?.['x-request-id'] || randomUUID()).slice(0, 128);
  res.setHeader('X-Request-ID', requestId);

  if (req.method !== 'POST') {
    audit('operator_agent_request_rejected', requestId, { reason: 'method', method: req.method });
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  }
  if (!requireOperatorKey(req, res)) {
    audit('operator_agent_request_rejected', requestId, { reason: 'authentication' });
    return;
  }

  // 503 rather than 500: an unconfigured deployment is an operator problem, and
  // saying so plainly beats a generic failure that sends someone into the logs.
  if (!AGENT_URL || !AGENT_TOKEN) {
    audit('operator_agent_request_rejected', requestId, { reason: 'upstream_not_configured' });
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
  if (!prompt) {
    audit('operator_agent_request_rejected', requestId, { reason: 'empty_prompt' });
    return res.status(400).json({ ok: false, error: 'prompt is required' });
  }
  audit('operator_agent_request_started', requestId, { prompt_length: prompt.length, has_session: Boolean(body?.session_id) });

  // A single agent task can legitimately run for minutes. Abort well before the
  // function's own ceiling so the client gets a clean error rather than a
  // truncated stream with no explanation. 780s against the 800s maxDuration
  // below: 20s of headroom is enough to write the SSE error frame and end the
  // response. Raising this without raising maxDuration just moves the failure
  // from a clean "agent timed out" to a platform-level kill mid-stream.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 780000);

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
      audit('operator_agent_request_failed', requestId, { reason: 'upstream_status', upstream_status: upstream.status });
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
    audit('operator_agent_request_completed', requestId, { outcome: 'stream_complete' });
  } catch (err) {
    const aborted = err.name === 'AbortError';
    audit('operator_agent_request_failed', requestId, { reason: aborted ? 'timeout' : 'upstream_error' });
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: aborted ? 'timed out' : err.message })}\n\n`);
      return res.end();
    }
    return res.status(aborted ? 504 : 502).json({ ok: false, error: aborted ? 'agent timed out' : err.message });
  } finally {
    clearTimeout(timeout);
  }
}
