import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createVerify, createPublicKey, createHash, sign as signBytes } from 'crypto';
import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { deepStrictEqual, throws } from 'node:assert';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  dec,
  encodeDocumentFields,
  expandFieldPaths,
  findIdempotentResult,
  firestoreDocumentName,
  keyIdFromPem,
  keyIsExpired,
  normalizeHardwareFingerprint,
  parseEnvelope,
  rememberIdempotentResult,
  quoteFirestoreFieldPath,
  canonicalString,
  verifyEnrolledHardware,
  verifyP256,
  verifySignerAttestation,
} from '../../Backend/broker.js';
import { CANONICAL_PATH as ENROLL_PATH, isP256Pem } from '../../Backend/device-enroll.js';
import {
  brokerHeartbeatEvidence,
  CANONICAL_PATH as HEARTBEAT_PATH,
  heartbeatTelemetryFields,
  S24_ONLY_TELEMETRY,
  TELEMETRY_WHITELIST,
} from '../../Backend/device-heartbeat.js';
import pollHandler, {
  CANONICAL_PATH as POLL_PATH,
  pollResponseCommands,
} from '../../Backend/device-commands-poll.js';
import claimHandler, { canonicalClaimPath } from '../../Backend/broker-command-claim.js';
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
    destFor('/api/s24-command'),
    'Backend/s24-command.js',
  );
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

test('broker v2: Firestore masks quote each non-simple map-key segment', () => {
  strictEqual(quoteFirestoreFieldPath('enrollment.seq'), 'enrollment.seq');
  strictEqual(quoteFirestoreFieldPath('commandQueue.sync-now_123.status'), 'commandQueue.`sync-now_123`.status');
  strictEqual(quoteFirestoreFieldPath('commandQueue.550e8400-e29b-41d4-a716-446655440000'),
    'commandQueue.`550e8400-e29b-41d4-a716-446655440000`');
  strictEqual(quoteFirestoreFieldPath('map.a`b\\c'), 'map.`a\\`b\\\\c`');
  throws(() => quoteFirestoreFieldPath('commandQueue..status'), /invalid/);
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
  const env = { requestId: 'request-1', seq: 8, timestamp: 10, bodySha256: 'body-hash' };
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
  deepStrictEqual(
    findIdempotentResult({ recentResults }, { ...env, timestamp: 11 }, '/api/device-command-claim/c1'),
    { error: 'requestId was reused with a different signed request' },
  );
});

test('broker v2: heartbeat evidence is server-owned and S24 claims are explicitly whitelisted', () => {
  deepStrictEqual(brokerHeartbeatEvidence({ keyId: 'a'.repeat(32) }, '2026-09-21T00:00:00.000Z'), {
    'enrollment.lastHeartbeatAt': '2026-09-21T00:00:00.000Z',
    'enrollment.lastSignedHeartbeatAt': '2026-09-21T00:00:00.000Z',
    'enrollment.lastSignedHeartbeatKeyId': 'a'.repeat(32),
    'enrollment.lastSignedHeartbeatProtocol': '2',
  });
  for (const field of ['heartbeatAuth', 'liveDeviceVerified', 'sourceType', 'runtimeIsAndroid', 'installationEvidence']) {
    strictEqual(TELEMETRY_WHITELIST.includes(field), true, field);
  }
  strictEqual(TELEMETRY_WHITELIST.includes('enrollment'), false);
  strictEqual(TELEMETRY_WHITELIST.includes('lastSeen'), false);
});

test('broker v2: poll preserves requestedAt as the public queuedAt timestamp', () => {
  const requestedAt = '2026-09-21T00:00:00.000Z';
  deepStrictEqual(pollResponseCommands({
    'sync-now-id': { action: 'sync-now', status: 'pending', requestedAt },
  }, Date.parse(requestedAt)), [{
    commandId: 'sync-now-id', action: 'sync-now', payload: {}, queuedAt: requestedAt,
    state: 'pending', attempt: 0,
  }]);
});

test('broker v2: malformed and elapsed key expiries fail closed', () => {
  strictEqual(keyIsExpired({}), false);
  strictEqual(keyIsExpired({ expiresAt: 'not-a-date' }, 100), true);
  strictEqual(keyIsExpired({ expiresAt: '1970-01-01T00:00:01.000Z' }, 1000), true);
  strictEqual(keyIsExpired({ expiresAt: '1970-01-01T00:00:02.000Z' }, 1000), false);
});

