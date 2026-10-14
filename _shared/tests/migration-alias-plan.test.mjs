import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLedgerOnly, listMigrations, loadAliases, planMigrations } from '../../Database/scripts/lib/migration-plan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const schema = join(root, 'Database', 'schema');
const files = listMigrations(await readdir(schema));
const aliases = await loadAliases(schema);
let failures = 0;
const check = (label, pass, detail = '') => {
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : `\n      ${detail}`}`);
};

check('alias map names only migrations this checkout ships', Object.keys(aliases).every((file) => files.includes(file)));
check('alias map has no overlapping historical identity', (() => {
  const all = Object.values(aliases).flat(); return all.length === new Set(all).size;
})());

const currentOnly = planMigrations(files, new Set(files), aliases);
check('current ledger reconciles aliases without applying SQL', currentOnly.every((step) => step.action !== 'apply'));
check('current ledger supplies every missing shared name', currentOnly.filter((step) => step.action === 'add-aliases').flatMap((step) => step.aliases).length === Object.values(aliases).flat().length);

const historical = new Set(files);
for (const [file, names] of Object.entries(aliases)) {
  historical.delete(file);
  historical.add(names[0]);
}
const historicalPlan = planMigrations(files, historical, aliases);
check('historical jpbir/P1 names never re-run SQL', historicalPlan.every((step) => step.action !== 'apply'));
check('ledger-only mode accepts only known history', (() => { try { assertLedgerOnly(historicalPlan); return true; } catch { return false; } })());

const reconciled = new Set([...historical, ...historicalPlan.flatMap((step) => step.aliases)]);
const second = planMigrations(files, reconciled, aliases);
check('a reconciled ledger is a no-op', second.every((step) => step.action === 'skip'));

const fresh = planMigrations(files, new Set(), aliases);
check('a new database applies every local migration exactly once', fresh.length === files.length && fresh.every((step) => step.action === 'apply'));
check('ledger-only mode rejects unknown migration history', (() => { try { assertLedgerOnly(fresh); return false; } catch { return true; } })());
const missingCheckpoint = new Set(historical);
missingCheckpoint.delete('009_dynamodb_repair_state.sql');
const missingCheckpointPlan = planMigrations(files, missingCheckpoint, aliases);
check('missing checkpoint migration is explicitly identified before ledger-only reconciliation', (() => {
  try {
    assertLedgerOnly(missingCheckpointPlan);
    return false;
  } catch (err) {
    return /009_dynamodb_repair_state\.sql/.test(String(err?.message || ''));
  }
})());

console.log(failures ? `\n${failures} check(s) failed.` : '\nMigration alias plan verified.');
process.exitCode = failures ? 1 : 0;
