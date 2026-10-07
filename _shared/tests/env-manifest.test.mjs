// Offline guards for _shared/config/vercel-env.manifest.json.
//
// The manifest exists because the only record of what each Vercel project's
// environment contained used to be Vercel itself, which made every question -
// "is FIREBASE_SERVICE_ACCOUNT_JSON set on channel-sandbox?", "did STATS_KEY leak
// out of development?" - a manual CLI investigation, and made drift undetectable.
// Two real incidents shaped these assertions:
//
//   * channel-sandbox's STATS_KEY was pullable in PLAINTEXT from its development
//     environment (Vercel blocks secret decryption for production and preview only)
//     and was byte-identical to the production key. Deleting it from development is
//     asserted below so it cannot quietly come back.
//   * jayti-dashboard's Production VERCEL_PROJECT_ID once carried a leading U+FEFF,
//     which corrupted Backend/vercel-analytics.js:24. Its length is asserted per
//     environment because a BOM is invisible in every normal view.
//
// These run with no network and no credentials. Regenerating the manifest needs
// `vercel` auth: node _shared/tools/generate-env-manifest.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const raw = readFileSync(join(ROOT, '_shared', 'config', 'vercel-env.manifest.json'), 'utf8');
const manifest = JSON.parse(raw);

let pass = 0, total = 0;
function t(name, fn) {
  total++;
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

const proj = (n) => manifest.projects[n];
const varOf = (n, key) => proj(n).vars.find((v) => v.key === key);
const CREDENTIALISH = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|_URL$|^URL$|DATABASE|POSTGRES|REDIS|BLOB)/;

// ---------------------------------------------------------------- no secrets --

t('the manifest stores no value for any variable', () => {
  for (const [name, p] of Object.entries(manifest.projects)) {
    for (const v of p.vars) {
      assert.equal('value' in v, false, `${name}/${v.key} carries a value`);
      for (const [env, d] of Object.entries(v.environments)) {
        assert.deepEqual(Object.keys(d).sort().filter((k) => !['length', 'sha256_12', 'updatedAt'].includes(k)), [],
          `${name}/${v.key}/${env} has unexpected fields`);
      }
    }
  }
});

t('the serialized file contains no credential shape at all', () => {
  for (const needle of ['postgres://', 'postgresql://', 'redis://', 'rediss://', 'https://:',
    'BEGIN PRIVATE KEY', 'BEGIN RSA', '[SENSITIVE]', 'eyJ2IjoidjIi', '"decrypted"', 'xoxb-', 'AKIA']) {
    assert.equal(raw.includes(needle), false, `manifest contains ${needle}`);
  }
});

t('only allowlisted keys are fingerprinted', () => {
  const allow = new Set(manifest.fingerprintAllowlist);
  for (const [name, p] of Object.entries(manifest.projects)) {
    for (const v of p.vars) {
      for (const [env, d] of Object.entries(v.environments)) {
        if (d.sha256_12 !== undefined) {
          assert.ok(allow.has(v.key), `${name}/${v.key}/${env} is fingerprinted but not allowlisted`);
          assert.match(d.sha256_12, /^[0-9a-f]{12}$/, `${name}/${v.key}/${env} bad fingerprint`);
        }
      }
    }
  }
});

t('the fingerprint allowlist itself names no credential', () => {
  // A sha256 of a low-entropy secret lets an attacker confirm a guess offline, so
  // the allowlist may only ever hold identifiers, regions, table names and config
  // whose contents are already public in the repo.
  for (const key of manifest.fingerprintAllowlist) {
    assert.equal(CREDENTIALISH.test(key), false, `${key} must not be fingerprinted`);
  }
});

t('no variable NAME in the manifest embeds a token', () => {
  // Vercel names Blob variables vercel_blob_rw_<storeId>_<READ_WRITE_TOKEN>_<SUFFIX>,
  // so the name IS a credential. Committing it would widen the exposure from
  // "anyone with Vercel project read access" to "anyone who can clone the repo".
  // The generator redacts the middle segment and records only its sha256; this
  // fails if a future integration invents another secret-in-name shape.
  for (const [name, p] of Object.entries(manifest.projects)) {
    for (const v of p.vars) {
      assert.equal(/_[A-Za-z0-9]{20,}_/.test(v.key), false,
        `${name}/${v.key} embeds a token-shaped segment`);
    }
  }
  assert.equal(/vercel_blob_rw_[A-Za-z0-9]+_[A-Za-z0-9]{20,}/.test(raw), false,
    'a raw Blob token reached the file');

  const redacted = manifest.projects['jayti-dashboard'].vars.filter((v) => v.keyRedacted);
  assert.ok(redacted.length >= 1, 'the Blob token-in-name vars should be present and redacted');
  for (const v of redacted) {
    assert.match(v.key, /<REDACTED>/, `${v.key} is marked redacted but shows no marker`);
    assert.match(v.keySha256_12, /^[0-9a-f]{12}$/, `${v.key} has no usable fingerprint`);
    assert.ok(v.note, `${v.key} is redacted without explaining why`);
  }
});

