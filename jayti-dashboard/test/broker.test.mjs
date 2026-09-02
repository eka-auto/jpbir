import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createVerify, createPublicKey, createHash } from 'crypto';
import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { deepStrictEqual, throws } from 'node:assert';
import { generateKeyPairSync } from 'node:crypto';

import {
  encodeDocumentFields,
  expandFieldPaths,
  findIdempotentResult,
  normalizeHardwareFingerprint,
  rememberIdempotentResult,
  verifyEnrolledHardware,
  verifySignerAttestation,
} from '../lib/broker.js';
import { isP256Pem } from '../api/device-enroll.js';

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

test('broker v2: Firestore document fields use the REST document shape', () => {
  const expanded = expandFieldPaths({
    'enrollment.seq': 7,
    'enrollment.lastRequestIds': ['request-1'],
    online: true,
  });
  deepStrictEqual(expanded, {
    enrollment: { seq: 7, lastRequestIds: ['request-1'] },
    online: true,
  });
  deepStrictEqual(encodeDocumentFields(expanded), {
    enrollment: {
      mapValue: {
        fields: {
          seq: { integerValue: 7 },
          lastRequestIds: { arrayValue: { values: [{ stringValue: 'request-1' }] } },
        },
      },
    },
    online: { booleanValue: true },
  });
});

test('broker v2: conflicting or unsafe Firestore field paths fail closed', () => {
  throws(() => expandFieldPaths({ enrollment: 1, 'enrollment.seq': 2 }), /conflicting/);
  throws(() => expandFieldPaths({ '__proto__.polluted': true }), /invalid/);
});

test('broker v2: enrollment accepts P-256 and rejects other EC curves', () => {
  const p256 = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey
    .export({ type: 'spki', format: 'pem' });
  const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).publicKey
    .export({ type: 'spki', format: 'pem' });
  strictEqual(isP256Pem(p256), true);
  strictEqual(isP256Pem(p384), false);
});

test('broker v2: enrolled hardware remains bound to exact identity', () => {
  const enrolled = normalizeHardwareFingerprint({
    manufacturer: 'LENOVO', model: '82KA', serialHash: 'abc123', hostname: 'ignored',
  });
  strictEqual(verifyEnrolledHardware(enrolled, enrolled), null);
  strictEqual(
    verifyEnrolledHardware(enrolled, { ...enrolled, serialHash: 'changed' }),
    'hardware mismatch: serialHash changed after enrollment',
  );
});

test('broker v2: production signer metadata fails closed', () => {
  strictEqual(verifySignerAttestation('tpm-cng-p256', {
    provider: 'Microsoft Platform Crypto Provider', exportable: false,
  }), null);
  strictEqual(verifySignerAttestation('tpm-cng-p256', { exportable: false }), 'TPM CNG signer metadata is missing or invalid');
  strictEqual(verifySignerAttestation('android-keystore-p256', {
    provider: 'AndroidKeyStore', insideSecureHardware: true, algorithm: 'EC', keySize: 256,
  }), null);
  strictEqual(verifySignerAttestation('android-keystore-p256', {
    provider: 'AndroidKeyStore', insideSecureHardware: false, algorithm: 'EC', keySize: 256,
  }), 'AndroidKeyStore secure-hardware metadata is missing or invalid');
});

test('broker v2: command results are idempotent only for the same signed request', () => {
  const env = { requestId: 'request-1', seq: 8, bodySha256: 'body-hash' };
  const body = { success: true, claimToken: 'token' };
  const recentResults = rememberIdempotentResult({}, env, '/api/device/commands/c1/claim', 200, body);
  deepStrictEqual(
    findIdempotentResult({ recentResults }, env, '/api/device/commands/c1/claim'),
    { status: 200, body },
  );
  deepStrictEqual(
    findIdempotentResult({ recentResults }, { ...env, bodySha256: 'changed' }, '/api/device/commands/c1/claim'),
    { error: 'requestId was reused with a different signed request' },
  );
});
