import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { presentMessageRow } from '../../Backend/jp-wa-messages.js';

const outgoing = presentMessageRow({
  msg_id: 'm1', sent_at: '2026-05-30T16:52:00Z', from_me: true,
  sender: '[object Object]', kind: 'text', encrypted: true,
  body: '[Encrypted — export chat to read]', chat_name: 'Peer', chat_kind: 'direct',
});
assert.equal(outgoing.sender, null);
assert.equal(outgoing.sender_label, 'You');
assert.match(outgoing.display_body, /^Encrypted message/);
assert.equal(outgoing.encrypted, true);
assert.equal(outgoing.readable, false);

const recoveredText = presentMessageRow({
  msg_id: 'm-readable', sent_at: '2026-05-30T16:50:00Z', from_me: false,
  sender: 'Peer', kind: 'text', encrypted: true, body: 'actual imported text',
  chat_name: 'Peer', chat_kind: 'direct',
});
assert.equal(recoveredText.encrypted, true, 'legacy flag remains visible for diagnostics');
assert.equal(recoveredText.readable, true, 'a real body wins over the stale legacy flag');
assert.equal(recoveredText.display_body, 'actual imported text');

const incoming = presentMessageRow({
  msg_id: 'm2', sent_at: '2026-05-30T16:51:00Z', from_me: false,
  sender: '<Undefined>', kind: 'text', encrypted: true,
  body: '[Encrypted — export chat to read]', chat_name: 'Supriya', chat_kind: 'direct',
});
assert.equal(incoming.sender, null);
assert.equal(incoming.sender_label, 'Supriya');

const callMarker = presentMessageRow({
  msg_id: 'm-call', sent_at: '2026-05-30T16:51:00Z', from_me: true,
  kind: 'call', encrypted: false, body: '[Call]', chat_name: 'Peer', chat_kind: 'direct',
});
assert.equal(callMarker.readable, false, 'call markers are metadata, not chat text');

const audioMarker = presentMessageRow({
  msg_id: 'm-audio', sent_at: '2026-05-30T16:51:00Z', from_me: true,
  kind: 'audio', encrypted: false, body: '[Audio message]', chat_name: 'Peer', chat_kind: 'direct',
});
assert.equal(audioMarker.readable, false, 'audio markers are metadata, not chat text');

const otherMarker = presentMessageRow({
  msg_id: 'm-other', sent_at: '2026-05-30T16:51:00Z', from_me: true,
  kind: 'other', encrypted: false, body: '[Other]', chat_name: 'Peer', chat_kind: 'direct',
});
assert.equal(otherMarker.readable, false, 'other markers are metadata, not chat text');

const system = presentMessageRow({
  msg_id: 'm3', sent_at: null, from_me: false, sender: '<Undefined>',
  kind: 'system', encrypted: true, body: '[System message]',
  chat_name: 'Group', chat_kind: 'group',
});
assert.equal(system.sender_label, 'System');
assert.match(system.display_body, /^System event/);

const frontend = await readFile(new URL('../../Frontend/index.html', import.meta.url), 'utf8');
assert.match(frontend, /m\.sender_label \|\| m\.sender \|\| 'Unknown sender'/);
assert.match(frontend, /m\.display_body \|\| m\.body/);
assert.match(frontend, /Load older messages/);
assert.match(frontend, /total_readable_count/);
assert.match(frontend, /m\.readable === true/);
assert.match(frontend, /Inventory gap/);

const dbFrontend = await readFile(new URL('../../Frontend/db.html', import.meta.url), 'utf8');
const messageEndpoint = await readFile(new URL('../../Backend/jp-wa-messages.js', import.meta.url), 'utf8');
assert.match(messageEndpoint, /readableOnly/);
assert.match(messageEndpoint, /m\.body <> ALL/);
// The /db explorer reads whole rows from its own API now, so it has no readable
// side channel to keep in step: the readable-only path belongs to index.html's
// drill-down (asserted above), and this page shows every stored message body.
assert.doesNotMatch(dbFrontend, /readableWhatsAppMessages|readableWhatsAppInventory/);
assert.doesNotMatch(dbFrontend, /readable: '1'/);
assert.match(dbFrontend, /drawerGet\('whatsapp'/);

console.log('WhatsApp message presentation tests passed');
