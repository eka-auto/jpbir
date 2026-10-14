// Exercise the shipped inline script, not a duplicate implementation. A copied
// dashboard key can contain invisible format characters that trim() leaves in
// place; every credential entry point must behave like the password input.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../../Devices/sandbox/dashboard/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const key = 'Ab9-test-key';
const copied = ' \t\u200b' + key + '\u2060\ufeff\u202c\n';

function storage(initial = '') {
  const values = new Map(initial ? [['SANDBOX_KEY', initial]] : []);
  return {
    getItem: name => values.get(name) ?? null,
    setItem: (name, value) => values.set(name, String(value)),
    removeItem: name => values.delete(name)
  };
}

function page({ session = '', legacy = '', search = '', denied = false } = {}) {
  const elements = new Map();
  const requests = [];
  const urls = [];
  const timers = [];
  const element = id => {
    if (!elements.has(id)) {
      const listeners = {};
      elements.set(id, {
        value: '', hidden: id === 'key-gate', textContent: '', innerHTML: '',
        addEventListener: (event, fn) => { listeners[event] = fn; },
        click: () => listeners.click?.(),
        keydown: key => listeners.keydown?.({ key })
      });
    }
    return elements.get(id);
  };
  const sessionStorage = storage(session);
  const localStorage = storage(legacy);
  if (denied) {
    sessionStorage.getItem = sessionStorage.setItem = () => { throw new Error('storage denied'); };
  }
  const context = vm.createContext({
    URLSearchParams, location: { search, pathname: '/', hash: '#dashboard' },
    history: { replaceState: (_state, _title, url) => urls.push(url) },
    sessionStorage, localStorage,
    document: { getElementById: element, querySelectorAll: () => [] },
    setInterval: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
    console: { error: () => {} },
    fetch: async (url, opts) => {
      requests.push({ url, opts });
      const status = context.responseStatus || (opts.headers['X-Stats-Key'] === key ? 200 : 401);
      return { status, ok: status === 200, json: async () => ({ data: [] }) };
    }
  });
  vm.runInContext(script, context);
  return { context, element, requests, urls, timers, sessionStorage, localStorage };
}

// Drain only promises from the mocked fetch chain; no network or real timers.
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
let pass = 0, total = 0;
async function t(name, fn) {
  total++;
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (error) { console.log('  FAIL ' + name + ' -> ' + error.message); process.exitCode = 1; }
}

await t('pasted keys remove invisible format characters before all six API reads', async () => {
  const p = page();
  p.element('key-input').value = copied;
  p.element('key-unlock').click();
  await settle();
  assert.equal(p.requests.length, 6);
  assert.ok(p.requests.every(r => r.opts.headers['X-Stats-Key'] === key));
  assert.equal(p.sessionStorage.getItem('SANDBOX_KEY'), key);
  assert.equal(p.element('key-input').value, '');
  assert.equal(p.element('key-gate').hidden, true);
  assert.equal(p.timers.length, 1);
});
await t('Enter uses the same normalization as the Unlock button', async () => {
  const p = page();
  p.element('key-input').value = copied;
  p.element('key-input').keydown('Enter');
  await settle();
  assert.equal(p.requests[0].opts.headers['X-Stats-Key'], key);
});
await t('URL bootstrap normalizes and removes every key parameter without losing other URL parts', async () => {
  const p = page({ search: '?view=all&key=' + encodeURIComponent(copied) + '&key=discarded' });
  await settle();
  assert.equal(p.sessionStorage.getItem('SANDBOX_KEY'), key);
  assert.equal(p.urls[0], '/?view=all#dashboard');
});
await t('existing session keys are normalized and repaired in session storage', async () => {
  const p = page({ session: copied });
  await settle();
  assert.equal(p.sessionStorage.getItem('SANDBOX_KEY'), key);
  assert.ok(p.requests.every(r => r.opts.headers['X-Stats-Key'] === key));
});
await t('legacy keys migrate normalized to session storage and leave no persistent copy', async () => {
  const p = page({ legacy: copied });
  await settle();
  assert.equal(p.sessionStorage.getItem('SANDBOX_KEY'), key);
  assert.equal(p.localStorage.getItem('SANDBOX_KEY'), null);
});
await t('format-only and whitespace-only pasted keys cannot unlock or start requests', async () => {
  for (const value of [' \t\n', '\u200b\u2060\u202c', ' \u200b ']) {
    const p = page();
    p.element('key-input').value = value;
    p.element('key-unlock').click();
    await settle();
    assert.equal(p.requests.length, 0);
    assert.equal(p.element('key-gate').hidden, false);
  }
});
await t('format-only stored and URL keys are removed without making protected requests', async () => {
  for (const options of [{ session: '\u200b' }, { legacy: '\u2060' }, { search: '?key=%E2%80%8B' }, { search: '?key=' }]) {
    const p = page(options);
    await settle();
    assert.equal(p.requests.length, 0);
    assert.equal(p.sessionStorage.getItem('SANDBOX_KEY'), null);
    assert.equal(p.localStorage.getItem('SANDBOX_KEY'), null);
    if (options.search) assert.equal(p.urls[0], '/#dashboard');
  }
});
await t('meaningful characters and case remain unchanged and a wrong key is still rejected', async () => {
  const p = page();
  p.context.setKey(' Ab9 test-KEY! ');
  assert.equal(p.context.getKey(), 'Ab9 test-KEY!');
  await p.context.apiFetch('/data/whatsapp');
  assert.equal(p.requests[0].opts.headers['X-Stats-Key'], 'Ab9 test-KEY!');
  assert.equal(p.context.getKey(), '');
  assert.equal(p.element('key-gate').hidden, false);
});
await t('a 503 configuration failure retains the normalized key while a 401 clears it', async () => {
  const p = page();
  p.context.setKey(copied);
  p.context.responseStatus = 503;
  await p.context.apiFetch('/data/whatsapp');
  assert.equal(p.context.getKey(), key);
  p.context.responseStatus = 401;
  await p.context.apiFetch('/data/whatsapp');
  assert.equal(p.context.getKey(), '');
});
await t('unavailable session storage stays fail closed without protected startup requests', async () => {
  const p = page({ denied: true, search: '?key=' + encodeURIComponent(copied) });
  await settle();
  assert.equal(p.requests.length, 0);
  assert.equal(p.context.getKey(), '');
  assert.equal(p.element('key-gate').hidden, false);
});
console.log(`\n${pass}/${total} sandbox key normalization checks passed`);
