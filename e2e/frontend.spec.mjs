import { expect, test } from '@playwright/test';

const noHorizontalOverflow = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('main dashboard starts at the labelled gate without console errors', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
  await expect(page.getByLabel('Dashboard key')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Skip to Main Content' })).toBeAttached();
  expect(await noHorizontalOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('sandbox sends no protected requests before unlock and fits a phone viewport', async ({ page }) => {
  const protectedRequests = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) protectedRequests.push(request.url()); });
  await page.goto('/sandbox');
  await expect(page.getByText('Dashboard key required.')).toBeVisible();
  await expect(page.getByLabel('Dashboard key')).toBeVisible();
  const commandButtons = page.locator('.command-btn');
  await expect(commandButtons).toHaveCount(5);
  for (let i = 0; i < await commandButtons.count(); i++) await expect(commandButtons.nth(i)).toBeDisabled();
  await page.waitForTimeout(500);
  expect(protectedRequests).toEqual([]);
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('agent page has labelled controls and a bounded locked state', async ({ page }) => {
  await page.goto('/agent');
  await expect(page.getByLabel('Dashboard key')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});

// These are unlocked browser-flow regressions with synthetic API fixtures, not
// live phone attestation. The old locked-screen smoke tests could not catch a
// command-only production document being labelled Offline or stale online=true.
const sandboxTestKey = 'synthetic-browser-test-key';
async function sandboxApi(page, { s24, deviceStatus = 200 } = {}) {
  const paths = new Set();
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    paths.add(path);
    expect(request.method()).toBe('GET');
    if (request.headers()['x-stats-key'] !== sandboxTestKey) {
      return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
    }
    if (path.startsWith('/api/devices/')) {
      return route.fulfill({ status: deviceStatus, json: deviceStatus === 200
        ? { status: path.includes('samsung-s24-ultra') ? s24 : { online: true, lastSeen: '2000-01-01T00:00:00Z' } }
        : { error: 'source unavailable' } });
    }
    const payloads = {
      '/api/data/whatsapp': { data: [{ body: 'Synthetic test message', kind: 'text' }] },
      '/api/data/calls': { data: [{ name: 'Synthetic contact', type: 'Call', duration_seconds: 3 }] },
      '/api/data/sms': { data: [] },
      '/api/data/contacts': { data: [], collected: false, note: 'Contacts are not collected' },
    };
    expect(payloads[path]).toBeDefined();
    return route.fulfill({ json: payloads[path] });
  });
  return paths;
}

for (const scenario of [
  { name: 'command-only production-shaped document', status: { commandQueue: {}, evidence: { capturedBy: 'synthetic-import' } }, label: 'Heartbeat unavailable', lastSeen: 'No heartbeat recorded' },
  { name: 'stale online flag', status: { online: true, lastSeen: '2000-01-01T00:00:00Z' }, label: 'Heartbeat stale' },
  { name: 'fresh reported heartbeat', status: () => ({ online: true, lastSeen: new Date().toISOString() }), label: 'Heartbeat fresh' },
  { name: 'explicit fresh offline report', status: () => ({ online: false, lastSeen: new Date().toISOString() }), label: 'Offline' },
  { name: 'future-dated heartbeat', status: { online: true, lastSeen: '2099-01-01T00:00:00Z' }, label: 'Heartbeat unavailable', lastSeen: 'Invalid heartbeat timestamp' },
  { name: 'failed status API', status: {}, deviceStatus: 500, label: 'Status unavailable', lastSeen: '--' },
]) {
  test(`unlocked sandbox handles ${scenario.name} while rendering data cards`, async ({ page }) => {
    const paths = await sandboxApi(page, { s24: typeof scenario.status === 'function' ? scenario.status() : scenario.status, deviceStatus: scenario.deviceStatus });
    await page.goto('/sandbox');
    await page.getByLabel('Dashboard key').fill(' \u200b' + sandboxTestKey + '\u2060 ');
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.locator('#s24-status')).toHaveText(scenario.label);
    if (scenario.lastSeen) await expect(page.locator('#s24-lastseen')).toHaveText(scenario.lastSeen);
    await expect(page.locator('#vivobook-status')).toHaveText(scenario.deviceStatus ? 'Status unavailable' : 'Heartbeat stale');
    await expect(page.locator('#whatsapp-list .data-item')).toHaveCount(1);
    await expect(page.locator('#calls-list .data-item')).toHaveCount(1);
    await expect(page.locator('#sms-list')).toHaveText('No data available');
    await expect(page.locator('#contacts-list')).toHaveText('Contacts are not collected');
    await expect(page.locator('#key-gate')).toBeHidden();
    expect([...paths].sort()).toEqual([
      '/api/data/calls', '/api/data/contacts', '/api/data/sms', '/api/data/whatsapp',
      '/api/devices/jayti-asus-vivobook/status', '/api/devices/samsung-s24-ultra/status',
    ]);
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
}

test('rejected sandbox key keeps both device panels locked, not offline', async ({ page }) => {
  await sandboxApi(page, { s24: {} });
  await page.goto('/sandbox');
  await page.getByLabel('Dashboard key').fill('synthetic-wrong-key');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.locator('#key-gate')).toBeVisible();
  await expect(page.locator('#key-gate-msg')).toContainText(/key/);
  await expect(page.locator('#s24-status')).toHaveText('Locked');
  await expect(page.locator('#vivobook-status')).toHaveText('Locked');
});
