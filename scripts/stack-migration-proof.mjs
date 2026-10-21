// Proves the migration tooling, inside the project environment.
//
// The Product engineering panel has a row for Database/scripts/migrate.mjs.
// It used to sit on a probe that answered "unknown" forever, because a
// serverless function cannot apply a migration to a live database without
// being the thing that breaks it. This script is the proof, and it runs
// where a migration can actually be exercised: against a FRESH database
// created inside the isolated environment.
//
// Three checks, and the panel's receipt names all three:
//
//   fresh-apply      every migration in Database/schema applies cleanly to an
//                    empty database
//   second-run-noop  running the runner again changes nothing
//   ledger-match     the ledger the runner wrote names exactly the migration
//                    files in the repository
//
// The database is created fresh rather than reusing whatever the environment
// already had, because "the runner applied nothing" is indistinguishable from
// "the runner is broken" on a database that was already migrated. A fresh
// database is the only place the first check means anything.
//
// Usage (inside the environment):
//   node scripts/stack-migration-proof.mjs <output.json>

import { execFileSync } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { listMigrations, loadAliases } from '../Database/scripts/lib/migration-plan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = join(ROOT, 'Database', 'schema');
const PROOF_DB = 'stackproof';

const baseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!baseUrl) {
  console.error('DATABASE_URL is not set — run this inside the project environment');
  process.exit(1);
}

function proofUrl() {
  const url = new URL(baseUrl);
  url.pathname = '/' + PROOF_DB;
  // The isolated database in project/environment does not speak TLS, and this
  // proof points at it DELIBERATELY. The opt-out is explicit for that reason:
  // the production URL never carries it, and a URL without it still gets
  // verify-full TLS with the hostname checked.
  url.searchParams.set('sslmode', 'disable');
  return url.toString();
}

function runMigrations(databaseUrl) {
  const out = execFileSync(process.execPath, [join(ROOT, 'Database', 'scripts', 'migrate.mjs')], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_URL_UNPOOLED: databaseUrl },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out;
}

function committedCounts(output) {
  const m = /Committed:\s*(\d+)\s*migration\(s\),\s*(\d+)\s*ledger alias\(es\)/.exec(output);
  return m ? { applied: Number(m[1]), aliases: Number(m[2]) } : null;
}

const checks = { 'fresh-apply': 'fail', 'second-run-noop': 'fail', 'ledger-match': 'fail' };
let result = 'pass';
const notes = [];

const admin = new pg.Client({ connectionString: baseUrl });
// The environment's database may still be starting when this runs: compose
// starts the dependency, not the service's health check. Waiting for the
// database rather than failing on the first attempt keeps a slow start from
// looking like a broken migration runner.
let connected = false;
for (let attempt = 0; attempt < 30 && !connected; attempt++) {
  try {
    await admin.connect();
    connected = true;
  } catch (e) {
    if (attempt === 29) throw e;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
try {
  // A fresh database, every time. `DROP ... IF EXISTS` first so a re-run
  // inside the same environment does not inherit a previous proof.
  await admin.query('DROP DATABASE IF EXISTS ' + PROOF_DB);
  await admin.query('CREATE DATABASE ' + PROOF_DB);
} finally {
  await admin.end();
}

const url = proofUrl();

let first;
try {
  first = committedCounts(runMigrations(url));
} catch (e) {
  notes.push('fresh apply failed: ' + String(e.stdout || '') + String(e.stderr || e.message).slice(0, 400));
  first = null;
}
if (first && first.applied > 0) {
  checks['fresh-apply'] = 'pass';
} else {
  result = 'fail';
  notes.push('the fresh database did not receive any migration (applied=' + (first ? first.applied : 'error') + ')');
}

let second;
try {
  second = committedCounts(runMigrations(url));
} catch (e) {
  notes.push('second run failed: ' + String(e.stderr || e.message).slice(0, 400));
  second = null;
}
if (second && second.applied === 0) {
  checks['second-run-noop'] = 'pass';
} else {
  result = 'fail';
  notes.push('the second run was not a no-op (applied=' + (second ? second.applied : 'error') + ')');
}

// The ledger the runner wrote must name exactly the migration files the
// repository ships. Anything else means the runner and the schema disagree
// about what has been applied.
const client = new pg.Client({ connectionString: url });
await client.connect();
let appliedNames = [];
try {
  const res = await client.query('SELECT filename FROM schema_migrations ORDER BY filename');
  appliedNames = res.rows.map((r) => r.filename).filter(Boolean);
} finally {
  await client.end();
}

const files = listMigrations(await readdir(SCHEMA_DIR));
const aliases = await loadAliases(SCHEMA_DIR);
const known = new Set(files);
for (const names of Object.values(aliases)) for (const n of names) known.add(n);

const unknown = appliedNames.filter((n) => !known.has(n));
const missing = files.filter((f) => !appliedNames.includes(f));
if (!unknown.length && !missing.length) {
  checks['ledger-match'] = 'pass';
} else {
  result = 'fail';
  if (unknown.length) notes.push('the ledger names migrations this repository does not have: ' + unknown.join(', '));
  if (missing.length) notes.push('the ledger is missing migrations this repository ships: ' + missing.join(', '));
}

const outPath = process.argv[2];
const report = { subject: 'migration-tooling', result, checks, notes };
if (outPath) {
  await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
}
console.log(JSON.stringify(report, null, 2));
if (result !== 'pass') process.exitCode = 1;
