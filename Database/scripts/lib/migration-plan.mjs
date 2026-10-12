// Pure migration planning for the shared jpbir / jaytibirthday-site ledger.
// A migration can have more than one historical filename because the two
// repositories previously assigned different numbers to identical SQL.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const filename = /^\d+_[a-z0-9_]+\.sql$/;

export async function loadAliases(schemaDir) {
  const path = join(schemaDir, 'migration-aliases.json');
  if (!existsSync(path)) return {};
  const raw = JSON.parse(await readFile(path, 'utf8'));
  const seen = new Set();
  const aliases = {};
  for (const [file, names] of Object.entries(raw)) {
    if (file.startsWith('_')) continue;
    if (!filename.test(file) || !Array.isArray(names) || !names.length
      || names.some((name) => typeof name !== 'string' || !filename.test(name) || name === file)
      || new Set(names).size !== names.length) {
      throw new Error('Invalid migration alias map');
    }
    for (const name of names) {
      if (seen.has(name)) throw new Error('Migration aliases must not overlap');
      seen.add(name);
    }
    aliases[file] = names;
  }
  return aliases;
}

export function listMigrations(files) {
  return [...files].filter((file) => file.endsWith('.sql')).sort();
}

// A recorded equivalent is proof that the SQL already ran. Missing names are
// ledger aliases only; the caller copies the known applied_at timestamp.
export function planMigrations(files, appliedNames, aliasesByFile) {
  return files.map((file) => {
    const names = [file, ...(aliasesByFile[file] || [])];
    const source = names.find((name) => appliedNames.has(name));
    if (!source) return { file, source: file, aliases: names.slice(1), action: 'apply' };
    const aliases = names.filter((name) => !appliedNames.has(name));
    return aliases.length
      ? { file, source, aliases, action: 'add-aliases' }
      : { file, source, aliases: [], action: 'skip' };
  });
}

export function assertLedgerOnly(plan) {
  const pending = plan.filter((step) => step.action === 'apply');
  if (pending.length) {
    throw new Error(`Ledger-only reconciliation refused: ${pending.length} migration(s) have no applied record`);
  }
}

export async function addLedgerAliases(client, step) {
  for (const alias of step.aliases) {
    const result = await client.query(`
      INSERT INTO schema_migrations (filename, applied_at)
      SELECT $1, applied_at FROM schema_migrations WHERE filename = $2
      ON CONFLICT (filename) DO NOTHING
      RETURNING filename`, [alias, step.source]);
    if (result.rowCount !== 1) {
      const existing = await client.query('SELECT filename FROM schema_migrations WHERE filename = $1', [alias]);
      if (existing.rowCount !== 1) throw new Error('Migration alias source record is missing');
    }
  }
}
