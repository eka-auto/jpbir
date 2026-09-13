// Runs every *.test.mjs in this directory, in a child process each, and exits
// non-zero if any of them does.
//
// `npm test` previously resolved to `echo 'No tests specified'`, so the CI step
// `npm test --if-present` exited 0 without executing anything - four suites and
// then a fifth sat in this directory being run only by hand. These suites are
// plain scripts that set process.exitCode rather than node:test files, so
// `node --test` does not drive them either; this runner does.

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort();

if (!files.length) {
  console.error('no *.test.mjs found in ' + here);
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  console.log(`\n=== ${file}`);
  const res = spawnSync(process.execPath, [join(here, file)], { stdio: 'inherit' });
  // A signal kill leaves status null; treat anything that is not a clean 0 as a
  // failure so a crashed suite cannot be mistaken for a passing one.
  if (res.status !== 0) {
    failed++;
    console.log(`--- ${file} FAILED (exit ${res.status === null ? 'signal ' + res.signal : res.status})`);
  }
}

console.log(`\n${files.length - failed}/${files.length} suites passed`);
process.exit(failed ? 1 : 0);
