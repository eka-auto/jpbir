#!/usr/bin/env node
// Import WhatsApp "Export chat (Attach media)" exports into Neon + Vercel Blob.
//
// This is the host-side companion to Database/lib/wa-export-parser.mjs and the
// path the capture audit recommends: the official export is the only source
// that carries real message bodies AND the real media bytes. Run it on the
// owner's machine against an EXTRACTED export (unzip the .zip first — Node has
// no zip reader, and Expand-Archive / unzip is one command).
//
//   npm run wa:export-import -- --dir /path/to/extracted-exports
//
// Layout the --dir must contain:
//   mapping.json   { "<file-or-subfolder>": "<jid>" }
//                  or  { "<file-or-subfolder>": { "chat_id": "<jid>",
//                        "name": "Display Name", "kind": "group|direct" } }
//   plus, for each entry, either a "<name>.txt" with its media files beside it,
//   or a subfolder holding "_chat.txt" and that chat's media files.
//
// For every "<file> (file attached)" / "<attached: file>" marker the parser
// finds, this uploads the bundled file's bytes to Vercel Blob (private, under a
// HASHED chat handle so no phone number lands in a URL), then ingests chats,
// messages and attachments through Integrations/wa-store.js in ONE transaction.
// Ordering is handled by ingestBatch: chats are upserted before messages and
// attachments, so the WHERE EXISTS guards never drop a row; bytes are uploaded
// before ingest, so every attachment already has a blob_url. Direct to Neon and
// Blob, same as wa-import.mjs — needs DATABASE_URL and BLOB_READ_WRITE_TOKEN.
//
// Idempotent: message keys are content hashes and chat_id is the jid, so a
// re-run upserts in place. A real body imported here overwrites any
// [Encrypted — export chat to read] placeholder a recovery-dump import left
// (the ON CONFLICT clause in wa-store.js's upsertMessages).
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ingestBatch, handleFor } from '../../Integrations/wa-store.js';
import { parseExport } from '../lib/wa-export-parser.mjs';
import { loadEnv } from './_env.mjs';

loadEnv();

const args = process.argv.slice(2);
const opt = (name, dflt = null) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : dflt; };
const has = (name) => args.includes(name);

const dir = opt('--dir', process.env.WA_EXPORT_DIR);
if (!dir) {
  console.error('usage: node Database/scripts/wa-export-import.mjs --dir <extracted-exports> '
    + '[--device id] [--run id] [--me "Your Name,Alias"] [--tz-offset +05:30] [--month-first] [--dry-run]');
  process.exit(1);
}
if (!existsSync(dir)) { console.error(`[error] no exports directory at ${dir}`); process.exit(2); }

