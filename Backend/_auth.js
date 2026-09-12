// Shared dashboard-key check for the read-only analytics endpoints.
//
// The frontend has always sent ?key=<KEY> and has always handled 401 by clearing
// sessionStorage and reopening the unlock gate - but no backend ever validated
// the key, so /api/visitor would return a complete visitor dossier (IP,
// fingerprint, user agent, geolocation, full interaction trail) to anyone on the
// internet holding a session id.

import { createHash, timingSafeEqual } from 'node:crypto';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const STATS_KEY = _env.STATS_KEY || '';

// Digest both sides before comparing: timingSafeEqual throws on length mismatch,
// and comparing raw values would leak the key's length through that exception.
const sha256 = v => createHash('sha256').update(String(v), 'utf8').digest();

/**
 * @returns {{ok: true} | {ok: false, status: number, error: string}}
 */
export function checkKey(req) {
  // Fails closed. A missing STATS_KEY reports 503 rather than 401 so that a
  // server that was never configured is distinguishable from a wrong key -
  // otherwise the operator sees "invalid key" and goes looking in the browser.
  if (!STATS_KEY) {
    return { ok: false, status: 503, error: 'STATS_KEY is not configured on the server' };
  }

  const supplied = req.query?.key || req.headers?.['x-stats-key'] || '';
  if (!supplied) return { ok: false, status: 401, error: 'missing key' };

  return timingSafeEqual(sha256(supplied), sha256(STATS_KEY))
    ? { ok: true }
    : { ok: false, status: 401, error: 'invalid key' };
}

/**
 * Guard helper: writes the error response and returns false when unauthorized,
 * so a handler can `if (!requireKey(req, res)) return;`.
 */
export function requireKey(req, res) {
  const result = checkKey(req);
  if (result.ok) return true;
  res.status(result.status).json({ success: false, error: result.error });
  return false;
}
