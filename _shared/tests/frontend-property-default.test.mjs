// The dashboard's landing property is declared in exactly one place.
//
// index.html's site selector is the control that decides which tracked property
// every ANALYZE panel reads (`/api/stats?site=`), and its markup has always
// declared the birthday website as the option that is `selected`. 357185a
// ("fix: harden dashboard deployment and test coverage") added a second,
// hard-coded default in the script — `sessionStorage.getItem('jbt_site') ||
// 'tech'` — so a fresh browser opened on jaytipargal.tech while the selector
// still displayed jbt. The visible symptom was the owner's report: visit the
// birthday website, open the dashboard, and the Live feed and Sessions panel
// show zero, because the panel was reading a property the visit never touched.
//
// Nothing failed: the markup was right, the script was right on its own terms,
// and no test compared them. This is that comparison.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX = readFileSync(join(ROOT, 'Frontend', 'index.html'), 'utf8');

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

// The selector block, from its opening tag to the matching </select>. Bounded so
// an option added to some other select can never be mistaken for this one.
const selectorBlock = (() => {
  const start = INDEX.indexOf('id="siteSel"');
  assert.ok(start > -1, 'the site selector (#siteSel) is gone from index.html');
  const end = INDEX.indexOf('</select>', start);
  assert.ok(end > start, '#siteSel has no closing </select>');
  return INDEX.slice(start, end);
})();

const optionValues = [...selectorBlock.matchAll(/<option\s+value="([^"]+)"/g)].map((m) => m[1]);
const selectedValues = [...selectorBlock.matchAll(/<option\s+value="([^"]+)"[^>]*\bselected\b/g)].map((m) => m[1]);

// The one line that decides the landing property. Anchored to the top-level
// `var SITE =` so the `SITE = this.value` handler is not picked up.
const siteInit = (() => {
  const m = INDEX.match(/^\s*var SITE = (.*);\s*$/m);
  assert.ok(m, 'index.html no longer initialises SITE with a single `var SITE = ...` line');
  return m[1];
})();

const hostsLiteral = (() => {
  const m = INDEX.match(/var SITE_HOSTS = (\{[^}]*\});/);
  assert.ok(m, 'SITE_HOSTS is gone from index.html');
  return m[1];
})();

const hostMap = Object.fromEntries(
  [...hostsLiteral.matchAll(/([A-Za-z0-9_-]+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]])
);

t('the selector declares exactly one selected property', () => {
  assert.equal(selectedValues.length, 1,
    'expected one <option ... selected> in #siteSel, found ' + selectedValues.length);
});

t('the landing property is the birthday website', () => {
  // The product is the birthday website; the dashboard is how the owner watches
  // it. Changing the landing view is a deliberate edit to the markup, and this
  // assertion is here so it cannot happen as a side effect of some other change.
  assert.equal(hostMap[selectedValues[0]], 'jaytibirthday.in',
    'the selector no longer lands on jaytibirthday.in; if that is intended, change the markup and this expectation together');
});

t('the script does not restate the default as a second literal', () => {
  // `sessionStorage.getItem('jbt_site') || 'tech'` was the regression: a literal
  // that disagreed with the markup and nothing compared them. The selector's own
  // element id is not a property, so `$('siteSel')` is stripped before the scan.
  const withoutIds = siteInit.replace(/\$\('[^']*'\)/g, '$()');
  const literals = [...withoutIds.matchAll(/'([a-z0-9_-]+)'/gi)]
    .map((m) => m[1])
    .filter((v) => v !== 'jbt_site');
  for (const value of literals) {
    assert.equal(value, selectedValues[0],
      `SITE falls back to '${value}' while the selector declares '${selectedValues[0]}' as selected`);
  }
});

t('SITE is resolved from the selector the operator actually sees', () => {
  assert.match(siteInit, /siteSel/,
    'SITE no longer reads #siteSel, so the dropdown and the panels can disagree');
});

t('every property the selector offers is a property the script can read', () => {
  assert.deepEqual(optionValues.slice().sort(), Object.keys(hostMap).sort(),
    'the selector options and SITE_HOSTS have drifted apart');
  for (const [key, host] of Object.entries(hostMap)) {
    assert.ok(host.includes('.'), key + ' maps to "' + host + '", which is not a host');
  }
  assert.equal(new Set(Object.values(hostMap)).size, Object.keys(hostMap).length,
    'two selector entries point at the same property');
});

console.log('\n  ' + pass + '/' + total + ' passed');
