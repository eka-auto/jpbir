// Merges the three proof reports into the one report the publisher reads.
//
// The report's SHAPE is defined here and only here. It used to be defined in a
// node -e snippet inside the workflow and read by
// scripts/stack-evidence-publish.mjs, and the two disagreed about where a
// subject's checks sat: the merge wrote them under `checks` and the publisher
// looked for them at the top level. Every publication therefore failed with
// "the check report has no entry for runtime-contract" while every proof on the
// page was green — a shape mismatch between two places that had never met.
//
// One definition, one place, and a test that runs this and feeds the result to
// the publisher's reader.
//
// Usage:
//   node scripts/stack-merge-checks.mjs <runtime-contract.json> <migration-tooling.json> <ledger.json> <out.json>

import { readFile, writeFile } from 'node:fs/promises';

const read = async (path) => JSON.parse(await readFile(path, 'utf8'));

const [runtimePath, migrationPath, ledgerPath, outPath] = process.argv.slice(2);
if (!runtimePath || !migrationPath || !ledgerPath || !outPath) {
  console.error('usage: node scripts/stack-merge-checks.mjs <runtime-contract.json> <migration-tooling.json> <ledger.json> <out.json>');
  process.exit(2);
}

const runtime = await read(runtimePath);
const migration = await read(migrationPath);
const ledger = await read(ledgerPath);

const checks = {
  'runtime-contract': runtime.checks || {},
  'migration-tooling': { ...(migration.checks || {}), ...(ledger.checks || {}) },
};
const notes = [...(runtime.notes || []), ...(migration.notes || []), ...(ledger.notes || [])];

const failed = Object.entries(checks)
  .filter(([, subjectChecks]) => Object.values(subjectChecks).some((value) => value !== 'pass'))
  .map(([subject, subjectChecks]) => subject + ' (' +
    Object.entries(subjectChecks).filter(([, value]) => value !== 'pass').map(([name]) => name).join(', ') + ')');

const report = {
  result: failed.length ? 'fail' : 'pass',
  checks,
  notes,
};

await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
if (failed.length) {
  console.error('at least one proof did not pass: ' + failed.join('; '));
  process.exit(1);
}
