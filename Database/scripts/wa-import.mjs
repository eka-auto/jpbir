#!/usr/bin/env node
// Load a WhatsApp inventory into Neon from the owner's machine.
//
// The input is what Database/scripts/wa-build-inventory.mjs writes:
// { totals, chats: [{ id, n, k, u, m, e, md, au, cl, f, l, sz }] }, or a bare
// array of chats, in the compact or the verbose shape. Names go straight from
// your disk to the database; they never touch the repository.
//
//   npm run wa:build -- /path/to/recovery-dump
//   npm run wa:import -- Database/wa-inventory.json
//   npm run wa:import -- Database/wa-inventory.json --device samsung-s24-ultra
//
// Direct to Neon only (DATABASE_URL from .env.local, same as db:migrate).
// There is deliberately no HTTP ingest endpoint in this project: an inventory
// of real contact names is loaded by the owner, from the owner's machine, and
// read back only through the key-gated /api/wa-galaxy.
//
// Idempotent: rows are keyed on the chat's own id (or, for an inventory
// without ids, a hash of kind + name — a second chat with the same name gets
// its own key, numbered in file order), so re-running after a partial load
// resumes instead of duplicating.
import { readFile } from 'node:fs/promises';
import { ingestBatch, normalizeChat, assignChatIds } from '../../Integrations/wa-store.js';

const args = process.argv.slice(2);
const opt = (name, dflt = null) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : dflt; };
const file = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));

if (!file) {
  console.error('usage: node Database/scripts/wa-import.mjs <inventory.json> [--messages msgs.json]'
    + ' [--device id] [--run id]');
  process.exit(1);
}

const device = opt('--device', 'owner-import');
const runId = opt('--run', `import_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`);

async function loadList(path, listKey) {
  const j = JSON.parse(await readFile(path, 'utf8'));
  if (Array.isArray(j)) return j;
  if (j && Array.isArray(j[listKey])) return j[listKey];
  throw new Error(`${path}: expected an array or an object with a "${listKey}" array`);
}

// Ids are assigned over the whole file, before any slicing into API batches,
// so two same-name chats that land in different batches still get two rows.
const chats = assignChatIds(await loadList(file, 'chats'));
const messages = opt('--messages') ? await loadList(opt('--messages'), 'messages') : [];
const usable = chats.filter((c) => normalizeChat(c)).length;
console.log(`${file}: ${chats.length} chats (${usable} usable)` + (messages.length ? `, ${messages.length} messages` : ''));
if (!usable) { console.error('nothing to import'); process.exit(1); }

// One transaction: a failed load leaves no half-written inventory behind.
// The direct (unpooled) endpoint, because pgbouncer in transaction mode is a
// poor fit for a multi-statement batch held open across chunked upserts.
const { directPool } = await import('../../Integrations/postgres.js');
const pool = directPool();
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const r = await ingestBatch((t, p) => client.query(t, p), { chats, messages, device, run_id: runId, done: true },
    { source: 'wa-import' });
  await client.query('COMMIT');
  const n = (await client.query('SELECT COUNT(*)::int n FROM wa_chats')).rows[0].n;
  console.log(`chats upserted ${r.chats.upserted} (skipped ${r.chats.skipped}, duplicates ${r.chats.duplicates}), messages upserted ${r.messages.upserted}`);
  console.log(`wa_chats now holds ${n} rows — run ${runId}`);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  throw err;
} finally {
  client.release();
  await pool.end();
}
