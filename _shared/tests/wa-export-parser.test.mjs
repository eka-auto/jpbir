// The WhatsApp "Export chat (Attach media)" parser is the only capture path
// that recovers real message bodies AND real media bytes (see the capture
// audit). These tests pin the two things that path got wrong before:
//   - media markers ("FILE (file attached)" / "<attached: FILE>") must become
//     attachment rows keyed to their message, not be dropped like the DOM
//     scrapers did and not stay count-only like the recovery dump did;
//   - the parser's output must ingest cleanly through the REAL wa-store.js
//     normalizers, so a green test here means a real import would land rows —
//     without a database.
import assert from 'node:assert/strict';
import {
  parseExport, parseDateTime, kindForFile, tzOffsetMinutes,
} from '../../Database/lib/wa-export-parser.mjs';
import {
  normalizeMessage, normalizeChat, normalizeAttachment,
  attachmentSkipReason, isReadableMessageBody,
} from '../../Integrations/wa-store.js';

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const GID = '120363047062981104@g.us';
const DID = '919254228280@c.us';

const SAMPLE = [
  '[16/06/24, 3:45:12 PM] John Doe: Hello there',
  '[16/06/24, 3:46:00 PM] Me: Hi!',
  'This is a second line',
  '[16/06/24, 3:47:00 PM] John Doe: IMG-20240616-WA0001.jpg (file attached)',
  'Nice photo',
  '[16/06/24, 3:48:00 PM] John Doe: <attached: PTT-20240616-WA0002.opus>',
  '[16/06/24, 3:49:00 PM] John Doe: <Media omitted>',
  '[16/06/24, 3:50:00 PM] Messages and calls are end-to-end encrypted.',
].join('\n');

const parsed = parseExport(SAMPLE, { chatId: DID, name: 'John Doe', meAliases: ['Me'] });

t('a modern bracketed line yields one message with sender and body', () => {
  assert.equal(parsed.messages[0].sender, 'John Doe');
  assert.equal(parsed.messages[0].body, 'Hello there');
  assert.equal(parsed.messages[0].kind, 'text');
  assert.equal(parsed.messages[0].from_me, false);
});

t('the exporter\'s own alias sets from_me true', () => {
  assert.equal(parsed.messages[1].sender, 'Me');
  assert.equal(parsed.messages[1].from_me, true);
});

t('continuation lines attach to the previous body verbatim', () => {
  assert.equal(parsed.messages[1].body, 'Hi!\nThis is a second line');
});

t('an Android "(file attached)" marker becomes a media message plus an image attachment, caption preserved', () => {
  const m = parsed.messages[2];
  assert.equal(m.kind, 'media');
  assert.equal(m.body, 'Nice photo');
  const a = parsed.attachments.find((x) => x.file_name === 'IMG-20240616-WA0001.jpg');
  assert.ok(a, 'image attachment emitted');
  assert.equal(a.kind, 'image');
  assert.equal(a.mime, 'image/jpeg');
  assert.equal(a.msg_id, `${DID}:${m.id}`);
});

t('an iOS "<attached: PTT-….opus>" becomes an audio message plus a ptt attachment', () => {
  const m = parsed.messages[3];
  assert.equal(m.kind, 'audio');
  const a = parsed.attachments.find((x) => x.file_name === 'PTT-20240616-WA0002.opus');
  assert.ok(a, 'ptt attachment emitted');
  assert.equal(a.kind, 'ptt');
  assert.equal(a.msg_id, `${DID}:${m.id}`);
});

t('a "<Media omitted>" line is media kind with no attachment (no bytes to upload)', () => {
  const m = parsed.messages[4];
  assert.equal(m.kind, 'media');
  assert.equal(parsed.attachments.some((a) => a.msg_id === `${DID}:${m.id}`), false);
});

t('a timestamped line with no "sender:" is a system record, not glued to the prior message', () => {
  const m = parsed.messages[5];
  assert.equal(m.kind, 'system');
  assert.equal(m.sender, null);
  assert.match(m.body, /end-to-end encrypted/);
});

t('the chat inventory counts media, audio and the date range', () => {
  assert.equal(parsed.chat.messages, 6);
  assert.equal(parsed.chat.media, 2);   // the (file attached) image and the <Media omitted>
  assert.equal(parsed.chat.audio, 1);   // the voice note
  assert.equal(parsed.chat.first, '2024-06-16');
  assert.equal(parsed.chat.last, '2024-06-16');
});

