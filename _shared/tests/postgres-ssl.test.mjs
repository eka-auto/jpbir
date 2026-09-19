// The Neon URL ships sslmode=require. pg-connection-string treats that as
// verify-full today and warns that pg v9 will switch to libpq semantics, where
// 'require' encrypts but never checks the certificate's hostname — a silent
// downgrade on a major bump. Pinning verify-full now removes that future.
//
// It was also the loudest thing in production logs: 10 of the 18 error-level
// records in one 13-minute window were this single warning, on every route that
// touches Postgres. Vercel classifies anything on stderr as level "error", so a
// benign deprecation notice was burying real failures.
import assert from 'node:assert/strict';
import { enforceVerifyFull } from '../../Integrations/postgres.js';

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

// Percent-encoded on purpose: a real Neon password carries characters that must
// survive the rewrite byte-for-byte.
const PW = 'p%40ssw0rd%2Fx%3Fy';
const BASE = `postgres://user:${PW}@ep-x.c-10.us-east-1.aws.neon.tech/neondb`;

t('sslmode=require is pinned to verify-full', () => {
  assert.equal(
    enforceVerifyFull(`${BASE}?sslmode=require`),
    `${BASE}?sslmode=verify-full`
  );
});

t('the other two aliased modes are pinned too', () => {
  for (const mode of ['prefer', 'verify-ca']) {
    assert.equal(
      enforceVerifyFull(`${BASE}?sslmode=${mode}`),
      `${BASE}?sslmode=verify-full`,
      mode
    );
  }
});

t('verify-full is already correct and is left byte-identical', () => {
  const cs = `${BASE}?sslmode=verify-full`;
  assert.equal(enforceVerifyFull(cs), cs);
});

t('an explicit opt-out is not overridden', () => {
  // 'disable' and 'allow' are deliberate local-development choices against a
  // non-TLS Postgres. Silently upgrading them would break `npm run db:migrate`
  // for anyone not pointed at Neon, and neither mode triggers the warning.
  for (const mode of ['disable', 'allow']) {
    const cs = `${BASE}?sslmode=${mode}`;
    assert.equal(enforceVerifyFull(cs), cs, mode);
  }
});

t('sslmode is rewritten when it is not the first parameter', () => {
  assert.equal(
    enforceVerifyFull(`${BASE}?pooling=true&sslmode=require&x=1`),
    `${BASE}?pooling=true&sslmode=verify-full&x=1`
  );
});

t('a URL with no sslmode is untouched', () => {
  // makePool still passes ssl:{rejectUnauthorized:true} explicitly, so the
  // absence of the parameter does not mean an unencrypted connection.
  assert.equal(enforceVerifyFull(BASE), BASE);
});

t('the password and every other parameter survive unchanged', () => {
  const cs = `${BASE}?sslmode=require&options=--c%20statement_timeout%3D3000`;
  const out = enforceVerifyFull(cs);
  assert.equal(out, `${BASE}?sslmode=verify-full&options=--c%20statement_timeout%3D3000`);
  assert.ok(out.includes(PW), 'the encoded password must be byte-identical');
  assert.equal(new URL(out).password, new URL(cs).password);
  assert.equal(new URL(out).hostname, new URL(cs).hostname);
  assert.equal(new URL(out).searchParams.get('options'),
    new URL(cs).searchParams.get('options'));
});

t('a mode merely starting with a weaker name is not half-rewritten', () => {
  // Guards the (?=&|$) boundary: 'requireX' must not become 'verify-fullX'.
  const cs = `${BASE}?sslmode=requireX`;
  assert.equal(enforceVerifyFull(cs), cs);
});

console.log(`\n${pass}/${total} passed`);
