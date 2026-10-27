// The manifest is the one definition of the production warehouse, and the
// check that enforces it has to be able to tell two identical copies apart.
//
// On 2026-10-27 the meadow organization held two byte-identical copies of
// jpbir_live: production wrote to one of them and the repository's secrets
// named the other. A freshness comparison could not tell them apart - both
// answered "yes". The manifest's identifiers can, so these checks pin that
// behaviour down.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_TARGET_NAME,
  compareFreshness,
  compareTarget,
  findTarget,
  readManifest,
} from '../../.github/scripts/warehouse-target.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let failures = 0;
const check = (label, pass, detail = '') => {
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : `\n      ${detail}`}`);
};

const manifest = readManifest(join(root, 'project', 'targets.json'));
const target = findTarget(manifest, DEFAULT_TARGET_NAME);

check('the manifest names a production neon target', target.environment === 'production', `environment: ${target.environment}`);
check('the production target records a project, a branch and a database', Boolean(target.project_id && target.branch_id && target.database));
check('the production warehouse lives in the meadow organization', target.organization_id === 'org-billowing-meadow-62228264', `organization: ${target.organization_id}`);
check('the production warehouse is not the retired source project', target.project_id !== 'fancy-cloud-99501540', `project: ${target.project_id}`);

const matching = { project_id: target.project_id, branch_id: target.branch_id, database: target.database };
check('a credential on the recorded project, branch and database passes', compareTarget(target, matching).ok);

const wrongProject = compareTarget(target, { ...matching, project_id: 'some-other-project' });
check('a credential on another project fails', !wrongProject.ok);
check('the failure names the project on both sides', wrongProject.reasons.some((r) => r.includes(target.project_id) && r.includes('some-other-project')), wrongProject.reasons.join('; '));

const wrongBranch = compareTarget(target, { ...matching, branch_id: 'br-somewhere-else' });
check('a credential on another branch fails', !wrongBranch.ok);

const wrongDatabase = compareTarget(target, { ...matching, database: 'neondb' });
check('a credential on another database fails', !wrongDatabase.ok);
check('the failure names the database on both sides', wrongDatabase.reasons.some((r) => r.includes(target.database) && r.includes('neondb')), wrongDatabase.reasons.join('; '));

const partial = compareTarget(target, { project_id: matching.project_id });
check('an identifier the provider does not report is not treated as a mismatch', partial.ok, partial.reasons.join('; '));

check('a database within an hour of the application passes', compareFreshness('2026-10-27T08:00:00Z', '2026-10-27T08:30:00Z').ok);
check('a database an hour behind the application fails', !compareFreshness('2026-10-27T06:00:00Z', '2026-10-27T08:30:00Z').ok);
check('a database ahead of the application passes', compareFreshness('2026-10-27T09:00:00Z', '2026-10-27T08:30:00Z').ok);
check('a database with no comparable timestamp passes the freshness check', compareFreshness(null, '2026-10-27T08:30:00Z').ok);

const verify = readFileSync(join(root, '.github', 'scripts', 'verify-production-warehouse.mjs'), 'utf8');
const apply = readFileSync(join(root, '.github', 'workflows', 'migrate-production.yml'), 'utf8');
const dryRun = readFileSync(join(root, '.github', 'workflows', 'migration-dry-run.yml'), 'utf8');

check('the verification script compares the credential with the manifest', /compareTarget\s*\(/.test(verify));
const logged = verify.split('\n').filter((line) => /console\.(log|error)\(/.test(line)).join('\n');
check('the verification script prints no connection string', !/postgres(ql)?:\/\//.test(logged) && !/console\.(log|error)\([^)]*\+\s*DATABASE_URL/.test(verify), logged);
check('the verification script prints the identity it checked', /neon project/.test(verify) && /manifest/.test(verify));
check('the apply workflow and the dry run share one verification script', apply.includes('verify-production-warehouse.mjs') && dryRun.includes('verify-production-warehouse.mjs'));
check('the apply workflow carries no second copy of the check', !/current_setting\('neon\.project_id'/.test(apply), 'the inline preflight is still in migrate-production.yml');
check('the dry run runs the plan in read-only mode', /migrate\.mjs --dry-run/.test(dryRun));
check('the dry run never applies a migration', !/migrate\.mjs(?! --dry-run)/.test(dryRun.replace(/migrate\.mjs --dry-run/g, '')));
check('the dry run triggers on a schema change to main', /push:/.test(dryRun) && /branches:\s*\[main\]/.test(dryRun) && /Database\/schema\/\*\*/.test(dryRun));

console.log(failures ? `\n${failures} check(s) failed.` : '\nWarehouse target verified.');
process.exitCode = failures ? 1 : 0;
