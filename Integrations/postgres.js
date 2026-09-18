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

function makePool(connectionString) {
  if (!connectionString) {
    throw new Error('No Postgres connection string set (DATABASE_URL / POSTGRES_URL)');
  }
  return new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Neon serves a publicly trusted certificate; verify it.
    ssl: { rejectUnauthorized: true },
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
