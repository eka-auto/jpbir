// The WhatsApp inventory path, end to end, without a database: shape
// normalisation, the chunked upserts (against a query stub that records the
// SQL), the galaxy payload in both name modes, and the read handler's guards.
// Run: node _shared/tests/wa-store.test.mjs
//
// NOTE ON 503 vs 500: an unconfigured deployment answers 503, not 500.
// Backend/_auth.js has always drawn that line for STATS_KEY -- 503 for "this
// server was never set up", 401 for "wrong key" -- so an operator can tell the
// two apart instead of hunting for a bug in the browser. The store-backed
// handlers used 500 for the same condition, splitting the behaviour for no
// reason: Frontend/db.html keys its gate off 401/503, so a 500 from db-api left
// the page stuck. All 21 such responses moved to 503; these assertions moved
// with them.
import {
  normalizeChat, normalizeMessage, normalizeSender, whatsappAddress, messageSenderLabel, displayMessageBody,
  isReadableMessageBody,
  chatIdFor, assignChatIds, idlessChats, upsertChats, upsertMessages, ingestBatch,
  normalizeAttachment, attachmentSkipReason, upsertAttachments,
  galaxyPayload, redactChats, toCompact, CHUNK,
} from '../../Integrations/wa-store.js';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- normalizeChat ---------- */
const compact = { n: 'Test 001', k: 'direct', u: 0, m: 1813, e: 1769, md: 63, au: 112, cl: 93, f: '2025-10-28', l: '2026-02-23', sz: 0 };
const c1 = normalizeChat(compact);
check('compact chat normalises', c1 && c1.name === 'Test 001' && c1.kind === 'direct' && c1.msg_count === 1813
  && c1.enc_count === 1769 && c1.media_count === 63 && c1.audio_count === 112 && c1.call_count === 93
  && c1.first_at === '2025-10-28' && c1.last_at === '2026-02-23' && c1.member_count === 0 && c1.unresolved === false,
  JSON.stringify(c1));

const verbose = { id: 'g1@g.us', name: 'Test Group', kind: 'g', unresolved: true, messages: 10, encrypted: 12, media: 2, audio: 1, calls: 0, first: '2024-01-01T10:00:00Z', last: '', size: 7 };
const c2 = normalizeChat(verbose);
check('verbose chat normalises, short kind expands', c2 && c2.kind === 'group' && c2.member_count === 7 && c2.unresolved === true, JSON.stringify(c2));
check('explicit id is kept', c2 && c2.chat_id === 'g1@g.us', c2 && c2.chat_id);
check('enc_count is capped at msg_count', c2 && c2.enc_count === 10, c2 && String(c2.enc_count));
check('undated last stays null', c2 && c2.last_at === null && c2.first_at === '2024-01-01', JSON.stringify(c2));
check('hash id is stable and shape-independent', chatIdFor({ n: 'X', k: 'd' }) === chatIdFor({ name: 'X', kind: 'direct' })
  && chatIdFor({ n: 'X', k: 'd' }) !== chatIdFor({ n: 'X', k: 'g' }), chatIdFor({ n: 'X', k: 'd' }));
check('unusable records return null', normalizeChat({ k: 'direct' }) === null && normalizeChat({ n: 'A', k: 'club' }) === null
  && normalizeChat(null) === null && normalizeChat('x') === null, 'expected null');
const c3 = normalizeChat({ n: 'Dates', k: 'd', m: 1, f: '2024-02-31', l: '2024-02-29' });
check('calendar-invalid date becomes null, a real leap day stays', c3 && c3.first_at === null && c3.last_at === '2024-02-29', JSON.stringify(c3));
const c4 = normalizeChat({ n: 'Dates', k: 'd', m: 1, f: '2023-02-29', l: '2025-13-01' });
check('non-leap Feb 29 and month 13 are rejected', c4 && c4.first_at === null && c4.last_at === null, JSON.stringify(c4));

