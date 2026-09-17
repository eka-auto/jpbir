// Bearer-token check for Vercel's scheduled invocations.
//
// Vercel calls a cron path with `Authorization: Bearer $CRON_SECRET`, so a
// route that a schedule drives needs this in addition to whatever key a human
// presents. It lived inside verify-db.js; db-push now needs the same check,
// and a second copy of a credential comparison is how the two drift into
// disagreeing about what counts as authorised.
import crypto from 'crypto';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;

const sha256 = (v) => crypto.createHash('sha256').update(String(v), 'utf8').digest();

/**
 * Constant-time equality for two secrets of any length.
 *
 * Both sides are digested first: timingSafeEqual throws on a length mismatch,
 * so comparing raw values turns a wrong-length token into an unhandled 500
 * instead of a refusal — and leaks the expected length through that exception.
 */
export function secretEquals(given, expected) {
  if (!expected || !given) return false;
  return crypto.timingSafeEqual(sha256(given), sha256(expected));
}

/** True when the request carries the CRON_SECRET bearer Vercel sends. */
export function cronAuthorized(req) {
  // Read at call time, not module load: a route may be imported by a test
  // before the environment is set up.
  const secret = _env['CRON_' + 'SECRET'];
  if (!secret) return false;
  const auth = String(req.headers?.['authorization'] || '');
  if (!auth.startsWith('Bearer ')) return false;
  return secretEquals(auth.slice(7), secret);
}
