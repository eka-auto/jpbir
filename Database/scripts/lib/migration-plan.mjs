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

/**
 * The names the shared ledger can hold without being a divergence.
 *
 * Three sources, and each answers a different question:
 *
 *   ours         the files this repository ships, plus the historical names its
 *                alias map records as equivalent. A row under any of these
 *                proves that migration ran.
 *   owners       the migrations the sibling repository owns and applied to the
 *                same ledger. A row under one of these is the other owner's
 *                business.
 *   retired      the migrations this repository applied and then removed from
 *                the tree. Their rows stay, because the migration did run.
 *
 * Anything else in the ledger is a divergence, and the runner must not be
 * trusted with it.
 */
export function explainableNames(files, aliasesByFile, shared) {
  const ours = new Set(files);
  for (const names of Object.values(aliasesByFile || {})) for (const name of names) ours.add(name);
  const explainable = new Set(ours);
  for (const owner of (shared.owners || [])) for (const name of owner.migrations) explainable.add(name);
  for (const name of Object.keys(shared.retired || {})) explainable.add(name);
  return { ours, explainable };
}

/**
 * Refuses a shared-ledger manifest that claims one of our own names.
 *
 * The manifest exists to explain FOREIGN rows. If it also lists a migration
 * this repository ships, or one its alias map records, then an unrecorded
 * rename of ours would be waved through as "that is the sibling's" — which is
 * the exact divergence the reconciliation exists to catch. A name cannot be
 * both ours and theirs.
 */
export function assertManifestAgreesWithTree(files, aliasesByFile, shared) {
  const { ours } = explainableNames(files, aliasesByFile, shared);
  for (const owner of (shared.owners || [])) {
    for (const name of owner.migrations) {
      if (ours.has(name)) {
        throw new Error(
          'the shared ledger manifest lists "' + name + '" as owned by ' + owner.repository +
          ', but this repository ships it or records it as an alias. A name cannot be both.',
        );
      }
    }
  }
  for (const name of Object.keys(shared.retired || {})) {
    if (ours.has(name)) {
      throw new Error('the shared ledger manifest retires "' + name + '", but this repository still ships it');
    }
    if (files.includes(name)) {
      throw new Error('a retired migration must not still be in the tree: ' + name);
    }
  }
  return true;
}

export function listMigrations(files) {
  return [...files].filter((file) => file.endsWith('.sql')).sort();
}

/**
 * The other writers of the shared ledger, and this repository's retired
 * migrations.
 *
 * `schema_migrations` lives in one Neon database and two repositories write to
 * it. The alias map records the migrations the two SHARE; this file records
 * the migrations only the OTHER repository owns, so that a foreign row in the
 * ledger is recognisable as foreign rather than as an unrecorded rename of one
 * of ours — which is the failure the reconciliation exists to catch.
 *
 * It is kept apart from the alias map on purpose. The alias map changes what
 * the RUNNER does: a name listed there means "this file's SQL already ran
 * under that name, skip it". A name listed here changes only what the
 * reconciliation BELIEVES, and listing a rename of ours there would skip a
 * migration that still has to run.
 *
 * Validation is deliberately strict: a malformed manifest must fail loudly
 * rather than quietly explain fewer rows and turn a divergence into a pass.
 */
export async function loadSharedLedger(schemaDir) {
  const path = join(schemaDir, 'shared-ledger.json');
  if (!existsSync(path)) return { owners: [], retired: {} };
  const raw = JSON.parse(await readFile(path, 'utf8'));
  const owners = [];
  const retired = {};
  const seen = new Set();

  for (const owner of raw.owners || []) {
    if (!owner || typeof owner.repository !== 'string' || !owner.repository.length
      || !Array.isArray(owner.migrations)) {
      throw new Error('Invalid shared ledger owner');
    }
    for (const name of owner.migrations) {
      if (!filename.test(name)) throw new Error('Invalid shared ledger migration name: ' + name);
      if (seen.has(name)) throw new Error('Shared ledger migration names must not overlap: ' + name);
      seen.add(name);
    }
    owners.push({ repository: owner.repository, migrations: [...owner.migrations] });
  }

  for (const [name, reason] of Object.entries(raw.retired || {})) {
    if (!filename.test(name)) throw new Error('Invalid retired migration name: ' + name);
    if (typeof reason !== 'string' || !reason.length) {
      throw new Error('A retired migration must say why it was retired: ' + name);
    }
    if (seen.has(name)) throw new Error('Shared ledger migration names must not overlap: ' + name);
    seen.add(name);
    retired[name] = reason;
  }

  return { owners, retired };
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
  const pending = plan.filter((step) => step.action === 'apply').map((step) => step.file);
  if (pending.length) {
    throw new Error(`Ledger-only reconciliation refused: ${pending.length} migration(s) have no applied record: ${pending.join(', ')}`);
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
