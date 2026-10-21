// Reconciles the SHARED production migration ledger against this repository.
//
// The sibling jaytibirthday-site repository owns migrations 001-003 of the
// same Neon database, and this repository owns 004 onwards. The numbering
// invariant across the two has already been broken three times over, which is
// why Database/schema/migration-aliases.json records which historical names
// are equivalent to which file.
//
// The reconciliation therefore asks one question: is every migration name in
// the production ledger still explainable by this repository — either as a
// file it ships, or as a recorded alias of one? A name that is neither means
// the ledger and the schema have diverged, and a migration runner that meets
// that divergence is a runner whose "already applied" answer cannot be
// trusted.
//
// The check is deliberately INDEPENDENT of whether production has caught up
// with this revision: production having applied fewer migrations than this
// repository ships is normal (a deploy is pending), while production having
// applied a migration this repository does not know about is a divergence.
//
// Usage:
//   HEALTH_CHECK_KEY=... node scripts/stack-ledger-reconcile.mjs <output.json>

import { readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listMigrations, loadAliases } from '../Database/scripts/lib/migration-plan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = join(ROOT, 'Database', 'schema');
const KEY = process.env['HEALTH_' + 'CHECK_KEY'];
const BASE = process.env['STACK_' + 'HEALTH_URL'] || 'https://jaytipargal.tech';

const checks = { 'ledger-reconciliation': 'fail' };
const notes = [];

if (!KEY) {
  notes.push('HEALTH_CHECK_KEY is not configured');
} else {
  const res = await fetch(BASE + '/api/verify-db', { headers: { 'x-health-key': KEY } });
  if (!res.ok) {
    notes.push('the health endpoint answered HTTP ' + res.status);
  } else {
    const body = await res.json();
    const applied = (body.ledger && body.ledger.applied) || [];
    const files = listMigrations(await readdir(SCHEMA_DIR));
    const aliases = await loadAliases(SCHEMA_DIR);
    const known = new Set(files);
    for (const names of Object.values(aliases)) for (const n of names) known.add(n);

    const unknown = applied.filter((n) => !known.has(n));
    if (!body.ledger || body.ledger.ok !== true) {
      notes.push('the ledger could not be read: ' + ((body.ledger && body.ledger.error) || 'no ledger in the response'));
    } else if (unknown.length) {
      notes.push('production has applied migrations this repository cannot explain: ' + unknown.join(', '));
    } else {
      checks['ledger-reconciliation'] = 'pass';
    }
  }
}

const report = { subject: 'migration-tooling', checks, notes };
const outPath = process.argv[2];
if (outPath) await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
if (checks['ledger-reconciliation'] !== 'pass') process.exitCode = 1;
