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

import { buildSecretPlan, describePlan } from '../../.github/scripts/repoint-warehouse-secrets.mjs';

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

console.log(failures ? `\n${failures} check(s) failed.` : '\nWarehouse secret repoint verified.');
process.exitCode = failures ? 1 : 0;