t('the dashed "DD/MM/YY, H:MM PM - Sender:" form parses too', () => {
  const p = parseExport('16/06/24, 3:45 PM - John Doe: Hello', { chatId: DID });
  assert.equal(p.messages.length, 1);
  assert.equal(p.messages[0].body, 'Hello');
  assert.equal(p.messages[0].sender, 'John Doe');
});

t('IST wall-clock is converted to UTC (15:45:12 +05:30 -> 10:15:12Z)', () => {
  assert.equal(parsed.messages[0].sent_at, '2024-06-16T10:15:12.000Z');
});

t('dayFirst vs monthFirst swaps the month and day', () => {
  // Midday so the +05:30 offset does not carry the UTC date across midnight.
  const d = parseExport('05/06/24, 1:00 PM - A: x', { chatId: DID });                 // 5 June
  const mth = parseExport('05/06/24, 1:00 PM - A: x', { chatId: DID, dayFirst: false }); // 6 May
  assert.equal(d.messages[0].sent_at.slice(0, 10), '2024-06-05');
  assert.equal(mth.messages[0].sent_at.slice(0, 10), '2024-05-06');
});

t('an impossible civil date (31/02) is rejected rather than rolled forward', () => {
  assert.equal(parseDateTime('31/02/24', '1:00 PM'), null);
});

t('tzOffsetMinutes parses +05:30 and rejects garbage', () => {
  assert.equal(tzOffsetMinutes('+05:30'), 330);
  assert.equal(tzOffsetMinutes('-08:00'), -480);
  assert.throws(() => tzOffsetMinutes('nope'));
});

t('kindForFile maps extensions and WhatsApp name prefixes', () => {
  assert.equal(kindForFile('IMG-20240101-WA0001.jpg'), 'image');
  assert.equal(kindForFile('VID-x.mp4'), 'video');
  assert.equal(kindForFile('PTT-x.opus'), 'ptt');
  assert.equal(kindForFile('AUD-x.m4a'), 'audio');
  assert.equal(kindForFile('STK-x.webp'), 'sticker');
  assert.equal(kindForFile('invoice.pdf'), 'document');
  assert.equal(kindForFile('mystery.xyz'), 'other');
});

t('re-parsing the same export is deterministic, and two identical lines get distinct keys', () => {
  const again = parseExport(SAMPLE, { chatId: DID, name: 'John Doe', meAliases: ['Me'] });
  assert.deepEqual(again.messages.map((m) => m.id), parsed.messages.map((m) => m.id));
  const dupes = parseExport([
    '[16/06/24, 3:45:00 PM] A: dup',
    '[16/06/24, 3:45:00 PM] A: dup',
  ].join('\n'), { chatId: DID });
  assert.notEqual(dupes.messages[0].id, dupes.messages[1].id);
});

// The point of the whole exercise: what the parser emits must survive the real
// wa-store.js normalizers, or the import would silently drop rows.
t('every parsed message normalizes to a keyed, readable wa_messages row', () => {
  for (const m of parsed.messages) {
    const row = normalizeMessage(m, DID);
    assert.ok(row, 'message normalized');
    assert.equal(row.msg_id, `${DID}:${m.id}`);
    assert.equal(row.chat_id, DID);
  }
  assert.equal(isReadableMessageBody(normalizeMessage(parsed.messages[0], DID)), true);
});

t('a parsed attachment is rejected until it carries a blob_url, then normalizes to a wa_attachments row', () => {
  const a = parsed.attachments[0];
  assert.equal(attachmentSkipReason(a), 'missing-blob-url');     // the load-bearing guard
  const withBlob = { ...a, blob_url: 'https://example.blob.vercel-storage.com/x' };
  assert.equal(attachmentSkipReason(withBlob), null);
  const row = normalizeAttachment(withBlob);
  assert.ok(row);
  assert.equal(row.chat_id, DID);
  assert.equal(row.msg_id, a.msg_id);
});

t('the chat inventory record normalizes to a wa_chats row', () => {
  const c = normalizeChat(parsed.chat);
  assert.ok(c);
  assert.equal(c.chat_id, DID);
  assert.equal(c.kind, 'direct');
  assert.equal(c.msg_count, 6);
  assert.equal(c.media_count, 2);
  // a group jid is classified as a group
  assert.equal(normalizeChat(parseExport('16/06/24, 1:00 PM - A: x', { chatId: GID, name: 'Fam' }).chat).kind, 'group');
});

console.log(`\n${pass}/${total} checks passed`);
