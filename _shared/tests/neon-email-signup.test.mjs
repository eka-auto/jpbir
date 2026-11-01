import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountActions } from '../../Frontend/auth-session.js';
import authConfig from '../../Backend/auth-config.js';

test('signup confirms the authenticated user through a separate session read', async () => {
  const calls = [];
  const user = { id: 'user-fixture', email: 'signup@example.test', name: 'Signup Test' };
  const actions = createAccountActions({
    signUp: { email: async (input) => { calls.push(input.email); return { data: { user } }; } },
    getSession: async () => { calls.push('session'); return { data: { user } }; },
  });
  const result = await actions.signUp({ name: user.name, email: user.email, password: 'fixture-password-only' });
  assert.equal(result.user.id, user.id);
  assert.equal(result.requiresVerification, false);
  assert.deepEqual(calls, [user.email, 'session']);
});

test('signup without an active session asks for verification instead of claiming sign-in', async () => {
  const actions = createAccountActions({
    signUp: { email: async () => ({ data: { user: { id: 'pending' } } }) },
    getSession: async () => ({ data: null }),
  });
  const result = await actions.signUp({ name: 'Test', email: 'test@example.test', password: 'fixture-password-only' });
  assert.equal(result.user, null);
  assert.equal(result.requiresVerification, true);
});

test('provider errors and thrown failures never expose credentials in UI errors', async () => {
  for (const failure of [
    async () => ({ error: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'private-fixture-detail' } }),
    async () => { throw new Error('private-fixture-detail'); },
  ]) {
    const actions = createAccountActions({ signIn: { email: failure } });
    await assert.rejects(actions.signIn({ email: 'test@example.test', password: 'private-fixture-detail' }), (error) => {
      assert.ok(!error.message.includes('private-fixture-detail'));
      return true;
    });
  }
});

test('sign-out clears the session and a current-user read supports anonymous users', async () => {
  let user = { id: 'user-fixture' };
  const actions = createAccountActions({
    getSession: async () => ({ data: user ? { user } : null }),
    signOut: async () => { user = null; return { data: { success: true } }; },
  });
  assert.equal((await actions.currentUser()).id, 'user-fixture');
  await actions.signOut();
  assert.equal(await actions.currentUser(), null);
});

test('thrown Neon SDK HTTP errors preserve safe invalid-credentials feedback', async () => {
  const actions = createAccountActions({ signIn: { email: async () => {
    throw { code: 'invalid_credentials', error: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'private-fixture-detail' } };
  } } });
  await assert.rejects(actions.signIn({ email: 'test@example.test', password: 'fixture-password-only' }), { message: 'Email or password is incorrect.' });
});

test('an untrusted Auth origin reports configuration failure instead of a network outage', async () => {
  const actions = createAccountActions({ signIn: { email: async () => {
    throw { error: { code: 'INVALID_ORIGIN' } };
  } } });
  await assert.rejects(actions.signIn({ email: 'test@example.test', password: 'fixture-password-only' }), { message: 'This site is not allowed to sign in. Contact the site administrator.' });
});

test('email verification requests a code for verification and reads the current user afterward', async () => {
  const calls = [];
  const user = { id: 'verified-fixture', email: 'test@example.test' };
  const actions = createAccountActions({
    emailOtp: {
      sendVerificationOtp: async (input) => { calls.push(input); return { data: { success: true } }; },
      verifyEmail: async (input) => { calls.push(input.email); return { data: { status: true } }; },
    },
    getSession: async () => ({ data: { user } }),
  });
  await actions.sendVerification(user.email);
  assert.deepEqual(calls[0], { email: user.email, type: 'email-verification' });
  assert.equal((await actions.verifyEmail({ email: user.email, otp: '000000' })).id, user.id);
});

test('invalid verification codes produce safe, actionable feedback', async () => {
  const actions = createAccountActions({ emailOtp: { verifyEmail: async () => {
    throw { error: { code: 'INVALID_OTP', message: 'private-fixture-detail' } };
  } } });
  await assert.rejects(actions.verifyEmail({ email: 'test@example.test', otp: '000000' }), { message: 'That verification code is invalid or has expired. Request a new code.' });
});

test('public Auth configuration exposes only the service URL, with no caching', () => {
  const previous = process.env.NEON_AUTH_BASE_URL;
  process.env.NEON_AUTH_BASE_URL = 'https://ep-fixture.neonauth.us-east-1.aws.neon.tech/neondb/auth';
  try {
    const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    authConfig({ method: 'GET' }, response);
    assert.equal(response.code, 200);
    assert.deepEqual(Object.keys(response.body), ['authUrl']);
    assert.equal(response.headers['Cache-Control'], 'no-store');
  } finally {
    if (previous === undefined) delete process.env.NEON_AUTH_BASE_URL;
    else process.env.NEON_AUTH_BASE_URL = previous;
  }
});

test('public Auth configuration fails closed for missing configuration and non-GET requests', () => {
  const previous = process.env.NEON_AUTH_BASE_URL;
  delete process.env.NEON_AUTH_BASE_URL;
  try {
    for (const [method, expected] of [['GET', 503], ['POST', 405]]) {
      const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
      authConfig({ method }, response);
      assert.equal(response.code, expected);
      assert.equal(response.body.authUrl, undefined);
    }
  } finally {
    if (previous !== undefined) process.env.NEON_AUTH_BASE_URL = previous;
  }
});
