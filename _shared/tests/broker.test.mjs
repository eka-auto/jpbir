import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createVerify, createPublicKey, createHash, sign as signBytes } from 'crypto';
import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { deepStrictEqual, throws } from 'node:assert';
import { generateKeyPairSync } from 'node:crypto';

import {
  encodeDocumentFields,
  expandFieldPaths,
  findIdempotentResult,
  firestoreDocumentName,
  normalizeHardwareFingerprint,
  parseEnvelope,
  rememberIdempotentResult,
  canonicalString,
  verifyEnrolledHardware,
  verifyP256,
  verifySignerAttestation,
} from '../../Backend/broker.js';
import { CANONICAL_PATH as ENROLL_PATH, isP256Pem } from '../../Backend/device-enroll.js';
import { CANONICAL_PATH as HEARTBEAT_PATH } from '../../Backend/device-heartbeat.js';
import { CANONICAL_PATH as POLL_PATH } from '../../Backend/device-commands-poll.js';
import { canonicalClaimPath } from '../../Backend/broker-command-claim.js';
import { canonicalCompletePath } from '../../Backend/broker-command-complete.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = join(__dirname, '..', '..', 'Devices', 'sandbox', 'tests', 'fixtures', 'python_to_node.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
const vercelConfig = JSON.parse(readFileSync(join(__dirname, '..', '..', 'vercel.json'), 'utf-8'));

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

test('broker v2: exact envelope accepts ECDSA P-256 DER signatures', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
  const keyId = createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 32);
  const rawBody = Buffer.from('{"hardware":{"manufacturer":"LENOVO"}}');
  const bodySha256 = createHash('sha256').update(rawBody).digest('hex');
  const timestamp = Date.now();
  const requestId = '550e8400-e29b-41d4-a716-446655440000';
  const path = '/api/device-heartbeat';
  const canonical = canonicalString({
    keyId,
    method: 'POST',
    path,
    seq: 7,
    timestamp,
    requestId,
  }, bodySha256);
  const signature = signBytes('SHA256', Buffer.from(canonical), privateKey);
  strictEqual(signature[0], 0x30, 'ECDSA signature must use ASN.1 DER encoding');

  const env = parseEnvelope({
    method: 'POST',
    headers: {
      'x-broker-proto': '2',
      'x-key-id': keyId,
      'x-device-seq': '7',
      'x-timestamp': String(timestamp),
      'x-request-id': requestId,
      'x-signature': signature.toString('base64'),
    },
  }, rawBody, path);

  strictEqual(env.error, undefined);
  strictEqual(env.canonical, canonical);
  strictEqual(verifyP256(publicKeyPem, env.canonical, env.signature), true);
});

test('broker v2: every handler uses the flat canonical path contract', () => {
  strictEqual(ENROLL_PATH, '/api/device-enroll');
  strictEqual(HEARTBEAT_PATH, '/api/device-heartbeat');
  strictEqual(POLL_PATH, '/api/device-commands-poll');
  strictEqual(canonicalClaimPath('c1'), '/api/device-command-claim/c1');
  strictEqual(canonicalCompletePath('c1'), '/api/device-command-complete/c1');
});

test('broker v2: Vercel maps command aliases away from filesystem collisions', () => {
  const destFor = (src) => vercelConfig.routes.find((r) => r.src === src)?.dest;
  strictEqual(
    destFor('/api/device-command-claim'),
    'Backend/broker-command-claim.js',
  );
  strictEqual(
    destFor('/api/device-command-claim/(?<commandId>[^/]+)'),
    'Backend/broker-command-claim.js?commandId=$commandId',
  );
  strictEqual(
    destFor('/api/device-command-complete'),
    'Backend/broker-command-complete.js',
  );
  strictEqual(
    destFor('/api/device-command-complete/(?<commandId>[^/]+)'),
    'Backend/broker-command-complete.js?commandId=$commandId',
  );
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

test('broker v2: Firestore transaction writes use resource names, not URLs', () => {
  strictEqual(
    firestoreDocumentName('project-id', 'eka-agent', '/deviceKeys/key-id'),
    'projects/project-id/databases/eka-agent/documents/deviceKeys/key-id',
  );
  throws(() => firestoreDocumentName('project-id', 'eka-agent', '../other'), /invalid/);
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
  const recentResults = rememberIdempotentResult({}, env, '/api/device-command-claim/c1', 200, body);
  deepStrictEqual(
    findIdempotentResult({ recentResults }, env, '/api/device-command-claim/c1'),
    { status: 200, body },
  );
  deepStrictEqual(
    findIdempotentResult({ recentResults }, { ...env, bodySha256: 'changed' }, '/api/device-command-claim/c1'),
    { error: 'requestId was reused with a different signed request' },
  );
});
