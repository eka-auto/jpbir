// Add-only key sync: GitHub Actions secrets -> Vercel production.
//
// Every name in SYNC_KEYS that is set as a GitHub secret but absent from the
// Vercel project in every environment is created there as a sensitive
// Production variable. Nothing is updated or removed, and a key Vercel already
// holds keeps the environments it has: several are Production-only on purpose,
// and sensitive values can't be read back to tell a stale GitHub copy from a
// rotated Vercel one.
//
// Env vars bind at build time, so the live production deployment is rebuilt
// whenever a SYNC_KEYS production variable is newer than it - whether this run
// added it, an earlier run's redeploy failed, or someone ran `vercel env add`.
//
// DRY_RUN=1 reports what would change and writes nothing.

const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID, DRY_RUN, SYNC_KEYS = '', SECRETS_JSON = '{}' } = process.env;

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
const [{ envs }, { deployments: [live] }] = await Promise.all([
  vercel(`/v9/projects/${VERCEL_PROJECT_ID}/env`),
  vercel(`/v6/deployments?projectId=${VERCEL_PROJECT_ID}&target=production&state=READY&limit=1`),
]);
const present = new Set(envs.map(e => e.key));

const batch = [];
for (const key of keys) {
  const value = secrets[key]?.trim();
  if (!value || present.has(key)) continue;
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
