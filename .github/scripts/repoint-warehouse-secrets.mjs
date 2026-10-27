// Repoint the repository's connection secrets at the warehouse the manifest
// records. Run by a person:
//
//     node .github/scripts/repoint-warehouse-secrets.mjs --yes
//
// The connection strings are minted by Neon itself for the manifest's
// project, branch and database, and handed to `gh secret set` on standard
// input. No value is printed, logged, or written to this repository, and no
// value is ever pasted by hand - there is nothing for a person to mistype and
// nothing for a log to leak.
//
// The manifest drives the change: this script repoints the secrets at whatever
// project/targets.json names, and .github/workflows/migration-dry-run.yml then
// checks on every schema change that the credential and the manifest still
// agree. If they ever drift again, CI says so.
//
// Writing a repository secret needs the identity that owns the repository, and
// project/ACCESS.md keeps the personal identity out of secret mutations, so
// this is deliberately a person-run step.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_TARGET_NAME, findTarget, readManifest } from './warehouse-target.mjs';

const REPO = process.env.EKA_REPO || 'eka-auto/jpbir';

/**
 * The four connection secrets, and which form of the connection string each
 * one carries. Pooled for the names that application traffic uses, unpooled
 * for the names that tooling uses.
 */
export function buildSecretPlan(pooled, unpooled) {
  return {
    DATABASE_URL: pooled,
    DATABASE_URL_UNPOOLED: unpooled,
    POSTGRES_URL: pooled,
    POSTGRES_URL_NON_POOLING: unpooled,
  };
}

/**
 * What may be printed about a plan: the secret names and whether each carries
 * a pooled or an unpooled string. Never a value.
 */
export function describePlan(plan) {
  const pooled = plan.DATABASE_URL;
  return Object.keys(plan)
    .sort()
    .map((name) => `  ${name}: ${plan[name] === pooled ? 'pooled' : 'unpooled'} connection string`);
}

function run(command, args, options = {}) {
  const res = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (res.error) throw new Error(`${command} could not be run: ${res.error.message}`);
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').trim().split('\n').slice(-3).join(' ');
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }
  return res.stdout || '';
}

export function connectionString(target, { pooled }) {
  const args = [
    'connection-string',
    '--project-id', target.project_id,
    '--branch', target.branch_id,
    '--database-name', target.database,
    '--role-name', target.role || 'neondb_owner',
  ];
  if (pooled) args.push('--pooled');
  const out = run('neon', args);
  const url = out.split('\n').map((line) => line.trim()).find((line) => /^postgres(ql)?:\/\//.test(line));
  if (!url) throw new Error('the Neon CLI did not return a connection string');
  return url;
}

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error('This changes the repository\'s connection secrets. Re-run with --yes to do it.');
    process.exit(1);
  }

  const target = findTarget(readManifest(), process.env.EKA_TARGET_NAME || DEFAULT_TARGET_NAME);
  console.log('manifest target : ' + target.name);
  console.log('neon project    : ' + target.project_id);
  console.log('neon branch     : ' + target.branch_id);
  console.log('database        : ' + target.database);

  const who = run('gh', ['api', 'user', '--jq', '.login']).trim();
  const permissions = run('gh', ['api', `repos/${REPO}`, '--jq', '.permissions.admin']).trim();
  if (permissions !== 'true') {
    console.error(`::error::the authenticated account ${who} may not write secrets on ${REPO}`);
    process.exit(1);
  }
  console.log('writing as      : ' + who);

  const plan = buildSecretPlan(
    connectionString(target, { pooled: true }),
    connectionString(target, { pooled: false }),
  );

  for (const line of describePlan(plan)) console.log(line);

  for (const [name, value] of Object.entries(plan)) {
    // The value goes in on standard input: it never appears in a command line,
    // in this script's output, or in a process listing.
    run('gh', ['secret', 'set', name, '--repo', REPO], { input: value });
    console.log('  set ' + name);
  }

  console.log('done. The next schema change to main runs the dry-run job, which prints');
  console.log('the project, branch and database the credential now resolves to.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
