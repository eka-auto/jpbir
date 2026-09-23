// Device pages must escape what devices write.
//
// /s24 and /vivobook render each device's Firestore `network` map, and
// Backend/jp-devices.js passes that map through exactly as the agent stored it
// (`network = f.network`). Its signal and traffic figures look like numbers, so
// both pages concatenated them into innerHTML raw: a signal_percent of
// <img onerror=...> ran as markup on a page whose localStorage holds the
// dashboard key. s24.html was fixed in PR #111 and vivobook.html after it.
//
// The contract is cross-page, so this runs the renderNetwork() each page ships
// (lifted out by brace matching, the ip-grouping.test.mjs technique; none of the
// lifted helpers holds a brace inside a string or regex, which is all this
// simple matcher needs) against one crafted map and reads the HTML it writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'Frontend');

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

function lift(src, page, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start !== -1, `${name}() not found in Frontend/${page}`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces while lifting ${name}() from ${page}`);
}

// Runs one page's renderNetwork(dev) against stub elements and returns them.
function render(page, dev) {
  const src = readFileSync(join(FRONTEND, page), 'utf8');
  const els = {};
  const $ = (id) => (els[id] = els[id] || { innerHTML: '', textContent: '' });
  const helpers = ['esc', 'fmtTime', 'fmtAgo', 'renderNetwork'].map((n) => lift(src, page, n)).join('\n');
  // BLANK_HINTS (vivobook) and netWithdrawn (s24) are page state renderNetwork touches.
  new Function('$', 'var BLANK_HINTS = { netHint: "" }, netWithdrawn = true;\n' + helpers + '\nreturn renderNetwork;')($)(dev);
  return els;
}

const XSS = '<img src=x onerror="window.__xss=1">';
const crafted = {
  deviceId: 'device-under-test',
  network: {
    ssid: 'Home-5G', wifiSignal: { signal_percent: XSS }, sent_mb: XSS, recv_mb: XSS,
    updatedAt: '2026-09-23T04:00:00Z', interfaces: { wlan0: '192.168.1.44/24' },
  },
};

for (const page of ['s24.html', 'vivobook.html']) {
  t(`${page}: device-written signal and traffic figures are text, never markup`, () => {
    const html = render(page, crafted).netDetail.innerHTML;
    assert.equal(/<img/i.test(html), false, 'a crafted network figure reached the page as a live <img>');
    assert.equal((html.match(/&lt;img src=x onerror=&quot;window\.__xss=1&quot;&gt;/g) || []).length, 3,
      'signal, sent and received should each appear once, escaped');
  });

  t(`${page}: ordinary figures still read as figures`, () => {
    const els = render(page, { network: { ssid: 'Home-5G', wifiSignal: { signal_percent: 72 }, sent_mb: 412.6, recv_mb: 2290.1 } });
    const html = els.netDetail.innerHTML;
    assert.match(html, />72%</);
    assert.match(html, />412\.6 MB</);
    assert.match(html, />2290\.1 MB</);
    assert.equal(els.netHint.textContent, 'Connected to Home-5G · 72% signal');
  });
}

console.log(`\n${pass}/${total} checks passed`);
if (pass !== total) process.exitCode = 1;
