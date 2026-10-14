// The two device pages, /s24 and /vivobook, keep two contracts with the data
// they render. Both are cross-file, so neither is visible from one page alone.
//
// 1. They escape what devices write. Each renders its device's Firestore
//    `network` map, and Backend/jp-devices.js passes that map through exactly as
//    the agent stored it (`network = f.network`). Its signal and traffic figures
//    look like numbers, so both pages concatenated them into innerHTML raw: a
//    signal_percent of <img onerror=...> ran as markup on a page whose
//    localStorage holds the dashboard key. s24.html was fixed in PR #111 and
//    vivobook.html in #116.
//
// 2. A queue row is amber exactly when the "pending" KPI counts it. The KPI is
//    commandQueuePendingDepth, counted over Backend/s24-public.js's
//    PENDING_STATUSES; the badge colour is each page's own statusBadge(). The
//    two drifted apart once: finished commands ('ok', 'done', 'error') were drawn
//    amber, so /s24 showed eight amber rows under a KPI of "2 pending".
//
// This runs the functions each page ships (lifted out by brace matching, the
// ip-grouping.test.mjs technique; none of the lifted helpers holds a brace
// inside a string or regex, which is all this simple matcher needs) and reads
// the HTML they write.
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

// ── 2. amber means pending, on both pages ──────────────────────────────
const BACKEND = readFileSync(join(FRONTEND, '..', 'Backend', 's24-public.js'), 'utf8');
const pendingMatch = BACKEND.match(/const PENDING_STATUSES = \[([^\]]*)\]/);
const PENDING = pendingMatch ? [...pendingMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
const AMBER = 'color:#B9770E';
// Statuses the phone, the laptop agent and the backend write, plus names no
// list knows, a prototype member and a number stored by an older writer.
const SEEN = ['pending', 'queued', 'requested', 'claimed', 'completed', 'ok', 'done', 'failed', 'error', 'rejected',
  'written', 'cancelled', 'constructor', 'toString', 7, '', null];

function badgeOf(page) {
  const src = readFileSync(join(FRONTEND, page), 'utf8');
  // The status sets are page-level vars the lifted function reads.
  const sets = [...src.matchAll(/var (WAITING|SUCCEEDED|FAILED) = \{[^}]*\};/g)].map((m) => m[0]).join('\n');
  const inSet = src.includes('function inSet(') ? lift(src, page, 'inSet') : '';
  return new Function(sets + '\n' + inSet + '\n' + ['esc', 'statusBadge'].map((n) => lift(src, page, n)).join('\n') + '\nreturn statusBadge;')();
}

t('the backend\'s PENDING_STATUSES list is readable (the badge contract below is checked against it)', () => {
  assert.deepEqual(PENDING, ['pending', 'queued', 'requested', 'claimed']);
});

for (const page of ['s24.html', 'vivobook.html']) {
  t(`${page}: a queue row is amber exactly when the pending KPI counts its status`, () => {
    const badge = badgeOf(page);
    for (const status of SEEN) {
      const counted = PENDING.includes(status);
      // An empty or null status is drawn as 'pending' by both pages, and the
      // backend counts neither; skip those rather than assert a known gap twice.
      if (status === '' || status === null) continue;
      assert.equal(badge(status).includes(AMBER), counted,
        `${JSON.stringify(status)} is ${counted ? 'counted as pending but not' : 'not counted as pending but is'} drawn amber`);
    }
  });

  t(`${page}: finished commands read as finished, and any status prints as text`, () => {
    const badge = badgeOf(page);
    for (const s of ['ok', 'completed']) assert.match(badge(s), /color:#2ea043/, `${s} is not green`);
    for (const s of ['failed', 'error', 'rejected']) assert.match(badge(s), /color:#c83c3c/, `${s} is not red`);
    assert.match(badge('completed'), />DONE</);
    assert.match(badge(7), />7</, 'a numeric status must render, not throw');
    assert.equal(/<img/.test(badge('<img src=x onerror=1>')), false, 'a crafted status reached the page as markup');
  });
}

t('the main device dashboard labels generated_at as fetched, not a device sync', () => {
  const index = readFileSync(join(FRONTEND, 'index.html'), 'utf8');
  assert.match(index, /' · fetched ' \+ fmtTime\(res\.body\.generated_at\)/);
  assert.doesNotMatch(index, /' · synced ' \+ fmtTime\(res\.body\.generated_at\)/);
  assert.match(index, /var liveSync = newestLastSeen\(devices\)/);
});

console.log(`\n${pass}/${total} checks passed`);
if (pass !== total) process.exitCode = 1;
