// Parser for WhatsApp's "Export chat" .txt, in the "Attach media" form.
//
// This is the clean-text (and, crucially, the real-media) source. The audit of
// the capture tooling found every other path either structurally unable to
// recover message bodies (LevelDB regex, wa-build-inventory's sealed dump) or
// unable to move media bytes (DOM scrapers drop media; wa_media_push joins the
// wrong key namespace). WhatsApp's own export is the only artifact that carries
// both the text and the files, in a documented, stable format.
//
// The line/date/kind logic here is ported from the device-side importer
// Devices/S24/wa_export_import.py (which is byte-pinned in its installer bundle
// and must not be edited — installer-pins.test.mjs enforces that). This module
// is the host-side equivalent, and it adds the one thing that script cannot do:
// it reads the "FILE (file attached)" / "<attached: FILE>" markers that a WITH
// MEDIA export writes and turns each into an attachment record keyed to its
// message, so Database/scripts/wa-export-import.mjs can upload the bytes and
// feed Integrations/wa-store.js's upsertAttachments.
//
// Pure: no filesystem, no network, no ambient clock. The caller supplies the
// chat text and the list of filenames present in the export, and gets back the
// exact { chat, messages, attachments } shapes wa-store.js normalizes — so the
// test can prove the output ingests cleanly without a database.
import crypto from 'node:crypto';

// WhatsApp writes the exporting phone's LOCAL wall-clock with no offset, so the
// zone has to be supplied to recover UTC. +05:30 (the S24's zone) is the
// default, matching wa_export_import.py; a US-locale export needs dayFirst:false
// as well. These are the two locale assumptions the audit flagged as the only
// real limitation of the otherwise-correct device parser.
const DEFAULT_TZ_OFFSET = '+05:30';

// One message line, with a "sender:". Mirrors _LINE_MODERN in the python:
//   [16/06/24, 3:45:12 PM] John Doe: Hello
//   16/06/24, 3:45 PM - John Doe: Hello
const LINE_MODERN = /^\[?(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\]?\s*[-–]?\s*([^:]{1,120}?):\s*(.*)$/;
// A timestamped record with no "sender:" — "Messages and calls are end-to-end
// encrypted", group creation, joins/leaves. _LINE_MODERN needs a sender, so
// without this these were glued onto the previous body or dropped.
const LINE_SYSTEM = /^\[?(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\]?\s*[-–]?\s*(.*)$/;

// In-body markers WhatsApp writes for non-text messages when media is NOT
// attached (export "Without Media"). Map them to the message kind so the chat
// counts are right even when the bytes are absent.
const KIND_MARKERS = [
  [/<Media omitted>/i, 'media'],
  [/image omitted/i, 'media'],
  [/video omitted/i, 'media'],
  [/GIF omitted/i, 'media'],
  [/sticker omitted/i, 'media'],
  [/document omitted/i, 'media'],
  [/audio omitted/i, 'audio'],
  [/voice message omitted/i, 'audio'],
  [/missed voice call/i, 'call'],
  [/missed video call/i, 'call'],
  [/video call/i, 'call'],
  [/voice call/i, 'call'],
];

// The two forms a WITH MEDIA export uses to reference a bundled file:
//   Android:  IMG-20240616-WA0001.jpg (file attached)
//   iOS:      <attached: 00000042-PHOTO-2024-06-16-15-45-12.jpg>
// The invisible LRM (U+200E) WhatsApp prefixes these with is stripped first.
const IOS_ATTACH = /<attached:\s*([^>]+?)>/i;
const ANDROID_ATTACH = /^(.+?\.[A-Za-z0-9]{2,5})\s*\((?:file attached|attached)\)$/i;

const EXT_KIND = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', bmp: 'image', heic: 'image', webp: 'image',
  mp4: 'video', mov: 'video', '3gp': 'video', mkv: 'video', avi: 'video', webm: 'video',
  opus: 'audio', ogg: 'audio', m4a: 'audio', mp3: 'audio', aac: 'audio', amr: 'audio', wav: 'audio',
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document', xlsx: 'document',
  ppt: 'document', pptx: 'document', txt: 'document', csv: 'document', rtf: 'document',
  zip: 'document', apk: 'document', vcf: 'document',
};

const EXT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  mp4: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp', mkv: 'video/x-matroska', webm: 'video/webm',
  opus: 'audio/ogg', ogg: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', aac: 'audio/aac', amr: 'audio/amr', wav: 'audio/wav',
  pdf: 'application/pdf', vcf: 'text/vcard', txt: 'text/plain', csv: 'text/csv',
  zip: 'application/zip', apk: 'application/vnd.android.package-archive',
};

