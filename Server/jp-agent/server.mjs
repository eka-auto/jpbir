// jp-agent — the terminal, moved behind jaytipargal.tech.
//
// Runs on a DigitalOcean droplet rather than Vercel because a Vercel function
// is short-lived with an ephemeral filesystem: no persistent workspace, no
// long-running builds, no git checkout that survives between questions.
//
// SECURITY POSTURE. This executes arbitrary commands on a host that reaches
// your infrastructure, so the design assumes the endpoint will eventually be
// found by someone who should not have it:
//   - binds 127.0.0.1 only; nginx terminates TLS and is the sole ingress
//   - every request needs a bearer token, compared with timingSafeEqual over
//     digests so neither the value nor its length leaks through timing
//   - runs as the unprivileged `jpagent` user, never root
//   - the agent's cwd is pinned to WORKSPACE; it cannot be redirected per-request
//   - the browser never holds the token. jaytipargal.tech proxies server-side.

import { createServer } from 'node:http';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';

const PORT = Number(process.env.JP_AGENT_PORT || 8790);
const HOST = '127.0.0.1';
const TOKEN = process.env.JP_AGENT_TOKEN || '';
const WORKSPACE = process.env.JP_AGENT_WORKSPACE || '/srv/workspace';
const MODEL = process.env.JP_AGENT_MODEL || 'claude-opus-5';
const MAX_TURNS = Number(process.env.JP_AGENT_MAX_TURNS || 40);

if (!TOKEN) {
  console.error('JP_AGENT_TOKEN is unset — refusing to start rather than serve unauthenticated.');
  process.exit(1);
}

const sha256 = v => createHash('sha256').update(String(v), 'utf8').digest();
const TOKEN_DIGEST = sha256(TOKEN);

function authorized(req) {
  const h = req.headers.authorization || '';
  const supplied = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!supplied) return false;
  return timingSafeEqual(sha256(supplied), TOKEN_DIGEST);
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

// Conversations are kept in memory and keyed by id so the dashboard can hold a
// thread the way a terminal session does. Bounded so a long-lived process
// cannot grow without limit.
const sessions = new Map();
const MAX_SESSIONS = 50;
function touchSession(id) {
  const s = sessions.get(id) || { id, created: Date.now(), turns: [] };
  s.lastUsed = Date.now();
  sessions.set(id, s);
  if (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
    sessions.delete(oldest.id);
  }
  return s;
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Streams the agent's work as Server-Sent Events. The dashboard renders these
// live, so a long task shows its progress instead of hanging on a spinner —
// which is most of what makes a terminal feel responsive.
async function handleAsk(req, res, body) {
  const prompt = (body.prompt || '').trim();
  if (!prompt) return send(res, 400, { ok: false, error: 'prompt is required' });

  const sessionId = body.session_id || randomUUID();
  const session = touchSession(sessionId);

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  emit('start', { session_id: sessionId, model: MODEL, workspace: WORKSPACE });
  log(`ask session=${sessionId} chars=${prompt.length}`);

  let text = '';
  try {
    for await (const msg of query({
      prompt,
      options: {
        model: MODEL,
        cwd: WORKSPACE,
        maxTurns: MAX_TURNS,
        permissionMode: 'bypassPermissions',
        resume: session.sdkSessionId,
      },
    })) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        session.sdkSessionId = msg.session_id;
        emit('init', { tools: msg.tools?.length ?? 0 });
      } else if (msg.type === 'assistant') {
        for (const block of msg.message?.content || []) {
          if (block.type === 'text') {
            text += block.text;
            emit('text', { text: block.text });
          } else if (block.type === 'tool_use') {
            // Name and a short argument preview only — full arguments can carry
            // file contents and secrets, and this stream reaches a browser.
            emit('tool', { name: block.name, preview: JSON.stringify(block.input).slice(0, 200) });
          }
        }
      } else if (msg.type === 'result') {
        session.turns.push({ prompt, at: Date.now() });
        emit('done', {
          session_id: sessionId,
          is_error: !!msg.is_error,
          duration_ms: msg.duration_ms,
          cost_usd: msg.total_cost_usd,
          turns: msg.num_turns,
        });
      }
    }
  } catch (err) {
    log('ask failed:', err.message);
    emit('error', { error: err.message });
  }
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Unauthenticated, deliberately: nginx and uptime checks need it, and it
  // discloses nothing beyond the fact that a service is running.
  if (url.pathname === '/health') {
    return send(res, 200, { ok: true, service: 'jp-agent', sessions: sessions.size, uptime_s: Math.round(process.uptime()) });
  }

  if (!authorized(req)) {
    log(`401 ${req.method} ${url.pathname}`);
    return send(res, 401, { ok: false, error: 'unauthorized' });
  }

  if (url.pathname === '/sessions' && req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      sessions: [...sessions.values()].map(s => ({
        id: s.id, created: s.created, lastUsed: s.lastUsed, turns: s.turns.length,
      })),
    });
  }

  if (url.pathname === '/ask' && req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req) || '{}');
    } catch (e) {
      return send(res, 400, { ok: false, error: 'invalid JSON body' });
    }
    return handleAsk(req, res, body);
  }

  return send(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, HOST, () => log(`jp-agent listening on ${HOST}:${PORT}, workspace ${WORKSPACE}, model ${MODEL}`));
