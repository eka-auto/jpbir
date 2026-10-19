// jp-agent — the terminal, moved behind jaytipargal.tech.
//
// Runs as a Render web service rather than a Vercel function, because a function
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
import { readFileSync } from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { s24DeviceTools } from './s24-tools.mjs';

const PORT = Number(process.env.JP_AGENT_PORT || process.env.PORT || 8790);
// Default stays 127.0.0.1, the jp-agent posture: nginx on the box is the only
// ingress. Render's proxy lives outside the container, so there the service
// env sets JP_AGENT_HOST=0.0.0.0 and the platform supplies PORT.
const HOST = process.env.JP_AGENT_HOST || '127.0.0.1';
const TOKEN = process.env.JP_AGENT_TOKEN || '';
const WORKSPACE = process.env.JP_AGENT_WORKSPACE || '/srv/workspace';
// Sonnet 5 rather than Opus 5: $2/$10 per MTok against $5/$25, and it is the
// agentic-coding tier, so a dashboard terminal doing edits, greps and test runs
// keeps its quality at a fraction of the credit burn. Override per-box with
// JP_AGENT_MODEL if a session genuinely needs Opus.
const MODEL = process.env.JP_AGENT_MODEL || 'claude-sonnet-5';
// 40 turns cut off real work — a bug hunt across a few files spends turns fast.
// Note the practical ceiling for the dashboard path is wall-clock, not this:
// Backend/agent-run.js aborts at 780s. This cap is for long CLI-side runs.
const MAX_TURNS = Number(process.env.JP_AGENT_MAX_TURNS || 150);

// MCP tool wiring is config-driven: /etc/jp-agent-mcp.json lists servers as
// { name, type, url, headers } entries (SDK McpHttpServerConfig shape, with
// `${VAR}` interpolation resolved from this process's environment). If the
// file is missing, empty, or has no usable entries, fall back to the
// in-process s24 tools so the device plane never silently disappears.
function loadMcpServers() {
  const fallback = { fallback: true, servers: { 's24-connect': s24DeviceTools } };
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(process.env.JP_AGENT_MCP_CONFIG || '/etc/jp-agent-mcp.json', 'utf8'));
  } catch {
    return fallback;
  }
  const servers = {};
  for (const s of cfg.servers || []) {
    if (!s || !s.name || !s.url) continue;
    const headers = {};
    for (const [k, v] of Object.entries(s.headers || {})) {
      headers[k] = String(v).replace(/\$\{(\w+)\}/g, (_, n) => process.env[n] ?? '');
    }
    servers[s.name] = { type: s.type || 'http', url: s.url, headers };
  }
  return Object.keys(servers).length ? { fallback: false, servers } : fallback;
}
const MCP = loadMcpServers();

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

// 4MB, not 256KB: pasting a stack trace, a diff or a whole file into the
// terminal is the normal way to ask this thing to find a bug. Kept below
// nginx's client_max_body_size so an oversized prompt fails as our JSON error
// rather than nginx's HTML 413.
async function readBody(req, limit = 4 * 1024 * 1024) {
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

  // One live stream per session id. Two concurrent /ask on the same id both read
  // session.sdkSessionId before either writes it, so the second init silently
  // orphans the first conversation. Verified against the live agent: parallel
  // turns planting ALPHA and BRAVO both returned OK, and the next turn could
  // recall only BRAVO. Refusing is honest; queueing would make a second tab
  // look hung for however long the first task runs.
  if (session.busy) {
    return send(res, 409, { ok: false, error: 'session busy — a request is already running on this session_id' });
  }
  session.busy = true;

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  // A tab closing mid-stream destroys the socket. With no 'error' listener on
  // res, the next write emits an unhandled 'error' event, and EventEmitter
  // turns that into an uncaught exception on a later tick — outside the
  // try/catch below, so it kills the process and every other live session with
  // it. Closing the tab on a slow task is normal use, not an edge case.
  let clientGone = false;
  res.on('close', () => { clientGone = true; });
  res.on('error', err => { clientGone = true; log('response stream error:', err.message); });
  req.on('error', err => { clientGone = true; log('request stream error:', err.message); });

  const emit = (event, data) => {
    if (clientGone || res.writableEnded || res.destroyed) return false;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch (err) {
      clientGone = true;
      log('write after disconnect:', err.message);
      return false;
    }
  };

  emit('start', { session_id: sessionId, model: MODEL, workspace: WORKSPACE });
  log(`ask session=${sessionId} chars=${prompt.length}`);

  try {
    for await (const msg of query({
      prompt,
      options: {
        model: MODEL,
        cwd: WORKSPACE,
        maxTurns: MAX_TURNS,
        permissionMode: 'bypassPermissions',
        resume: session.sdkSessionId,
        mcpServers: MCP.servers,
      },
    })) {
      // Nobody is reading any more. Breaking ends the SDK iterator, which stops
      // the agent loop — otherwise a closed tab keeps billing turns to nobody.
      if (clientGone) {
        log(`client gone, abandoning session=${sessionId}`);
        break;
      }
      if (msg.type === 'system' && msg.subtype === 'init') {
        session.sdkSessionId = msg.session_id;
        emit('init', { tools: msg.tools?.length ?? 0 });
      } else if (msg.type === 'assistant') {
        for (const block of msg.message?.content || []) {
          if (block.type === 'text') {
            emit('text', { text: block.text });
          } else if (block.type === 'tool_use') {
            // Even a short argument preview can expose a token or credential.
            emit('tool', { name: block.name });
          }
        }
      } else if (msg.type === 'result') {
        // Keep the size, not the prompt: turns.length is the only thing ever read
        // (/sessions), and retaining prompts grew RSS ~1:1 with everything pasted
        // into a session — which is never evicted while it stays in use.
        session.turns.push({ chars: prompt.length, at: Date.now() });
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
  } finally {
    session.busy = false;
  }
  // end() on an already-ended or destroyed response throws ERR_STREAM_*, which
  // here would be the same unhandled rejection the .catch in the route now
  // absorbs — but not ending a live one leaks the socket.
  if (!res.writableEnded && !res.destroyed) res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Unauthenticated, deliberately: nginx and uptime checks need it, and it
  // discloses nothing beyond the fact that a service is running.
  if (url.pathname === '/health') {
    return send(res, 200, { ok: true, service: 'jp-agent', sessions: sessions.size, uptime_s: Math.round(process.uptime()), mcp: MCP.fallback ? 'in-process' : 'config' });
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
      // `|| '{}'` only rescues an empty body. `null`, `3` and `"x"` are all
      // valid JSON and all survive that guard, then throw on the first property
      // access in handleAsk. Only a plain object is a usable body.
      const parsed = JSON.parse(await readBody(req) || '{}');
      body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      return send(res, 400, { ok: false, error: 'invalid JSON body' });
    }
    // Nothing awaits handleAsk, so a throw inside it is an unhandled rejection —
    // fatal on Node >=15, and it takes every other in-flight session with it.
    // Once the SSE headers are out we can only log and close the stream.
    return handleAsk(req, res, body).catch(err => {
      log('handleAsk failed:', err.message);
      if (!res.headersSent) return send(res, 500, { ok: false, error: 'internal error' });
      try { res.end(); } catch { /* socket already gone */ }
    });
  }

  return send(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, HOST, () => log(`jp-agent listening on ${HOST}:${PORT}, workspace ${WORKSPACE}, model ${MODEL}`));