test('broker v2: a retry matching a record written before signedRequestHash existed is replayed, not rejected', () => {
  // Records written by the previous deploy carry no hash. Judging them by it turned a
  // legitimate retry that straddled the deploy into a 401, which the client treats as a
  // revoked key and exits 3, leaving the command claimed until its lease expired.
  const path = '/api/device-command-complete/c1';
  const env = { requestId: 'request-1', seq: 8, timestamp: 10, bodySha256: 'body-hash' };
  const legacy = { requestId: 'request-1', seq: 8, path, bodySha256: 'body-hash', status: 200, body: { success: true } };
  deepStrictEqual(findIdempotentResult({ recentResults: [legacy] }, env, path), { status: 200, body: { success: true } });
  for (const changed of [{ bodySha256: 'other' }, { seq: 9 }]) {
    deepStrictEqual(findIdempotentResult({ recentResults: [legacy] }, { ...env, ...changed }, path),
      { error: 'requestId was reused with a different signed request' });
  }
});

test('broker v2: only the S24 key may write S24 evidence or claim the S24 identity', () => {
  // canonicalDeviceId is what makes jp-devices treat a doc as the phone, so any other
  // enrolled key (a laptop agent, an off-device bridge) could mark its own doc as the S24
  // and assert every evidence field about itself.
  const claims = {
    deviceId: 'samsung-s24-ultra',
    canonicalDeviceId: 'samsung-s24-ultra',
    connectionMethod: 'signed-broker-v2',
    agentVersion: 's24-termux-broker-2026-09-21.2',
    heartbeatAuth: 'termux-phone',
    liveDeviceVerified: true,
    sourceType: 'live_daemon',
    runtimeIsAndroid: true,
    installationEvidence: { jobSchedulerVerified: true },
    enrollment: { activeKeyId: 'forged' },
  };
  const laptop = heartbeatTelemetryFields('g4g-lenovo-laptop', claims);
  strictEqual(laptop.deviceId, 'g4g-lenovo-laptop');
  strictEqual(laptop.canonicalDeviceId, 'g4g-lenovo-laptop');
  for (const field of S24_ONLY_TELEMETRY) strictEqual(Object.hasOwn(laptop, field), false, field);
  strictEqual(Object.hasOwn(laptop, 'enrollment'), false);

  const phone = heartbeatTelemetryFields('samsung-s24-ultra', claims);
  for (const field of S24_ONLY_TELEMETRY) deepStrictEqual(phone[field], claims[field], field);
  strictEqual(phone.canonicalDeviceId, 'samsung-s24-ultra');
});

// ---- handler-level replay tests: Firestore and Google's token endpoint answered in-process --

function fakeFirestore(docs) {
  const saKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const previousSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const previousFetch = globalThis.fetch;
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    project_id: 'test-project', client_email: 'test@example.invalid', private_key: saKey,
  });
  const patches = [];
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'oauth2.googleapis.com') return reply({ access_token: 'test-token', expires_in: 3600 });
    const path = decodeURIComponent(u.pathname.split('/documents')[1]);
    const method = init.method || 'GET';
    if (method === 'GET') {
      return docs[path] ? reply({ fields: encodeDocumentFields(docs[path]), updateTime: 'u1' }) : reply({}, 404);
    }
    if (method === 'PATCH') {
      patches.push({ path, body: JSON.parse(init.body) });
      return reply({});
    }
    if (method === 'POST' && path === '/auditLog') return reply({});
    throw new Error(`unexpected Firestore call ${method} ${url}`);
  };
  return {
    patches,
    written: (index) => dec({ mapValue: { fields: patches[index].body.fields } }),
    restore() {
      globalThis.fetch = previousFetch;
      if (previousSa === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousSa;
    },
  };
}

function enrolledDevice(deviceId) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  return { deviceId, privateKey, publicKeyPem, keyId: keyIdFromPem(publicKeyPem) };
}

// Returns a factory so a test can send the byte-identical signed request twice, as the
// client's retry does.
function signedRequest(device, { path, body, seq, query = {} }) {
  const raw = Buffer.from(JSON.stringify(body));
  const timestamp = Date.now();
  const requestId = randomUUID();
  const bodySha256 = createHash('sha256').update(raw).digest('hex');
  const canonical = canonicalString(
    { keyId: device.keyId, method: 'POST', path, seq, timestamp, requestId }, bodySha256,
  );
  const signature = signBytes('SHA256', Buffer.from(canonical), device.privateKey).toString('base64');
  return () => Object.assign(Readable.from([raw]), {
    method: 'POST',
    query,
    headers: {
      'x-broker-proto': '2',
      'x-key-id': device.keyId,
      'x-device-seq': String(seq),
      'x-timestamp': String(timestamp),
      'x-request-id': requestId,
      'x-signature': signature,
    },
  });
}