/* ---------- assignChatIds: same name, different chats ---------- */
{
  const twins = [{ n: 'Family', k: 'g', m: 1 }, { n: 'Family', k: 'g', m: 2 }, { id: 'j1', n: 'Family', k: 'g', m: 3 }, { n: 'Family', k: 'd', m: 4 }];
  const ids = assignChatIds(twins).map(chatIdFor);
  check('same-name chats get distinct keys, the first one unchanged', new Set(ids).size === 4 && ids[0] === chatIdFor(twins[0]) && ids[2] === 'j1', ids.join(','));
  check('assignChatIds is deterministic and leaves the input alone', eq(assignChatIds(twins), assignChatIds(twins)) && !('id' in twins[0]), JSON.stringify(twins[0]));
  check('idlessChats lists the records the endpoint must refuse',
    eq(idlessChats([{ id: 'a' }, { n: 'B', k: 'd' }, null, { jid: 'j' }, { chat_id: 'c' }, { id: '', n: 'E', k: 'd' }]), [1, 5])
    && eq(idlessChats(assignChatIds(twins)), []) && eq(idlessChats(undefined), []), JSON.stringify(idlessChats([{ n: 'B', k: 'd' }])));
}

/* ---------- normalizeMessage ---------- */
const m1 = normalizeMessage({ id: 'ABC', ts: 1700000000, from_me: 1, text: 'hi', type: 'text' }, 'g1@g.us');
check('message normalises with epoch seconds', m1 && m1.msg_id === 'g1@g.us:ABC' && m1.sent_at === '2023-11-14T22:13:20.000Z'
  && m1.from_me === true && m1.body === 'hi' && m1.encrypted === false && m1.kind === 'text', JSON.stringify(m1));
const m2 = normalizeMessage({ chat: 'c9', key: 'K', timestamp: '2026-01-02T03:04:05Z', kind: 'voice' });
check('message without body is sealed, unknown kind -> other', m2 && m2.encrypted === true && m2.kind === 'other' && m2.chat_id === 'c9', JSON.stringify(m2));
check('message without key is dropped', normalizeMessage({ chat: 'c9', text: 'x' }) === null, 'expected null');
check('WhatsApp id objects become stable addresses', whatsappAddress({ user: '919999', server: 'c.us' }) === '919999@c.us'
  && whatsappAddress({ _serialized: '123@g.us' }) === '123@g.us', 'address object was not normalized');
check('object senders keep names or ids instead of JavaScript coercion', normalizeSender({ pushName: 'Alice', _serialized: '1@c.us' }) === 'Alice'
  && normalizeSender({ id: { user: '2', server: 'c.us' } }) === '2@c.us', 'sender object was not normalized');
check('legacy sender sentinels become null', ['[object Object]', '<Undefined>', 'undefined', 'null'].every((v) => normalizeSender(v) === null), 'sentinel leaked');
const m3 = normalizeMessage({ chat: 'c9', key: 'O', sender: { _serialized: '3@c.us' } }, 'c9');
check('message normalisation never stores object Object', m3 && m3.sender === '3@c.us', JSON.stringify(m3));
check('sender labels recover from direction and chat metadata', messageSenderLabel({ from_me: true }) === 'You'
  && messageSenderLabel({ kind: 'system' }) === 'System'
  && messageSenderLabel({ sender: '<Undefined>', chat_kind: 'direct', chat_name: 'Alice' }) === 'Alice'
  && messageSenderLabel({ sender: '[object Object]', chat_kind: 'group' }) === 'Unknown participant', 'bad sender label');
check('body display preserves real text and explains sealed metadata', displayMessageBody({ body: 'hello', encrypted: true }) === 'hello'
  && displayMessageBody({ body: '[Encrypted — export chat to read]', encrypted: true }).startsWith('Encrypted message')
  && displayMessageBody({ body: '[System message]', kind: 'system', encrypted: true }).startsWith('System event'), 'bad body display');
check('readability follows the stored body rather than the stale encrypted flag',
  isReadableMessageBody({ body: 'hello', encrypted: true })
  && !isReadableMessageBody({ body: '[Encrypted — export chat to read]', encrypted: false })
  && !isReadableMessageBody({ body: '   ', encrypted: false }),
  'readability must identify actual imported text');

