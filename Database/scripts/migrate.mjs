// Applies every .sql file in Database/schema in filename order, once each.
//
// Runs against the unpooled endpoint: pgbouncer in transaction mode cannot
// execute DDL inside an explicit transaction, which is exactly what a
// migration needs to stay all-or-nothing.
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { directPool } from '../../Integrations/postgres.js';
import { loadEnv } from './_env.mjs';

loadEnv();

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema');

async function main() {
  const pool = directPool();
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const applied = new Set(
      (await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)
    );
    const files = (await readdir(SCHEMA_DIR)).filter((f) => f.endsWith('.sql')).sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip  ${file} (already applied)`);
        continue;
      }
      const sql = await readFile(join(SCHEMA_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  ok    ${file}`);
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`${file} failed: ${err.message}`);
      }
    }
    console.log(ran ? `applied ${ran} migration(s)` : 'schema already up to date');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('migrate failed:', err.message);
  process.exit(1);
});
