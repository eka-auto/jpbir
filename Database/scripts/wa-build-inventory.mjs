#!/usr/bin/env node
// Build the WhatsApp inventory from a WhatsApp recovery dump.
//
//   npm run wa:build -- <recovery-dir> [-o Database/wa-inventory.json]
//
// The dump is the JSONL set the recovery tool writes, one file per LevelDB
// artifact: 328_7_chat.jsonl, 328_8_message.jsonl, 328_4_contact.jsonl and
// 328_21_group-metadata.jsonl are the four this reads. Output is the compact
// shape Database/scripts/wa-import.mjs loads into Neon:
//
//   { totals, chats: [{ id, n, k, u, m, e, md, au, cl, f, l, sz }] }
//
// Real names go from the dump straight into that file and then into the
// database. Neither the dump nor the built inventory belongs in git — write
// the output outside the repo, or to the gitignored Database/wa-inventory.json.
//
// Keying: a chat is identified by the jid embedded in every message id,
// `<fromMe>_<chatJid>_<hash>`. Keying on `value.from` instead would be wrong
// for the 39,066 outgoing messages, where `from` is the owner's own number and
// the peer is in `to._serialized`.
import fs from 'node:fs';
import rl from 'node:readline';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt = null) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : dflt; };
const dir = args.find((a, i) => !a.startsWith('-') && (i === 0 || !args[i - 1].startsWith('-')));
const out = opt('-o', opt('--out', 'Database/wa-inventory.json'));

if (!dir) {
  console.error('usage: node Database/scripts/wa-build-inventory.mjs <recovery-dir> [-o out.json]');
  process.exit(1);
}

// A recovered dump carries metadata only — bodies stay sealed — so every
// message counts toward enc_count. Anything not media or audio is a message
// and nothing more; call_log rows count as both a message and a call, which is
// how the existing inventory totals were derived.
const MEDIA = new Set(['image', 'video', 'document', 'album', 'sticker', 'vcard', 'multi_vcard', 'ptv', 'product', 'location']);
const AUDIO = new Set(['ptt', 'audio']);

const readJsonl = (file, onRecord) => new Promise((resolve, reject) => {
  const path = join(dir, file);
  if (!fs.existsSync(path)) { console.warn(`  (missing ${file} — skipped)`); return resolve(); }
  let n = 0;
  const stream = rl.createInterface({ input: fs.createReadStream(path) });
  stream.on('line', (line) => {
    if (!line.trim()) return;
    // A recovered dump has torn records in it; one bad line must not end the run.
    try { onRecord(JSON.parse(line)); n++; } catch { /* unparseable fragment */ }
  });
  stream.on('close', () => { console.log(`  ${file}: ${n} records`); resolve(); });
  stream.on('error', reject);
});

const chatMeta = new Map();   // jid -> display name from the chat list
const groups = new Map();     // jid -> { subject, size }
const contacts = new Map();   // jid or phone -> saved name

console.log(`reading ${dir}`);
await readJsonl('328_7_chat.jsonl', (o) => {
  const v = o.value || {};
  if (v.id) chatMeta.set(v.id, v.name || null);
});
await readJsonl('328_21_group-metadata.jsonl', (o) => {
  const v = o.value || {};
  if (v.id) groups.set(v.id, { subject: v.subject || null, size: v.size ?? null });
});
await readJsonl('328_4_contact.jsonl', (o) => {
  const v = o.value || {};
  const name = v.name || v.pushname || v.shortName || null;
  if (!name) return;
  if (v.id) contacts.set(v.id, name);
  // the address book keys on the phone jid, the chat may key on the @lid alias
  if (v.phoneNumber) contacts.set(v.phoneNumber, name);
});

const tally = new Map();
let keyed = 0, unkeyable = 0;
await readJsonl('328_8_message.jsonl', (o) => {
  const v = o.value || {};
  let jid = String(v.id || '').split('_')[1] || '';
  if (!jid.includes('@')) {
    // torn id: fall back to the envelope
    const to = v.to && typeof v.to === 'object' ? v.to._serialized : v.to;
    jid = String(v.from || '').includes('@') ? String(v.from) : String(to || '');
  }
  if (!jid.includes('@')) { unkeyable++; return; }
  keyed++;

  let c = tally.get(jid);
  if (!c) { c = { m: 0, md: 0, au: 0, cl: 0, first: null, last: null }; tally.set(jid, c); }
  const type = v.type || '';
  c.m++;
  if (type === 'call_log') c.cl++;
  else if (MEDIA.has(type)) c.md++;
  else if (AUDIO.has(type)) c.au++;

  const t = typeof v.t === 'number' && Number.isFinite(v.t) ? v.t : null;
  if (t) {
    if (!c.first || t < c.first) c.first = t;
    if (!c.last || t > c.last) c.last = t;
  }
});

const day = (epoch) => (epoch ? new Date(epoch * 1000).toISOString().slice(0, 10) : '');
const chats = [];
for (const [jid, c] of tally) {
  const isGroup = jid.endsWith('@g.us');
  const group = groups.get(jid);
  const name = chatMeta.get(jid) || group?.subject || contacts.get(jid) || null;
  chats.push({
    id: jid,
    n: name || (isGroup ? 'Unnamed group' : jid.split('@')[0]),
    k: isGroup ? 'group' : 'direct',
    u: name ? 0 : 1,          // no saved contact behind this number
    m: c.m,
    e: c.m,                   // bodies are sealed in a recovered dump
    md: c.md,
    au: c.au,
    cl: c.cl,
    f: day(c.first),
    l: day(c.last),
    sz: isGroup ? (group?.size ?? 0) : 0,
  });
}
chats.sort((a, b) => b.m - a.m || a.n.localeCompare(b.n));

const totals = { chats: chats.length, groups: 0, direct: 0, msgs: 0, media: 0, audio: 0, calls: 0, enc: 0, undated: 0, unresolved: 0 };
for (const c of chats) {
  c.k === 'group' ? totals.groups++ : totals.direct++;
  totals.msgs += c.m; totals.media += c.md; totals.audio += c.au;
  totals.calls += c.cl; totals.enc += c.e;
  if (!c.f || !c.l) totals.undated++;
  if (c.u) totals.unresolved++;
}

fs.writeFileSync(out, JSON.stringify({ totals, chats }));
console.log(`\nkeyed ${keyed} messages, ${unkeyable} unkeyable`);
console.log(JSON.stringify(totals, null, 2));
console.log(`\nwrote ${out} (${chats.length} chats) — real names, keep it out of git`);