/* ---------- upserts against a recording stub ---------- */
// rowCount mimics pg: every chat row is written; message rows can be filtered by the chat guard
function stub(messageRowCount = null) {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    const isMsg = /INSERT INTO wa_messages/.test(text);
    return { rows: [], rowCount: isMsg && messageRowCount !== null ? messageRowCount : (params && params[0] ? params[0].length : 0) };
  };
  return { calls, query };
}
{
  const s = stub();
  const many = Array.from({ length: CHUNK * 2 + 50 }, (_, i) => ({ n: `P ${i}`, k: i % 5 ? 'direct' : 'group', m: i, e: 0, md: 0, au: 0, cl: 0, f: '', l: '', sz: 0 }));
  const r = await upsertChats(s.query, [...many, { k: 'direct' }], { device: 'dev', runId: 'r1', source: 'test' });
  check('chats are chunked', s.calls.length === 3 && r.upserted === CHUNK * 2 + 50 && r.skipped === 1,
    `${s.calls.length} statements, ${JSON.stringify(r)}`);
  check('chunk carries parallel arrays', s.calls[0].params.length === 16 && s.calls[0].params.every((p) => p.length === CHUNK)
    && s.calls[2].params[0].length === 50, `lengths ${s.calls[0].params.map((p) => p.length).join(',')}`);
  check('chunk statement is an upsert on chat_id', /INSERT INTO wa_chats/.test(s.calls[0].text) && /ON CONFLICT \(chat_id\) DO UPDATE/.test(s.calls[0].text), s.calls[0].text.slice(0, 80));
  check('meta lands in every row', s.calls[0].params[12].every((d) => d === 'dev') && s.calls[0].params[13].every((x) => x === 'r1')
    && s.calls[0].params[14].every((x) => x === 'test'), 'device/run/source columns');
}
{
  // three messages sent, the store keeps one (two belong to a chat never ingested)
  const s = stub(1);
  const r = await upsertMessages(s.query, [
    { chat_id: 'g1@g.us', id: 'M1', text: 'x' }, { chat_id: 'ghost', id: 'M2', text: 'y' }, { chat_id: 'ghost', id: 'M3', text: 'z' },
  ], { runId: 'r1' });
  check('messages report what was stored, not what was sent', r.upserted === 1 && r.skipped === 0, JSON.stringify(r));
  check('a message whose chat was never ingested is orphaned, not silently lost',
    r.received === 3 && r.normalized === 3 && r.orphaned === 2, JSON.stringify(r));
  check('message statement is guarded by the chat existing', /WHERE EXISTS \(SELECT 1 FROM wa_chats/.test(s.calls[0].text), s.calls[0].text.slice(0, 120));
  // The recovery dump is re-sent on every S24 sync with no text, so each record
  // arrives as the encrypted placeholder. With `body = COALESCE(EXCLUDED.body, ...)`
  // that placeholder replaced the text a chat export had imported. The statement
  // must let a placeholder or NULL fill only an empty row, and keep `encrypted`
  // with whichever body survives.
  const sql = s.calls[0].text.replace(/\s+/g, ' ');
  check('a placeholder re-sent by the recovery dump never overwrites an imported message body',
    !/body = COALESCE\(EXCLUDED\.body, wa_messages\.body\)/.test(sql)
    && /body = CASE WHEN EXCLUDED\.body IS NULL OR EXCLUDED\.body = '\[Encrypted — export chat to read\]' THEN COALESCE\(wa_messages\.body, EXCLUDED\.body\) ELSE EXCLUDED\.body END/.test(sql)
    && /encrypted = CASE WHEN \(EXCLUDED\.body IS NULL OR EXCLUDED\.body = '\[Encrypted — export chat to read\]'\) AND wa_messages\.body IS NOT NULL AND wa_messages\.body <> '\[Encrypted — export chat to read\]' THEN wa_messages\.encrypted ELSE EXCLUDED\.encrypted END/.test(sql)
    && s.calls[0].params.length === 12,
    sql.slice(sql.indexOf('ON CONFLICT'), sql.indexOf('ON CONFLICT') + 600));
}
{
  // two id-less "Family" groups plus the same explicit id twice: one statement, three distinct keys
  const s = stub();
  const r = await upsertChats(s.query, [
    { n: 'Family', k: 'g', m: 1 }, { n: 'Family', k: 'g', m: 2 },
    { id: 'j1', n: 'Old', k: 'd', m: 5 }, { id: 'j1', n: 'New', k: 'd', m: 7 },
  ], { runId: 'r1' });
  const ids = s.calls[0].params[0];
  check('one statement never carries the same chat_id twice', s.calls.length === 1 && ids.length === 3 && new Set(ids).size === 3
    && r.upserted === 3 && r.duplicates === 1 && r.skipped === 0, `${JSON.stringify(ids)} ${JSON.stringify(r)}`);
  check('a repeated explicit id keeps the last record', s.calls[0].params[1][2] === 'New' && s.calls[0].params[4][2] === 7, JSON.stringify(s.calls[0].params[1]));
  const sm = stub();
  const rm = await upsertMessages(sm.query, [{ chat_id: 'j1', id: 'M', text: 'a' }, { chat_id: 'j1', id: 'M', text: 'b' }], { runId: 'r1' });
  check('a repeated message key collapses to one row, last body wins', sm.calls[0].params[0].length === 1 && sm.calls[0].params[7][0] === 'b'
    && rm.upserted === 1 && rm.duplicates === 1, JSON.stringify(rm));
}
{
  const s = stub();
  const r = await ingestBatch(s.query, {
    device: 'samsung-s24-ultra', run_id: 'run9', done: true,
    chats: [compact, verbose],
    messages: [{ chat_id: 'g1@g.us', id: 'M1', ts: 1700000000, text: 'x' }, { nope: true }],
  }, { source: 'wa-ingest' });
  const kinds = s.calls.map((c) => (/INSERT INTO wa_chats/.test(c.text) ? 'chats' : /INSERT INTO wa_messages/.test(c.text) ? 'messages' : /INSERT INTO wa_sync_runs/.test(c.text) ? 'run' : '?'));
  check('ingestBatch writes chats, messages, then the run', eq(kinds, ['chats', 'messages', 'run']), kinds.join(','));
  check('ingestBatch reports counts and closes the run', r.run_id === 'run9' && r.device === 'samsung-s24-ultra' && r.chats.upserted === 2
    && r.messages.upserted === 1 && r.messages.skipped === 1 && r.done === true, JSON.stringify(r));
  const run = s.calls[2];
  check('run row marks done with a finish time', run.params[2] === 'done' && typeof run.params[4] === 'string', JSON.stringify(run.params));
  check('run tallies are recomputed from rows, not added per batch',
    /\(SELECT COUNT\(\*\)::int FROM wa_chats\s+WHERE run_id = \$1\)/.test(run.text)
    && /\(SELECT COUNT\(\*\)::int FROM wa_messages\s+WHERE run_id = \$1\)/.test(run.text)
    && /\(SELECT COUNT\(\*\)::int FROM wa_attachments\s+WHERE run_id = \$1\)/.test(run.text)
    && !/wa_sync_runs\.chats_seen \+/.test(run.text) && run.params.length === 6, run.text.replace(/\s+/g, ' ').slice(0, 360));
  check('attachments_skipped rides as the last param so status/finish keep their positions',
    run.params[2] === 'done' && typeof run.params[4] === 'string' && run.params[5] === 0,
    JSON.stringify(run.params));
  const s2 = stub();
  const r2 = await ingestBatch(s2.query, {}, {});
  check('empty batch still records a run with a unique id', s2.calls.length === 1 && /^run_[0-9a-f-]{36}$/.test(r2.run_id) && r2.done === false, JSON.stringify(r2));
  const r3 = await ingestBatch(stub().query, {}, {});
  check('two id-less batches get different runs', r2.run_id !== r3.run_id, `${r2.run_id} vs ${r3.run_id}`);

  // A real S24 chat-export whose chat_id matches no ingested chat: every line is
  // dropped by the FK guard. That used to vanish; now it rides in the run note
  // (and the note stays the last-but-one param, so attachments_skipped is last).
  const so = stub(0);
  const ro = await ingestBatch(so.query, {
    run_id: 'rx', messages: [{ chat_id: 'ghost@c.us', id: 'M1', text: 'hi' }, { chat_id: 'ghost@c.us', id: 'M2', text: 'yo' }],
  }, {});
  const runo = so.calls[so.calls.length - 1];
  check('an orphaned chat-export is reported in the run note, not silently dropped',
    ro.messages.orphaned === 2 && runo.params.length === 6 && /2 messages dropped: chat_id not in wa_chats/.test(runo.params[3] || ''),
    JSON.stringify({ messages: ro.messages, note: runo.params[3], len: runo.params.length }));
}

/* ---------- attachment path (normalizeAttachment / upsertAttachments) ----------
   Entirely untested until now while wa_attachments backs two deployed routes,
   and every rejection was a silent `return null`. Pin that a bad record is
   rejected WITH a reason and COUNTED, never dropped in silence. */
{
  check('attachmentSkipReason names each reason and passes a valid record',
    attachmentSkipReason(null) === 'not-an-object'
    && attachmentSkipReason({ blob_url: 'https://b/x', kind: 'image' }) === 'missing-chat-id'
    && attachmentSkipReason({ chat_id: 'c1', kind: 'image' }) === 'missing-blob-url'
    && attachmentSkipReason({ chat_id: 'c1', blob_url: 'https://b/x', kind: 'nope' }) === 'unknown-kind'
    && attachmentSkipReason({ chat_id: 'c1', blob_url: 'https://b/x', kind: 'image' }) === null,
    'reason classifier changed');

  check('normalizeAttachment drops a record with no blob_url (bytes must be in Blob first)',
    normalizeAttachment({ chat_id: 'c1', kind: 'image' }) === null
    && normalizeAttachment({ chat_id: 'c1', blob_url: 'https://b/x', kind: 'image' }) !== null,
    'missing blob_url must reject');

  // The exact failure mode found in production: the producer sends media
  // metadata but never uploaded the bytes, so every record lacks blob_url.
  // Nothing lands — and it is all COUNTED, with reasons, not vanished.
  const s = stub();
  const noBlob = await upsertAttachments(s.query, [
    { chat_id: 'c1', kind: 'image' }, { chat_id: 'c2', kind: 'video' }, null,
  ], { runId: 'r1' });
  check('a run that drops every attachment reports it, does not look perfect',
    noBlob.received === 3 && noBlob.upserted === 0 && noBlob.skipped === 3
    && noBlob.skippedReasons['missing-blob-url'] === 2 && noBlob.skippedReasons['not-an-object'] === 1
    && s.calls.length === 0,
    JSON.stringify(noBlob));

  // Valid records, but the chat-exists guard (stubbed to keep one) filters the
  // other: it is orphaned, surfaced rather than lost between normalized/upserted.
  const orphanStub = (() => {
    const calls = [];
    const query = async (text, params) => { calls.push({ text, params }); return { rows: [], rowCount: 1 }; };
    return { calls, query };
  })();
  const twoValid = await upsertAttachments(orphanStub.query, [
    { chat_id: 'c1', blob_url: 'https://b/1', kind: 'image', msg_id: 'm1' },
    { chat_id: 'ghost', blob_url: 'https://b/2', kind: 'video', msg_id: 'm2' },
  ], { runId: 'r1' });
  check('an attachment whose chat was never ingested is orphaned, not silently lost',
    twoValid.received === 2 && twoValid.normalized === 2 && twoValid.upserted === 1
    && twoValid.orphaned === 1 && twoValid.skipped === 0,
    JSON.stringify(twoValid));

  // ingestBatch runs the attachment upsert and carries its skip tally to the run.
  const bs = stub();
  const rb = await ingestBatch(bs.query, {
    run_id: 'runA', chats: [], messages: [],
    attachments: [{ chat_id: 'c1', kind: 'image' }, { chat_id: 'c2', blob_url: 'https://b/2', kind: 'video' }],
  }, {});
  const attCall = bs.calls.find((c) => /INSERT INTO wa_attachments/.test(c.text));
  const runCall = bs.calls.find((c) => /INSERT INTO wa_sync_runs/.test(c.text));
  check('ingestBatch runs the attachment upsert and carries its tally to the run',
    Boolean(attCall) && Boolean(runCall)
    && rb.attachments.skipped === 1 && rb.attachments.upserted === 1
    && runCall.params[5] === 1,   // attachments_skipped = 1 rejected + 0 orphaned
    `${JSON.stringify(rb.attachments)} runParam5=${runCall && runCall.params[5]}`);
}

/* ---------- galaxy payload ---------- */
{
  const rows = [
    { chat_id: '919999999999@s.whatsapp.net', name: 'A', kind: 'direct', unresolved: false, msg_count: 10, enc_count: 4, media_count: 1, audio_count: 2, call_count: 3, member_count: null, first_at: '2025-01-01', last_at: '2025-02-01' },
    { chat_id: 'b', name: 'B', kind: 'group', unresolved: true, msg_count: 5, enc_count: 5, media_count: 0, audio_count: 0, call_count: 0, member_count: 9, first_at: null, last_at: null },
    { chat_id: 'c', name: 'C', kind: 'direct', unresolved: false, msg_count: 1, enc_count: 0, media_count: 0, audio_count: 0, call_count: 0, member_count: null, first_at: '2025-03-01', last_at: '2025-03-01' },
  ];
  const full = galaxyPayload(rows, { generatedAt: '2026-09-13T00:00:00Z' });
  check('payload shape matches cards_data.json', eq(Object.keys(full), ['totals', 'sample', 'names', 'source', 'generated_at', 'chats'])
    && full.sample === false && full.names === 'full', Object.keys(full).join(','));
  check('totals add up', eq(full.totals, { chats: 3, groups: 1, direct: 2, msgs: 16, media: 1, audio: 2, calls: 3, enc: 9, undated: 1 }), JSON.stringify(full.totals));
  check('compact row keeps the page fields and no jid',
    eq(toCompact(rows[1]), { h: toCompact(rows[1]).h, n: 'B', k: 'group', u: 1, m: 5, e: 5, md: 0, au: 0, cl: 0, f: '', l: '', sz: 9 })
    && !('id' in toCompact(rows[0])) && !('chat_id' in toCompact(rows[0])), JSON.stringify(toCompact(rows[1])));
  // The handle addresses one chat for the drill-down without shipping its jid.
  check('handle is opaque, stable and distinct per chat',
    /^[0-9a-f]{16}$/.test(toCompact(rows[0]).h)
    && toCompact(rows[0]).h === toCompact(rows[0]).h
    && toCompact(rows[0]).h !== toCompact(rows[1]).h
    && !JSON.stringify(toCompact(rows[0])).includes('919999999999'),
    toCompact(rows[0]).h);
  const red = galaxyPayload(rows, { names: 'redacted', generatedAt: '2026-09-13T00:00:00Z' });
  check('redacted payload numbers people and groups separately, in order',
    eq(red.chats.map((c) => c.n), ['Person 001', 'Group 001', 'Person 002']) && red.sample === true && red.names === 'redacted',
    JSON.stringify(red.chats.map((c) => c.n)));
  check('redaction keeps every count and the same totals', eq(red.totals, full.totals) && red.chats.every((c, i) => c.m === full.chats[i].m && c.k === full.chats[i].k),
    JSON.stringify(red.totals));
  check('redacted payload carries no real name or jid', !JSON.stringify(red).includes('919999999999') && !/"n":"[ABC]"/.test(JSON.stringify(red)), JSON.stringify(red).slice(0, 200));
  check('redactChats leaves the input alone', redactChats(full.chats)[0].n === 'Person 001' && full.chats[0].n === 'A', full.chats[0].n);
}

/* ---------- handler guard (no DATABASE_URL in this process) ----------
   This project ships no ingest endpoint: the inventory is loaded from the
   owner's machine by Database/scripts/wa-import.mjs. The one route is the
   key-gated read, and the dashboard key is the only thing standing between a
   caller and 862 real contact names, so every way past it is checked here. */
delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL;
const mkRes = () => ({ statusCode: null, payload: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.payload = b; return this; } });

