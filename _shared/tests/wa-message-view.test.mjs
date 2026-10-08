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
assert.match(dbFrontend, /readableWhatsAppMessages/);
assert.match(dbFrontend, /readable: '1'/);
assert.match(dbFrontend, /Latest readable messages/);
assert.match(dbFrontend, /m\.readable === true/);

console.log('WhatsApp message presentation tests passed');
