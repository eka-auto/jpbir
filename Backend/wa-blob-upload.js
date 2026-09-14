// Key-guarded blob-upload for WhatsApp media & audio files.
//
// The S24 daemon POSTs one file's bytes as the raw request body with
// metadata in query params. Because Vercel functions cap request body at
// 4.5 MB, this rejects anything larger and asks the caller to skip it —
// most WhatsApp images and audio comfortably fit; large videos will need
// a follow-up client-upload flow.
//
//   POST /api/wa-blob-upload?kind=image&file_name=IMG_202506.jpg
//        x-wa-ingest-key: $WA_INGEST_KEY
//        content-type:    image/jpeg
//        body:            <raw file bytes>
//   ->   { ok:true, blob_url:'https://…blob.vercel-storage.com/…' }
//
// The Vercel Blob token (BLOB_READ_WRITE_TOKEN) must be set on the project.
// The daemon writes the returned blob_url into wa_attachments via /api/wa-ingest.
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { put } from '@vercel/blob';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const WA_INGEST_KEY = _env.WA_INGEST_KEY || '';

const sha256 = (v) => createHash('sha256').update(String(v), 'utf8').digest();
function keyMatches(given, expected) {
  if (!expected || !given) return false;
  return timingSafeEqual(sha256(given), sha256(expected));
}

export const config = { api: { bodyParser: false } };

async function readRawBody(req, cap) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > cap) throw Object.assign(new Error('body too large'), { code: 'E_TOO_LARGE' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Kept slightly under Vercel's 4.5 MB serverless-function body limit.
const MAX_BODY = 4 * 1024 * 1024;

const SAFE_KINDS = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker', 'other']);

function safeName(name) {
  const base = String(name || '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'file';
  return base;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  const supplied = (req.headers && req.headers['x-wa-ingest-key']) || (req.query && req.query.key) || '';
  if (!keyMatches(supplied, WA_INGEST_KEY)) {
    return res.status(404).json({ error: 'not found' });
  }
  if (req.method !== 'POST' && req.method !== 'PUT') {
    res.setHeader('Allow', 'POST, PUT');
    return res.status(405).json({ ok: false, error: 'POST/PUT only' });
  }

  const kind = String(req.query.kind || 'other').toLowerCase();
  if (!SAFE_KINDS.has(kind)) return res.status(400).json({ ok: false, error: 'unknown kind' });
  const contentType = req.headers['content-type'] || 'application/octet-stream';
  const fileName = safeName(req.query.file_name || 'file');

  if (!_env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ ok: false, error: 'BLOB_READ_WRITE_TOKEN not configured on this deployment' });
  }

  let buf;
  try {
    buf = await readRawBody(req, MAX_BODY);
  } catch (err) {
    if (err.code === 'E_TOO_LARGE') {
      return res.status(413).json({ ok: false, error: `file exceeds ${MAX_BODY} bytes — skip and try smaller` });
    }
    return res.status(400).json({ ok: false, error: 'could not read body' });
  }
  if (!buf.length) return res.status(400).json({ ok: false, error: 'empty body' });

  // Unguessable random component so blob URLs are effectively unlisted;
  // the schema stores blob_url as the source of truth.
  const rand = randomBytes(6).toString('hex');
  const pathname = `wa/${kind}/${rand}-${fileName}`;

  try {
    const { url } = await put(pathname, buf, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
    });
    return res.status(200).json({ ok: true, blob_url: url, size_bytes: buf.length });
  } catch (err) {
    console.error('[wa-blob-upload]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
