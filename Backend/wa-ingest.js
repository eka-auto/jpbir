// Key-guarded write side for the WhatsApp inventory.
//
// The other Claude session shipped Backend/wa-galaxy.js with a deliberate
// no-HTTP-ingest posture: "an inventory of real contact names is loaded by
// the owner, from the owner's machine, and read back only through the
// key-gated /api/wa-galaxy." The owner's explicit ask to live-sync from the
// S24 reverses that comment. This endpoint accepts batches over HTTPS, but
// gated on its OWN key (WA_INGEST_KEY, not the dashboard's STATS_KEY) so a
// leak of the read key cannot nuke the store.
//
// Body: { device?, run_id?, chats?: [...], messages?: [...], done?: bool, note? }
// Chat and message shapes come from Integrations/wa-store.js — the same shape
// Database/scripts/wa-import.mjs already loads locally. Send the same run_id
// on every batch and done:true on the last so wa_sync_runs shows one run.
//
// Guards mirror wa-galaxy: 404 (not 401) on a bad or missing key so the route
// is not discoverable to a scanner; every chat must carry its own id/jid,
// since a batch is a slice of one push and same-name pairs cannot be told
// apart across requests without ids.
import { createHash, timingSafeEqual } from 'node:crypto';
import { query, isConfigured } from '../Integrations/postgres.js';
import { ingestBatch, idlessChats } from '../Integrations/wa-store.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const WA_INGEST_KEY = _env.WA_INGEST_KEY || '';

// timingSafeEqual throws on length mismatch, which would leak the key length
// through the exception. Digest both sides first.
const sha256 = (v) => createHash('sha256').update(String(v), 'utf8').digest();

function keyMatches(given, expected) {
  if (!expected || !given) return false;
  return timingSafeEqual(sha256(given), sha256(expected));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  const supplied = (req.headers && req.headers['x-wa-ingest-key'])
    || (req.query && req.query.key)
    || '';
  // 404 rather than 401 so the route reads the same as "not present" to a scanner.
  if (!keyMatches(supplied, WA_INGEST_KEY)) {
    return res.status(404).json({ error: 'not found' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'POST only' });
  }

  // Validate inputs before the server-config check, so a caller with a broken
  // body gets a specific 400 even on a deployment that's missing DATABASE_URL.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ ok: false, error: 'body is not JSON' }); }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'JSON object body required' });
  }
  // The derived kind+name key is safe only over one whole list. One batch at
  // a time, two id-less requests each carrying a "Family" group would both key
  // on the first-occurrence hash and overwrite each other, so name them here
  // and refuse before the store is touched.
  const missing = idlessChats(Array.isArray(body.chats) ? body.chats : []);
  if (missing.length) {
    const where = `chats[${missing[0]}]` + (missing.length > 1 ? ` and ${missing.length - 1} more` : '');
    return res.status(400).json({
      ok: false,
      error: `no id/jid on ${where}: each chat in a batch must carry its own id (the S24 pusher sends the wa jid)`,
      missing: missing.slice(0, 50),
    });
  }

  if (!isConfigured()) {
    return res.status(500).json({ ok: false, error: 'DATABASE_URL not set on this deployment' });
  }

  try {
    const result = await ingestBatch(query, body, { source: 'wa-ingest' });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    // 42P01 = undefined_table. On the read side this is "nothing to show", but
    // on the write side it is a real ops error: the pusher would silently drop
    // batches. Say so.
    if (err && err.code === '42P01') {
      return res.status(500).json({ ok: false, error: 'wa_chats table not migrated yet — run db:migrate before pushing' });
    }
    console.error('[wa-ingest] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
