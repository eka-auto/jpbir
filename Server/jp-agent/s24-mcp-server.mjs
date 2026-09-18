// s24-mcp — standalone streamable-HTTP MCP server exposing the S24 device
// registry tools on the droplet.
//
// This is the network-transport twin of s24-tools.mjs (the in-process MCP
// server jp-agent loads via createSdkMcpServer). Both wrap the SAME tool
// semantics — Firestore REST against the eka-agent device registry — so a
// model gets identical behavior whether tools arrive in-process or over HTTP.
// Keep the handlers in sync with s24-tools.mjs.
//
// Why a separate process:
//   - jp-agent can reference it as { type: 'http' } in mcpServers config,
//     making the tool wiring config-driven instead of a hardcoded import.
//   - Any other MCP client can use it: Claude Code on any machine, or an
//     Anthropic-hosted Managed Agent reaching https://runner.jaytipargal.tech/mcp
//     with a vault credential as the bearer token.
//
// Auth: Authorization: Bearer $S24_MCP_TOKEN (constant-time compare), same
// pattern as jp-agent. Binds 127.0.0.1 only; nginx terminates TLS.

import { createServer } from 'node:http';
import { createHash, createSign, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { deviceHealth, commandItem } from '/opt/jp-agent/device-health.mjs';

const PORT = Number(process.env.S24_MCP_PORT || 8792);
const HOST = '127.0.0.1';
const TOKEN = process.env.S24_MCP_TOKEN || '';
if (!TOKEN) {
  console.error('S24_MCP_TOKEN is unset — refusing to start unauthenticated.');
  process.exit(1);
}

const PROJECT_ID = process.env.S24_PROJECT_ID || 'intrepid-stage-495117-q1';
const DATABASE = process.env.S24_FIRESTORE_DB || 'eka-agent';
const DEFAULT_DEVICE = process.env.S24_DEVICE_DOC || 'samsung-s24-ultra';
const KEY_FILE = process.env.S24_SERVICE_ACCOUNT_KEY || '/etc/jp-agent-firestore-key.json';

const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents`;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';

const DEVICE_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

let tokenCache = { token: null, expiresAt: 0 };

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getToken() {
  const now = Date.now() / 1000;
  if (tokenCache.token && now < tokenCache.expiresAt - 60) return tokenCache.token;

  const key = JSON.parse(readFileSync(KEY_FILE, 'utf8'));
  const iat = Math.floor(now);
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = b64url(Buffer.from(JSON.stringify({
    iss: key.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  })));
  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = b64url(signer.sign(key.private_key));

  const res = await fetch(TOKEN_URL, {
    signal: AbortSignal.timeout(20000),
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signingInput}.${signature}`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${JSON.stringify(data)}`);

  tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in || 3600) };
  return tokenCache.token;
}

async function fsRequest(method, path, body) {
  const token = await getToken();
  const res = await fetch(`${FS_BASE}/${path}`, {
    signal: AbortSignal.timeout(20000),
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  if (!res.ok) return { __error__: { code: res.status, body: text.slice(0, 400) } };
  return parsed;
}

function decode(value) {
  if (value == null) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('mapValue' in value) {
    const out = {};
    for (const [k, v] of Object.entries(value.mapValue.fields || {})) out[k] = decode(v);
    return out;
  }
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  return value;
}

const SIMPLE_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function maskPath(dotted) {
  return dotted
    .split('.')
    .map((seg) => (SIMPLE_SEGMENT_RE.test(seg) ? seg : '`' + seg.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`'))
    .join('.');
}

function parseDoc(raw) {
  if (raw && raw.__error__) return raw;
  const out = {};
  for (const [k, v] of Object.entries(raw?.fields || {})) out[k] = decode(v);
  return out;
}

function errText(doc) {
  if (doc && doc.__error__) return `Firestore error ${doc.__error__.code}: ${doc.__error__.body}`;
  return null;
}

function validId(deviceId) {
  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) {
    return `'${deviceId}' is not a valid device_id (lowercase, hyphen-separated, e.g. samsung-s24-ultra).`;
  }
  return null;
}

async function getDoc(deviceId) {
  return parseDoc(await fsRequest('GET', `devices/${deviceId}`));
}