// _auth.js reads STATS_KEY into a module constant at import time, so the
// environment has to be right *before* the import, and the unconfigured case
// needs its own module instance — hence the cache-busting specifier below.
process.env.STATS_KEY = 'k-test';
const { default: galaxy } = await import('../../Backend/wa-galaxy.js');

let res = mkRes(); await galaxy({ method: 'GET', headers: {}, query: {} }, res);
check('galaxy without a key is 401', res.statusCode === 401, String(res.statusCode));
res = mkRes(); await galaxy({ method: 'GET', headers: {}, query: { key: 'wrong' } }, res);
check('galaxy with the wrong key is 401', res.statusCode === 401, String(res.statusCode));
res = mkRes(); await galaxy({ method: 'GET', headers: { 'x-stats-key': 'k-test' }, query: {} }, res);
// "not 401 and not 503" used to stand in for "auth passed", which worked only
// while the unconfigured store answered 500. Now that both the missing STATS_KEY
// and the missing DATABASE_URL answer 503, that proxy is ambiguous. Assert the
// real thing instead: the request got PAST auth and reached the store check, so
// the 503 it receives is the DATABASE_URL one, not the STATS_KEY one.
check('the key is accepted from a header too',
  res.statusCode !== 401 && /DATABASE_URL/.test(res.payload?.error || ''),
  `${res.statusCode} ${JSON.stringify(res.payload)}`);
