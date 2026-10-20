import { expect, test } from '@playwright/test';

// The WhatsApp panel was rebuilt as a real chat client: a chat list on the
// left, a conversation on the right. These are browser-flow regressions
// against synthetic API fixtures, not live data.
//
// The panel's whole point is that it does not lie. A metadata-only chat must
// not look like a chat with readable text, and the headline must lead with
// the readable count rather than a bare row count.

const testKey = 'synthetic-messenger-test-key';

const CHATS = [
  {
    chat_id: 'h_readable_1', name: 'Family Group', kind: 'group',
    msg_count: 19837, stored_count: 19837, readable_count: 104, enc_count: 19733,
    media_count: 3, member_count: 5, first_at: '2026-09-01', last_at: '2026-10-19',
  },
  {
    chat_id: 'h_readable_2', name: 'Maa', kind: 'direct',
    msg_count: 4, stored_count: 4, readable_count: 4, enc_count: 0,
    media_count: 0, member_count: null, first_at: '2026-09-02', last_at: '2026-10-20',
  },
  {
    chat_id: 'h_locked_1', name: 'Old Recovery Dump', kind: 'direct',
    msg_count: 900, stored_count: 900, readable_count: 0, enc_count: 900,
    media_count: 40, member_count: null, first_at: '2024-01-01', last_at: '2024-06-30',
  },
];

const TOTALS = {
  chats: 3, groups: 1, direct: 2, msgs: 916, stored: 916, missing: 0,
  readable: 16, media: 43, audio: 5, calls: 2, enc: 900, undated: 1,
};

async function messengerApi(page, overrides = {}) {
  const seen = new Set();
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    seen.add(path);
    if (request.headers()['x-stats-key'] !== testKey) {
      return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
    }
    if (path === '/api/jp-whatsapp') {
      return route.fulfill({
        json: {
          ok: true, migrated: true, generated_at: '2026-10-20T12:00:00Z',
          chats: overrides.chats || CHATS,
          totals: overrides.totals || TOTALS,
          runs: [],
        },
      });
    }
    if (path === '/api/jp-telegram') {
      return route.fulfill({
        json: {
          ok: true, migrated: true, generated_at: '2026-10-20T12:00:00Z',
          chats: [], totals: {}, runs: [],
        },
      });
    }
    if (path === '/api/jp-wa-messages') {
      const chatId = new URL(request.url()).searchParams.get('chat_id');
      if (chatId === 'h_locked_1') {
        return route.fulfill({
          json: {
            ok: true, chat_id: chatId, count: 1, total_count: 900,
            total_readable_count: 0, total_metadata_count: 900, next_before: null,
            messages: [{
              msg_id: 'm-locked', sent_at: '2024-06-30T10:00:00Z', from_me: false,
              sender: 'Old Recovery Dump', sender_label: 'Old Recovery Dump',
              kind: 'text', encrypted: true, readable: false,
              body: '[Encrypted — export chat to read]', display_body: null,
            }],
          },
        });
      }
      return route.fulfill({
        json: {
          ok: true, chat_id: chatId, count: 2, total_count: 12,
          total_readable_count: 12, total_metadata_count: 0, next_before: null,
          messages: [
            {
              msg_id: 'm-2', sent_at: '2026-10-19T09:30:00Z', from_me: false,
              sender: 'Maa', sender_label: 'Maa', kind: 'text', encrypted: false,
              readable: true, body: 'Are you coming?', display_body: 'Are you coming?',
            },
            {
              msg_id: 'm-1', sent_at: '2026-10-19T09:00:00Z', from_me: true,
              sender: 'me', sender_label: 'You', kind: 'text', encrypted: false,
              readable: true, body: 'Yes!', display_body: 'Yes!',
            },
          ],
        },
      });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.addInitScript(key => sessionStorage.setItem('jbt_stats_key', key), testKey);
  return seen;
}

test('WhatsApp panel leads with readable chats and separates metadata-only ones', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await messengerApi(page);
  await page.goto('/');
  await page.locator('button[data-page="whatsapp"]').click();

  const panel = page.locator('#page-whatsapp');
  await expect(panel).toBeVisible();

  // The headline names the readable chats, not the raw row count.
  const split = panel.locator('#waSplit');
  await expect(split.locator('.mess-split-cell.readable .n')).toHaveText('2');
  await expect(split.locator('.mess-split-cell.readable .l')).toContainText('chats with readable text');
  await expect(split.locator('.mess-split-cell.meta .n')).toHaveText('1');
  await expect(split.locator('.mess-split-cell.meta .l')).toContainText('metadata only');

  // The default tab lists the readable chats and hides the locked one.
  const list = panel.locator('#waChatList');
  await expect(list.locator('.mess-chat')).toHaveCount(2);
  await expect(list).toContainText('Family Group');
  await expect(list).toContainText('Maa');
  await expect(list).not.toContainText('Old Recovery Dump');

  // The other tabs reach the locked chat, and label it as having no text.
  await panel.locator('.mess-tab', { hasText: 'Metadata only' }).click();
  await expect(list.locator('.mess-chat')).toHaveCount(1);
  await expect(list).toContainText('Old Recovery Dump');
  await expect(list).toContainText('No readable text');
  await expect(list.locator('.mess-badge.e')).toContainText('900 locked');

  expect(errors).toEqual([]);
});

