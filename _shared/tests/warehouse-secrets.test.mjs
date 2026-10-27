// The repoint script is the one place a connection string passes through a
// process, so two things have to hold: the four secrets get the right form of
// the connection string, and nothing the script prints can contain one.
//
// Writing a repository secret needs an identity the personal one is not
// allowed to use (project/ACCESS.md), so the script is person-run; these
// checks cover the parts that can be checked without touching a secret.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSecretPlan, describePlan, assertPlainIdentifier, explainNeonFailure, neonInvocation } from '../../.github/scripts/repoint-warehouse-secrets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let failures = 0;
const check = (label, pass, detail = '') => {
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : `\n      ${detail}`}`);
};

const POOLED = 'postgresql://neondb_owner:hunter2@ep-example-pooler.aws.neon.tech/jpbir_live';
const UNPOOLED = 'postgresql://neondb_owner:hunter2@ep-example.aws.neon.tech/jpbir_live';

const plan = buildSecretPlan(POOLED, UNPOOLED);

check('the plan sets all four connection secrets', Object.keys(plan).sort().join(',') === 'DATABASE_URL,DATABASE_URL_UNPOOLED,POSTGRES_URL,POSTGRES_URL_NON_POOLING', Object.keys(plan).join(','));
check('the application-facing names carry the pooled string', plan.DATABASE_URL === POOLED && plan.POSTGRES_URL === POOLED);
check('the tooling names carry the unpooled string', plan.DATABASE_URL_UNPOOLED === UNPOOLED && plan.POSTGRES_URL_NON_POOLING === UNPOOLED);

const described = describePlan(plan).join('\n');
check('the report names every secret', ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING'].every((n) => described.includes(n)));
check('the report carries no connection string', !described.includes('hunter2') && !/postgres(ql)?:\/\//.test(described), described);
check('the report says which form each secret carries', described.includes('pooled') && described.includes('unpooled'));

const source = readFileSync(join(root, '.github', 'scripts', 'repoint-warehouse-secrets.mjs'), 'utf8');
check('the script never prints a value', !/console\.log\([^)]*\b(pooled|unpooled|value|url)\b/i.test(source), 'a console.log takes a connection string');
check('the script hands the value to gh on standard input', /input:\s*value/.test(source));
check('the script refuses to run without an explicit --yes', /--yes/.test(source) && /process\.exit\(1\)/.test(source));
check('the script refuses an identity that may not write secrets', /permissions\.admin/.test(source) && /may not write secrets/.test(source));
check('the script reads its target from the manifest', /findTarget\(readManifest\(\)/.test(source));

// The command is run by a person on their own machine, and that machine is
// usually Windows: npm installs the Neon CLI as `neon.cmd` there, and Node
// refuses to spawn a `.cmd` without a shell, so the Linux-only invocation died
// with ENOENT before it ever reached Neon.
const onWindows = neonInvocation('win32');
const onLinux = neonInvocation('linux');
check('the Windows invocation uses the .cmd the installer writes', onWindows.command === 'neon.cmd' && onWindows.options.shell === true, JSON.stringify(onWindows));
check('the elsewhere invocation calls neon directly, without a shell', onLinux.command === 'neon' && !onLinux.options.shell, JSON.stringify(onLinux));
check('the connection string comes through the platform invocation', /neonInvocation\(\)/.test(source) && !/run\('neon',\s*args\)/.test(source));

// A Neon API key belongs to one organization. The mirror and the source
// projects are in different ones, so the wrong key used to fail with a bare
// "project not found" that named neither.
const TARGET = {
  project_id: 'bitter-glade-72523152',
  organization_id: 'org-billowing-meadow-62228264',
  branch_id: 'br-hidden-leaf-b8l1j76r',
  database: 'jpbir_live',
  role: 'neondb_owner',
};
const scoped = explainNeonFailure(new Error('neon.cmd connection-string failed: ERROR: project not found'), TARGET);
check(
  'a credential scoped to another organization names the organization to use',
  scoped.message.includes('org-billowing-meadow-62228264') && /NEON_API_KEY/.test(scoped.message),
  scoped.message,
);
const passedThrough = explainNeonFailure(new Error('the Neon CLI did not return a connection string'), TARGET);
check('an unrelated failure is passed through unchanged', passedThrough.message === 'the Neon CLI did not return a connection string', passedThrough.message);

// The Windows invocation goes through a shell, so an identifier carrying a
// metacharacter would be interpreted rather than passed.
let refused = false;
try {
  assertPlainIdentifier('jpbir_live; rm -rf /', 'database');
} catch {
  refused = true;
}
check('an identifier carrying a shell metacharacter is refused', refused);
check('a plain identifier passes through unchanged', assertPlainIdentifier('jpbir_live', 'database') === 'jpbir_live');

console.log(failures ? `\n${failures} check(s) failed.` : '\nWarehouse secret repoint verified.');
process.exitCode = failures ? 1 : 0;
