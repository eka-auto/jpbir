// Guard + batch-shape coverage for the local-first S24 sync ingest.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadPublicKeys, authorize } from '../../Backend/s24-ingest.js';
import { canonicalString, keyIdFromPem } from '../../Backend/broker.js';
import { validateBatch, MAX_RECORDS_PER_BATCH } from '../../Integrations/s24-store.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const KEY_ID = keyIdFromPem(PEM);

function sign(rawBody, over = {}) {
  const timestamp = String(over.timestamp ?? Date.now());
  const requestId = over.requestId ?? crypto.randomUUID();
  const seq = String(over.seq ?? 1);
  const keyId = over.keyId ?? KEY_ID;
  const canonical = canonicalString(
    { keyId, method: 'POST', path: '/api/s24-ingest', seq, timestamp, requestId },
    crypto.createHash('sha256').update(rawBody).digest('hex')
  );
  const signer = crypto.createSign('SHA256');
  signer.update(canonical);
  signer.end();
  return {
    'x-key-id': keyId,
    'x-signature': over.signature ?? signer.sign(privateKey).toString('base64'),
    'x-timestamp': timestamp,
    'x-request-id': requestId,
    'x-seq': seq,
  };
}

const KEYS = loadPublicKeys(PEM);
const BODY = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8');
const NOW = Date.now();

let pass = 0;
let total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

t('a correctly signed upload is authorised', () => {
  const r = authorize(sign(BODY), BODY, KEYS, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.keyId, KEY_ID);
});

t('no configured key fails closed, it does not fall open', () => {
  const r = authorize(sign(BODY), BODY, [], NOW);
  assert.equal(r.ok, undefined);
  assert.equal(r.httpStatus, 503);
});

t('an unsigned request is rejected', () => {
  const r = authorize({}, BODY, KEYS, NOW);
  assert.equal(r.httpStatus, 401);
  assert.match(r.error, /missing signature headers/);
});

t('a body altered after signing no longer verifies', () => {
  const headers = sign(BODY);
  const tampered = Buffer.from(JSON.stringify({ hello: 'evil' }), 'utf8');
  assert.equal(authorize(headers, tampered, KEYS, NOW).httpStatus, 401);
});

t('a signature from a key we do not hold is rejected', () => {
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const canonical = canonicalString(
    { keyId: KEY_ID, method: 'POST', path: '/api/s24-ingest', seq: '1', timestamp: String(NOW), requestId: '00000000-0000-4000-8000-000000000001' },
    crypto.createHash('sha256').update(BODY).digest('hex')
  );
  const s = crypto.createSign('SHA256'); s.update(canonical); s.end();
  const headers = {
    'x-key-id': KEY_ID, 'x-signature': s.sign(other.privateKey).toString('base64'),
    'x-timestamp': String(NOW), 'x-request-id': '00000000-0000-4000-8000-000000000001', 'x-seq': '1',
  };
  assert.equal(authorize(headers, BODY, KEYS, NOW).httpStatus, 401);
});

t('an unknown key id is rejected without revealing which ids exist', () => {
  const r = authorize(sign(BODY, { keyId: 'f'.repeat(32) }), BODY, KEYS, NOW);
  assert.equal(r.httpStatus, 401);
  assert.equal(r.error, 'signature rejected', 'same message as a bad signature');
});

t('a replayed-from-the-past timestamp is refused', () => {
  const old = NOW - 10 * 60 * 1000;
  assert.equal(authorize(sign(BODY, { timestamp: old }), BODY, KEYS, old).httpStatus, undefined);
  assert.equal(authorize(sign(BODY, { timestamp: old }), BODY, KEYS, NOW).httpStatus, 401);
});

t('multiple public keys load, so a key can be rotated without a flag day', () => {
  const second = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const secondPem = second.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const both = loadPublicKeys(PEM + '\n' + secondPem);
  assert.equal(both.length, 2);
  assert.equal(loadPublicKeys(JSON.stringify([PEM, secondPem])).length, 2, 'JSON array form also works');
  assert.equal(authorize(sign(BODY), BODY, both, NOW).ok, true, 'the old key still works during rotation');
});

