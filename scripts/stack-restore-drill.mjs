// The backup-and-restore drill, run against the isolated environment.
//
// A backup that has never been restored is a hypothesis. The acceptance bar
// for a release is that the data can be brought back, and the only way to
// know that before the bad day is to do it on a schedule.
//
// The drill:
//   1. applies every migration to a FRESH database,
//   2. dumps it with pg_dump (the real tool, not a hand-rolled SQL writer),
//   3. restores the dump into a SECOND fresh database,
//   4. compares the restored schema and the shared migration ledger with the
//      source.
//
// It runs against project/environment's isolated Postgres, never against
// production. The dump file is written into the workspace so it can be
// inspected, and the restored database is dropped afterwards.
//
// Usage (on the host, with the environment running):
//   node scripts/stack-restore-drill.mjs
//
// The compose `db` service is the postgres image, so pg_dump and pg_restore
// are available there; the `dev` service has the node runtime. The two are
// driven from the host with `docker compose exec`, which is also how CI runs
// it.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_DIR = join(ROOT, 'project', 'environment');
const COMPOSE = join(ENV_DIR, 'compose.yaml');
// The dump goes to the system temporary directory, never into the repository:
// it is a database file, and this repository is public.
const DUMP = join(tmpdir(), 'jpbir-restore-drill.dump');
const SOURCE_DB = 'restoredrill';
const TARGET_DB = 'restoredrill_restore';

function compose(args, options = {}) {
  return execFileSync('docker', ['compose', '--project-directory', ENV_DIR, '-f', COMPOSE, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function psql(db, sql) {
  return compose(['exec', '-T', 'db', 'psql', '-U', DB_USER, '-d', db, '-tAc', sql]);
}

// The credentials come from the running database container rather than from a
// constant here, so the drill cannot quietly disagree with the environment it
// is drilling.
const DB_USER = compose(['exec', '-T', 'db', 'printenv', 'POSTGRES_USER']).trim();
const DB_PASSWORD = compose(['exec', '-T', 'db', 'printenv', 'POSTGRES_PASSWORD']).trim();

/** The direct connection string for one database in the isolated Postgres. */
function dbUrl(db) {
  // sslmode=disable is explicit and deliberate: the isolated Postgres does not
  // speak TLS. The production URL never carries it, and a URL without it still
  // gets verify-full TLS with the hostname checked.
  return 'postgres://' + DB_USER + ':' + DB_PASSWORD + '@db:5432/' + db + '?sslmode=disable';
}

function step(name, fn) {
  process.stdout.write('  ' + name + ' ... ');
  const started = Date.now();
  const result = fn();
  console.log('ok (' + Math.round((Date.now() - started) / 1000) + 's)');
  return result;
}

const notes = [];

// The source database must exist and be fully migrated before there is
// anything worth backing up.
step('create a fresh database', () => {
  psql('postgres', 'DROP DATABASE IF EXISTS ' + SOURCE_DB);
  psql('postgres', 'DROP DATABASE IF EXISTS ' + TARGET_DB);
  psql('postgres', 'CREATE DATABASE ' + SOURCE_DB);
});

step('apply every migration to it', () => {
  compose(['run', '--rm', '-e', 'DATABASE_URL_UNPOOLED=' + dbUrl(SOURCE_DB),
    'dev', 'node', 'Database/scripts/migrate.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
});

step('back it up with pg_dump', () => {
  const dump = compose(['exec', '-T', 'db', 'pg_dump', '-U', DB_USER, '--no-owner', '--no-acl', SOURCE_DB]);
  writeFileSync(DUMP, dump);
  notes.push('the backup is ' + Math.round(dump.length / 1024) + ' KiB');
  return dump;
});

step('restore the dump into a second fresh database', () => {
  psql('postgres', 'CREATE DATABASE ' + TARGET_DB);
  const dump = readFileSync(DUMP, 'utf8');
  // psql reads the script from stdin; the dump is piped in as one string.
  compose(['exec', '-T', 'db', 'psql', '-U', DB_USER, '-d', TARGET_DB, '-v', 'ON_ERROR_STOP=1'], {
    input: dump,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
});

const schemaOf = (db) => psql(db, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'").trim();
const ledgerOf = (db) => psql(db, "SELECT count(*) FROM schema_migrations").trim();

step('compare the restored database with the source', () => {
  const sourceTables = schemaOf(SOURCE_DB);
  const restoredTables = schemaOf(TARGET_DB);
  const sourceLedger = ledgerOf(SOURCE_DB);
  const restoredLedger = ledgerOf(TARGET_DB);
  if (sourceTables !== restoredTables) {
    throw new Error('table count differs after restore: ' + sourceTables + ' vs ' + restoredTables);
  }
  if (sourceLedger !== restoredLedger) {
    throw new Error('ledger count differs after restore: ' + sourceLedger + ' vs ' + restoredLedger);
  }
  if (Number(sourceTables) === 0) throw new Error('the backup contained no tables');
  if (Number(sourceLedger) === 0) throw new Error('the backup contained no ledger rows');
  notes.push('restored ' + restoredTables + ' table(s) and ' + restoredLedger + ' ledger row(s) from ' + DUMP);
});

step('drop the drill databases', () => {
  psql('postgres', 'DROP DATABASE IF EXISTS ' + SOURCE_DB);
  psql('postgres', 'DROP DATABASE IF EXISTS ' + TARGET_DB);
});

console.log('\n  restore drill passed');
for (const note of notes) console.log('  - ' + note);
