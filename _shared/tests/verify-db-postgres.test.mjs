// /api/verify-db has to cover the store the dashboard actually reads.
//
// It shipped checking DynamoDB and Firestore only, so it could answer
// `production_ready: true` while every db-api view returned 500 — either
// because DATABASE_URL was unset on that deployment or because the schema had
// never been migrated there. jpbirrestructured.vercel.app is exactly that
// state today: Firestore-backed routes 200, Neon-backed routes 500.
//
// Two layers, the same shape as wa-endpoint-auth.test.mjs. The first drives
// verifyPostgres() with an injected query function, so the missing-table,
// connection-failure and not-configured branches are exercised without a
// database. The second re-derives the required-table list from the SQL in the
// Postgres-backed routes, so a route that starts reading a NEW table fails this
// suite the day it is added rather than the day the health check lies about it.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND = join(ROOT, 'Backend');

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${detail}`}`);
};

// Importing the handler must not need a live database or AWS credentials.
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.STATS_KEY = 'k-test';

const { verifyPostgres, REQUIRED_TABLES } = await import('../../Backend/verify-db.js');

// ---------------------------------------------------------------- layer 1 --

{
  const result = await verifyPostgres(async () => { throw new Error('should not be called'); }, () => false);
  check(
    'unconfigured deployment reports not-ok without touching the database',
    result.ok === false && /DATABASE_URL/.test(result.error || ''),
    `got ${JSON.stringify(result)}`
  );
}

{
  // Every table present: the happy path also has to carry the freshness fields,
  // because "schema fine, ingestion stopped" is the failure this endpoint is
  // most likely to be asked about.
  const q = async (sql) => {
    if (/information_schema/.test(sql)) return { rows: REQUIRED_TABLES.map((t) => ({ table_name: t })) };
    return { rows: [{ events: 10846, sites: 2, newest_event_at: '2026-09-17T17:40:05Z', last_write_at: '2026-09-17T17:40:05Z' }] };
  };
  const result = await verifyPostgres(q, () => true);
  check(
    'fully migrated database verifies ok and reports freshness',
    result.ok === true && result.missing.length === 0 && result.events === 10846 && result.newest_event_at != null,
    `got ${JSON.stringify(result)}`
  );
}

{
  // A half-migrated database is the real-world case: this project ships
  // Database/schema/004-006, the sibling jaytibirthday-site ships 001-003, and
  // either can be applied without the other.
  const owned = REQUIRED_TABLES.filter((t) => t.startsWith('wa_') || t.startsWith('s24_'));
  const q = async (sql) => {
    if (/information_schema/.test(sql)) return { rows: owned.map((t) => ({ table_name: t })) };
    throw new Error('freshness query must not run against a missing events table');
  };
  const result = await verifyPostgres(q, () => true);
  const missingCore = REQUIRED_TABLES.filter((t) => !owned.includes(t));
  check(
    'missing analytics tables are reported, not swallowed',
    result.ok === false &&
      missingCore.every((t) => result.missing.includes(t)) &&
      result.missing.length === missingCore.length,
    `got ${JSON.stringify(result)}`
  );
}

{
  const result = await verifyPostgres(async () => { throw new Error('connection terminated unexpectedly'); }, () => true);
  check(
    'a dead connection is reported as not-ok rather than thrown',
    result.ok === false && /connection terminated/.test(result.error || ''),
    `got ${JSON.stringify(result)}`
  );
}

// ---------------------------------------------------------------- layer 2 --

// Files that talk to Postgres at all. Anything importing the shared pool is a
// route whose tables belong in REQUIRED_TABLES.
const pgFiles = readdirSync(BACKEND)
  .filter((f) => f.endsWith('.js'))
  .filter((f) => readFileSync(join(BACKEND, f), 'utf8').includes('Integrations/postgres.js'));
// Durable section/conversation reads live in shared store modules, rather than
// duplicating SQL in each route. They belong to the same health contract.
pgFiles.push('../Integrations/dashboard-store.js','../Integrations/agent-store.js','../Integrations/telegram-store.js');

// Write-side helpers keep their own bookkeeping tables (s24_sync_batches) and
// db-push mirrors from DynamoDB; the health check covers what the READ paths
// need, so those two are scanned for reads but not required to be complete.
const NOT_A_TABLE = new Set([
  // SQL built-ins and catalogs that appear after FROM/JOIN
  'generate_series', 'information_schema', 'unnest', 'lateral', 'pg_indexes', 'pg_constraint',
  // written by the ingest path's own bookkeeping, never read by a dashboard view
  's24_sync_batches', 'schema_migrations',
  // `ON CONFLICT ... DO UPDATE SET` puts a keyword where a table name goes
  'set',
  // false positive: "Update" in email addresses (analytics@jaytibirthday.in)
  // triggers the SQL keyword check, then "update the secret" captures "the"
  'the',
]);

// Only string literals that are SQL. Scanning whole files matched the prose in
// the comment blocks these routes are full of ("mirror INTO the warehouse"),
// which is how you get `the` reported as an unlisted table.
const STRING_LITERAL = /`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g;

const referenced = new Map(); // table -> files
for (const file of pgFiles) {
  const source = readFileSync(join(BACKEND, file), 'utf8');
  for (const literal of source.match(STRING_LITERAL) || []) {
    if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(literal)) continue;
    // `EXTRACT(hour FROM occurred_at)` is not a table reference.
    const sql = literal.replace(/EXTRACT\s*\([^)]*\)/gi, ' ').replace(/--[^\n]*/g, ' ');
    // CTE names are local to the statement that declares them.
    const ctes = new Set([...sql.matchAll(/(?:WITH|,)\s+([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)].map((m) => m[1].toLowerCase()));
    for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:public\.)?([a-z_][a-z0-9_]*)\b(\s*\()?/gi)) {
      const name = m[1].toLowerCase();
      if (m[2]) continue;               // a function call, not a table
      if (ctes.has(name)) continue;
      if (NOT_A_TABLE.has(name)) continue;
      if (!referenced.has(name)) referenced.set(name, []);
      if (!referenced.get(name).includes(file)) referenced.get(name).push(file);
    }
  }
}

const known = new Set(REQUIRED_TABLES);
const unlisted = [...referenced.keys()].filter((t) => !known.has(t)).sort();
check(
  'every table a Postgres route queries is in REQUIRED_TABLES',
  unlisted.length === 0,
  unlisted.map((t) => `${t} (used by ${referenced.get(t).join(', ')})`).join('\n      ')
);

const unused = REQUIRED_TABLES.filter((t) => !referenced.has(t)).sort();
check(
  'REQUIRED_TABLES lists nothing the routes never read',
  unused.length === 0,
  `no route references: ${unused.join(', ')}`
);

check('scanned at least the known Postgres routes', pgFiles.length >= 8, `found only ${pgFiles.length}: ${pgFiles.join(', ')}`);

console.log(`\n${failures ? `${failures} check(s) failed` : 'all checks passed'}`);
process.exitCode = failures ? 1 : 0;
