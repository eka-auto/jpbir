#!/usr/bin/env node
// Regenerate _shared/config/vercel-env.manifest.json from live Vercel state.
//
// Why this exists: until now the only record of what each project's environment
// contained was Vercel itself. That made every question in this repo's history -
// "is FIREBASE_SERVICE_ACCOUNT_JSON set on channel-sandbox?", "did STATS_KEY leak
// out of development?", "which vars are readable secrets?" - a manual CLI
// investigation, and it made drift undetectable. The manifest is the artifact an
// autosync can reconcile against; _shared/tests/env-manifest.test.mjs keeps it
// honest offline.
//
// Two sources, each used only for what it is authoritative for:
//   * GET /v9/projects/{id}/env  -> key, type, visibility, target, securityIssues.
//     The `decrypt=true` parameter is DEPRECATED AND IGNORED, so the `value` it
//     returns for type:encrypted vars is ciphertext, not plaintext. Fingerprinting
//     that would be meaningless: it changes on re-encryption even when the value
//     does not.
//   * `vercel env pull`           -> correctly decoded values. Used only to derive
//     sha256_12 fingerprints for a small allowlist of non-credential identifiers.
//
// Plaintext never reaches this process. Each pulled file is decoded inside a
// disposable child process that prints fingerprints and nothing else, then every
// temp file is shredded. NO SECRET VALUE IS EVER WRITTEN TO THE MANIFEST, and the
// script aborts if one would be.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// #96 dropped `vercel` from devDependencies: nothing in the deployed app used
// it and its transitive tree was the whole `npm audit` report. That left this
// script pointing at a bin that no longer gets installed. Prefer the local bin
// when a contributor happens to have one, otherwise resolve `vercel` from PATH
// (`npm i -g vercel && vercel login`).
const LOCAL_VERCEL = path.join(ROOT, 'node_modules', '.bin', 'vercel');
const VERCEL = fs.existsSync(LOCAL_VERCEL) ? LOCAL_VERCEL : 'vercel';
const OUT = path.join(ROOT, '_shared', 'config', 'vercel-env.manifest.json');
const TEAM = 'team_pbbZItTCyIkGsw6LeGrcWx0c';

const PROJECTS = [
  { name: 'jayti-dashboard', projectId: 'prj_ert0BAxafhopYg8tjtbOMcfjDI9r' },
  { name: 'channel-sandbox', projectId: 'prj_hRRe8dOt2F3mYU721Qk9lFAG9V92' },
];
const ENVIRONMENTS = ['production', 'preview', 'development'];

// Only these are fingerprinted. A SHA-256 of a low-entropy secret lets an
// attacker confirm a guess offline, so this allowlist holds identifiers,
// regions, table names and the sandbox config (whose device ids are already
// committed in Devices/sandbox/devices.json) - never a credential, token,
// password, key, or a URL that could carry one.
const FINGERPRINT_ALLOWLIST = [
  'VERCEL_PROJECT_ID', 'VERCEL_TEAM_ID', 'VERCEL_ANALYTICS_PROJECT_ID',
  'FIRESTORE_DB', 'JP_AWS_REGION', 'JP_TELEMETRY_TABLE', 'STATS_SITE',
  'STALE_ALERT_SECONDS', 'SANDBOX_CONFIG_JSON', 'SANDBOX_MODE',
];

function run(args, opts = {}) {
  const r = spawnSync(VERCEL, args, { encoding: 'utf8', timeout: 240000, maxBuffer: 128 * 1024 * 1024, ...opts });
  if (r.error) throw new Error(`could not run ${VERCEL}: ${r.error.message} — install the Vercel CLI (npm i -g vercel) and log in`);
  if (r.status !== 0) throw new Error(`vercel ${args.join(' ')} failed (${r.status}): ${(r.stderr || r.stdout || '').slice(0, 300)}`);
  return r.stdout || '';
}

