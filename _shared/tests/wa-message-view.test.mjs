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
assert.match(frontend, /readable ·/);

console.log('WhatsApp message presentation tests passed');