res = mkRes(); await galaxy({ method: 'POST', headers: {}, query: { key: 'k-test' } }, res);
check('galaxy POST is 405', res.statusCode === 405, String(res.statusCode));

res = mkRes(); await galaxy({ method: 'GET', headers: {}, query: { key: 'k-test' } }, res);
check('names never sit in a shared cache', res.headers['Cache-Control'] === 'private, no-store', JSON.stringify(res.headers));
check('the right key with no store is a clear 503', res.statusCode === 503 && /DATABASE_URL/.test(res.payload.error), `${res.statusCode} ${JSON.stringify(res.payload)}`);

/* ---------- the chat drill-down carries the same guards ---------- */
const { default: chat } = await import('../../Backend/wa-chat.js');

res = mkRes(); await chat({ method: 'GET', headers: {}, query: {} }, res);
check('wa-chat without a key is 401', res.statusCode === 401, String(res.statusCode));
res = mkRes(); await chat({ method: 'GET', headers: {}, query: { key: 'wrong', h: 'a'.repeat(16) } }, res);
check('wa-chat with the wrong key is 401', res.statusCode === 401, String(res.statusCode));
res = mkRes(); await chat({ method: 'POST', headers: {}, query: { key: 'k-test' } }, res);
check('wa-chat POST is 405', res.statusCode === 405, String(res.statusCode));
// A malformed handle is refused before the store is touched, so a caller
// cannot use this route to probe whether the database is reachable.
res = mkRes(); await chat({ method: 'GET', headers: {}, query: { key: 'k-test', h: 'not-a-handle' } }, res);
check('wa-chat rejects a malformed handle with 400, not a store error',
  res.statusCode === 400 && /handle/.test(res.payload.error), `${res.statusCode} ${JSON.stringify(res.payload)}`);
res = mkRes(); await chat({ method: 'GET', headers: {}, query: { key: 'k-test', h: 'a'.repeat(16) } }, res);
check('wa-chat with a well-formed handle and no store is a clear 503',
  res.statusCode === 503 && /DATABASE_URL/.test(res.payload.error), `${res.statusCode} ${JSON.stringify(res.payload)}`);
check('wa-chat never lets a shared cache hold a chat', res.headers['Cache-Control'] === 'private, no-store', JSON.stringify(res.headers));

// Fails closed when the server was never configured. The rule lives in
// _auth.js, which reads STATS_KEY once at import, so this case needs its own
// instance of _auth.js — a query string on wa-galaxy.js would not give it one,
// because wa-galaxy's own import of _auth.js stays cached under the plain
// specifier and would still hold the key set above.
delete process.env.STATS_KEY;
const { checkKey } = await import('../../Backend/_auth.js?no-stats-key');
const unconfigured = checkKey({ query: { key: 'anything' }, headers: {} });
check('a server with no STATS_KEY fails closed, and says so',
  unconfigured.ok === false && unconfigured.status === 503 && /not configured/.test(unconfigured.error),
  JSON.stringify(unconfigured));

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