function fakeRes() {
  const res = { statusCode: 0, body: undefined };
  res.setHeader = () => {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('broker v2: a poll stores no response body, and a retried poll is answered from the current queue', async () => {
  // Every 15-second poll used to copy its whole response - each visible command and its
  // payload - into enrollment.recentResults, up to ten times over. A backed-up queue could
  // push the device doc past Firestore's 1 MiB limit; the PATCH then failed and poll
  // returned 500 forever, so the device could never drain the backlog that caused it.
  const device = enrolledDevice('samsung-s24-ultra');
  const commandQueue = {};
  for (let i = 0; i < 40; i++) {
    commandQueue[`c${i}`] = { action: 'echo', status: 'pending', payload: { blob: 'x'.repeat(1000) } };
  }
  const docPath = '/devices/samsung-s24-ultra';
  const docs = {
    [`/deviceKeys/${device.keyId}`]: { status: 'active', deviceId: device.deviceId, publicKeyPem: device.publicKeyPem },
    [docPath]: { enrollment: { activeKeyId: device.keyId, seq: 4 }, commandQueue },
  };
  const fs = fakeFirestore(docs);
  try {
    const request = signedRequest(device, { path: POLL_PATH, body: {}, seq: 5 });
    const first = fakeRes();
    await pollHandler(request(), first);
    strictEqual(first.statusCode, 200, JSON.stringify(first.body));
    strictEqual(first.body.commands.length, 40);
    strictEqual(fs.patches.length, 1);
    const written = fs.written(0);
    strictEqual(written.enrollment.recentResults[0].body, null, 'the poll response must not be stored');
    strictEqual(JSON.stringify(fs.patches[0].body).length < 4000, true, 'the poll write must not grow with the queue');

    // The response was lost and a command arrived before the client's identical retry.
    docs[docPath] = {
      enrollment: { ...docs[docPath].enrollment, ...written.enrollment },
      commandQueue: { ...commandQueue, c40: { action: 'ping', status: 'pending' } },
    };
    const replay = fakeRes();
    await pollHandler(request(), replay);
    strictEqual(replay.statusCode, 200, JSON.stringify(replay.body));
    strictEqual(replay.body.commands.length, 41, 'a retried poll reports the current queue');
    strictEqual(fs.patches.length, 1, 'a replay writes nothing');
  } finally {
    fs.restore();
  }
});

test('broker v2: a claim record omits the payload, and a retried claim gets it back from the entry', async () => {
  const device = enrolledDevice('samsung-s24-ultra');
  const docPath = '/devices/samsung-s24-ultra';
  const docs = {
    [`/deviceKeys/${device.keyId}`]: { status: 'active', deviceId: device.deviceId, publicKeyPem: device.publicKeyPem },
    [docPath]: {
      enrollment: { activeKeyId: device.keyId, seq: 4 },
      commandQueue: { 'cmd-1': { action: 'wa-media-push', status: 'pending', payload: { timeout_seconds: 900 } } },
    },
  };
  const fs = fakeFirestore(docs);
  try {
    const request = signedRequest(device, {
      path: canonicalClaimPath('cmd-1'), body: { workerSessionId: 'worker-1' }, seq: 5, query: { commandId: 'cmd-1' },
    });
    const first = fakeRes();
    await claimHandler(request(), first);
    strictEqual(first.statusCode, 200, JSON.stringify(first.body));
    deepStrictEqual(first.body.payload, { timeout_seconds: 900 });
    const written = fs.written(0);
    const record = written.enrollment.recentResults[0].body;
    strictEqual(record.claimToken, first.body.claimToken);
    strictEqual(Object.hasOwn(record, 'payload'), false, 'the payload is already on the entry; no second copy');

    docs[docPath] = { ...docs[docPath], enrollment: { ...docs[docPath].enrollment, ...written.enrollment } };
    const replay = fakeRes();
    await claimHandler(request(), replay);
    strictEqual(replay.statusCode, 200, JSON.stringify(replay.body));
    deepStrictEqual(replay.body, first.body, 'a retried claim returns the original claim, payload included');
    strictEqual(fs.patches.length, 1, 'a replay writes nothing');
  } finally {
    fs.restore();
  }
});
