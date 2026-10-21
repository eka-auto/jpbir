// Regenerates Backend/lib/stack-subjects.js — the pinned digests that bind the
// Product engineering panel's two evidence-backed rows to exact file bytes.
//
// Two subjects:
//
//   runtime-contract   the S24 device contract and the bundle it pins. The
//                      contract is what forbids an inbound listener on the
//                      phone and what pins the agent bundle; proving it means
//                      proving the bundle matches it.
//   migration-tooling  the migration runner, its plan library and the schema
//                      it applies. A migration runner that cannot apply the
//                      schema is a row that has to stay unproven.
//
// The digest is the input to `Backend/lib/stack-evidence.js`, which compares
// it with the digest in a CI receipt. Changing a subject file therefore
// invalidates the proof until CI re-runs the checks and a new receipt is
// published — which is the point. A row whose subject drifted must not keep
// a green light.
//
// Usage:
//   node scripts/stack-subjects.mjs           regenerate the pinned manifest
//   node scripts/stack-subjects.mjs --check   fail if the tree has drifted
//
// `--check` is what CI runs: it makes an unpinned change to a subject file
// fail the build instead of silently making the row permanently stale.

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { digestOf } from '../Backend/lib/stack-digest.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'Backend', 'lib', 'stack-subjects.js');

const RUNTIME_CONTRACT_FILES = [
  'Devices/S24/runtime_contract.json',
  'Devices/S24/device_agent.py',
  'Devices/S24/signer.py',
  'Devices/S24/broker_client.py',
  'Devices/S24/single_instance.py',
  'Devices/S24/install_daemon.sh',
  'Devices/S24/s24-agent-daemon.mjs',
  'Devices/S24/daemon/s24-agent-daemon.mjs',
  'Devices/S24/requirements-broker.txt',
];

async function schemaFiles() {
  const dir = join(ROOT, 'Database', 'schema');
  const names = await readdir(dir);
  const sql = names.filter((n) => n.endsWith('.sql')).sort();
  const aliases = names.includes('migration-aliases.json') ? ['migration-aliases.json'] : [];
  const shared = names.includes('shared-ledger.json') ? ['shared-ledger.json'] : [];
  return [...sql, ...aliases, ...shared].map((n) => 'Database/schema/' + n);
}

async function hashFile(relativePath) {
  const bytes = await readFile(join(ROOT, relativePath));
  return { path: relativePath.split(sep).join('/'), sha256: createHash('sha256').update(normaliseText(bytes)).digest('hex') };
}

/**
 * The bytes a subject is hashed over: line endings normalised to LF.
 *
 * Git checks the same file out with CRLF on Windows and LF on Linux, so the
 * raw bytes of a subject differ per platform while the file is identical. A
 * digest over the raw bytes would therefore pin a value that only one
 * platform can reproduce — the CI producer on Linux would compute a different
 * digest from the one pinned here, and every receipt it published would be
 * refused as "the checked subject has changed". The same normalisation is
 * used by the generator and by the manifest comparison, so the pinned value
 * describes the file's text rather than one checkout's line endings.
 */
function normaliseText(bytes) {
  return Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

async function buildSubjects() {
  const migrationFiles = [
    'Database/scripts/migrate.mjs',
    'Database/scripts/lib/migration-plan.mjs',
    'Database/scripts/_env.mjs',
    ...(await schemaFiles()),
  ];

  const runtimeContract = {
    description: 'S24 device runtime contract and the bundle it pins',
    files: await Promise.all(RUNTIME_CONTRACT_FILES.map(hashFile)),
  };
  runtimeContract.digest = digestOf(runtimeContract.files);

  const migrationTooling = {
    description: 'Migration runner, plan library and the schema it applies',
    files: await Promise.all(migrationFiles.map(hashFile)),
  };
  migrationTooling.digest = digestOf(migrationTooling.files);

  return {
    'runtime-contract': runtimeContract,
    'migration-tooling': migrationTooling,
  };
}

function render(subjects, s24Contract) {
  const body = JSON.stringify(subjects, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : '  ' + line))
    .join('\n');
  const contractBody = JSON.stringify(s24Contract, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : '  ' + line))
    .join('\n');
  return `// GENERATED FILE — do not edit by hand.
//
// Produced by scripts/stack-subjects.mjs. Run that script after changing any
// file listed below, and commit the result together with the change. CI runs
// the same script in --check mode, so a subject edited without re-pinning it
// fails the build instead of leaving a panel row permanently unproven.
//
// The digests are the binding between a CI evidence receipt and the exact
// bytes it checked. See Backend/lib/stack-evidence.js.

export const SUBJECTS = ${body};

// The facts the panel needs from the device runtime contract.
//
// They are lifted out of the contract file by the generator rather than
// copied into Backend/lib by hand, so the panel's expectation of the device
// cannot drift from the contract the device actually runs. The CI check
// re-reads the contract and fails if these values no longer match it.
export const S24_CONTRACT = ${contractBody};
`;
}

/**
 * The facts the panel needs from the device runtime contract.
 */
async function s24ContractFacts() {
  const contract = JSON.parse(await readFile(join(ROOT, 'Devices', 'S24', 'runtime_contract.json'), 'utf8'));
  return {
    device_id: contract.deviceId,
    release: contract.release,
    agent_version_prefix: contract.heartbeat.agentVersionPrefix,
    connection_method: contract.transport.connectionMethod,
    job_scheduler_period_ms: contract.persistence.jobSchedulerPeriodMs,
    heartbeat_interval_seconds: Math.round(contract.persistence.jobSchedulerPeriodMs / 1000),
  };
}

const s24Contract = await s24ContractFacts();
const subjects = await buildSubjects();
const next = render(subjects, s24Contract);

if (process.argv.includes('--check')) {
  let current = null;
  try {
    // Compared with line endings normalised, for the same reason the digests
    // are: the working copy's CRLF and the generated LF are the same file.
    current = normaliseText(await readFile(OUT)).toString('utf8');
  } catch {
    current = null;
  }
  if (current !== next) {
    console.error('Backend/lib/stack-subjects.js is out of date with the tree.');
    console.error('Run: node scripts/stack-subjects.mjs');
    for (const [id, subject] of Object.entries(subjects)) {
      console.error('  ' + id + ' -> ' + subject.digest + ' (' + subject.files.length + ' files)');
    }
    process.exit(1);
  }
  console.log('stack-subjects.js matches the tree (' + Object.keys(subjects).length + ' subjects)');
} else {
  await writeFile(OUT, next, 'utf8');
  for (const [id, subject] of Object.entries(subjects)) {
    console.log('pinned ' + id + ' -> ' + subject.digest + ' (' + subject.files.length + ' files)');
  }
  console.log('pinned S24_CONTRACT -> release ' + s24Contract.release);
}