t('a malformed key does not take the valid ones down with it', () => {
  assert.equal(loadPublicKeys('-----BEGIN PUBLIC KEY-----\nnonsense\n-----END PUBLIC KEY-----\n' + PEM).length, 1);
});

// ---- batch shape ----
const RUN = { run_id: 'r-1', device_id: 'samsung-s24-ultra', started_at: '2026-09-14T00:00:00Z' };

t('a well-formed batch validates', () => {
  const r = validateBatch({
    run: RUN,
    datasets: [{ dataset: 'call_log', status: 'ok', record_count: 1 }],
    records: [{ dataset: 'call_log', record_id: '1', payload: { number: 'x' } }],
  });
  assert.equal(r.ok, true);
});

t('a different device cannot write through the S24-only endpoint', () => {
  const r = validateBatch({
    run: { ...RUN, device_id: 'some-other-phone' },
    datasets: [{ dataset: 'apps', status: 'empty', record_count: 0 }],
    records: [],
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /samsung-s24-ultra/);
});

t('a batch without a coverage ledger is refused', () => {
  assert.equal(validateBatch({ run: RUN, datasets: [], records: [] }).ok, false);
});

t('duplicate dataset statuses are refused', () => {
  const r = validateBatch({
    run: RUN,
    datasets: [
      { dataset: 'apps', status: 'ok', record_count: 1 },
      { dataset: 'apps', status: 'ok', record_count: 1 },
    ],
    records: [],
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /duplicate/);
});

t('negative manifest counts are refused', () => {
  const r = validateBatch({
    run: RUN,
    datasets: [{ dataset: 'apps', status: 'ok', record_count: -1 }],
    records: [],
  });
  assert.equal(r.ok, false);
});

t('chunk coordinates are validated', () => {
  assert.equal(validateBatch({
    run: RUN,
    upload: { batch_index: 2, batch_count: 1 },
    datasets: [{ dataset: 'apps', status: 'empty', record_count: 0 }],
    records: [],
  }).ok, false);
  assert.equal(validateBatch({
    run: RUN,
    upload: { batch_index: 1, batch_count: 3 },
    datasets: [{ dataset: 'apps', status: 'empty', record_count: 0 }],
    records: [],
  }).ok, true);
});

t('a record whose dataset has no status row is refused', () => {
  // Otherwise it would land in the table but never appear on the coverage
  // page, which is the exact gap this shape exists to close.
  const r = validateBatch({
    run: RUN,
    datasets: [{ dataset: 'call_log', status: 'ok' }],
    records: [{ dataset: 'sms', record_id: '1' }],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.detail, ['sms']);
});

t('an unavailable dataset is a valid batch with zero records', () => {
  const r = validateBatch({
    run: RUN,
    datasets: [{ dataset: 'sms', status: 'denied', detail: 'READ_SMS not granted' }],
    records: [],
  });
  assert.equal(r.ok, true, 'a refusal has to be recordable, or a gap looks like an absence');
});

t('an invented status is refused', () => {
  assert.equal(validateBatch({ run: RUN, datasets: [{ dataset: 'x', status: 'probably' }] }).ok, false);
});

t('a missing run header is refused', () => {
  assert.equal(validateBatch({ datasets: [], records: [] }).ok, false);
});

t('an oversized batch is refused rather than truncated', () => {
  const records = Array.from({ length: MAX_RECORDS_PER_BATCH + 1 }, (_, i) => ({ dataset: 'd', record_id: String(i) }));
  const r = validateBatch({ run: RUN, datasets: [{ dataset: 'd', status: 'ok' }], records });
  assert.equal(r.ok, false);
  assert.match(r.error, /batch too large/);
});

console.log(`\n${pass}/${total} passed`);
