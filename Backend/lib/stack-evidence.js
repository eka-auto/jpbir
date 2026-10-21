// Verifiable evidence for the two rows a serverless function cannot probe.
//
// `Devices/S24/runtime_contract.json` and `Database/scripts/migrate.mjs` used
// to sit on the `static` probe, which was hard-coded to `unknown` with the
// reason "no live signal reachable from a serverless function". That was
// honest and permanently grey: the two rows could never be anything else, so
// "38 rows proven green" was unreachable by construction.
//
// What changed is not the function. The proof no longer has to come from a
// request handler.
//
// A protected CI job runs the checks that CAN be run outside one — the
// migration runner against an isolated database, the device bundle against the
// contract it pins — and publishes a signed receipt bound to:
//
//   - the exact subject bytes (a digest over the files that make up the
//     subject),
//   - the source revision that was checked,
//   - the workflow that produced it,
//   - the result of every named check,
//   - a validity window.
//
// The function then verifies the receipt before the row may go green. It never
// takes the receipt's word for anything: the signature is recomputed, the
// digest is compared with the digest pinned in `stack-subjects.js`, the
// producer must be a workflow this build trusts, the revision must be the one
// running, and the receipt must be unexpired. A missing, forged, expired,
// wrong-target or wrong-revision receipt leaves the row unproven, which keeps
// the release gate closed — it never turns into a pass.
//
// The pinned digests live in `stack-subjects.js`, which
// `scripts/stack-subjects.mjs` regenerates. CI runs that script in --check
// mode, so editing a subject file without re-pinning it fails the build
// instead of silently making the row stale forever.

import crypto from 'crypto';
import { digestOf } from './stack-digest.js';
import { SUBJECTS } from './stack-subjects.js';

export const EVIDENCE_DOC = 'system/stackEvidence';

/**
 * The workflows allowed to publish a receipt. A receipt from any other
 * producer is rejected even if it is perfectly signed: the key is shared with
 * CI, and "signed" must mean "signed by the pipeline that actually ran the
 * checks", not "signed by anybody holding the key".
 */
export const TRUSTED_EVIDENCE_WORKFLOWS = Object.freeze(['evidence-publish']);

/**
 * The checks each subject must report before its row may be proven.
 *
 * These are named rather than implied by the receipt's overall result: a
 * receipt that says "pass" without the checks that matter is not evidence for
 * the thing the row claims.
 */
export const REQUIRED_CHECKS = Object.freeze({
  'runtime-contract': Object.freeze(['contract-bundle-digest', 'contract-schema-valid', 'device-bundle-syntax']),
  'migration-tooling': Object.freeze(['fresh-apply', 'second-run-noop', 'ledger-reconciliation']),
});

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

/**
 * A stable serialisation of a receipt body, for signing.
 *
 * Keys are sorted at every level, so that a producer and a consumer agree on
 * the bytes without having to agree on a JSON key order — including inside
 * the nested check map, which is the part a producer is most likely to build
 * in a different order from the part a consumer re-reads.
 */
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalValue(value[key]);
    return out;
  }
  return value;
}

export function canonicalBody(body) {
  const sorted = {};
  for (const key of Object.keys(body || {}).sort()) {
    const value = body[key];
    if (value === undefined || value === null) continue;
    sorted[key] = canonicalValue(value);
  }
  return JSON.stringify(sorted);
}

export function signBody(body, key) {
  if (!key) throw new Error('no evidence signing key');
  return 'hmac-sha256:' + crypto.createHmac('sha256', String(key)).update(canonicalBody(body)).digest('hex');
}

/** Constant-time comparison of two signatures. */
function signatureEquals(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Verify one receipt.
 *
 * Order matters: the signature is checked before anything in the body is
 * believed, so an unsigned or altered receipt is rejected on the signature
 * rather than being discussed field by field. The body checks that follow all
 * fail closed — a receipt that cannot be proven correct is not evidence.
 *
 * @returns {{valid: boolean, reason: string}}
 */
export function verifyReceipt(receipt, subjectId, options = {}) {
  const nowMs = Number(options.nowMs) || Date.now();
  const key = options.key;
  const subject = SUBJECTS[subjectId] || null;

  if (!receipt || typeof receipt !== 'object') {
    return { valid: false, reason: 'no CI evidence has been published for ' + subjectId };
  }
  if (!key) {
    return { valid: false, reason: 'the evidence verification key is not configured on this deployment' };
  }
  if (!receipt.signature) {
    return { valid: false, reason: 'the evidence is unsigned — a self-asserted receipt is not evidence' };
  }

  const body = { ...receipt };
  delete body.signature;
  const expected = signBody(body, key);
  if (!signatureEquals(receipt.signature, expected)) {
    return { valid: false, reason: 'the evidence signature does not verify (altered or forged receipt)' };
  }

  if (receipt.subject !== subjectId) {
    return { valid: false, reason: 'the evidence is for subject "' + receipt.subject + '", not "' + subjectId + '"' };
  }
  const expectedDigest = options.expectedDigest || (subject && subject.digest) || null;
  if (!expectedDigest) {
    return { valid: false, reason: 'no pinned digest exists for subject "' + subjectId + '"' };
  }
  if (receipt.digest !== expectedDigest) {
    return {
      valid: false,
      reason: 'the checked subject has changed since the evidence was produced (expected ' + expectedDigest + ')',
    };
  }
  if (receipt.result !== 'pass') {
    return { valid: false, reason: 'the CI check did not pass (result: ' + (receipt.result || 'none') + ')' };
  }
  const trusted = options.trustedWorkflows || TRUSTED_EVIDENCE_WORKFLOWS;
  if (!trusted.includes(receipt.workflow)) {
    return { valid: false, reason: 'the evidence was not produced by a trusted workflow ("' + receipt.workflow + '")' };
  }
  if (options.expectedRevision && receipt.revision !== options.expectedRevision) {
    return {
      valid: false,
      reason: 'the evidence was produced for source revision ' + String(receipt.revision).slice(0, 12) +
        ', not the running revision ' + String(options.expectedRevision).slice(0, 12),
    };
  }

  const producedAt = Date.parse(receipt.produced_at);
  if (!Number.isFinite(producedAt)) {
    return { valid: false, reason: 'the evidence has no readable production time' };
  }
  if (producedAt > nowMs) {
    return { valid: false, reason: 'the evidence claims a future production time' };
  }
  const expiresAt = Date.parse(receipt.expires_at);
  if (!Number.isFinite(expiresAt)) {
    return { valid: false, reason: 'the evidence has no readable expiry' };
  }
  if (expiresAt <= nowMs) {
    return { valid: false, reason: 'the evidence expired at ' + receipt.expires_at };
  }

  const required = REQUIRED_CHECKS[subjectId] || [];
  const checks = receipt.checks || {};
  for (const name of required) {
    if (checks[name] !== 'pass') {
      return { valid: false, reason: 'the check "' + name + '" did not pass (' + (checks[name] || 'absent') + ')' };
    }
  }

  return { valid: true, reason: 'CI evidence verified: ' + receipt.workflow + ' at ' + receipt.produced_at };
}

/**
 * The subject's own description, for the panel's one-line problem text.
 * Only names and digests — never file contents.
 */
export function subjectSummary(subjectId) {
  const subject = SUBJECTS[subjectId];
  if (!subject) return null;
  return {
    id: subjectId,
    description: subject.description,
    digest: subject.digest,
    files: subject.files.length,
  };
}

export { SUBJECTS, digestOf, sha256 };