// Decode a pulled .env in a child process; return only allowlist fingerprints.
function fingerprints(envFile) {
  const child = `
    const crypto=require('node:crypto');
    const fs=require('node:fs');
    const txt=fs.readFileSync(process.argv[1],'utf8');
    const allow=JSON.parse(process.argv[2]);
    const out={};
    for(const k of allow){
      const m=txt.match(new RegExp('^'+k+'=(.*)$','m'));
      if(!m)continue;
      // Vercel wraps values in double quotes but does NOT escape inner quotes, so
      // a JSON value arrives as "{"project":...}" and a real dotenv parser
      // truncates it at the first inner quote (that is why loadEnvFile reported
      // length 1 for SANDBOX_CONFIG_JSON). Strip exactly one leading and one
      // trailing quote and treat the rest literally.
      let v=m[1].replace(/\\r$/,'');
      if(v.length>=2&&v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);
      if(v==='[SENSITIVE]')continue;
      out[k]={length:v.length,sha256_12:crypto.createHash('sha256').update(v).digest('hex').slice(0,12)};
    }
    process.stdout.write(JSON.stringify(out));
  `;
  const r = spawnSync(process.execPath, ['-e', child, envFile, JSON.stringify(FINGERPRINT_ALLOWLIST)],
    { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error(`fingerprint child failed: ${(r.stderr || '').slice(0, 300)}`);
  return JSON.parse(r.stdout || '{}');
}

const iso = (ms) => (ms ? new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z') : null);

// Vercel's Blob integration names a variable
// `vercel_blob_rw_<storeId>_<READ_WRITE_TOKEN>_READ_WRITE_TOKEN` - a live token
// inside the NAME. That is already visible to anyone with project read access and
// echoed into build logs; copying it into a committed file would widen the
// exposure to everyone who can clone the repo, which is strictly worse. So the
// token segment is redacted here and the real name is represented only by a
// sha256, which still detects a rename or a new store without disclosing it.
const SECRET_IN_NAME = /^(vercel_blob_rw_[A-Za-z0-9]+)_([A-Za-z0-9]{20,})(_[A-Z_]+)$/;

function redactKey(key) {
  const m = key.match(SECRET_IN_NAME);
  if (!m) return { key, redacted: false };
  return {
    key: `${m[1]}_<REDACTED>${m[3]}`,
    redacted: true,
    keySha256_12: crypto.createHash('sha256').update(key).digest('hex').slice(0, 12),
  };
}

// Belt and braces: refuse to emit ANY key that still looks like it carries a
// long random segment, whatever integration invented it.
function assertNoSecretInName(serialized) {
  const hits = [...serialized.matchAll(/"key":\s*"([^"]*_[A-Za-z0-9]{20,}_[^"]*)"/g)].map((m) => m[1]);
  if (hits.length) {
    console.error(`ABORT: ${hits.length} key(s) still embed a token-shaped segment: ${hits.join(', ')}`);
    process.exit(1);
  }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'envman-'), { recursive: true });
fs.chmodSync(tmp, 0o700);
const made = [];
const track = (p) => { made.push(p); return p; };

function cleanup() {
  for (const f of made) { try { fs.rmSync(f, { recursive: true, force: true }); } catch {} }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

const manifest = {
  $comment: [
    'Declarative inventory of every Vercel environment variable on both deployed',
    'projects, so drift is detectable and a re-provision is verifiable against',
    'something instead of against tribal knowledge.',
    '',
    'NO SECRET VALUES ARE STORED HERE AND NONE MAY EVER BE ADDED. Vercel type',
    '"encrypted" is still READABLE IN PLAINTEXT by anyone with project access, so a',
    'value copied into this file would be a credential committed to the repo. Only an',
    'explicit allowlist of non-credential identifiers carries length + sha256_12,',
    'which detects drift (a BOM, a truncation, a re-save) without disclosing anything.',
    '',
    'One entry per KEY, not per record: Vercel stores a row per key per environment',
    'group, so 93 records are 73 keys on jayti-dashboard. Values legitimately differ',
    'per environment - production SANDBOX_CONFIG_JSON carries the device roster that',
    'preview and development do not - so each environment is listed separately and',
    'environments a key is deliberately absent from are recorded in "absentFrom".',
    '',
    'Regenerate: node _shared/tools/generate-env-manifest.mjs   (needs `vercel` auth)',
    'Verify offline: node _shared/tests/env-manifest.test.mjs',
  ].join('\n'),
  generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  source: 'GET /v9/projects/{projectId}/env  +  vercel env pull (fingerprints only)',
  team: { slug: 'jayti', id: TEAM },
  fingerprintAllowlist: FINGERPRINT_ALLOWLIST,
  projects: {},
};

try {
  for (const { name, projectId } of PROJECTS) {
    const apiRaw = JSON.parse(run(['api', `/v9/projects/${projectId}/env?teamId=${TEAM}`, '--scope', 'jayti']));
    const records = apiRaw.envs || [];

    // Per-environment decoded fingerprints.
    const linkDir = track(path.join(tmp, name));
    fs.mkdirSync(path.join(linkDir, '.vercel'), { recursive: true });
    fs.writeFileSync(path.join(linkDir, '.vercel', 'project.json'), JSON.stringify({ projectId, orgId: TEAM }));
    const fpByEnv = {};
    for (const env of ENVIRONMENTS) {
      const f = track(path.join(tmp, `${name}.${env}.env`));
      try {
        run(['env', 'pull', f, `--environment=${env}`, '--yes'], { cwd: linkDir });
        fpByEnv[env] = fingerprints(f);
      } catch (e) {
        fpByEnv[env] = {};
        console.error(`  ! ${name}/${env}: pull or fingerprint failed (${String(e.message).slice(0, 120)})`);
      }
      try { fs.rmSync(f, { force: true }); } catch {}
    }

    // Collapse records into one entry per key.
    const byKey = new Map();
    for (const r of records) {
      if (!byKey.has(r.key)) byKey.set(r.key, { key: r.key, type: r.type, visibility: r.visibility || null, envs: new Map(), issues: new Set(), updatedAt: null });
      const e = byKey.get(r.key);
      if (r.type && r.type !== e.type) e.type = `${e.type}+${r.type}`;
      for (const t of (r.target || [])) {
        const fp = (fpByEnv[t] || {})[r.key];
        e.envs.set(t, fp ? { ...fp, updatedAt: iso(r.updatedAt) } : { updatedAt: iso(r.updatedAt) });
      }
      const issues = Array.isArray(r.securityIssues) ? r.securityIssues : (r.securityIssues ? [r.securityIssues] : []);
      issues.forEach((i) => e.issues.add(i));
      if (!e.updatedAt || (r.updatedAt && new Date(r.updatedAt) > new Date(e.updatedAt))) e.updatedAt = iso(r.updatedAt);
    }

    const vars = [...byKey.values()].map((e) => {
      const red = redactKey(e.key);
      const rec = {
        key: red.key,
        type: e.type,
        visibility: e.visibility,
        environments: Object.fromEntries([...e.envs.entries()].sort()),
        absentFrom: ENVIRONMENTS.filter((x) => !e.envs.has(x)),
      };
      if (red.redacted) {
        rec.keyRedacted = true;
        rec.keySha256_12 = red.keySha256_12;
        rec.note = 'the real variable name embeds a live read-write token; only its sha256 is recorded';
      }
      if (e.issues.size) rec.securityIssues = [...e.issues].sort();
      if (e.updatedAt) rec.updatedAt = e.updatedAt;
      return rec;
    }).sort((a, b) => a.key.localeCompare(b.key));

    manifest.projects[name] = {
      projectId,
      recordCount: records.length,
      uniqueKeyCount: vars.length,
      byType: records.reduce((a, r) => { a[r.type] = (a[r.type] || 0) + 1; return a; }, {}),
      readableSecrets: vars.filter((v) => (v.securityIssues || []).includes('readable-secret')).map((v) => v.key),
      vars,
    };
    console.log(`${name}: ${records.length} records -> ${vars.length} keys, ${manifest.projects[name].readableSecrets.length} readable-secret`);
  }
} finally {
  cleanup();
}

// Hard guarantee: nothing that could be a credential reaches the file.
const out = JSON.stringify(manifest, null, 2) + '\n';
for (const banned of ['"value"', '"decrypted"', '"configurationId"', 'postgres://', 'postgresql://', 'redis://', 'rediss://', 'BEGIN PRIVATE KEY', 'eyJ2IjoidjIi', '[SENSITIVE]']) {
  if (out.includes(banned)) { console.error(`ABORT: manifest would contain ${banned}`); process.exit(1); }
}
assertNoSecretInName(out);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`\nwrote ${path.relative(ROOT, OUT)} (${out.length} bytes); temp files shredded`);
