// Key-gated media proxy for private WhatsApp blobs.
//
// wa-blob-upload.js stores each media file in Vercel Blob with access:'private',
// so the raw blob URL is NOT fetchable without a signature. The dashboard can't
// put a bearer token on an <img>/<video>/<audio> element, so it points those at
//
//   GET /api/wa-media?att_id=<id>&token=<short-lived attachment token>
//
// which checks the same STATS_KEY as every other read route, looks up the blob
// pathname for that attachment, mints a short-lived presigned GET URL, and
// 302-redirects to it. The presigned URL is valid for ~2 minutes and scoped to
// that one pathname, so it can't be shared usefully; the store-wide signing
// token is issued once and cached in module scope, so a grid of 40 thumbnails
// costs one network round-trip on a cold function, then local HMAC signing.
//
// Referrer-Policy:no-referrer keeps even the short-lived attachment token from
// leaking to the blob host on redirect. The long-lived dashboard key is never
// placed in a media URL.
import { requireKey } from './_auth.js';
import { verifyMediaToken } from './lib/media-auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';
import { issueSignedToken, presignUrl } from '@vercel/blob';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;

// Store-wide read token, reused across invocations of a warm function. Refreshed
// before it expires so a request never presigns against a dead delegation.
let _tokenCache = null; // { token: IssuedSignedToken, validUntil: number }
const TOKEN_TTL_MS = 55 * 60 * 1000; // issue for 55 min
const TOKEN_SKEW_MS = 60 * 1000; // refresh a minute early
const URL_TTL_MS = 2 * 60 * 1000; // each presigned URL lives 2 min

async function storeToken() {
  const now = Date.now();
  if (_tokenCache && _tokenCache.validUntil - TOKEN_SKEW_MS > now) {
    return _tokenCache.token;
  }
  const token = await issueSignedToken({
    pathname: '*',
    operations: ['get', 'head'],
    validUntil: now + TOKEN_TTL_MS,
  });
  _tokenCache = { token, validUntil: now + TOKEN_TTL_MS };
  return token;
}

// wa-blob-upload stores blob_url as a full URL; presignUrl wants the pathname
// (e.g. "wa/image/ab12cd-IMG.jpg"). Parse it back off the stored URL.
function pathnameOf(blobUrl) {
  try {
    return new URL(blobUrl).pathname.replace(/^\/+/, '');
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'GET only' });
  }
  const attId = String((req.query && req.query.att_id) || '').trim();
  if (!attId) return res.status(400).json({ ok: false, error: 'att_id required' });

  // Media elements cannot send x-stats-key. Normal dashboard responses carry a
  // short-lived HMAC bound to exactly one attachment. Direct API clients may
  // still use the header, but a raw ?key= query is deliberately ignored here.
  const mediaToken = String((req.query && req.query.token) || '');
  if (!verifyMediaToken(attId, mediaToken)) {
    const headerOnlyReq = { ...req, query: { ...(req.query || {}), key: undefined } };
    if (!requireKey(headerOnlyReq, res)) return;
  }
  if (!isConfigured()) {
    return res.status(503).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  }
  if (!_env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ ok: false, error: 'BLOB_READ_WRITE_TOKEN not configured on this deployment' });
  }

  let row;
  try {
    const r = await query(`SELECT blob_url FROM wa_attachments WHERE att_id = $1`, [attId]);
    row = r.rows[0];
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'lookup failed' });
  }
  if (!row || !row.blob_url) return res.status(404).json({ ok: false, error: 'not found' });

  const pathname = pathnameOf(row.blob_url);
  if (!pathname) return res.status(422).json({ ok: false, error: 'attachment has no usable blob path' });

  try {
    const token = await storeToken();
    const { presignedUrl } = await presignUrl(token, {
      operation: 'get',
      pathname,
      access: 'private',
      validUntil: Date.now() + URL_TTL_MS,
    });
    res.setHeader('Location', presignedUrl);
    return res.status(302).end();
  } catch (err) {
    // A token minted against a rotated store secret fails here; drop the cache
    // so the next request re-issues rather than looping on a stale token.
    _tokenCache = null;
    console.error('[wa-media]', err);
    return res.status(502).json({ ok: false, error: 'could not sign media url' });
  }
}
