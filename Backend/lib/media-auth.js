import { createHmac, timingSafeEqual } from 'node:crypto';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const TTL_MS = 15 * 60 * 1000;

const signature = (attId, expires) => createHmac('sha256', _env.STATS_KEY || '')
  .update(`${attId}\n${expires}`, 'utf8')
  .digest('base64url');

export function issueMediaToken(attId, now = Date.now()) {
  if (!_env.STATS_KEY || !attId) return '';
  const expires = now + TTL_MS;
  return `${expires}.${signature(String(attId), expires)}`;
}

export function verifyMediaToken(attId, token, now = Date.now()) {
  if (!_env.STATS_KEY || !attId || !token) return false;
  const [rawExpires, supplied, extra] = String(token).split('.');
  if (extra !== undefined || !/^\d{13}$/.test(rawExpires || '') || !supplied) return false;
  const expires = Number(rawExpires);
  if (!Number.isFinite(expires) || expires < now || expires > now + TTL_MS + 60_000) return false;
  const expected = signature(String(attId), expires);
  const a = Buffer.from(supplied, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
