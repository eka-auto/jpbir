import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

test.use({ baseURL: 'http://localhost:3000', trace: 'off', video: 'off', screenshot: 'off' });

test('signup page reports missing service configuration without accepting passwords', async ({ page }) => {
  await page.route('**/api/auth-config', (route) => route.fulfill({ status: 503, json: { error: 'Not configured' } }));
  await page.goto('/signup');
  await expect(page.getByRole('status')).toContainText('not configured');
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeDisabled();
});

test('verification form completes signup before reading the current user', async ({ page }) => {
  const user = { id: 'fixture-user', email: 'fixture@example.test', name: 'Fixture User', emailVerified: false };
  let verified = false;
  let codeRequested = false;
  await page.route('**/api/auth-config', (route) => route.fulfill({ json: { authUrl: 'https://ep-fixture.neonauth.us-east-1.aws.neon.tech/neondb/auth' } }));
  await page.route('https://ep-fixture.neonauth.us-east-1.aws.neon.tech/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'Access-Control-Allow-Origin': 'http://localhost:3000', 'Access-Control-Allow-Credentials': 'true' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path.endsWith('/get-session')) return route.fulfill({ headers, json: verified ? { user: { ...user, emailVerified: true }, session: { id: 'fixture-session', userId: user.id, token: 'non-secret-test-fixture', expiresAt: new Date(Date.now() + 600000).toISOString() } } : null });
    if (path.endsWith('/sign-up/email')) return route.fulfill({ headers, json: { user, token: null } });
    if (path.endsWith('/email-otp/send-verification-otp')) { codeRequested = true; return route.fulfill({ headers, json: { success: true } }); }
    if (path.endsWith('/email-otp/verify-email')) { verified = true; return route.fulfill({ headers, json: { status: true, user: { ...user, emailVerified: true } } }); }
    return route.fulfill({ status: 404, headers, json: {} });
  });
  await page.goto('/signup');
  await expect(page.locator('#submit')).toBeEnabled();
  await page.getByLabel('Name', { exact: true }).fill(user.name);
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.locator('#password').fill('non-secret-fixture-password');
  await page.locator('#submit').click();
  await expect(page.locator('#verification-form')).toBeVisible();
  await expect(page.locator('#account')).toBeHidden();
  await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Verification code sent');
  expect(codeRequested).toBe(true);
  await page.getByLabel('Verification code', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.locator('#current-email')).toHaveText(user.email);
  await expect(page.locator('#verification-code')).toHaveValue('');
});

test('live Neon signup respects verification and checks the session when available', async ({ page }) => {
  const manualVerification = process.env.NEON_AUTH_MANUAL_VERIFICATION === '1';
  test.setTimeout(manualVerification ? 900000 : 90000);
  test.skip(process.env.NEON_AUTH_LIVE_TEST !== '1', 'Opt in to creating one real test account on the linked Neon branch.');
  const email = process.env.NEON_AUTH_TEST_EMAIL || `jpbir-signup-${randomUUID()}@example.com`;
  let signupId;
  let sessionId;
  const responses = [];
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (response.request().method() === 'POST' && path.endsWith('/sign-up/email')) {
      responses.push(response.json().then((body) => { signupId = body.user?.id; }));
    }
    if (path.endsWith('/get-session') && response.status() === 200) {
      responses.push(response.json().then((body) => { if (body?.user) sessionId = body.user.id; }));
    }
  });
  await page.goto('/signup');
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeEnabled();
  await page.getByLabel('Name', { exact: true }).fill('Neon Signup Test');
  await page.getByLabel('Email', { exact: true }).fill(email);
  // Generate and retain the password only in this browser's memory. Do not
  // include it in Playwright arguments, traces, screenshots, or test output.
  await page.locator('#password').evaluate((input) => {
    window.__signupTestPassword = `${crypto.randomUUID()}Aa!9`;
    input.value = window.__signupTestPassword;
  });
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect.poll(async () => await page.locator('#account').isVisible() || await page.locator('#verification-form').isVisible()).toBe(true);
  await Promise.all(responses);
  expect(Boolean(signupId)).toBe(true);
  if (await page.locator('#verification-form').isVisible()) {
    console.log(JSON.stringify({ check: 'neon-email-signup', registration: 'pass', email, current_user_read: 'pending_email_verification' }));
    if (!manualVerification || !process.env.NEON_AUTH_TEST_EMAIL) return;
    await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Verification code sent');
    console.log(JSON.stringify({ check: 'neon-email-signup', phase: 'awaiting_browser_email_verification', email }));
    // The owner enters the code on /signup in their own browser. This marker
    // only resumes the test; the following real password sign-in and session
    // read independently verify that email verification actually succeeded.
    await expect.poll(() => existsSync('/tmp/neon-email-verified'), { timeout: 600000, intervals: [1000] }).toBe(true);
    await page.locator('#toggle-mode').click();
    await page.locator('#password').evaluate((input) => { input.value = window.__signupTestPassword; });
    await page.locator('#submit').click();
  }
  await expect(page.locator('#current-email')).toHaveText(email, { timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Signed in', exact: true })).toBeVisible();
  await Promise.all(responses);
  expect(sessionId === signupId).toBe(true);

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('signed out');
  await page.getByRole('button', { name: 'Already have an account? Sign in' }).click();
  await page.locator('#password').evaluate((input) => { input.value = `incorrect-${crypto.randomUUID()}`; });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('incorrect');
  await page.locator('#password').evaluate((input) => { input.value = window.__signupTestPassword; });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#current-email')).toHaveText(email);
  await page.reload();
  await expect(page.locator('#current-email')).toHaveText(email);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeEnabled();
  await expect(page.locator('#account')).toBeHidden();
  console.log(JSON.stringify({ check: 'neon-email-signup', result: 'pass', email, signup_matches_session: true, session_survives_reload: true, signed_out: true }));
});
