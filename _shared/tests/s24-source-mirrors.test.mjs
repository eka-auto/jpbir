import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mcp = await readFile(new URL('../../Integrations/s24-connect-mcp/server.py', import.meta.url), 'utf8');
const daemon = await readFile(new URL('../../Backend/s24_phone_direct_cloud.py', import.meta.url), 'utf8');

for (const [name, source] of [['MCP', mcp], ['phone daemon', daemon]]) {
  assert.doesNotMatch(source, /-----BEGIN (?:RSA )?PRIVATE KEY-----/, `${name} contains a private key`);
  assert.doesNotMatch(source, /"private_key"\s*:\s*"/, `${name} contains service-account JSON`);
}

assert.match(mcp, /S24_SERVICE_ACCOUNT_KEY/);
assert.match(mcp, /DATABASE\s*=\s*os\.environ\.get\("S24_FIRESTORE_DB", "eka-agent"\)/);
assert.match(mcp, /def device_ping\(/);
assert.match(mcp, /def device_send\(/);

assert.match(daemon, /DEVICE_DOC_ID\s*=\s*'samsung-s24-ultra'/);
assert.match(daemon, /FIRESTORE_DB\s*=\s*os\.environ\.get\('EKA_FIRESTORE_DB', 'eka-agent'\)/);
assert.match(daemon, /if not RUNTIME_IS_ANDROID:/);
assert.match(daemon, /sys\.exit\(78\)/);
assert.match(daemon, /for doc_id in doc_ids or \[DEVICE_DOC_ID\]:/);

console.log('S24 tracked source mirror tests passed');
