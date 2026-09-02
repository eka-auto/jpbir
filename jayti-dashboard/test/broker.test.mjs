import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createVerify, createPublicKey, createHash } from 'crypto';
import { test } from 'node:test';
import { strictEqual } from 'node:assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = join(__dirname, '..', '..', 'channel-sandbox', 'tests', 'fixtures', 'python_to_node.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

test('broker v2: Python-generated signature verifies in Node', () => {
  const { publicKeyPem, canonical, signatureBase64, expectedVerify, keyId } = fixture;
  const verifier = createVerify('SHA256');
  verifier.update(canonical);
  verifier.end();
  const ok = verifier.verify(publicKeyPem, Buffer.from(signatureBase64, 'base64'));
  strictEqual(ok, expectedVerify, `signature verification failed for keyId ${keyId}`);
  console.log(`✓ keyId ${keyId} verified`);
});

test('broker v2: keyId derivation matches Python', () => {
  const { publicKeyPem, keyId } = fixture;
  const pubKey = createPublicKey(publicKeyPem);
  const der = pubKey.export({ type: 'spki', format: 'der' });
  const derived = createHash('sha256').update(der).digest('hex').slice(0, 32);
  strictEqual(derived, keyId, 'keyId derivation mismatch');
  console.log(`✓ keyId derivation matches: ${keyId}`);
});
