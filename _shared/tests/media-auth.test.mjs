import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.STATS_KEY = 'media-signing-test-key';

const { issueMediaToken, verifyMediaToken } = await import('../../Backend/lib/media-auth.js');
const now = 1_800_000_000_000;
const token = issueMediaToken('attachment-1', now);

assert.ok(token && !token.includes(process.env.STATS_KEY));
assert.equal(verifyMediaToken('attachment-1', token, now + 1), true);
assert.equal(verifyMediaToken('attachment-2', token, now + 1), false);
assert.equal(verifyMediaToken('attachment-1', token + 'x', now + 1), false);
assert.equal(verifyMediaToken('attachment-1', token, now + 16 * 60 * 1000), false);

const media = readFileSync(join(ROOT, 'Backend', 'wa-media.js'), 'utf8');
const viewer = readFileSync(join(ROOT, 'Frontend', 'viewer.html'), 'utf8');
const index = readFileSync(join(ROOT, 'Frontend', 'index.html'), 'utf8');
assert.match(media, /verifyMediaToken/);
assert.doesNotMatch(viewer, /wa-media\?att_id=['"].*&key=/);
assert.doesNotMatch(index, /wa-media\?att_id=['"].*&key=/);
assert.match(viewer, /&token=/);
assert.match(index, /&token=/);

console.log('media token authentication verified');