test('a readable chat opens as a chat thread, oldest message first', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await messengerApi(page);
  await page.goto('/');
  await page.locator('button[data-page="whatsapp"]').click();

  await page.locator('#waChatList .mess-chat', { hasText: 'Maa' }).click();

  const thread = page.locator('#waThread');
  await expect(thread).toContainText('Maa');

  const bubbles = page.locator('#waBody .mess-bubble');
  await expect(bubbles).toHaveCount(2);
  // Chronological: the 09:00 message precedes the 09:30 one.
  await expect(bubbles.first()).toContainText('Yes!');
  await expect(bubbles.last()).toContainText('Are you coming?');

  // The outgoing message is on the right and carries the read receipt.
  await expect(page.locator('#waBody .mess-row.out')).toHaveCount(1);
  await expect(page.locator('#waBody .mess-row.out .mess-tick')).toHaveCount(1);

  // A date separator marks the day.
  await expect(page.locator('#waBody .mess-day')).toHaveCount(1);
  await expect(page.locator('#waBody .mess-day')).toHaveText('2026-10-19');

  expect(errors).toEqual([]);
});

test('a metadata-only chat says so instead of showing fake text', async ({ page }) => {
  await messengerApi(page);
  await page.goto('/');
  await page.locator('button[data-page="whatsapp"]').click();
  await page.locator('.mess-tab', { hasText: 'Metadata only' }).click();
  await page.locator('#waChatList .mess-chat', { hasText: 'Old Recovery Dump' }).click();

  const body = page.locator('#waBody');
  await expect(body).toBeVisible();
  // The row is drawn as locked, and no message text is invented for it.
  await expect(body.locator('.mess-bubble.locked')).toHaveCount(1);
  await expect(body).toContainText('Encrypted');
  await expect(body).not.toContainText('export chat to read');

  // The thread explains why, and how to fix it.
  await expect(page.locator('#waNotes')).toContainText('No readable text for this chat');
  await expect(page.locator('#waNotes')).toContainText('h_locked_1');
});

test('searching the chat list filters by name', async ({ page }) => {
  await messengerApi(page);
  await page.goto('/');
  await page.locator('button[data-page="whatsapp"]').click();
  await expect(page.locator('#waChatList .mess-chat')).toHaveCount(2);
  await page.locator('#waSearch').fill('family');
  await expect(page.locator('#waChatList .mess-chat')).toHaveCount(1);
  await expect(page.locator('#waChatList')).toContainText('Family Group');
  await expect(page.locator('#waChatList')).not.toContainText('Maa');
});

test('a chat with both kinds of row switches between text and every row', async ({ page }) => {
  const seen = [];
  await messengerApi(page);
  // Playwright runs the most recently registered route first, so this one
  // takes precedence over the catch-all in messengerApi.
  await page.route('**/api/jp-wa-messages*', async route => {
    const url = new URL(route.request().url());
    seen.push(url.searchParams.get('readable'));
    const chatId = url.searchParams.get('chat_id');
    if (url.searchParams.get('readable') === '1') {
      return route.fulfill({
        json: {
          ok: true, chat_id: chatId, count: 1, total_count: 104,
          total_readable_count: 104, total_metadata_count: 19733, next_before: null,
          messages: [{
            msg_id: 'm-1', sent_at: '2026-10-19T09:00:00Z', from_me: false,
            sender: 'Maa', sender_label: 'Maa', kind: 'text', encrypted: false,
            readable: true, body: 'Real text', display_body: 'Real text',
          }],
        },
      });
    }
    return route.fulfill({
      json: {
        ok: true, chat_id: chatId, count: 1, total_count: 19837,
        total_readable_count: 104, total_metadata_count: 19733, next_before: null,
        messages: [{
          msg_id: 'm-locked', sent_at: '2026-10-19T08:00:00Z', from_me: false,
          sender: 'Maa', sender_label: 'Maa', kind: 'text', encrypted: true,
          readable: false, body: '[Encrypted — export chat to read]', display_body: null,
        }],
      },
    });
  });
  await page.goto('/');
  await page.locator('button[data-page="whatsapp"]').click();

  // The mixed chat opens on its readable text, not on a locked row.
  await page.locator('#waChatList .mess-chat', { hasText: 'Family Group' }).click();
  await expect(page.locator('#waBody .mess-bubble')).toHaveCount(1);
  await expect(page.locator('#waBody')).toContainText('Real text');
  expect(seen[seen.length - 1]).toBe('1');

  // The switch is offered, because the chat has both kinds of row.
  const toggle = page.locator('#waMode');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText('Show all rows');

  await toggle.click();
  await expect(page.locator('#waBody .mess-bubble.locked')).toHaveCount(1);
  expect(seen[seen.length - 1]).toBeNull();
  await expect(toggle).toHaveText('Show readable text');
});

test('a chat with only one kind of row offers no switch', async ({ page }) => {
  await messengerApi(page);
  await page.goto('/');
  await page.locator('button[data-page="whatsapp"]').click();
  await page.locator('#waChatList .mess-chat', { hasText: 'Maa' }).click();
  await expect(page.locator('#waBody .mess-bubble')).toHaveCount(2);
  // Maa has readable rows and no locked ones, so there is nothing to switch to.
  await expect(page.locator('#waMode')).toBeHidden();
});

test('Telegram panel opens empty and says no data was captured', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const seen = await messengerApi(page);
  await page.goto('/');
  await page.locator('button[data-page="telegram"]').click();

  const panel = page.locator('#page-telegram');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#tgChatList')).toContainText('No Telegram data captured yet');
  // The prompt must not present a zero as if it were a measurement.
  await expect(panel.locator('#tgSplit .mess-split-cell.readable .n')).toHaveText('0');
  expect(seen.has('/api/jp-telegram')).toBe(true);
  expect(errors).toEqual([]);
});

test('the messenger panel fits a phone viewport', async ({ page }) => {
  await messengerApi(page);
  await page.goto('/');
  await page.locator('button[data-page="whatsapp"]').click();
  await expect(page.locator('#waChatList .mess-chat')).toHaveCount(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(overflow).toBe(true);
});
