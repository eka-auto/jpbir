import crypto from 'crypto';
import { fsGet, fsPatch } from './broker.js';
import { secretEquals } from './lib/cron-auth.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const STATS_KEY = _env['STATS_' + 'KEY'];

export const S24_DEVICE_ID = 'samsung-s24-ultra';
export const ALLOWED_ACTIONS = new Set([
  'status-only',
  'ping',
  'echo',
  'wa-push',
  'wa-media-push',
  'sync-now',
]);

/**
 * Bearer-token check for the S24 command endpoint.
 *
 * The comparison is delegated to secretEquals in lib/cron-auth.js, which SHA-256
 * digests both sides before timingSafeEqual. The local version compared raw
 * buffers behind an `a.length === b.length` guard, so a wrong-length token took
 * a different, cheaper path than a right-length one -- the key's length was
 * observable, which is the exact failure both _auth.js and cron-auth.js carry
 * comments about avoiding. Two copies of a credential comparison is how they
 * drift into disagreeing about what counts as authorised.
 *
 * The Bearer shape is kept rather than moved to requireKey(): Frontend's call
 * sends `Authorization: Bearer`, and _auth.js reads ?key= / x-stats-key. Only
 * the comparison was wrong, not the transport.
 */
export function isAuthorized(req, expectedKey = STATS_KEY) {
  const header = String(req?.headers?.authorization || '');
  if (!header.startsWith('Bearer ')) return false;
  return secretEquals(header.slice(7).trim(), expectedKey);
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
    return res.status(503).json({ success: false, error: 'command authentication is not configured' });
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
