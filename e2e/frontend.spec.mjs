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
async function sandboxApi(page, { s24, deviceStatus = 200, dataOverrides = {} } = {}) {
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
      '/api/data/sources': { ok: true, tables: [{ table: 's24_calls', endpoint: '/api/data/calls', schemaMatches: true, record_count: '12', latest_record_at: '2026-10-01T00:00:00Z' }] },
      ...dataOverrides,
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

test('database linkage audit uses authenticated GET and shows table-to-endpoint counts', async ({ page }) => {
  const paths = await sandboxApi(page, { s24: {} });
  await page.goto('/sandbox');
  await expect(page.getByRole('button', { name: 'Verify database linkage' })).toBeDisabled();
  await page.getByLabel('Dashboard key').fill(sandboxTestKey);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByRole('button', { name: 'Verify database linkage' }).click();
  await expect(page.locator('#source-audit')).toContainText('Database linkage verified.');
  await expect(page.locator('#source-audit')).toContainText('s24_calls → /api/data/calls: 12 stored records');
  expect(paths.has('/api/data/sources')).toBe(true);
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('archived and partial results remain visible without masquerading as live collection', async ({ page }) => {
  await sandboxApi(page, { s24: {}, dataOverrides: {
    '/api/data/calls': { data: [{ name: 'Synthetic archived contact', duration_seconds: 9 }], partial: true, sources: [{ source: 'neon_archive', archival: true }] },
    '/api/data/sms': { data: [], partial: true, sources: [] },
  } });
  await page.goto('/sandbox');
  await page.getByLabel('Dashboard key').fill(sandboxTestKey);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.locator('#calls-list .data-item')).toHaveCount(1);
  await expect(page.locator('#calls-list')).toContainText('Source: Postgres archive');
  await expect(page.locator('#calls-list')).toContainText('Partial result');
  await expect(page.locator('#sms-list')).toContainText('Data unavailable from one or more sources');
});

// The database explorer reads an imported Neon archive. Even a recent export
// of status=connected is not a current signed phone heartbeat. All fixtures
// and credentials below are synthetic and stay on the local test server.
const archiveTestKey = 'k'.repeat(40);
async function archiveApi(page, { device = {}, status = 200 } = {}) {
  const views = new Set();
  await page.route('**/api/db-api**', async route => {
    const request = route.request();
    expect(request.method()).toBe('GET');
    expect(request.headers()['x-stats-key']).toBe(archiveTestKey);
    const view = new URL(request.url()).searchParams.get('view');
    views.add(view);
    if (view === 's24' && status !== 200) {
      return route.fulfill({ status, json: { ok: false, error: 'Archive source unavailable' } });
    }
    const data = {
      sites: [],
      health: { counts: { s24_records: 74 }, countsForSite: {}, coverage: {}, sources: [], span: {} },
      overview: { totals: {}, daily: [], hourly: [], byType: [], topPages: [], countries: [], cities: [], browsers: [], oses: [], devices: [], referrers: [], utm: [], languages: [], isps: [], timezones: [], domains: [], screens: [] },
      s24: {
        migrated: true, normalized: true, section: 'overview', total: 0, limit: 100, offset: 0,
        rows: [], counts: { all: 74, calls: 32, sms: 0, commands: 31 }, device,
        datasets: [{ dataset: 'direct_sms', status: 'unavailable', record_count: 0, stored_records: 0, detail: 'phone attestation failed' }],
        runs: [{ started_at: new Date().toISOString(), upload_status: 'complete' }],
        runsTotal: 1, batches: [], batchesTotal: 0,
      },
    }[view];
    expect(data).toBeDefined();
    return route.fulfill({ json: { ok: true, view, data } });
  });
  await page.addInitScript(key => sessionStorage.setItem('jbt_stats_key', key), archiveTestKey);
  return views;
}

for (const scenario of [
  { name: 'stale connected snapshot', device: { status: 'connected', observed_at: '2000-01-01T00:00:00Z', last_seen: '2000-01-01T00:00:00Z' } },
  { name: 'recent stored verification flags', device: () => ({ status: 'connected', observed_at: new Date().toISOString(), last_seen: new Date().toISOString(), runtime_is_android: true, live_device_verified: true }) },
  { name: 'future-dated stored verification flags', device: { status: 'connected', observed_at: '2099-01-01T00:00:00Z', last_seen: '2099-01-01T00:00:00Z', runtime_is_android: true, live_device_verified: true } },
  { name: 'missing phone snapshot', device: {} },
]) {
  test(`database explorer treats ${scenario.name} as historical, not live`, async ({ page }) => {
    const device = typeof scenario.device === 'function' ? scenario.device() : scenario.device;
    const views = await archiveApi(page, { device });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/db');
    await page.locator('button[data-page="s24"]').click();
    const archive = page.locator('#page-s24');
    const evidence = archive.locator('.card').filter({ has: page.getByRole('heading', { name: /Archived phone evidence/ }) });
    await expect(evidence).toContainText('Historical evidence — not live verified.');
    await expect(evidence.locator('h3 .tag')).toHaveText(device.status ? 'historical snapshot' : 'no phone evidence');
    await expect(evidence.getByRole('link', { name: 'Check current device status' })).toHaveAttribute('href', '/s24');
    if (device.status) await expect(evidence).toContainText('Recorded statusconnected');
    await expect(archive).toContainText('Export time, not a phone heartbeat');
    await expect(archive).toContainText('1 unavailable');
    await expect(archive).not.toContainText('no silent gaps');
    await expect(archive.locator('.kpi').filter({ hasText: 'Records' }).first()).toContainText('74');
    await expect(archive.locator('.kpi').filter({ hasText: 'Calls' }).first()).toContainText('32');
    expect(views.has('s24')).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('failed archive API is visible and never paints a connected phone', async ({ page }) => {
  await archiveApi(page, { status: 500 });
  await page.goto('/db');
  await page.locator('button[data-page="s24"]').click();
  await expect(page.locator('#err')).toContainText('Archive source unavailable');
  await expect(page.locator('#page-s24')).not.toContainText('historical snapshot');
});
