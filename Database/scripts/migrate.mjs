// Applies every migration once, or reconciles shared-ledger aliases only.
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { directPool } from '../../Integrations/postgres.js';
import { loadEnv } from './_env.mjs';
import { addLedgerAliases, assertLedgerOnly, listMigrations, loadAliases, planMigrations } from './lib/migration-plan.mjs';

loadEnv();

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const ledgerOnly = args.has('--ledger-only');

async function main() {
  if ([...args].some((arg) => !['--dry-run', '--ledger-only'].includes(arg))) {
    throw new Error('Supported options: --dry-run, --ledger-only');
  }
  const aliasesByFile = await loadAliases(SCHEMA_DIR);
  const files = listMigrations(await readdir(SCHEMA_DIR));
  if (!files.length) throw new Error('No migration files found');
  const pool = directPool();
  let client;
  try {
    client = await pool.connect();
    await client.query(dryRun ? 'BEGIN READ ONLY' : 'BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const ledger = await client.query("SELECT to_regclass('public.schema_migrations') AS ledger");
    if (!ledger.rows[0].ledger && ledgerOnly) throw new Error('Ledger-only reconciliation requires an existing ledger');
    if (!ledger.rows[0].ledger && !dryRun) {
      await client.query(`CREATE TABLE schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    }
    if (!dryRun) await client.query('LOCK TABLE schema_migrations IN SHARE ROW EXCLUSIVE MODE');
    const applied = ledger.rows[0].ledger || !dryRun
      ? new Set((await client.query('SELECT filename FROM schema_migrations')).rows.map((row) => row.filename))
      : new Set();
    const plan = planMigrations(files, applied, aliasesByFile);
    if (ledgerOnly) assertLedgerOnly(plan);
    for (const step of plan) console.log(`${dryRun ? 'plan' : 'queued'} ${step.action}: ${step.file}`);
    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('Dry run complete; no database changes');
      return;
    }
    let ran = 0;
    let aliasCount = 0;
    for (const step of plan) {
      if (step.action === 'apply') {
        await client.query(await readFile(join(SCHEMA_DIR, step.file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [step.file]);
        ran++;
      }
      if (step.aliases.length) {
        await addLedgerAliases(client, step);
        aliasCount += step.aliases.length;
      }
    }
    await client.query('COMMIT');
    console.log(`Committed: ${ran} migration(s), ${aliasCount} ledger alias(es); existing names preserved`);
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main().catch((err) => {
  // A driver error can contain a connection URI. Never print it.
  console.error('Migration stopped; no success is assumed.', err.code || err.name);
  process.exitCode = 1;
});
