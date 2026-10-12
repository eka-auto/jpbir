// Loads the DynamoDB telemetry backup into the Neon warehouse.
//
// Database/backups/dynamodb-telemetry-backup.json is the only surviving copy of
// the events that were in `jaytipargal_telemetry` on 2026-09-10. Backend/db-push.js
// can mirror LIVE DynamoDB into Postgres, but it scans the table -- so once the
// table is gone, or its credentials are rotated away, nothing in this repository
// could put those rows back and the dashboard would simply stop showing them.
// This reads the file instead.
//
// The items are DynamoDB's typed JSON ({"S": "..."}, {"N": "..."}, {"M": {...}}),
// which is unmarshalled here into the same camelCase shape jp-track writes, so
// the rows land through Backend/lib/warehouse.js insertEvent -- one definition of
// the row id, the site and the rollups, shared with the live path. Inserts are
// ON CONFLICT DO NOTHING, so running this twice is a no-op, and the rollups are
// recomputed from `events` afterwards rather than incremented.
//
//   node Database/scripts/import-telemetry-backup.mjs [path-to-backup.json]
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../../Integrations/postgres.js';
import { insertEvent, rollupVisitors, rollupSessions, siteFor } from '../../Backend/lib/warehouse.js';
import { loadEnv } from './_env.mjs';

loadEnv();

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BACKUP = join(HERE, '..', 'backups', 'dynamodb-telemetry-backup.json');

// Rows written before jp-track stamped a site carry no page URL either, and
// 'jaytipargal.com' is the property that table collected for.
const FALLBACK_SITE = 'jaytipargal.com';

export function unmarshal(node) {
  if (Array.isArray(node)) return node.map(unmarshal);
  if (node === null || typeof node !== 'object') return node;
  const keys = Object.keys(node);
  if (keys.length === 1) {
    const [type] = keys;
    const value = node[type];
    if (type === 'S') return value;
    if (type === 'N') return value.includes('.') ? Number(value) : Number.parseInt(value, 10);
    if (type === 'BOOL') return Boolean(value);
    if (type === 'NULL') return null;
    if (type === 'B') return value;
    // A map and a list carry the rest of the item inside them, so they unwrap
    // rather than being copied as {"M": ...} / {"L": ...}: that is the shape
    // insertEvent reads, and a nested eventData left wrapped imports as an
    // object with one useless key.
    if (type === 'M') return unmarshal(value);
    if (type === 'L') return (value || []).map(unmarshal);
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = unmarshal(v);
  return out;
}

/**
 * One backup item as the warehouse row it becomes. Exported so the mapping is
 * testable without a database: the legacy rows are the only copy of that
 * history, and a mapping that silently returns null would import nothing and
 * report success.
 */
export function rowFor(item) {
  return {
    site: siteFor(item.pageUrl, null) || FALLBACK_SITE,
    id: item.id,
    occurredAt: item.timestamp || item.epoch,
    pageUrl: item.pageUrl,
    sourceSystem: 'dynamodb-backup',
  };
}

async function main() {
  const file = process.argv[2] || DEFAULT_BACKUP;
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const items = (raw.Items || raw.items || []).map(unmarshal);
  if (!items.length) {
    console.error(`no Items in ${file}`);
    process.exitCode = 1;
    return;
  }

  let inserted = 0, skipped = 0;
  for (const item of items) {
    const row = rowFor(item);
    const wrote = await insertEvent(item, { site: row.site, sourceSystem: row.sourceSystem });
    if (wrote) inserted++;
    else skipped++;
  }
  await rollupVisitors();
  await rollupSessions();

  const totals = (await query(
    `SELECT site, COUNT(*)::int n FROM events WHERE source_system = 'dynamodb-backup'
      GROUP BY site ORDER BY n DESC`)).rows;
  console.log(`read      ${items.length} item(s) from ${file}`);
  console.log(`inserted  ${inserted}`);
  console.log(`already   ${skipped} (same row id already in events)`);
  for (const row of totals) console.log(`  ${row.site}: ${row.n} row(s) from this backup`);
}

// Only when run as a script: the test suite imports unmarshal/rowFor from here.
if (process.argv[1] && process.argv[1].endsWith('import-telemetry-backup.mjs')) {
  main().catch((err) => {
    console.error('import failed:', err.message);
    process.exit(1);
  });
}
