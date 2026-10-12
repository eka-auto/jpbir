// Add-only key sync: GitHub Actions secrets -> Vercel production.
//
// Every name in SYNC_KEYS that is set as a GitHub secret but missing from
// Vercel Production is created there as a sensitive Production variable.
// Nothing is updated or removed, and nothing is added to Preview or
// Development: several keys are Production-only on purpose, and sensitive
// values can't be read back to tell a stale GitHub copy from a rotated one.
//
// Env vars bind at build time, so the live production deployment is rebuilt
// whenever a SYNC_KEYS production variable is newer than it - whether this run
// added it, an earlier run's redeploy failed, or someone ran `vercel env add`.
//
// DRY_RUN=1 reports what would change and writes nothing.

import { createPrivateKey, createPublicKey } from 'node:crypto';

const {
  VERCEL_TOKEN,
  VERCEL_TEAM_ID,
  VERCEL_PROJECT_ID,
  DRY_RUN,
  SYNC_KEYS = '',
  SECRETS_JSON = '{}',
  STATIC_ENV_FILES = '{}',
} = process.env;

if (!VERCEL_TOKEN) {
  console.error('::error::the VERCEL_TOKEN secret is not set');
  process.exit(1);
}

async function vercel(path, init = {}) {
  const url = new URL(path, 'https://api.vercel.com');
  url.searchParams.set('teamId', VERCEL_TEAM_ID);
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url.pathname} -> ${res.status} ${body.error?.code ?? ''}`);
  return body;
}

const keys = new Set(SYNC_KEYS.split(/\s+/).filter(Boolean));
const secrets = JSON.parse(SECRETS_JSON);
const staticFiles = JSON.parse(STATIC_ENV_FILES);
const staticValues = new Map();
for (const [key, file] of Object.entries(staticFiles)) {
  if (!keys.has(key)) throw new Error(`STATIC_ENV_FILES key ${key} is not in SYNC_KEYS`);
  if (typeof file !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(file) || file.startsWith('/') || file.includes('..')) {
    throw new Error(`STATIC_ENV_FILES path for ${key} is not a safe repository-relative path`);
  }
  const value = await import('node:fs/promises').then(({ readFile }) => readFile(file, 'utf8'));
  if (!value.trim()) throw new Error(`STATIC_ENV_FILES source for ${key} is empty`);
  staticValues.set(key, value);
}

// The CI signer is intentionally private to GitHub Actions. The deployed
// endpoint needs only its public half, and GitHub Actions never exposes secret
// values for readback. Derive that public key during the controlled sync so a
// newly linked Vercel project is not left unable to verify scheduled S24
// exports. An explicit S24_SYNC_PUBLIC_KEYS value still wins, which preserves
// deliberate multi-key rotation when it is configured.
if (keys.has('S24_SYNC_PUBLIC_KEYS') && !staticValues.has('S24_SYNC_PUBLIC_KEYS') &&
    !secrets.S24_SYNC_PUBLIC_KEYS?.trim() && secrets.S24_SYNC_PRIVATE_KEY_PEM?.trim()) {
  try {
    const privateKey = createPrivateKey(secrets.S24_SYNC_PRIVATE_KEY_PEM);
    const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
    staticValues.set('S24_SYNC_PUBLIC_KEYS', publicKey);
  } catch {
    console.log('::error::could not derive S24_SYNC_PUBLIC_KEYS from S24_SYNC_PRIVATE_KEY_PEM');
    process.exitCode = 1;
  }
}
const [{ envs }, { deployments: [live] }] = await Promise.all([
  vercel(`/v9/projects/${VERCEL_PROJECT_ID}/env`),
  vercel(`/v6/deployments?projectId=${VERCEL_PROJECT_ID}&target=production&state=READY&limit=1`),
]);
// Only a Production record counts: a Preview- or Development-only copy is no
// reason to leave Production without the key.
const inProduction = new Set(envs.filter(e => e.target.includes('production')).map(e => e.key));

const batch = [];
for (const key of keys) {
  const value = staticValues.get(key) ?? secrets[key]?.trim();
  if (!value || inProduction.has(key)) continue;
  // A zero-width space spliced into a key has broken auth here before, and a
  // sensitive value can't be inspected once stored. Refuse it; never print it.
  if (/[^\x20-\x7e\t\r\n]/.test(value)) {
    console.log(`::error::${key} contains non-printable characters; not synced`);
    process.exitCode = 1;
    continue;
  }
  console.log(`${DRY_RUN ? 'would add' : 'adding'} ${key} -> production`);
  batch.push({ key, value, type: 'sensitive', target: ['production'] });
}

if (batch.length && !DRY_RUN) {
  const { failed = [] } = await vercel(`/v10/projects/${VERCEL_PROJECT_ID}/env`, {
    method: 'POST',
    body: JSON.stringify(batch),
  });
  for (const { error } of failed) {
    console.log(`::error::${error?.envVarKey ?? error?.key ?? 'a key'} was not added (${error?.code ?? 'unknown'})`);
    process.exitCode = 1;
  }
}

const newer = envs
  .filter(e => keys.has(e.key) && e.target.includes('production') && e.updatedAt > (live?.createdAt ?? 0))
  .map(e => e.key);
const reasons = [...batch.map(b => b.key), ...newer];

if (!reasons.length) {
  console.log('production is up to date');
} else if (DRY_RUN) {
  console.log(`dry run: would redeploy production for ${reasons.join(', ')}`);
} else if (!live) {
  console.log('::warning::no live production deployment to rebuild; the next deploy picks the keys up');
} else {
  const { url } = await vercel('/v13/deployments?forceNew=1', {
    method: 'POST',
    body: JSON.stringify({ name: live.name, deploymentId: live.uid, target: 'production' }),
  });
  console.log(`rebuilding the live production deployment for ${reasons.join(', ')}: https://${url}`);
}