const device = opt('--device', 'owner-export');
const runId = opt('--run', `export_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`);
const meAliases = (opt('--me', process.env.WA_ME_NAME || '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const tzOffset = opt('--tz-offset', process.env.WA_TZ_OFFSET || '+05:30');
const dayFirst = !has('--month-first');
const dryRun = has('--dry-run');

const mappingPath = path.join(dir, 'mapping.json');
if (!existsSync(mappingPath)) {
  console.error(`[error] ${mappingPath} missing — create it with { "<file-or-subfolder>": "<jid>" } pairs`);
  process.exit(2);
}
const mapping = JSON.parse(await readFile(mappingPath, 'utf8'));
if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || !Object.keys(mapping).length) {
  console.error('[error] mapping.json must be a non-empty object of { filename: jid | {chat_id,...} }');
  process.exit(2);
}

// Resolve one mapping entry to its chat text file and the directory its media
// files sit in. An entry may point at a .txt (media are siblings) or a folder
// (holding _chat.txt and its media).
async function resolveEntry(entryName) {
  const full = path.join(dir, entryName);
  if (!existsSync(full)) return null;
  const st = await stat(full);
  if (st.isDirectory()) {
    const inner = (await readdir(full)).filter((f) => f.toLowerCase().endsWith('.txt'));
    const chatTxt = inner.find((f) => f === '_chat.txt') || inner[0];
    if (!chatTxt) return null;
    return { textPath: path.join(full, chatTxt), mediaDir: full };
  }
  return { textPath: full, mediaDir: path.dirname(full) };
}

// Lazily loaded so --dry-run (and the tests) never require the Blob token.
let _put = null;
async function uploadBytes(pathname, bytes) {
  if (!_put) ({ put: _put } = await import('@vercel/blob'));
  const token = process.env.BLOB_READ_WRITE_TOKEN || undefined;
  const res = await _put(pathname, bytes, { access: 'private', addRandomSuffix: true, token });
  return res.url;
}

const allChats = [];
const allMessages = [];
const allAttachments = [];
let totalFiles = 0, uploaded = 0, missingFiles = 0;

for (const [entryName, value] of Object.entries(mapping)) {
  const chatId = typeof value === 'string' ? value : String(value.chat_id || value.id || '');
  if (!chatId) { console.error(`[skip] ${entryName}: no chat_id in mapping`); continue; }
  const resolved = await resolveEntry(entryName);
  if (!resolved) { console.log(`[skip] ${entryName}: not found in ${dir}`); continue; }

  const text = await readFile(resolved.textPath, 'utf8');
  const name = typeof value === 'object' && value.name ? value.name : path.basename(entryName).replace(/\.txt$/i, '');
  const kind = typeof value === 'object' ? value.kind : undefined;
  const { chat, messages, attachments } = parseExport(text, { chatId, name, kind, meAliases, dayFirst, tzOffset });

  // Upload each referenced file's bytes, then stamp the returned blob_url onto
  // the attachment. An attachment whose file is not in the export is dropped
  // here (counted) rather than sent without a blob_url, which wa-store rejects.
  const kept = [];
  for (const att of attachments) {
    totalFiles++;
    const filePath = path.join(resolved.mediaDir, att.file_name);
    if (!existsSync(filePath)) { missingFiles++; continue; }
    const bytes = await readFile(filePath);
    att.size_bytes = bytes.length;
    if (!dryRun) {
      att.blob_url = await uploadBytes(`wa-media/${handleFor(chatId)}/${att.file_name}`, bytes);
      uploaded++;
    }
    kept.push(att);
  }

  allChats.push(chat);
  allMessages.push(...messages);
  if (!dryRun) allAttachments.push(...kept);
  console.log(`${entryName}: ${messages.length} messages, ${kept.length}/${attachments.length} media for ${name}`);
}

console.log(`parsed ${allChats.length} chats, ${allMessages.length} messages, ${totalFiles} media refs`
  + ` (${uploaded} uploaded, ${missingFiles} file-not-found)`);

if (dryRun) {
  console.log('[dry-run] nothing uploaded or ingested');
  process.exit(0);
}
if (!allChats.length) { console.error('nothing to import'); process.exit(1); }

// One transaction, direct (unpooled) connection — same reasoning as wa-import.mjs:
// pgbouncer transaction mode is a poor fit for a multi-statement chunked batch.
const { directPool } = await import('../../Integrations/postgres.js');
const pool = directPool();
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const r = await ingestBatch((t, p) => client.query(t, p),
    { chats: allChats, messages: allMessages, attachments: allAttachments, device, run_id: runId, done: true },
    { source: 'wa-export-import' });
  await client.query('COMMIT');
  console.log(`chats ${r.chats.upserted}, messages ${r.messages.upserted} (orphaned ${r.messages.orphaned}),`
    + ` attachments ${r.attachments.upserted} (orphaned ${r.attachments.orphaned}, skipped ${r.attachments.skipped}) — run ${runId}`);
  if (r.messages.orphaned || r.attachments.orphaned) {
    console.error('[warn] orphaned rows mean a chat_id did not match an ingested chat — check the mapping jids');
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  throw err;
} finally {
  client.release();
  await pool.end();
}
