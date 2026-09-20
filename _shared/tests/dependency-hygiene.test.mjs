// Every production dependency must be imported by something.
//
// Commit fd66890 ("build(deps): add neon-js, workflow SDK, and
// react-router-dom") put three packages into `dependencies` that no file in the
// repository imports. The cost was not the three entries, it was the tree they
// dragged in: package-lock went from 427 to 1164 entries — +737 packages,
// +13,596 lines — and node_modules from 396 MB to 801 MB. `.github/workflows/ci-cd.yml`
// runs `npm ci`, so every CI run installed all of it, and @vercel/node bundles
// dependencies into each serverless function, so every cold start carried it.
//
// react-router-dom is the clearest case: it pulls React into a repository whose
// own CLAUDE.md opens with "no build step and no frontend framework — pages are
// hand-written HTML with inline vanilla JS". Nothing served by vercel.json could
// have used it. @neondatabase/neon-js was a pre-1.0 beta on a caret range, in
// production dependencies, for a project that reaches Postgres through `pg`.
//
// Unused dependencies are invisible: nothing fails, nothing warns, and the only
// symptom is a slow install and a fat bundle that nobody attributes to a
// specific commit. So the check has to be an assertion.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

// Every tracked source file, including the vendored Frontend/Backend trees. A
// dependency that only a vendored file imports is still a dependency somebody
// chose to declare, and the point here is to catch the ones NOTHING references.
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n')
  .filter((f) => /\.(js|mjs|cjs|ts|tsx|jsx)$/.test(f));

const sources = new Map();
for (const f of tracked) {
  try { sources.set(f, readFileSync(join(ROOT, f), 'utf8')); } catch { /* unreadable, skip */ }
}

function importersOf(name) {
  // Bare specifier, optionally with a subpath: 'pkg' or 'pkg/sub'.
  const rx = new RegExp(String.raw`(?:from|import|require\()\s*['"]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/[^'"]*)?['"]`);
  const out = [];
  for (const [f, s] of sources) if (rx.test(s)) out.push(f);
  return out;
}

t('the file scan actually found the source tree, so a pass cannot be vacuous', () => {
  assert.ok(sources.size > 100, `only ${sources.size} source files scanned — the glob is wrong`);
  assert.ok(importersOf('pg').length > 0, 'pg is imported by Integrations/postgres.js; the matcher is broken');
});

for (const name of Object.keys(pkg.dependencies || {})) {
  t(`${name} is imported by something`, () => {
    const importers = importersOf(name);
    assert.ok(importers.length > 0,
      `nothing imports ${name}. An unused production dependency installs on every ` +
      `npm ci and ships in every serverless bundle. Remove it, or move it to ` +
      `devDependencies if it is a tool rather than a runtime import.`);
  });
}

t('no React or router package is a production dependency of a repo with no frontend framework', () => {
  const banned = Object.keys(pkg.dependencies || {})
    .filter((n) => /^react(-dom|-router.*)?$/.test(n) || n === 'react-router');
  assert.deepEqual(banned, [],
    'CLAUDE.md: "no build step and no frontend framework — pages are hand-written HTML ' +
    'with inline vanilla JS". Nothing vercel.json serves can execute these.');
});

t('no production dependency is pinned to a pre-1.0 beta on a caret range', () => {
  const risky = Object.entries(pkg.dependencies || {})
    .filter(([, spec]) => /^\^0\./.test(spec) && /-(beta|alpha|rc|canary)/.test(spec))
    .map(([n, s]) => `${n}@${s}`);
  assert.deepEqual(risky, [],
    'a caret range on a 0.x pre-release lets a breaking build land with no commit here');
});

console.log(`\n${pass}/${total} checks passed`);
if (pass !== total) process.exitCode = 1;
