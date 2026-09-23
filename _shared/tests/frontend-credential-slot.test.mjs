// Every gated page must read the SAME credential slot, the same way.
//
// Four slots had drifted apart across eight pages, and the symptom was pages
// that looked dead:
//
//   index.html       'jbt_stats_key' in localStorage, and it actively DELETES
//                    the sessionStorage copy (index.html:719)
//   s24 / vivobook   'jbt_stats_key' in sessionStorage ONLY -- so unlocking the
//   / agent          main dashboard and clicking through hit the gate again,
//                    because index.html had just cleared the slot they read
//   jteka            'jbt_site' -- which is index.html's SITE SELECTOR, not a
//                    credential. After any visit to the main dashboard this
//                    page sent `x-stats-key: jbt` and took a flat 401
//   db               's24DashboardKey' -- a fourth slot, so /db needed its own
//                    unlock for the same key, on the only page that renders the
//                    entire S24 archive
//
// None of it is catchable by eye: every page looked internally consistent. The
// contract is cross-file, so the test has to be too.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'Frontend');
const read = (f) => readFileSync(join(FRONTEND, f), 'utf8');

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

// Every live page that sends the dashboard key. template.html does not gate,
// so it is deliberately absent. viewer.html joined when it stopped being a
// keyless Chrome-history viewer and became the key-gated Media gallery (PR
// #109): a page that sends the key is exactly what this contract is for.
const GATED = ['index.html', 's24.html', 'vivobook.html', 'agent.html', 'jteka.html', 'db.html', 'viewer.html'];
const SLOT = 'jbt_stats_key';

// Strip // and /* */ comments so a slot name mentioned in an explanation is not
// mistaken for a live read. Naive, but these files have no regex literals or
// strings containing '//' in the credential code.
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

for (const page of GATED) {
  t(`${page} stores the dashboard key in the shared '${SLOT}' slot`, () => {
    assert.ok(code(read(page)).includes(SLOT), `${page} never names ${SLOT}`);
  });
}

t('no page uses the site-selector slot as a credential — jteka did, and took a 401 every time', () => {
  for (const page of GATED) {
    const src = code(read(page));
    // index.html legitimately owns jbt_site as the site selector. Anywhere else
    // it must not appear next to key handling at all.
    if (page === 'index.html') continue;
    assert.equal(src.includes('jbt_site'), false,
      `${page} references jbt_site; that slot is index.html's site selector, not the key`);
  }
});

t('index.html keeps jbt_site strictly for site selection, never as a key', () => {
  const src = code(read('index.html'));
  for (const m of src.matchAll(/^.*jbt_site.*$/gm)) {
    assert.equal(/KEY|stats-key|x-stats/i.test(m[0]), false,
      `jbt_site appears on a credential line: ${m[0].trim().slice(0, 100)}`);
  }
});

for (const page of GATED) {
  t(`${page} reads localStorage, so a key set by the main dashboard reaches it`, () => {
    const src = code(read(page));
    assert.match(src, /localStorage\.getItem\(\s*(KEY_STORAGE|KEY_STORE|'jbt_stats_key'|"jbt_stats_key")/,
      `${page} never reads the slot from localStorage; index.html canonicalises it there`);
  });
}

for (const page of ['s24.html', 'vivobook.html', 'agent.html', 'jteka.html', 'viewer.html']) {
  t(`${page} writes the key to localStorage, not only sessionStorage`, () => {
    const src = code(read(page));
    assert.match(src, /localStorage\.setItem\(\s*(KEY_STORAGE|KEY_STORE)/,
      `${page} writes only to sessionStorage; index.html:719 clears that copy`);
  });
}

t('db.html migrates its legacy s24DashboardKey slot rather than stranding anyone already unlocked', () => {
  const src = code(read('db.html'));
  assert.ok(src.includes("LEGACY_KEY_STORAGE = 's24DashboardKey'"), 'legacy slot name is gone entirely');
  assert.match(src, /getItem\(LEGACY_KEY_STORAGE\)/, 'legacy slot is never read, so existing users are logged out');
  assert.match(src, /removeItem\(LEGACY_KEY_STORAGE\)/, 'legacy slot is never cleared, so the migration never completes');
});

t('no gated page still makes a raw sessionStorage call against the legacy db slot', () => {
  for (const page of GATED) {
    const src = code(read(page));
    assert.equal(/sessionStorage\.(get|set|remove)Item\(\s*['"]s24DashboardKey['"]/.test(src), false,
      `${page} still touches 's24DashboardKey' directly instead of the migrating accessors`);
  }
});

t('every storage access is wrapped against private mode, where localStorage throws on access', () => {
  for (const page of GATED) {
    const src = read(page);
    assert.match(src, /try\s*\{[^}]*(localStorage|sessionStorage)/,
      `${page} touches storage with no try/catch; private mode throws rather than returning null`);
  }
});

// ── 503 means two things; only one of them should log you out ───────────
// The store-backed handlers moved their "not configured on this deployment"
// responses from 500 to 503 to match Backend/_auth.js. That made 503 ambiguous:
// "no STATS_KEY" (an auth problem) and "no DATABASE_URL" (a store outage) now
// share a status. The pages clear the stored key on 503, which is right for the
// first and destructive for the second -- a database outage would log the
// operator out and make them re-enter a key that was never at fault.
// _auth.js tags its own failures with an `auth_*` code; the pages branch on it.

const AUTH_JS = readFileSync(join(FRONTEND, '..', 'Backend', '_auth.js'), 'utf8');

t('_auth.js tags every failure with a stable code, so 503 can be told apart from a store outage', () => {
  for (const code of ['auth_not_configured', 'auth_missing', 'auth_invalid']) {
    assert.ok(AUTH_JS.includes(code), `_auth.js no longer emits ${code}`);
  }
  assert.match(AUTH_JS, /json\(\{\s*success:\s*false,\s*code:\s*result\.code/,
    'requireKey stopped putting the code on the wire, so no client can branch on it');
});

t('no handler answers 500 for an unconfigured deployment — that split behaviour is what 503 fixed', () => {
  const backend = join(FRONTEND, '..', 'Backend');
  const offenders = [];
  for (const f of readdirSync(backend).filter((n) => n.endsWith('.js'))) {
    for (const line of readFileSync(join(backend, f), 'utf8').split('\n')) {
      if (line.includes('status(500)') && /not set|not configured|unconfigured/i.test(line)) {
        offenders.push(`${f}: ${line.trim().slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'these should be 503, like Backend/_auth.js');
});

for (const page of ['index.html', 'db.html', 'viewer.html']) {
  t(`${page} only clears the stored key when _auth.js says the failure was an auth one`, () => {
    const src = code(read(page));
    assert.match(src, /\/\^auth_\/\.test\(/,
      `${page} still treats every 503 as an auth failure, so a store outage logs the operator out`);
  });
}

console.log(`\n${pass}/${total} checks passed`);
if (pass !== total) process.exitCode = 1;
