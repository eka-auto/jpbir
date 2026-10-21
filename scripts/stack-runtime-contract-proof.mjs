// Proves the S24 device runtime contract, inside the project environment.
//
// The Product engineering panel has a row for Devices/S24/runtime_contract.json.
// It used to sit on a probe that answered "unknown" forever. Three facts have
// to hold for that row to be provable, and all three live outside a request
// handler:
//
//   contract-bundle-digest  the contract and the bundle it pins are exactly
//                           the bytes this revision ships
//   contract-schema-valid  the contract itself is well formed and says what
//                           it is supposed to say
//   device-bundle-syntax   the pinned device code parses — the bundle the
//                           contract hashes is not a broken file
//
// The DEVICE half of the proof is not here: the panel additionally requires a
// live attested device reporting the contracted release, because a contract
// file in a repository does not prove the phone runs it.
//
// Usage (inside the environment):
//   node scripts/stack-runtime-contract-proof.mjs <output.json>

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = join(ROOT, 'Devices', 'S24', 'runtime_contract.json');

const checks = {
  'contract-bundle-digest': 'fail',
  'contract-schema-valid': 'fail',
  'device-bundle-syntax': 'fail',
};
const notes = [];

// 1. The tree still matches the pinned digest.
try {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'stack-subjects.mjs'), '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  checks['contract-bundle-digest'] = 'pass';
} catch (e) {
  notes.push('the pinned subject digests do not match the tree: ' + String(e.stdout || '').trim().slice(0, 300));
}

// 2. The contract says what it must say.
try {
  const contract = JSON.parse(await readFile(CONTRACT, 'utf8'));
  const required = [
    ['deviceId', (v) => typeof v === 'string' && v.length > 0],
    ['release', (v) => typeof v === 'string' && v.length > 0],
    ['transport.connectionMethod', (v) => typeof v === 'string' && v.length > 0],
    ['transport.inboundListener', (v) => v === false],
    ['identity.keyType', (v) => typeof v === 'string' && v.length > 0],
    ['heartbeat.agentVersionPrefix', (v) => typeof v === 'string' && v.length > 0],
    ['persistence.jobSchedulerPeriodMs', (v) => typeof v === 'number' && v > 0],
    ['command.allowlistedActions', (v) => Array.isArray(v) && v.length > 0],
    ['forbiddenRuntimeFeatures', (v) => Array.isArray(v) && v.length > 0],
  ];
  const problems = [];
  for (const [path, ok] of required) {
    const value = path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), contract);
    if (!ok(value)) problems.push(path);
  }
  if (problems.length) notes.push('the contract does not satisfy: ' + problems.join(', '));
  else checks['contract-schema-valid'] = 'pass';
} catch (e) {
  notes.push('the contract could not be read: ' + String(e.message).slice(0, 200));
}

// 3. The pinned device code parses.
try {
  execFileSync('python3', ['-m', 'py_compile',
    join(ROOT, 'Devices', 'S24', 'device_agent.py'),
    join(ROOT, 'Devices', 'S24', 'signer.py'),
    join(ROOT, 'Devices', 'S24', 'broker_client.py'),
    join(ROOT, 'Devices', 'S24', 'single_instance.py'),
  ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync(process.execPath, ['--check', join(ROOT, 'Devices', 'S24', 's24-agent-daemon.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  checks['device-bundle-syntax'] = 'pass';
} catch (e) {
  notes.push('the pinned device bundle does not parse: ' + String(e.stderr || e.stdout || e.message).trim().slice(0, 300));
}

const report = { subject: 'runtime-contract', checks, notes };
const outPath = process.argv[2];
if (outPath) await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
if (Object.values(checks).some((v) => v !== 'pass')) process.exitCode = 1;
