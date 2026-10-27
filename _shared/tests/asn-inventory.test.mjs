// Contract tests for the read-only ASN inventory script and its workflow.
// The script holds the live database credential path, so these pin the three
// properties the owner approved it on: SELECT-only, no secret values printed,
// and no pull-request trigger (this is a public repository).
// Run: node _shared/tests/asn-inventory.test.mjs

import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptPath = join(root, 'Database', 'scripts', 'asn-inventory.mjs');
const workflowPath = join(root, '.github', 'workflows', 'asn-inventory.yml');

let pass = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.log('  FAIL ' + name + ' -> ' + e.message);
    process.exitCode = 1;
  }
}

t('the inventory script and its workflow exist', () => {
  assert.ok(existsSync(scriptPath), 'Database/scripts/asn-inventory.mjs is missing');
  assert.ok(existsSync(workflowPath), '.github/workflows/asn-inventory.yml is missing');
});

const script = readFileSync(scriptPath, 'utf8');
const workflow = readFileSync(workflowPath, 'utf8');

t('the script is SELECT-only', () => {
  const mutation = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY)\b/i;
  const hit = script.match(mutation);
  assert.strictEqual(hit, null, 'mutation keyword found: ' + (hit && hit[0]));
  assert.ok(/SELECT/.test(script), 'it still reads something');
});

t('the script can never print a connection string', () => {
  assert.ok(!/process\.env/.test(script), 'the script must not touch process.env directly');
  assert.ok(!/connectionString/.test(script), 'the script must not handle the connection string');
  assert.ok(/scrub\(/.test(script), 'error text must pass through the scrubber');
});

t('an unconfigured database fails loudly, never passes', () => {
  assert.ok(/isConfigured\(\)/.test(script), 'configuration is checked first');
  assert.ok(/process\.exit\(1\)/.test(script), 'unconfigured run exits non-zero');
  assert.ok(/process\.exitCode = 1/.test(script), 'query failures exit non-zero too');
});

t('the workflow reads the live secret without exposing it to pull requests', () => {
  assert.ok(/\bsecrets\.DATABASE_URL\b/.test(workflow), 'the DATABASE_URL secret is not wired in');
  assert.ok(/\bworkflow_dispatch:/.test(workflow), 'a manual run stays possible');
  assert.ok(/permissions:\s*\n\s*contents:\s*read/.test(workflow), 'the job gets read-only contents');
  assert.ok(!/\bpull_request\b/.test(workflow), 'this public repo must never expose the secret to PR runs');
  assert.ok(/node Database\/scripts\/asn-inventory\.mjs/.test(workflow), 'the workflow runs the script');
  assert.ok(/'Database\/scripts\/asn-inventory\.mjs'/.test(workflow), 'the script path is in the paths filter');
});

t('the script uses the repository postgres module, not its own client', () => {
  assert.ok(/from '\.\/_env\.mjs'/.test(script), 'local .env.local support comes from the shared loader');
  assert.ok(/Integrations\/postgres\.js/.test(script), 'the pooled client with verify-full TLS is the repo module');
});

console.log(`\n${pass} passed`);
