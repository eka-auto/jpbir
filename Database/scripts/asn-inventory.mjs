// Read-only ASN inventory of the live warehouse.
//
// Owner-approved 2026-10-27 (project/approvals/2026-10-27-asn-review-followup.md,
// question 2): settle how many events rows already carry stored ASN data, so the
// D-32 addendum's live counts stop being Blocked. It runs in CI (which holds the
// live DATABASE_URL secret) because no credential on any agent machine reaches
// the live database.
//
// Prints counts and the database name only - never the connection string, host
// or password. SELECT-only; `_shared/tests/asn-inventory.test.mjs` enforces both.
import { loadEnv } from './_env.mjs';

loadEnv();

const { query, isConfigured, pool } = await import('../../Integrations/postgres.js');

if (!isConfigured()) {
  console.error('asn-inventory: DATABASE_URL is not set - this is an Error, never a pass.');
  process.exit(1);
}

const scrub = (message) => String(message).replace(/:[^:@/\s]+@/g, ':***@').slice(0, 300);

try {
  const who = await query('SELECT current_database() AS db, current_user AS usr');
  console.log('database:', who.rows[0].db, '| role:', who.rows[0].usr);

  const cols = await query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'events'
        AND column_name IN ('asn', 'asn_org', 'asn_source')
      ORDER BY column_name`
  );
  const names = cols.rows.map((r) => r.column_name);
  console.log('asn columns:', names.length ? names.join(', ') : 'NONE');

  const counts = await query(
    `SELECT coalesce(site, '<null>') AS site, count(*)::int AS total,
            count(*) FILTER (WHERE asn IS NOT NULL)::int AS asn_n,
            count(*) FILTER (WHERE asn_org IS NOT NULL)::int AS asn_org_n,
            min(occurred_at)::date::text AS first_day,
            max(occurred_at)::date::text AS last_day
       FROM events
      GROUP BY 1
      ORDER BY 2 DESC`
  );
  console.log('per-site counts (total / asn / asn_org / days):');
  for (const row of counts.rows) console.log(' ', JSON.stringify(row));

  if (names.includes('asn_source')) {
    const bySource = await query(
      `SELECT coalesce(asn_source, '<null>') AS source, count(*)::int AS n
         FROM events
        GROUP BY 1
        ORDER BY 2 DESC`
    );
    console.log('asn_source groups:', JSON.stringify(bySource.rows));
  }

  const total = counts.rows.reduce((n, r) => n + r.total, 0);
  const withAsn = counts.rows.reduce((n, r) => n + r.asn_n, 0);
  console.log(`totals: ${withAsn}/${total} rows carry stored asn`);
  if (withAsn === 0) {
    console.log('NOTE: no stored ASN in this database - attribution is entirely read-time (ip-intel).');
  } else {
    console.log('NOTE: stored ASN exists - read-time lookup fills only the rows that lack it.');
  }
} catch (err) {
  console.error('asn-inventory failed:', err.code || 'no-code', scrub(err.message || err));
  process.exitCode = 1;
} finally {
  try {
    await pool().end();
  } catch {
    // pool() throws synchronously when unconfigured; the exit code already tells the story
  }
}
