// /api/jp-devices must fail in sentences, never in Google's raw bodies.
//
// Both Firestore throw sites in Backend/jp-devices.js used to build err.message
// around what Google sent back -- OAuth's JSON on a token failure, Firestore's
// JSON (or an HTML page from Google's front end) on a read failure -- and the
// handler answers a failure with err.message. The dashboard printed it: raw JSON
// and HTML on screen, against the rule that nothing raw reaches it, which
// jteka.html had to scrub in the browser (#114). A malformed
// FIREBASE_SERVICE_ACCOUNT_JSON was worse: V8's JSON.parse error quotes the text
// it choked on, and that text is a private key.
//
// This drives the real handler with a generated service-account key and a
// stubbed fetch, one fresh module instance per case (the secret is read at
// import time), and reads what a key-holder's browser would get back.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

let pass = 0, total = 0;
async function t(name, fn) {
  total++;
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const KEY = 'k-test-jp-devices-errors';
process.env.STATS_KEY = KEY;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = JSON.stringify({
  type: 'service_account', project_id: 'demo-project', client_email: 'svc@demo-project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
});

const mkRes = () => ({
  statusCode: null, payload: null, headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.statusCode = c; return this; },
  json(b) { this.payload = b; return this; },
});
const reply = (status, body, type) => new Response(typeof body === 'string' ? body : JSON.stringify(body),
  { status, headers: { 'content-type': type || 'application/json' } });

let n = 0;
// One request to /api/jp-devices with this secret and these upstream answers.
async function roster(secret, upstream) {
  process.env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'] = secret;
  const { default: handler } = await import(new URL('../../Backend/jp-devices.js?case=' + (++n), import.meta.url).href);
  const realFetch = globalThis.fetch, realErr = console.error, logged = [];
  globalThis.fetch = async (url) => (String(url).includes('oauth2.googleapis.com') ? upstream.token() : upstream.firestore());
  console.error = (...a) => logged.push(a.map(String).join(' '));
  try {
    const res = mkRes();
    await handler({ method: 'GET', url: '/api/jp-devices', headers: { 'x-stats-key': KEY }, query: {} }, res);
    return { status: res.statusCode, error: res.payload && res.payload.error, log: logged.join('\n') };
  } finally { globalThis.fetch = realFetch; console.error = realErr; }
}
const tokenOk = () => reply(200, { access_token: 'ya29.test', expires_in: 3600 });
const rawFree = (s, what) => {
  assert.equal(/[{}<>]|"\s*:/.test(s), false, `${what} still carries raw JSON or markup: ${s}`);
};

// ---- the extractor ----
const { upstreamMessage } = await import(new URL('../../Backend/jp-devices.js', import.meta.url).href);
await t('upstreamMessage keeps the one sentence inside each Google envelope, else names the status', () => {
  assert.equal(upstreamMessage({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }, 400), 'Invalid JWT Signature');
  assert.equal(upstreamMessage({ error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' } }, 403),
    'Missing or insufficient permissions');
  assert.equal(upstreamMessage({ error: 'unauthorized_client' }, 401), 'unauthorized_client');
  assert.equal(upstreamMessage(null, 502), 'HTTP 502', 'a body that was not JSON (an HTML page) is described by its status');
  assert.equal(upstreamMessage({}, 400), 'HTTP 400');
  assert.equal(upstreamMessage({ error: { message: 'see {"detail": 1}' } }, 500), 'HTTP 500', 'a "sentence" holding JSON is refused');
});

// ---- the handler, end to end ----
await t('a Firestore 403 reaches the dashboard as "firestore read failed: Missing or insufficient permissions"', async () => {
  const r = await roster(SA, {
    token: tokenOk,
    firestore: () => reply(403, { error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' } }),
  });
  assert.equal(r.status, 500);
  assert.equal(r.error, 'firestore read failed: Missing or insufficient permissions');
  rawFree(r.log, 'the server log');
});

await t('an HTML error page from Google\'s front end becomes its status, never markup', async () => {
  const r = await roster(SA, { token: tokenOk, firestore: () => reply(502, '<!DOCTYPE html><html><title>Error 502</title></html>', 'text/html') });
  assert.equal(r.error, 'firestore read failed: HTTP 502');
  rawFree(r.log, 'the server log');
});

await t('invalid_grant keeps Google\'s diagnosis and the key-rotation remedy, without the JSON around them', async () => {
  const r = await roster(SA, {
    token: () => reply(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }),
    firestore: () => { throw new Error('Firestore must not be called without a token'); },
  });
  assert.match(r.error, /^token exchange failed: Invalid JWT Signature — the FIREBASE_SERVICE_ACCOUNT_JSON key is invalid, revoked, or rotated/);
  rawFree(r.error, 'the error');
  rawFree(r.log, 'the server log');
});

await t('a malformed secret is named, never quoted — V8 echoes the key characters after the error', async () => {
  // A key pasted without its quotes: V8 answers 'Unexpected token 'M',
  // ..."ate_key": MARKERSECR"... is not valid JSON' -- the first ten
  // characters of the key itself, which the old handler sent back in its 500.
  const broken = '{"type":"service_account","project_id":"demo-project","private_key": MARKERSECRETKEYMATERIAL}';
  const r = await roster(broken, { token: tokenOk, firestore: tokenOk });
  assert.equal(r.status, 500);
  assert.match(r.error, /^FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON/);
  assert.equal(/MARKERSEC/.test(r.error + r.log), false, 'key material left the server: ' + r.error);
});

await t('a secret without its key fields says which ones, before signing anything', async () => {
  const r = await roster(JSON.stringify({ type: 'service_account', project_id: 'demo-project' }), { token: tokenOk, firestore: tokenOk });
  assert.equal(r.error, 'FIREBASE_SERVICE_ACCOUNT_JSON is missing private_key, client_email or project_id');
});

console.log(`\n${pass}/${total} checks passed`);
if (pass !== total) process.exitCode = 1;
