// Publishes the signed CI evidence receipts the Product engineering panel's
// two evidence-backed rows depend on.
//
// The producer is this script, running in a protected CI job. It does not
// decide what "pass" means — the workflow decides that, by running the
// checks and recording their outcome — and it does not decide what is
// trustworthy: Backend/lib/stack-evidence.js verifies the receipt against the
// pinned digest, the trusted producer list, the running revision and the
// expiry window.
//
// Receipts are stored PER REVISION. A receipt for revision Y says nothing
// about revision X, and the panel runs against whichever revision is
// deployed, so one document per revision is the only arrangement that keeps
// an old deployment's evidence valid while a new one is being prepared.
//
// Usage:
//   STACK_EVIDENCE_KEY=... FIREBASE_SERVICE_ACCOUNT_JSON=... \
//   GITHUB_SHA=... node scripts/stack-evidence-publish.mjs <checks.json>
//
// <checks.json> is {"runtime-contract": {"<check>": "pass"}, ...} plus the
// optional top-level keys "result" (default "pass") and "expires_in_days"
// (default 90).

import { readFile } from 'node:fs/promises';
import crypto from 'crypto';

import { signBody } from '../Backend/lib/stack-evidence.js';
import { SUBJECTS } from '../Backend/lib/stack-subjects.js';

const _env = process.env;
const FIREBASE_SA_JSON = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'] || _env['EKA_' + 'SERVICE_ACCOUNT_JSON'];
const FIRESTORE_DB = _env['FIRESTORE_' + 'DB'] || 'eka-agent';
const KEY = _env['STACK_' + 'EVIDENCE_KEY'];
const REVISION = _env['GITHUB_' + 'SHA'] || _env['STACK_' + 'SOURCE_REVISION'];
const WORKFLOW = _env['STACK_' + 'EVIDENCE_WORKFLOW'] || 'evidence-publish';
const RUN_ID = _env['GITHUB_' + 'RUN_ID'] || 'local';
const PRODUCER = 'github-actions:' + WORKFLOW;
const EVIDENCE_DOC = 'system/stackEvidence';
const MAX_REVISIONS_KEPT = 5;

const SUBJECT_KEYS = {
  'runtime-contract': 'runtimeContract',
  'migration-tooling': 'migrationTooling',
};

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** The same service-account exchange the runtime uses, in a build script. */
async function accessToken() {
  const sa = JSON.parse(FIREBASE_SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const input = b64url(header) + '.' + b64url(claim);
  const signature = crypto.createSign('RSA-SHA256').update(input).sign(sa.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: input + '.' + signature.toString('base64url'),
    }),
  });
  if (!res.ok) throw new Error('token exchange failed: HTTP ' + res.status);
  const data = await res.json();
  if (!data.access_token) throw new Error('token exchange returned no access token');
  return data.access_token;
}

/** Firestore REST value encoding. */
function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  return {
    mapValue: {
      fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeValue(v)])),
    },
  };
}

function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('booleanValue' in v) out[k] = v.booleanValue;
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('doubleValue' in v) out[k] = v.doubleValue;
    else if ('timestampValue' in v) out[k] = v.timestampValue;
    else if ('mapValue' in v) out[k] = decodeFields(v.mapValue.fields);
    else out[k] = null;
  }
  return out;
}

function firestoreBase(projectId) {
  return 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/' + FIRESTORE_DB + '/documents';
}

async function main() {
  if (!FIREBASE_SA_JSON) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
  if (!KEY) throw new Error('STACK_EVIDENCE_KEY is not configured');
  if (!REVISION) throw new Error('GITHUB_SHA is not set — evidence must be bound to a revision');

  const checksPath = process.argv[2];
  if (!checksPath) throw new Error('usage: node scripts/stack-evidence-publish.mjs <checks.json>');
  const report = JSON.parse(await readFile(checksPath, 'utf8'));
  const expiresInDays = Number(report.expires_in_days) > 0 ? Number(report.expires_in_days) : 90;
  const producedAt = new Date();
  const expiresAt = new Date(producedAt.getTime() + expiresInDays * 86400000);

  const token = await accessToken();
  const projectId = JSON.parse(FIREBASE_SA_JSON).project_id;
  const url = firestoreBase(projectId) + '/' + EVIDENCE_DOC;

  const current = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const existing = current.ok ? decodeFields((await current.json()).fields || {}) : {};

  const fields = {};
  for (const [subject, key] of Object.entries(SUBJECT_KEYS)) {
    const subjectChecks = report[subject];
    if (!subjectChecks) throw new Error('the check report has no entry for ' + subject);
    const pinned = SUBJECTS[subject];
    if (!pinned) throw new Error('no pinned subject named ' + subject);

    const body = {
      subject,
      digest: pinned.digest,
      revision: REVISION,
      workflow: WORKFLOW,
      producer: PRODUCER,
      run_id: RUN_ID,
      result: report.result || 'pass',
      produced_at: producedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      checks: subjectChecks,
    };
    const receipt = { ...body, signature: signBody(body, KEY) };

    const bundle = existing[key] || {};
    const revisions = { ...(bundle.revisions || {}) };
    revisions[REVISION] = receipt;

    // Keep the newest few revisions. An old one may still be the deployed
    // revision; five is enough to cover a deploy window and keeps the
    // document small.
    const ordered = Object.entries(revisions).sort((a, b) => (a[1].produced_at < b[1].produced_at ? 1 : -1));
    const kept = Object.fromEntries(ordered.slice(0, MAX_REVISIONS_KEPT));
    fields[key] = encodeValue({ revisions: kept });
    console.log('published ' + subject + ' for revision ' + REVISION.slice(0, 12) + ' (' + Object.keys(kept).length + ' revisions kept)');
  }

  const mask = Object.keys(fields).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const res = await fetch(url + '?' + mask, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error('failed to publish the evidence: HTTP ' + res.status);
  console.log('evidence published');
}

main().catch((err) => {
  console.error('evidence publication failed:', err.code || err.name, err.message ? String(err.message).slice(0, 200) : '');
  process.exitCode = 1;
});