async function patchDoc(deviceId, fields) {
  const nested = {};
  for (const [dotted, val] of Object.entries(fields)) {
    const parts = dotted.split('.');
    let cur = nested;
    for (const p of parts.slice(0, -1)) cur = cur[p] ??= {};
    cur[parts.at(-1)] = val;
  }
  const fsFields = {};
  for (const [k, v] of Object.entries(nested)) {
    // Minimal encoder for the shapes we write (bools, ISO strings, nested maps).
    const enc = (x) => {
      if (x === null || x === undefined) return { nullValue: null };
      if (typeof x === 'boolean') return { booleanValue: x };
      if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
      if (typeof x === 'string') return { stringValue: x };
      if (Array.isArray(x)) return { arrayValue: { values: x.map(enc) } };
      if (typeof x === 'object') {
        const f = {};
        for (const [k2, v2] of Object.entries(x)) f[k2] = enc(v2);
        return { mapValue: { fields: f } };
      }
      return { stringValue: String(x) };
    };
    fsFields[k] = enc(v);
  }
  const mask = Object.keys(fields)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(maskPath(k))}`)
    .join('&');
  return fsRequest('PATCH', `devices/${deviceId}?${mask}&currentDocument.exists=true`, { fields: fsFields });
}

function ageSeconds(ts) {
  if (typeof ts !== 'string') return null;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return null;
  return Math.round((Date.now() - t) / 1000);
}

function heartbeatFields(doc) {
  const lastSeen = doc.lastSeen ?? null;
  const updatedAt = doc.updatedAt ?? null;
  return {
    last_seen: lastSeen,
    last_seen_age_seconds: ageSeconds(lastSeen),
    ever_checked_in: lastSeen !== null,
    doc_updated_at: updatedAt,
    doc_updated_age_seconds: ageSeconds(updatedAt),
  };
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const json = (o) => text(JSON.stringify(o, null, 2));

const deviceIdParam = { device_id: z.string().default(DEFAULT_DEVICE).describe('Target device (default: the S24).') };

// A fresh McpServer per request: streamable-HTTP stateless mode requires a new
// transport (and therefore a freshly connected server) per request — sharing
// one transport corrupts its stream tracking after the first response. The
// server is cheap (six map inserts), so per-request construction also makes
// concurrent requests safe: no shared protocol state can cross-wire replies.
function buildMcp() {
  const mcp = new McpServer({ name: 's24-connect', version: '1.0.0' });

  mcp.registerTool(
  'list_devices',
  {
    description: 'List every device registered in the global devices/ collection, with online status and how fresh each check-in is.',
    inputSchema: {},
  },
  async () => {
    const documents = [];
    let pageToken;
    do {
      const res = await fsRequest('GET', 'devices?pageSize=100'
        + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''));
      if (res.__error__) return text(errText(res));
      documents.push(...(res.documents || []));
      pageToken = res.nextPageToken;
    } while (pageToken);
    const rows = documents.map((raw) => {
      const deviceId = raw.name.split('/').pop();
      const d = parseDoc(raw);
      return {
        device_id: deviceId,
        display_name: d.deviceDisplayName || deviceId,
        ...deviceHealth(deviceId, d),
        status: d.status || 'unknown',
        ...heartbeatFields(d),
      };
    });
    return json({ count: rows.length, devices: rows });
  },
);

mcp.registerTool(
  'device_ping',
  {
    description: 'Link-health check for one global device (defaults to the S24): reads its doc and reports staleness of the last check-in.',
    inputSchema: deviceIdParam,
  },
  async ({ device_id }) => {
    const bad = validId(device_id);
    if (bad) return text(bad);
    const doc = await getDoc(device_id);
    const err = errText(doc);
    if (err) return json({ connected: false, reason: err });
    return json({
      connected: true,
      device_id,
      project: PROJECT_ID,
      database: DATABASE,
      ...deviceHealth(device_id, doc),
      status: doc.status || 'unknown',
      battery: doc.battery ?? null,
      ...heartbeatFields(doc),
      checked_at: new Date().toISOString(),
    });
  },
);

mcp.registerTool(
  'device_wake',
  {
    description: 'Nudge a device to sync immediately by writing a wakeup + forceSync signal onto its registry document.',
    inputSchema: deviceIdParam,
  },
  async ({ device_id }) => {
    const bad = validId(device_id);
    if (bad) return text(bad);
    const at = new Date().toISOString();
    const res = await patchDoc(device_id, {
      forceWakeup: true,
      forceSync: true,
      wakeupSignal: at,
      syncRequestedAt: at,
      agentCommand: 'wakeup',
      commandPriority: 'HIGH',
    });
    const err = errText(res);
    return text(err || `Wakeup + forceSync written to ${device_id} at ${at}. Device acts on next poll.`);
  },
);

mcp.registerTool(
  'device_send',
  {
    description: "Queue a supported command (e.g. 'sync-now', 'status-only', 'start-ssh'). Queued is not executed. Check device_result and device_ping; do not infer supported actions from historical examples.",
    inputSchema: {
      action: z.string().describe("Command name the device's daemon understands, e.g. 'sync-now'."),
      device_id: z.string().default(DEFAULT_DEVICE),
      params: z.record(z.string(), z.any()).default({}).describe('Extra fields to merge into the queued command item.'),
      priority: z.enum(['NORMAL', 'HIGH', 'CRITICAL']).default('NORMAL'),
    },
  },
  async ({ action, device_id, params, priority }) => {
    const bad = validId(device_id);
    if (bad) return text(bad);
    const at = new Date().toISOString();
    const actionSlug = action.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'cmd';
    const cmdId = `jpagent_${Date.now()}_${actionSlug}_${randomUUID()}`;
    const item = commandItem(action, priority, params, at);
    const res = await patchDoc(device_id, {
      [`commandQueue.${cmdId}`]: item,
      forceWakeup: true,
      wakeupSignal: at,
      commandId: cmdId,
      commandPriority: priority,
    });
    const err = errText(res);
    if (err) return text(err);
    return json({ queued: true, device_id, command_id: cmdId, action, priority, at, next: 'poll with device_result(command_id=...)' });
  },
);

mcp.registerTool(
  'device_result',
  {
    description: 'Read back the status/result of a command previously queued with device_send.',
    inputSchema: { command_id: z.string(), device_id: z.string().default(DEFAULT_DEVICE) },
  },
  async ({ command_id, device_id }) => {
    const bad = validId(device_id);
    if (bad) return text(bad);
    const doc = await getDoc(device_id);
    const err = errText(doc);
    if (err) return text(err);
    const q = doc.commandQueue || {};
    if (!(command_id in q)) {
      return json({ found: false, device_id, command_id, hint: 'id not in commandQueue; may have been cleared' });
    }
    return json({ found: true, device_id, command_id, item: q[command_id] });
  },
);

mcp.registerTool(
  'device_queue',
  {
    description: 'List every command-queue item on a device with its current status.',
    inputSchema: deviceIdParam,
  },
  async ({ device_id }) => {
    const bad = validId(device_id);
    if (bad) return text(bad);
    const doc = await getDoc(device_id);
    const err = errText(doc);
    if (err) return text(err);
    const q = doc.commandQueue || {};
    const rows = Object.entries(q).map(([qid, item]) => ({
      command_id: qid,
      action: item?.action,
      status: item?.status,
      priority: item?.priority,
      requestedAt: item?.requestedAt,
    }));
    rows.sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
    return json({ device_id, items: rows });
  },
  );

  return mcp;
}

// --- HTTP transport (stateless streamable HTTP: new transport + server per request) ---
const sha256 = (v) => createHash('sha256').update(String(v), 'utf8').digest();
const TOKEN_DIGEST = sha256(TOKEN);

function authorized(req) {
  const h = req.headers.authorization || '';
  const supplied = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!supplied) return false;
  const d = sha256(supplied);
  return d.length === TOKEN_DIGEST.length && timingSafeEqual(d, TOKEN_DIGEST);
}

// Per-request stateless transport: one McpServer + one transport per HTTP
// request, closed when the response socket closes.
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'not found' }));
  }
  if (!authorized(req)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  let body;
  try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }

  const mcp = buildMcp();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); });
  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error('handleRequest failed:', (err && err.stack) || err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: String((err && err.message) || err) } }));
    } else {
      try { res.end(); } catch { /* socket already gone */ }
    }
  }
});

server.listen(PORT, HOST, () => console.log(`s24-mcp listening on ${HOST}:${PORT}, project ${PROJECT_ID}, db ${DATABASE}`));
