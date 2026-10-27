// One definition of "the production warehouse", read from the manifest.
//
// project/targets.json records the verified Neon project, branch, endpoint and
// database (contract rule 11). Two jobs need that definition: the one that
// applies migrations, and the one that reports pending migrations without
// writing. They used to carry separate copies of the check, which is how a
// credential and a manifest could name different databases without either
// noticing.
//
// Nothing here reads a secret value: the manifest holds identifiers only.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DEFAULT_TARGET_NAME = 'neon-jaytibirthday-db';

export const manifestPath = join(repoRoot, 'project', 'targets.json');

export function readManifest(path = manifestPath) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (!manifest || !Array.isArray(manifest.targets)) {
    throw new Error('project/targets.json has no targets array');
  }
  return manifest;
}

export function findTarget(manifest, name = DEFAULT_TARGET_NAME) {
  const target = manifest.targets.find((t) => t.name === name);
  if (!target) throw new Error(`project/targets.json has no target named ${name}`);
  if (target.provider !== 'neon') throw new Error(`target ${name} is not a neon target`);
  const ids = target.resource_ids || {};
  for (const key of ['project_id', 'branch_id', 'database']) {
    if (!ids[key]) throw new Error(`target ${name} has no ${key} in project/targets.json`);
  }
  return { name: target.name, environment: target.environment, ...ids };
}

/**
 * Compare what a credential connects to with what the manifest records.
 *
 * A freshness comparison alone cannot tell two byte-identical copies of a
 * database apart - both answer "yes" to it. The project, branch and database
 * identifiers can, so they are what this checks.
 */
export function compareTarget(expected, actual) {
  const reasons = [];
  const check = (label, want, got) => {
    if (!want || !got) return;
    if (String(want) !== String(got)) {
      reasons.push(`${label}: the manifest records ${want}, the credential connects to ${got}`);
    }
  };
  check('project', expected.project_id, actual.project_id);
  check('branch', expected.branch_id, actual.branch_id);
  check('database', expected.database, actual.database);
  return { ok: reasons.length === 0, reasons };
}

/**
 * Compare the newest tracked event in the database with the one the deployed
 * application reports. A database the application has stopped writing to is
 * not the database the application is reading.
 *
 * The comparison runs in one direction only: the application is the live
 * writer, so a database whose newest event is older than the application's is
 * behind it and is the wrong copy. A database ahead of the application is
 * fine - the application may simply be lagging. (The check this replaces
 * compared the other way round, so it fired on a database that was ahead and
 * let a stale copy through.)
 */
export function compareFreshness(dbNewest, apiNewest, toleranceMs = 3600000) {
  const reasons = [];
  if (dbNewest && apiNewest) {
    const behind = new Date(apiNewest).getTime() - new Date(dbNewest).getTime();
    if (behind > toleranceMs) {
      reasons.push(
        'the target is more than an hour behind the deployed application - not the same database',
      );
    }
  }
  return { ok: reasons.length === 0, reasons };
}
