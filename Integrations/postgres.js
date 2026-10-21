// Pooled client for the Neon store (jaytibirthday-db), shared by this
// project's API handlers.
//
// Serverless instances are frozen between invocations, so the pool is cached
// on globalThis — otherwise a warm instance opens a fresh pool per request and
// exhausts Neon's connection limit. DATABASE_URL is the pooled (pgbouncer)
// endpoint, which is what function traffic wants; the unpooled one is only
// needed for DDL, which pgbouncer cannot run inside a transaction.
import pg from 'pg';

const { Pool } = pg;

// pg-connection-string treats 'prefer', 'require' and 'verify-ca' as aliases for
// 'verify-full' today, and warns that pg v9 / pg-connection-string v3 will adopt
// standard libpq semantics instead — where 'require' encrypts but does NOT check
// the certificate's hostname. `package.json` pins `^8.23.0`, so nothing downgrades
// automatically; this pins the intent so a future major bump cannot do it silently.
//
// verify-full is not a guess about Neon: measured against the live production
// endpoints, sslmode=verify-full connects on both the pooled and the unpooled URL
// with a TLS socket whose peer CN is *.c-10.us-east-1.aws.neon.tech, while
// sslmode=disable is refused outright as "connection is insecure".
//
// Only the sslmode parameter is rewritten, so every other byte of the URL —
// password included — survives untouched. Parsing and re-serialising with WHATWG
// URL would risk re-encoding the credentials.
const WEAKER_SSLMODE = /([?&]sslmode=)(?:prefer|require|verify-ca)(?=&|$)/;

export function enforceVerifyFull(connectionString) {
  return connectionString.replace(WEAKER_SSLMODE, '$1verify-full');
}

/**
 * Whether the connection string asks for TLS to be switched off.
 *
 * An EXPLICIT `sslmode=disable` is a deliberate choice against a database that
 * does not speak TLS — the isolated Postgres in project/environment is one, and
 * the migration proof has to run the real migration runner against it. It is
 * honoured.
 *
 * Nothing else is. A URL with no sslmode, or one that says prefer, require or
 * verify-ca, still gets verify-full TLS with the certificate's hostname
 * checked: the absence of the parameter must never mean an unencrypted
 * connection to production.
 *
 * The distinction matters because node-postgres ignores the connection
 * string's sslmode entirely once an `ssl` option is passed to the Pool — so
 * without this rule an explicit opt-out was overridden, and `npm run
 * db:migrate` could not be pointed at a local database at all.
 */
export function sslDisabledBy(connectionString) {
  return /[?&]sslmode=disable(?:&|$)/.test(connectionString || '');
}

function makePool(connectionString) {
  if (!connectionString) {
    throw new Error('No Postgres connection string set (DATABASE_URL / POSTGRES_URL)');
  }
  return new Pool({
    connectionString: enforceVerifyFull(connectionString),
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Neon serves a publicly trusted certificate; verify it.
    ssl: sslDisabledBy(connectionString) ? false : { rejectUnauthorized: true },
  });
}

export function pool() {
  const g = globalThis;
  if (!g.__jpPgPool) {
    g.__jpPgPool = makePool(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  }
  return g.__jpPgPool;
}

/**
 * Direct (non-pooled) connection — migrations only. No fallback to the pooled
 * URL: pgbouncer can't hold a migration's transaction, so running one through
 * it half-applies instead of failing up front.
 */
export function directPool() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) {
    throw new Error('No direct Postgres connection string set (DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING)');
  }
  return makePool(url);
}

export async function query(text, params) {
  return pool().query(text, params);
}

export function isConfigured() {
  return Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
}
