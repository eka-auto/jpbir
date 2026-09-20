// The dashboard renders ONE sessions table for TWO endpoints.
//
// index.html picks /api/stats or /api/jp-stats from the site selector and feeds
// the result to the same renderer. So any session field one endpoint returns
// and the other does not shows up as a column that is populated on one site and
// blank on the other — with nothing in the page to explain why.
//
// That is what happened: `visitor_id`, `city`, `country` and `userAgent` were
// carried per session by jp-stats.js only, while the DEFAULT site (jbt) routes
// to stats.js. Four declared columns rendered empty on every row of the site
// most visits land on, and the table looked simply broken.
//
// Static parity check rather than a live one: both handlers need a real store,
// but the projection is literal in the source and that is the thing that drifts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

// The fields the sessions renderer actually reads off a session row.
const RENDERED = ['visitor_id', 'city', 'country', 'userAgent'];

const INDEX = read('Frontend/index.html');
const STATS = read('Backend/stats.js');
const JP_STATS = read('Backend/jp-stats.js');

t('the sessions renderer still reads the fields this test is about', () => {
  for (const f of RENDERED) {
    assert.ok(INDEX.includes('s.' + f), `index.html no longer reads s.${f}; update RENDERED`);
  }
});

for (const f of RENDERED) {
  t(`/api/stats carries ${f} on its session rows`, () => {
    assert.match(STATS, new RegExp('\\b' + f + ':'),
      `stats.js never puts ${f} on a session; the column is blank on the default site`);
  });
  t(`/api/jp-stats carries ${f} on its session rows`, () => {
    assert.match(JP_STATS, new RegExp('\\b' + f + ':'),
      `jp-stats.js never puts ${f} on a session`);
  });
}

t('both endpoints report which property they are scoped to, so the label cannot outrun the data', () => {
  assert.match(STATS, /site:\s*SITE/, 'stats.js stopped reporting its scope');
  assert.match(JP_STATS, /site:\s*site\s*\|\|\s*'all'/, 'jp-stats.js stopped reporting its scope');
});

console.log(`\n${pass}/${total} checks passed`);
if (pass !== total) process.exitCode = 1;
