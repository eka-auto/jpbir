// Key-gated media proxy for private WhatsApp blobs.
import { Readable } from 'node:stream';
import { requireKey } from './_auth.js';
import { verifyMediaToken } from './lib/media-auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';
import { get } from '@vercel/blob';
import { mediaKind } from './lib/media-policy.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;

function pathnameOf(blobUrl) {
  try { return new URL(blobUrl).pathname.replace(/^\/+/, ''); } catch { return null; }
}
function blobOptions(req) {
  const token = _env.BLOB_READ_WRITE_TOKEN || _env.BLOB_TOKEN;
  const range = req.headers && (req.headers.range || req.headers.Range);
  return {
    access: 'private',
    ...(token ? { token } : {}),
    ...(range ? { headers: { Range: range } } : {}),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // A PDF iframe renders error bodies too. Keep authentication/storage refusals
  // readable instead of showing the API's JSON inside the document preview.
  if(req.headers?.['sec-fetch-dest']==='iframe') {
    res.json=()=>{
      res.setHeader('Content-Type','text/plain; charset=utf-8');
      return res.send('This file is unavailable. Refresh the dashboard to check access.');
    };
  }
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
   try { row = (await query(`SELECT blob_url, mime, file_name FROM wa_attachments WHERE att_id = $1`, [attId])).rows[0]; }
  catch (err) { return res.status(500).json({ ok: false, error: err.message || 'lookup failed' }); }
  if (!row || !row.blob_url) return res.status(404).json({ ok: false, error: 'not found' });
   if(!mediaKind(row)) return res.status(404).json({ok:false,error:'Unsupported file'});
  const pathname = pathnameOf(row.blob_url);
  if (!pathname) return res.status(422).json({ ok: false, error: 'attachment has no usable blob path' });
  try {
    const result = await get(pathname, blobOptions(req));
    if (!result || ![200, 206].includes(result.statusCode) || !result.stream) {
      return res.status(404).json({ ok: false, error: 'not found' });
    }
     const mime=result.blob.contentType || 'application/octet-stream';
     if(!mediaKind({...row,mime})) return res.status(415).json({ok:false,error:'Unsupported file'});
     res.setHeader('Content-Type', mime);
     res.setHeader('Content-Security-Policy', "frame-ancestors 'self'; object-src 'none'; base-uri 'none'");
     res.setHeader('X-Frame-Options', 'SAMEORIGIN');
     res.setHeader('Content-Disposition', (mediaKind({...row,mime})==='document'?'attachment':'inline')+'; filename="'+String(row.file_name||'document').replace(/[\r\n"\\]/g,'_').slice(0,180)+'"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('ETag', result.blob.etag);
    for (const header of ['accept-ranges', 'content-length', 'content-range']) {
      const value = result.headers && result.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    if (req.method === 'HEAD') return res.status(result.statusCode).end();
    const stream = Readable.fromWeb(result.stream);
    stream.once('error', (err) => {
      console.error('[wa-media]', err);
      if (!res.headersSent) return res.status(502).json({ ok: false, error: 'could not fetch private media' });
      res.destroy(err);
    });
    return stream.pipe(res);
  } catch (err) {
    console.error('[wa-media]', err);
    return res.status(502).json({ ok: false, error: 'could not fetch private media' });
  }
}
