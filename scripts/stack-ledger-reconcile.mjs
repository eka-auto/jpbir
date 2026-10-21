// Reconciles the SHARED production migration ledger against this repository.
//
// The sibling jaytibirthday-site repository owns migrations 001-003 of the same
// Neon database, and this repository owns 004 onwards. The numbering invariant
// across the two has already been broken three times over, which is why
// Database/schema/migration-aliases.json records which historical names are
// equivalent to which file.
//
// The reconciliation therefore asks one question: is every migration name in
// the production ledger still explainable — as a file this repository ships,
// as an alias this repository records, as a migration the sibling repository
// owns, or as a migration this repository applied and then retired? A name
// that is none of those means the ledger and the schema have diverged, and a
// migration runner that meets that divergence is a runner whose "already
// applied" answer cannot be trusted.
//
// The check is deliberately INDEPENDENT of whether production has caught up
// with this revision: production having applied fewer migrations than this
// repository ships is normal (a deploy is pending), while production having
// applied a migration this repository cannot explain is a divergence.
//
// Usage:
//   HEALTH_CHECK_KEY=... node scripts/stack-ledger-reconcile.mjs <output.json>

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listMigrations, loadAliases, loadSharedLedger, explainableNames, assertManifestAgreesWithTree } from '../Database/scripts/lib/migration-plan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = join(ROOT, 'Database', 'schema');
const KEY = process.env['HEALTH_' + 'CHECK_KEY'];
const BASE = process.env['STACK_' + 'HEALTH_URL'] || 'https://jaytipargal.tech';

const checks = { 'ledger-reconciliation': 'fail' };
const notes = [];

const files = listMigrations(await readdir(SCHEMA_DIR));
const aliases = await loadAliases(SCHEMA_DIR);
const shared = await loadSharedLedger(SCHEMA_DIR);

// A name in the shared manifest that is ALSO one of ours would silence a real
// divergence instead of explaining a foreign row: the manifest says "that is
// theirs", so a rename of ours that was never recorded would be accepted as
// an equivalent. The manifest is checked against the tree for that reason.
assertManifestAgreesWithTree(files, aliases, shared);

const { ours, explainable } = explainableNames(files, aliases, shared);

if (!KEY) {
  notes.push('HEALTH_CHECK_KEY is not configured');
} else {
  const res = await fetch(BASE + '/api/verify-db', { headers: { 'x-health-key': KEY } });
  if (!res.ok) {
    notes.push('the health endpoint answered HTTP ' + res.status);
  } else {
    const body = await res.json();
    const ledger = body.ledger || {};
    const applied = Array.isArray(ledger.applied) ? ledger.applied : [];

    if (ledger.ok !== true) {
      notes.push('the ledger could not be read: ' + (ledger.error || 'no ledger in the response'));
    } else {
      const unknown = applied.filter((name) => !explainable.has(name));
      if (unknown.length) {
        notes.push('production has applied migrations this repository cannot explain: ' + unknown.join(', '));
      } else {
        checks['ledger-reconciliation'] = 'pass';
      }

      // Informational: migrations this repository ships that production has
      // not applied yet. A deploy in flight looks exactly like this, so it is
      // reported rather than failed on.
      const pending = files.filter((name) => !applied.includes(name));
      if (pending.length) {
        notes.push('not yet applied in production (a deploy may be in flight): ' + pending.join(', '));
      }
      const oursHere = applied.filter((name) => ours.has(name));
      const retiredHere = applied.filter((name) => shared.retired[name]);
      const foreign = applied.filter((name) => !ours.has(name) && !shared.retired[name]);
      notes.push('the shared ledger holds ' + applied.length + ' migration name(s): ' +
        oursHere.length + ' are this repository\'s files or their recorded aliases, ' +
        retiredHere.length + ' are its retired migrations, ' +
        foreign.length + ' belong to ' + shared.owners.map((o) => o.repository).join(', '));
    }
  }
}

const report = { subject: 'migration-tooling', checks, notes };
const outPath = process.argv[2];
if (outPath) await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
if (checks['ledger-reconciliation'] !== 'pass') process.exitCode = 1;
