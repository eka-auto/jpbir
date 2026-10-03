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