// ------------------------------------------------- decisions that must not slip --

t('channel-sandbox STATS_KEY stays out of development', () => {
  const v = varOf('channel-sandbox', 'STATS_KEY');
  assert.ok(v, 'STATS_KEY vanished from the manifest');
  assert.ok(v.absentFrom.includes('development'),
    'STATS_KEY is back on development, where Vercel returns it in plaintext');
  assert.equal(v.type, 'sensitive');
});

t('SANDBOX_AUTH_DISABLED is set on no project and no environment', () => {
  // It disables the sandbox auth guard entirely. Its absence is the invariant.
  for (const [name, p] of Object.entries(manifest.projects)) {
    assert.equal(p.vars.some((v) => v.key === 'SANDBOX_AUTH_DISABLED'), false, `${name} sets it`);
  }
});

t('channel-sandbox production carries all three required vars', () => {
  for (const key of ['STATS_KEY', 'SANDBOX_CONFIG_JSON', 'FIREBASE_SERVICE_ACCOUNT_JSON']) {
    const v = varOf('channel-sandbox', key);
    assert.ok(v, `${key} missing from the manifest`);
    assert.ok(v.environments.production, `${key} is not set on production`);
  }
});

t('the sandbox service-account key stays production-only', () => {
  // Preview and development have no key by design: preview deployments already run
  // against production data, so handing them a Firestore credential adds risk and
  // no isolation.
  const v = varOf('channel-sandbox', 'FIREBASE_SERVICE_ACCOUNT_JSON');
  assert.deepEqual(Object.keys(v.environments).sort(), ['production']);
  assert.deepEqual(v.absentFrom.sort(), ['development', 'preview']);
});

t('production SANDBOX_CONFIG_JSON carries the device roster that preview lacks', () => {
  // A lambda has no devices.json, so the roster only ever arrives inside this var.
  // When it was missing, four routes raised a bare KeyError and Flask answered an
  // HTML 500 that read like a crash.
  const v = varOf('channel-sandbox', 'SANDBOX_CONFIG_JSON');
  const prod = v.environments.production;
  const prev = v.environments.preview;
  assert.ok(prod.length > prev.length,
    `production (${prod.length}) is not larger than preview (${prev.length}) - roster missing?`);
  assert.ok(prod.length >= 600, `production config is only ${prod.length} chars`);
});

t('jayti-dashboard VERCEL_PROJECT_ID is exactly 32 chars on every environment', () => {
  const v = varOf('jayti-dashboard', 'VERCEL_PROJECT_ID');
  for (const env of ['production', 'preview', 'development']) {
    const d = v.environments[env];
    assert.ok(d, `${env} is missing it`);
    assert.equal(d.length, 32, `${env} is ${d.length} chars - a BOM or padding is invisible elsewhere`);
  }
  const fp = new Set(Object.values(v.environments).map((d) => d.sha256_12));
  assert.equal(fp.size, 1, 'the three environments disagree on the project id');
});

// ------------------------------------------------------------------- coverage --

// Vars the deployed sandbox reads that are deliberately NOT project env vars,
// or that are project env vars the manifest has not recorded yet — the
// generator needs `vercel` auth, so a var that is only about to be provisioned
// on the project is documented here until the next regeneration picks it up.
const NOT_PROJECT_ENV = {
  VERCEL_GIT_COMMIT_SHA: 'injected by Vercel at build time',
  VERCEL_REGION: 'injected by Vercel at runtime',
  SANDBOX_AUTH_DISABLED: 'must never be set - it disables the auth guard',
  SANDBOX_MODE: 'optional override; absent means the config mode ("real") is used',
  AGENT_API_URL: 'optional; only /api/agent/query reads it',
  AGENT_API_KEY: 'optional; only /api/agent/query reads it',
  AWS_REGION: 'optional; read with a default',
  DATABASE_URL: 'channel-sandbox project env var required by /api/data/whatsapp; provision per Devices/sandbox/README.md step 2, then regenerate the manifest',
  POSTGRES_URL: 'fallback name for DATABASE_URL (same convention as Integrations/postgres.js); same provisioning note',
};

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.venv' || e === '.git') continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(py|js|mjs|yml|example|html)$/.test(e)) out.push(p);
  }
  return out;
}

