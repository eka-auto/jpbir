// POST /api/s24-ingest — the only door into the S24 local-sync tables.
//
// Vercel has no SSH, so "connect over an SSH key" is implemented as the same
// trust model over HTTPS: an ECDSA P-256 keypair whose private half never
// leaves the laptop (and, with the CNG signer, never leaves the TPM). The
// public half lives in S24_SYNC_PUBLIC_KEYS here. Every upload is signed, and
// nothing unsigned is accepted — there is deliberately no shared-secret
// fallback, because one leaked header would otherwise be enough to write
// anything into the phone's history.
//
// Reuses keyIdFromPem / canonicalString / verifyP256 from broker.js rather than
// inventing a second signing scheme for the same fleet.
import crypto from 'node:crypto';
import { keyIdFromPem, canonicalString, verifyP256 } from './broker.js';
import { pool, isConfigured } from '../Integrations/postgres.js';
import { validateBatch, ingestBatch } from '../Integrations/s24-store.js';

const MAX_SKEW_MS = 5 * 60 * 1000;
const SEEN_RETENTION_HOURS = 24;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * S24_SYNC_PUBLIC_KEYS holds one or more PEM public keys, newline-separated
 * between PEM blocks or JSON-array encoded. Plural so a key can be rotated by
 * adding the new one, cutting over, then removing the old — rather than a
 * flag-day where a single-valued env var breaks every in-flight upload.
 */
export function loadPublicKeys(raw) {
  if (!raw) return [];
  let items;
  const trimmed = String(raw).trim();
  if (trimmed.startsWith('[')) {
    try { items = JSON.parse(trimmed); } catch { return []; }
  } else {
    items = trimmed.split(/(?=-----BEGIN )/g);
  }
  const out = [];
  for (const item of items) {
    const pem = String(item).replace(/\\n/g, '\n').trim();
    if (!pem.includes('BEGIN')) continue;
    try {
      out.push({ keyId: keyIdFromPem(pem), pem });
    } catch {
      // A malformed key is skipped rather than failing every other key with it.
    }
  }
  return out;
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Everything the endpoint decides before it touches the database, so the
 * decision can be tested without one. Returns { ok } or { error, httpStatus }.
 */
export function authorize(headers, rawBody, keys, now) {
  if (!keys.length) return { error: 'no signing keys configured', httpStatus: 503 };

  const keyId = String(headers['x-key-id'] || '');
  const signature = String(headers['x-signature'] || '');
  const timestampRaw = String(headers['x-timestamp'] || '');
  const requestId = String(headers['x-request-id'] || '');
  const seq = String(headers['x-seq'] || '0');

  if (!keyId || !signature || !timestampRaw || !requestId) {
    return { error: 'missing signature headers', httpStatus: 401 };
  }
  if (!/^[a-f0-9]{32}$/.test(keyId)) return { error: 'malformed key id', httpStatus: 400 };
  if (!/^\d{1,15}$/.test(seq)) return { error: 'malformed sequence', httpStatus: 400 };
  if (!/^\d{1,15}$/.test(timestampRaw)) return { error: 'malformed timestamp', httpStatus: 400 };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    return { error: 'malformed request id', httpStatus: 400 };
  }

  const key = keys.find((k) => k.keyId === keyId);
  // Same message for an unknown key and a bad signature, so the endpoint does
  // not tell a prober which key ids exist.
  if (!key) return { error: 'signature rejected', httpStatus: 401 };

  const skew = Math.abs(now - Number(timestampRaw));
  if (skew > MAX_SKEW_MS) return { error: 'timestamp outside allowed skew', httpStatus: 401 };

  const canonical = canonicalString(
    { keyId, method: 'POST', path: '/api/s24-ingest', seq, timestamp: timestampRaw, requestId },
    sha256Hex(rawBody)
  );
  if (!verifyP256(key.pem, canonical, signature)) {
    return { error: 'signature rejected', httpStatus: 401 };
  }
  return { ok: true, keyId, requestId, bodySha256: sha256Hex(rawBody) };
}

async function readRawBody(req) {
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (Buffer.isBuffer(req.body)) return req.body;

  // Vercel's Node runtime exposes the original IncomingMessage stream. Read
  // those bytes: signatures must cover what crossed the wire, not a JSON object
  // serialised a second time with potentially different escaping or numbers.
  if (req && typeof req.on === 'function' && !req.readableEnded) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(Object.assign(new Error('body too large'), { httpStatus: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  // Local test adapters sometimes pre-parse the body. Production clients emit
  // compact JSON in insertion order, matching JSON.stringify for this shape.
  if (req.body && typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body), 'utf8');
  return Buffer.alloc(0);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  }
  if (!isConfigured()) {
    return res.status(500).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  }

  const keys = loadPublicKeys(process.env.S24_SYNC_PUBLIC_KEYS);
  let raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    return res.status(err.httpStatus || 400).json({ ok: false, error: err.message });
  }
  const auth = authorize(req.headers || {}, raw, keys, Date.now());
  if (!auth.ok) {
    console.error('[s24-ingest] rejected:', auth.error);
    return res.status(auth.httpStatus).json({ ok: false, error: auth.error });
  }

  let body;
  try {
    body = typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ ok: false, error: 'body is not valid JSON' });
  }

  const checked = validateBatch(body);
  if (!checked.ok) {
    return res.status(400).json({ ok: false, error: checked.error, detail: checked.detail });
  }

  let client;
  try {
    client = await pool().connect();
    await client.query('BEGIN');
    // A valid signature proves who sent these bytes, not that they were sent
    // once. request_id is single-use; a retry of the same upload is reported
    // as a duplicate rather than counted twice.
    const claimed = await client.query(
      `INSERT INTO s24_ingest_seen (request_id, key_id, body_sha256) VALUES ($1, $2, $3)
       ON CONFLICT (request_id) DO NOTHING RETURNING request_id`,
      [auth.requestId, auth.keyId, auth.bodySha256]
    );
    if (!claimed.rowCount) {
      const previous = await client.query(
        'SELECT key_id, body_sha256 FROM s24_ingest_seen WHERE request_id = $1',
        [auth.requestId]
      );
      await client.query('ROLLBACK');
      if (!previous.rowCount || previous.rows[0].key_id !== auth.keyId || previous.rows[0].body_sha256 !== auth.bodySha256) {
        return res.status(409).json({ ok: false, error: 'request id was reused' });
      }
      return res.status(200).json({ ok: true, duplicate: true, requestId: auth.requestId });
    }

    const result = await ingestBatch(client.query.bind(client), checked.batch, { keyId: auth.keyId });

    await client.query(
      `DELETE FROM s24_ingest_seen WHERE seen_at < now() - ($1 || ' hours')::interval`,
      [String(SEEN_RETENTION_HOURS)]
    );
    await client.query('COMMIT');

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[s24-ingest] database error:', err && err.code ? err.code : 'unknown');
    return res.status(500).json({ ok: false, error: 'ingest failed' });
  } finally {
    if (client) client.release();
  }
}
