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
const OPERATOR_KEY = _env.OPERATOR_KEY || '';

// Digest both sides before comparing: timingSafeEqual throws on length mismatch,
// and comparing raw values would leak the key's length through that exception.
const sha256 = v => createHash('sha256').update(String(v), 'utf8').digest();

/**
 * Every failure carries a stable `code` as well as a status.
 *
 * Status alone stopped being enough once the store-backed handlers moved their
 * "not configured on this deployment" responses from 500 to 503 to match this
 * file. Two very different conditions now share 503: "this server has no
 * STATS_KEY" and "this server has no DATABASE_URL". The frontends clear the
 * stored key on 503, which is right for the first and destructive for the
 * second -- a database outage would log the operator out and make them re-enter
 * a key that was never the problem. `code` is what they branch on; matching on
 * the human-readable error string would be the brittle alternative.
 *
 * @returns {{ok: true} | {ok: false, status: number, code: string, error: string}}
 */
export function checkKey(req) {
  // Fails closed. A missing STATS_KEY reports 503 rather than 401 so that a
  // server that was never configured is distinguishable from a wrong key -
  // otherwise the operator sees "invalid key" and goes looking in the browser.
  if (!STATS_KEY) {
    return { ok: false, status: 503, code: 'auth_not_configured', error: 'STATS_KEY is not configured on the server' };
  }

  const supplied = req.query?.key || req.headers?.['x-stats-key'] || '';
  if (!supplied) return { ok: false, status: 401, code: 'auth_missing', error: 'missing key' };

  return timingSafeEqual(sha256(supplied), sha256(STATS_KEY))
    ? { ok: true }
    : { ok: false, status: 401, code: 'auth_invalid', error: 'invalid key' };
}

/**
 * Guard helper: writes the error response and returns false when unauthorized,
 * so a handler can `if (!requireKey(req, res)) return;`.
 */
export function requireKey(req, res) {
  const result = checkKey(req);
  if (result.ok) return true;
  res.status(result.status).json({ success: false, code: result.code, error: result.error });
  return false;
}

/**
 * Destructive/operator routes use a credential that is deliberately separate
 * from the read-only dashboard key. It is accepted only from a header so it
 * never appears in access logs, browser history, or referrers.
 */
export function checkOperatorKey(req) {
  if (!OPERATOR_KEY) {
    return { ok: false, status: 503, code: 'operator_auth_not_configured', error: 'OPERATOR_KEY is not configured on the server' };
  }

  const supplied = req.headers?.['x-operator-key'] || '';
  if (!supplied) return { ok: false, status: 401, code: 'operator_auth_missing', error: 'missing operator key' };

  return timingSafeEqual(sha256(supplied), sha256(OPERATOR_KEY))
    ? { ok: true }
    : { ok: false, status: 401, code: 'operator_auth_invalid', error: 'invalid operator key' };
}

export function requireOperatorKey(req, res) {
  const result = checkOperatorKey(req);
  if (result.ok) return true;
  res.status(result.status).json({ success: false, code: result.code, error: result.error });
  return false;
}