t('every env var the deployed sandbox entrypoints read is in the manifest or documented', () => {
  // Scope is vercel.json's `builds` entrypoints plus the module they import, not
  // the whole Devices/sandbox tree - that also holds device-side scripts and test
  // harnesses whose variables are never project env.
  const sources = ['Devices/sandbox/dashboard_api.py', 'Devices/sandbox/firestore_client.py']
    .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
  const read = new Set([...sources.matchAll(/os\.environ(?:\.get)?\(?\[?['"]([A-Z_][A-Z0-9_]*)['"]/g)].map((m) => m[1]));
  assert.ok(read.size >= 8, `only found ${read.size} env reads - the regex stopped matching`);

  const have = new Set(proj('channel-sandbox').vars.map((v) => v.key));
  const unaccounted = [...read].filter((k) => !have.has(k) && !(k in NOT_PROJECT_ENV)).sort();
  assert.deepEqual(unaccounted, [],
    `deployed code reads vars absent from the manifest and undocumented: ${unaccounted.join(', ')}`);

  const stale = Object.keys(NOT_PROJECT_ENV).filter((k) => !read.has(k) && k !== 'SANDBOX_AUTH_DISABLED');
  assert.deepEqual(stale, [], `documented-but-no-longer-read: ${stale.join(', ')} - drop them`);
});

t('manifest keys nothing reads are recorded as known orphans, with a reason', () => {
  // 42 of jayti-dashboard's 73 keys are referenced by no source file. Listing them
  // by group is the point: an orphan is a decision, not an accident, and the next
  // one has to be explained too. Several groups are NOT safe to delete by hand -
  // a Vercel storage connection re-syncs its own variables, so removing names
  // individually just gets them back.
  const ORPHAN_GROUPS = {
    'jayti-dashboard': {
      // Vercel's Neon integration writes this whole bundle for jaytibirthday-db,
      // but Integrations/postgres.js reads only DATABASE_URL / POSTGRES_URL and
      // their _UNPOOLED / _NON_POOLING siblings. Managed by store_dQhfMCNNH24Xrsot.
      'neon-connection-bundle (live store, unused siblings)': [
        'NEON_PROJECT_ID', 'PGDATABASE', 'PGHOST', 'PGHOST_UNPOOLED', 'PGPASSWORD',
        'PGUSER', 'POSTGRES_DATABASE', 'POSTGRES_HOST', 'POSTGRES_PASSWORD',
        'POSTGRES_PRISMA_URL', 'POSTGRES_URL_NO_SSL', 'POSTGRES_USER'],
      // private-file-gate-db (store_vCGyiw2WL0p7oh1k). That database was verified
      // to hold zero application tables, and removal is a human command:
      // `vercel integration-resource remove private-file-gate-db --disconnect-all`.
      'private-file-gate-db (store verified empty, pending removal)': [
        'GATE_DATABASE_URL', 'GATE_DATABASE_URL_UNPOOLED', 'GATE_NEON_AUTH_BASE_URL',
        'GATE_NEON_PROJECT_ID', 'GATE_PGDATABASE', 'GATE_PGHOST', 'GATE_PGHOST_UNPOOLED',
        'GATE_PGPASSWORD', 'GATE_PGUSER', 'GATE_POSTGRES_DATABASE', 'GATE_POSTGRES_HOST',
        'GATE_POSTGRES_PASSWORD', 'GATE_POSTGRES_PRISMA_URL', 'GATE_POSTGRES_URL',
        'GATE_POSTGRES_URL_NO_SSL', 'GATE_POSTGRES_URL_NON_POOLING', 'GATE_POSTGRES_USER',
        'GATE_VITE_NEON_AUTH_URL'],
      // Upstash device-data. Never wired up; the app reads DynamoDB and Neon.
      'upstash-kv (never wired up)': [
        'KV_REST_API_READ_ONLY_TOKEN', 'KV_REST_API_TOKEN', 'KV_REST_API_URL',
        'KV_URL', 'REDIS_URL'],
      // A live read-write token embedded in the variable NAME, visible to anyone
      // with project read access and echoed into build logs. The app reads plain
      // BLOB_READ_WRITE_TOKEN (Backend/wa-media.js, Backend/wa-blob-upload.js).
      // Deleting the name does NOT revoke the token; rotation is dashboard-only.
      // The generator redacts the token segment, so these appear as <REDACTED> and
      // carry only a keySha256_12 - committing the real names would widen the
      // exposure from Vercel project access to everyone who can clone the repo.
      'blob-token-in-variable-name (rotate, do not just delete)': [
        'vercel_blob_rw_KydwgdJeIogU0Fw6_<REDACTED>_STORE_ID',
        'vercel_blob_rw_KydwgdJeIogU0Fw6_<REDACTED>_WEBHOOK_PUBLIC_KEY',
        'vercel_blob_rw_qSrfKqJxsxAzFjXc_<REDACTED>_READ_WRITE_TOKEN',
        'vercel_blob_rw_qSrfKqJxsxAzFjXc_<REDACTED>_STORE_ID',
        'vercel_blob_rw_qSrfKqJxsxAzFjXc_<REDACTED>_WEBHOOK_PUBLIC_KEY'],
      'other-unused': ['BLOB_STORE_ID', 'ENDFORM_API_KEY'],
      // Retired from the source tree in the Neon-only release. They remain in
      // this inventory until the production deployment has been verified and
      // the Vercel records are deleted by id.
      'retired-cloud-runtime (pending production verification)': [
        'JP_AGENT_TOKEN', 'JP_AGENT_URL',
        'JP_AWS_ACCESS_KEY_ID', 'JP_AWS_REGION', 'JP_AWS_SECRET_ACCESS_KEY', 'JP_TELEMETRY_TABLE',
        'JP_WRITE_AWS_ACCESS_KEY_ID', 'JP_WRITE_AWS_SECRET_ACCESS_KEY',
      ],
    },
    'channel-sandbox': {
      // Set on all three environments; nothing in the repo reads it.
      'other-unused': ['ENDFORM_API_KEY'],
    },
  };

  const files = ['Backend', 'Integrations', 'Devices/sandbox', '.github']
    .flatMap((d) => walk(join(ROOT, d)));
  assert.ok(files.length > 100, `only scanned ${files.length} source files - the walk is broken`);
  const blob = files.map((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');

  for (const [name, p] of Object.entries(manifest.projects)) {
    const actual = p.vars.filter((v) => !blob.includes(v.key)).map((v) => v.key).sort();
    const groups = ORPHAN_GROUPS[name] || {};
    const expected = Object.values(groups).flat().sort();
    assert.equal(new Set(expected).size, expected.length, `${name}: orphan groups overlap`);
    assert.deepEqual(actual, expected,
      `${name}: orphan set changed. Unexplained additions mean a var lost its reader; ` +
      `missing entries mean one was removed or newly referenced.`);
  }
});

// ------------------------------------------------------------------- structure --

t('the manifest describes both projects with a stable shape', () => {
  assert.deepEqual(Object.keys(manifest.projects).sort(), ['channel-sandbox', 'jayti-dashboard']);
  for (const [name, p] of Object.entries(manifest.projects)) {
    assert.match(p.projectId, /^prj_[A-Za-z0-9]+$/, `${name} projectId`);
    assert.ok(p.uniqueKeyCount <= p.recordCount, `${name}: more keys than records`);
    assert.equal(p.vars.length, p.uniqueKeyCount, `${name}: vars array disagrees with uniqueKeyCount`);
    const keys = p.vars.map((v) => v.key);
    // Same comparator the generator uses; a byte-order sort() here would disagree
    // with localeCompare about where lowercase vercel_blob_rw_* sits.
    assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b)),
      `${name}: vars are not sorted, so diffs will churn`);
    assert.equal(new Set(keys).size, keys.length, `${name}: duplicate key entries`);
    for (const v of p.vars) {
      assert.ok(['sensitive', 'encrypted', 'plain'].some((x) => v.type.includes(x)), `${name}/${v.key} type ${v.type}`);
      assert.ok(Object.keys(v.environments).length > 0, `${name}/${v.key} has no environments`);
      for (const env of Object.keys(v.environments)) {
        assert.ok(['production', 'preview', 'development'].includes(env), `${name}/${v.key} bad env ${env}`);
        assert.equal(v.absentFrom.includes(env), false, `${name}/${v.key} lists ${env} both present and absent`);
      }
    }
  }
});

console.log(`\n${pass}/${total} passed`);