const extOf = (name) => {
  const m = /\.([A-Za-z0-9]{1,6})$/.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
};

/** Attachment kind (an ATT_KINDS value in wa-store.js), inferred from the filename. */
export function kindForFile(name) {
  const base = String(name || '').trim().replace(/^.*[/\\]/, '');
  if (/^stk[-_]/i.test(base) || /sticker/i.test(base)) return 'sticker';
  if (/^ptt[-_]/i.test(base)) return 'ptt';
  return EXT_KIND[extOf(base)] || 'other';
}

/** Best-effort mime for the uploaded bytes; null when unknown (wa-store tolerates null). */
export function mimeForFile(name) {
  return EXT_MIME[extOf(name)] || null;
}

// The message kind (an MSG_KINDS value) that an attachment of this file kind
// implies. image/video/document/sticker are all "media"; voice/audio is "audio".
function msgKindForAttachment(attKind) {
  return attKind === 'audio' || attKind === 'ptt' ? 'audio' : 'media';
}

/** '+05:30' -> offset in minutes east of UTC. Throws on a malformed value. */
export function tzOffsetMinutes(text) {
  const m = /^([+-])(\d{1,2}):?(\d{2})$/.exec(String(text == null ? '' : text).trim());
  if (!m) throw new Error(`bad tz offset ${JSON.stringify(text)}; expected a form like +05:30`);
  const sign = m[1] === '+' ? 1 : -1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * ISO 8601 UTC for one export date+time, or null if it cannot be parsed.
 * `dayFirst` selects DD/MM vs MM/DD; `tzMinutes` is the zone the wall-clock is
 * written in. An impossible civil date (31/02) returns null rather than letting
 * Date.UTC silently roll it into the next month.
 */
export function parseDateTime(dateS, timeS, { dayFirst = true, tzMinutes = 330 } = {}) {
  const ds = String(dateS).trim().replace(/-/g, '/');
  const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(ds);
  if (!dm) return null;
  const a = +dm[1], b = +dm[2];
  let y = +dm[3];
  if (y < 100) y += 2000;
  const day = dayFirst ? a : b;
  const mon = dayFirst ? b : a;

  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/.exec(String(timeS).trim());
  if (!tm) return null;
  let hr = +tm[1];
  const mi = +tm[2], se = +(tm[3] || 0);
  const ap = tm[4] ? tm[4].toUpperCase() : null;
  if (ap === 'PM' && hr !== 12) hr += 12;
  else if (ap === 'AM' && hr === 12) hr = 0;

  const utcMs = Date.UTC(y, mon - 1, day, hr, mi, se) - tzMinutes * 60000;
  const dt = new Date(utcMs);
  if (Number.isNaN(dt.getTime())) return null;
  // Round-trip the civil fields back through the same offset to reject overflow
  // (Date.UTC turns 2024-02-31 into 2024-03-02 without complaint).
  const civil = new Date(utcMs + tzMinutes * 60000);
  if (civil.getUTCFullYear() !== y || civil.getUTCMonth() !== mon - 1 || civil.getUTCDate() !== day) return null;
  return dt.toISOString();
}

function guessKind(body) {
  for (const [pat, kind] of KIND_MARKERS) if (pat.test(body || '')) return kind;
  return 'text';
}

// A WITH MEDIA message whose body is "FILE (file attached)" / "<attached: FILE>"
// plus an optional caption. Returns { file, caption } or null.
function extractAttachment(body) {
  const ios = IOS_ATTACH.exec(body);
  if (ios) {
    const file = ios[1].trim();
    const caption = body.replace(ios[0], '').replace(/‎/g, '').trim();
    return { file, caption };
  }
  const lines = body.split('\n');
  const first = lines[0].replace(/‎/g, '').trim();
  const and = ANDROID_ATTACH.exec(first);
  if (and) return { file: and[1].trim(), caption: lines.slice(1).join('\n').trim() };
  return null;
}

/** Group vs direct from the jid, unless the caller overrides it. */
export function kindForChatId(chatId, override) {
  if (override === 'group' || override === 'direct') return override;
  return String(chatId || '').endsWith('@g.us') ? 'group' : 'direct';
}

/**
 * Parse one exported chat.
 *
 * @param {string} text        the _chat.txt contents
 * @param {object} opts
 *   chatId     the WhatsApp jid this file belongs to (required; keys every row)
 *   name       display name for the chat inventory row
 *   kind       'group' | 'direct' (derived from chatId when omitted)
 *   meAliases  your display name(s) in the export, to set from_me
 *   dayFirst   DD/MM (true, default) vs MM/DD
 *   tzOffset   '+05:30' etc. — the zone the export wall-clock is written in
 * @returns { chat, messages, attachments } in wa-store.js's accepted shapes.
 *   attachments carry file_name but NOT blob_url — the runner fills that after
 *   uploading the bytes, because wa-store rejects an attachment with no blob_url.
 */
export function parseExport(text, opts = {}) {
  const chatId = String(opts.chatId || '').trim();
  if (!chatId) throw new Error('parseExport: chatId (the WhatsApp jid) is required');
  const name = String(opts.name || chatId);
  const kind = kindForChatId(chatId, opts.kind);
  const meAliases = new Set((opts.meAliases || []).map((s) => String(s).trim()).filter(Boolean));
  const dayFirst = opts.dayFirst !== false;
  const tzMinutes = tzOffsetMinutes(opts.tzOffset || DEFAULT_TZ_OFFSET);

  const messages = [];
  const attachments = [];
  const seen = new Map();
  let current = null;

  const finalize = (msg) => {
    // Key from CONTENT, not the file path — so importing the same export twice
    // (relative path, then cron's absolute path) writes the same msg_id and
    // upserts instead of duplicating. The #n counter keeps genuinely identical
    // repeated lines distinct. (Same scheme as wa_export_import.py.)
    const base = `${msg.sent_at || ''}|${msg.sender || ''}|${msg.body}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const key = 'exp:' + crypto.createHash('sha1').update(`${base}#${n}`).digest('hex').slice(0, 16);

    const att = msg.kind === 'system' ? null : extractAttachment(msg.body);
    if (att && att.file) {
      const attKind = kindForFile(att.file);
      messages.push({
        chat_id: chatId, id: key, sent_at: msg.sent_at, from_me: msg.from_me,
        sender: msg.sender, kind: msgKindForAttachment(attKind), body: att.caption,
      });
      attachments.push({
        chat_id: chatId, msg_id: `${chatId}:${key}`, kind: attKind,
        mime: mimeForFile(att.file), file_name: att.file, sent_at: msg.sent_at,
      });
    } else {
      messages.push({
        chat_id: chatId, id: key, sent_at: msg.sent_at, from_me: msg.from_me,
        sender: msg.sender, kind: msg.kind, body: msg.body,
      });
    }
  };

  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '').replace(/^﻿/, '');
    const m = LINE_MODERN.exec(line);
    const sysm = m ? null : LINE_SYSTEM.exec(line);
    if (m || sysm) {
      if (current) finalize(current);
      const g = m || sysm;
      const sentAt = parseDateTime(g[1], g[2], { dayFirst, tzMinutes });
      const sender = m ? m[3].trim() : null;
      const body = m ? m[4] : sysm[3];
      current = {
        sent_at: sentAt,
        sender,
        from_me: m && meAliases.size ? meAliases.has(sender) : null,
        kind: m ? guessKind(body) : 'system',
        body,
      };
    } else if (current) {
      // Continuation line, kept verbatim (blank lines included) — stripping or
      // skipping them reflows multi-line messages.
      current.body = current.body + '\n' + line;
    }
  }
  if (current) finalize(current);

  let media = 0, audio = 0, calls = 0, first = null, last = null;
  for (const msg of messages) {
    if (msg.kind === 'media') media++;
    else if (msg.kind === 'audio') audio++;
    else if (msg.kind === 'call') calls++;
    if (msg.sent_at) {
      const d = msg.sent_at.slice(0, 10);
      if (!first || d < first) first = d;
      if (!last || d > last) last = d;
    }
  }

  const chat = {
    id: chatId, name, kind,
    messages: messages.length, media, audio, calls,
    first, last,
  };
  return { chat, messages, attachments };
}
