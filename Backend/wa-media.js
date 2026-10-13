// Key-gated media proxy for private WhatsApp blobs.
import { Readable } from 'node:stream';
import { requireKey } from './_auth.js';
import { verifyMediaToken } from './lib/media-auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';
import { get } from '@vercel/blob';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;

function pathnameOf(blobUrl) {
  try { return new URL(blobUrl).pathname.replace(/^\/+/, ''); } catch { return null; }
}
function blobOptions() {
  const token = _env.BLOB_READ_WRITE_TOKEN || _env.BLOB_TOKEN;
  return token ? { access: 'private', token } : { access: 'private' };
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
  const mediaToken = String((req.query && req.query.token) || '');
  if (!verifyMediaToken(attId, mediaToken)) {
    const headerOnlyReq = { ...req, query: { ...(req.query || {}), key: undefined } };
    if (!requireKey(headerOnlyReq, res)) return;
  }
  if (!isConfigured()) return res.status(503).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  if (!(_env.BLOB_READ_WRITE_TOKEN || _env.BLOB_TOKEN || _env.BLOB_STORE_ID)) {
    return res.status(503).json({ ok: false, error: 'Blob is not configured on this deployment' });
  }
  let row;
  try { row = (await query(`SELECT blob_url FROM wa_attachments WHERE att_id = $1`, [attId])).rows[0]; }
  catch (err) { return res.status(500).json({ ok: false, error: err.message || 'lookup failed' }); }
  if (!row || !row.blob_url) return res.status(404).json({ ok: false, error: 'not found' });
  const pathname = pathnameOf(row.blob_url);
  if (!pathname) return res.status(422).json({ ok: false, error: 'attachment has no usable blob path' });
  try {
    const result = await get(pathname, blobOptions());
    if (!result || result.statusCode !== 200 || !result.stream) return res.status(404).json({ ok: false, error: 'not found' });
    res.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('ETag', result.blob.etag);
    if (req.method === 'HEAD') return res.status(200).end();
    return Readable.fromWeb(result.stream).pipe(res);
  } catch (err) {
    console.error('[wa-media]', err);
    return res.status(502).json({ ok: false, error: 'could not fetch private media' });
  }
}
