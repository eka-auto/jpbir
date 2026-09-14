import crypto from 'crypto';
import { fsGet, fsPatch } from './broker.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const STATS_KEY = _env['STATS_' + 'KEY'];

export const S24_DEVICE_ID = 'samsung-s24-ultra';
export const ALLOWED_ACTIONS = new Set([
  'heartbeat',
  'sync-now',
  'wakeup',
  'status-only',
]);

function timingSafeEqualText(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(String(actual));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function isAuthorized(req, expectedKey = STATS_KEY) {
  const header = String(req?.headers?.authorization || '');
  if (!header.startsWith('Bearer ')) return false;
  return timingSafeEqualText(header.slice(7).trim(), expectedKey);
}

export function validateCommand(body) {
  const device = String(body?.device || S24_DEVICE_ID).trim();
  const action = String(body?.action || 'sync-now').trim().toLowerCase();
  if (device !== S24_DEVICE_ID) {
    return { error: `device must be ${S24_DEVICE_ID}` };
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    return { error: `action must be one of: ${[...ALLOWED_ACTIONS].join(', ')}` };
  }
  return { device, action };
}

function commandId(action) {
  return `s24_${Date.now()}_${action}_${crypto.randomBytes(4).toString('hex')}`;
}

export async function queueS24Command(action) {
  const doc = await fsGet(`/devices/${S24_DEVICE_ID}`);
  if (!doc) throw new Error('S24 device document not found');

  const requestedAt = new Date().toISOString();
  const id = commandId(action);
  const fields = {
    [`commandQueue.${id}`]: {
      action,
      status: 'pending',
      requestedAt,
      requestedBy: 'dashboard-owner',
      source: 's24-command',
    },
    forceWakeup: true,
    wakeupSignal: requestedAt,
    commandId: id,
    commandPriority: 'HIGH',
  };
  if (action === 'sync-now') {
    fields.forceSync = true;
    fields.syncRequestedAt = requestedAt;
  }

  await fsPatch(`/devices/${S24_DEVICE_ID}`, fields);
  return { commandId: id, action, requestedAt };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!STATS_KEY) {
    return res.status(500).json({ success: false, error: 'command authentication is not configured' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'authentication required' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ success: false, error: 'body must be JSON' });
    }
  }
  const command = validateCommand(body);
  if (command.error) return res.status(400).json({ success: false, error: command.error });

  try {
    const result = await queueS24Command(command.action);
    return res.status(200).json({ success: true, device: command.device, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'S24 command queue failed' });
  }
}
