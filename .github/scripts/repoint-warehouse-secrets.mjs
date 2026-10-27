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

/**
 * How to invoke the Neon CLI on this platform.
 *
 * npm installs the CLI as `neon.cmd` and `neon.ps1` on Windows, and Node
 * refuses to spawn a `.cmd` without a shell, so `spawnSync('neon', ...)` fails
 * with ENOENT there while working on Linux and macOS. Exported so the
 * difference can be checked without running the CLI.
 */
export function neonInvocation(platform = process.platform) {
  return platform === 'win32'
    ? { command: 'neon.cmd', options: { shell: true } }
    : { command: 'neon', options: {} };
}

/**
 * Identifiers from the manifest are used to build a command line, and on
 * Windows that line goes through a shell. Neon's project, branch, database and
 * role names are plain identifiers, so refuse anything that is not - a value
 * carrying a shell metacharacter would otherwise be interpreted rather than
 * passed.
 */
const PLAIN_IDENTIFIER = /^[A-Za-z0-9_.-]+$/;

export function assertPlainIdentifier(value, label) {
  const text = String(value ?? '');
  if (!PLAIN_IDENTIFIER.test(text)) {
    throw new Error(`${label} "${text}" is not a plain identifier - refusing to build a command line from it`);
  }
  return text;
}

/**
 * Neon API keys belong to one organization, and a key for the wrong one fails
 * with a bare "project not found". Say which project and which organization,
 * and what to set, instead of leaving the operator to guess.
 */
export function explainNeonFailure(error, target) {
  const detail = String(error && error.message ? error.message : error);
  const scopeProblem = /project not found|not allowed to perform this action on the organization/i;
  if (!scopeProblem.test(detail)) return error instanceof Error ? error : new Error(detail);
  const org = target.organization_id ? ` (${target.organization_id})` : '';
  return new Error(
    `the Neon credential cannot see project ${target.project_id}. Neon API keys are scoped to one ` +
      `organization, so run this with NEON_API_KEY set to a key for the organization that owns ` +
      `project ${target.project_id}${org}. The CLI said: ${detail}`,
  );
}

export function connectionString(target, { pooled }) {
  const args = [
    'connection-string',
    '--project-id', assertPlainIdentifier(target.project_id, 'project'),
    '--branch', assertPlainIdentifier(target.branch_id, 'branch'),
    '--database-name', assertPlainIdentifier(target.database, 'database'),
    '--role-name', assertPlainIdentifier(target.role || 'neondb_owner', 'role'),
  ];
  if (pooled) args.push('--pooled');
  const invocation = neonInvocation();
  let out;
  try {
    out = run(invocation.command, args, invocation.options);
  } catch (error) {
    throw explainNeonFailure(error, target);
  }
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
