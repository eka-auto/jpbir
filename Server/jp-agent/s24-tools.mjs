// In-process MCP tools giving jp-agent the same Firestore device-registry
// access as the local s24-connect MCP server (C:\Users\abcom\s24-connect-mcp\server.py).
// Ported to Node rather than shelling out to Python: jp-agent's droplet only
// ships Node, and createSdkMcpServer() runs tools in-process with no extra
// transport or dependency beyond zod.
//
// Mirrors the Python tool set's semantics (device_id defaults, command-queue
// shape, field-mask escaping for hyphenated ids) so the two servers stay
// interchangeable from the model's point of view.

import { createHash, createSign, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';

const PROJECT_ID = process.env.S24_PROJECT_ID || 'intrepid-stage-495117-q1';
const DATABASE = process.env.S24_FIRESTORE_DB || 'eka-agent';
const DEFAULT_DEVICE = process.env.S24_DEVICE_DOC || 'samsung-s24-ultra';
const KEY_FILE = process.env.S24_SERVICE_ACCOUNT_KEY || '/etc/jp-agent-firestore-key.json';

const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents`;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';
const REQUESTED_BY = 'jp-agent-s24-tools';

const DEVICE_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SIMPLE_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
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

function encode(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) fields[k] = encode(v);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
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

function maskPath(dotted) {
  return dotted
    .split('.')
    .map((seg) => (SIMPLE_SEGMENT_RE.test(seg) ? seg : '`' + seg.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`'))
    .join('.');
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
  for (const [k, v] of Object.entries(nested)) fsFields[k] = encode(v);
  const mask = Object.keys(fields)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(maskPath(k))}`)
    .join('&');
  return fsRequest('PATCH', `devices/${deviceId}?${mask}`, { fields: fsFields });
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

const deviceIdParam = { device_id: z.string().default(DEFAULT_DEVICE).describe('Target device (default: the S24).') };

const listDevices = tool(
  'list_devices',
  'List every device registered in the global devices/ collection, with online status and how fresh each check-in is.',
  {},
  async () => {
    const res = await fsRequest('GET', 'devices?pageSize=100');
    if (res.__error__) return { content: [{ type: 'text', text: errText(res) }] };
    const rows = (res.documents || []).map((raw) => {
      const deviceId = raw.name.split('/').pop();
      const d = parseDoc(raw);
      return {
        device_id: deviceId,
        display_name: d.deviceDisplayName || deviceId,
        stored_online: Boolean(d.online || d.effectiveOnline),
        status: d.status || 'unknown',
        ...heartbeatFields(d),
      };
    });
    return { content: [{ type: 'text', text: JSON.stringify({ count: rows.length, devices: rows }, null, 2) }] };
  },
);

const devicePing = tool(
  'device_ping',
  'Link-health check for one global device (defaults to the S24): reads its doc and reports staleness of the last check-in.',
  deviceIdParam,
  async ({ device_id }) => {
    const bad = validId(device_id);
    if (bad) return { content: [{ type: 'text', text: bad }] };
    const doc = await getDoc(device_id);
    const err = errText(doc);
    if (err) return { content: [{ type: 'text', text: JSON.stringify({ connected: false, reason: err }) }] };
    const hb = heartbeatFields(doc);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          connected: true,
          device_id,
          project: PROJECT_ID,
          database: DATABASE,
          stored_online: Boolean(doc.online || doc.effectiveOnline),
          last_command_ack_at: doc.lastCommandAckAt ?? null,
          last_command_ack_age_seconds: ageSeconds(doc.lastCommandAckAt),
          status: doc.status || 'unknown',
          battery: doc.battery ?? null,
          ...hb,
          checked_at: new Date().toISOString(),
        }, null, 2),
      }],
    };
  },
);

const deviceWake = tool(
  'device_wake',
  'Nudge a device to sync immediately by writing a wakeup + forceSync signal onto its registry document.',
  deviceIdParam,
  async ({ device_id }) => {
    const bad = validId(device_id);
    if (bad) return { content: [{ type: 'text', text: bad }] };
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
    return { content: [{ type: 'text', text: err || `Wakeup + forceSync written to ${device_id} at ${at}. Device acts on next poll.` }] };
  },
);

const deviceSend = tool(
  'device_send',
  "Queue a command for a device and wake it so it runs promptly (e.g. action='sync-now', 'collect-sms', 'start-ssh'). Returns a command id; poll with device_result.",
  {
    action: z.string().describe("Command name the device's daemon understands, e.g. 'sync-now'."),
    device_id: z.string().default(DEFAULT_DEVICE),
    params: z.record(z.string(), z.any()).default({}).describe('Extra fields to merge into the queued command item.'),
    priority: z.enum(['NORMAL', 'HIGH', 'CRITICAL']).default('NORMAL'),
  },
  async ({ action, device_id, params, priority }) => {
    const bad = validId(device_id);
    if (bad) return { content: [{ type: 'text', text: bad }] };
    const at = new Date().toISOString();
    const actionSlug = action.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'cmd';
    const cmdId = `jpagent_${Date.now()}_${actionSlug}`;
    const item = { action, status: 'pending', priority, requestedAt: at, requestedBy: REQUESTED_BY, source: 'commandQueue', ...params };
    const res = await patchDoc(device_id, {
      [`commandQueue.${cmdId}`]: item,
      forceWakeup: true,
      wakeupSignal: at,
      commandId: cmdId,
      commandPriority: priority,
    });
    const err = errText(res);
    if (err) return { content: [{ type: 'text', text: err }] };
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ queued: true, device_id, command_id: cmdId, action, priority, at, next: 'poll with device_result(command_id=...)' }, null, 2),
      }],
    };
  },
);

const deviceResult = tool(
  'device_result',
  'Read back the status/result of a command previously queued with device_send.',
  { command_id: z.string(), device_id: z.string().default(DEFAULT_DEVICE) },
  async ({ command_id, device_id }) => {
    const bad = validId(device_id);
    if (bad) return { content: [{ type: 'text', text: bad }] };
    const doc = await getDoc(device_id);
    const err = errText(doc);
    if (err) return { content: [{ type: 'text', text: err }] };
    const q = doc.commandQueue || {};
    if (!(command_id in q)) {
      return { content: [{ type: 'text', text: JSON.stringify({ found: false, device_id, command_id, hint: 'id not in commandQueue; may have been cleared' }) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ found: true, device_id, command_id, item: q[command_id] }, null, 2) }] };
  },
);

const deviceQueue = tool(
  'device_queue',
  "List every command-queue item on a device with its current status.",
  deviceIdParam,
  async ({ device_id }) => {
    const bad = validId(device_id);
    if (bad) return { content: [{ type: 'text', text: bad }] };
    const doc = await getDoc(device_id);
    const err = errText(doc);
    if (err) return { content: [{ type: 'text', text: err }] };
    const q = doc.commandQueue || {};
    const rows = Object.entries(q).map(([qid, item]) => ({
      command_id: qid,
      action: item?.action,
      status: item?.status,
      priority: item?.priority,
      requestedAt: item?.requestedAt,
    }));
    rows.sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
    return { content: [{ type: 'text', text: JSON.stringify({ device_id, items: rows }, null, 2) }] };
  },
);

export const s24DeviceTools = createSdkMcpServer({
  name: 's24-connect',
  version: '1.0.0',
  instructions: `Firestore device-registry access (project ${PROJECT_ID}, db ${DATABASE}). Devices poll a command queue on their own doc; queuing a command does not mean it ran — check device_result / device_ping for staleness before assuming a device is reachable.`,
  tools: [listDevices, devicePing, deviceWake, deviceSend, deviceResult, deviceQueue],
});
