import crypto from 'crypto';
import {
  ALLOWED_KEY_TYPES,
  audit,
  dec,
  fsBeginTransaction,
  fsCommit,
  fsGet,
  fsPatch,
  fsRollback,
  keyIdFromPem,
  normalizeHardwareFingerprint,
  parseEnvelope,
  rateLimitOk,
  readRawBody,
  sendError,
  slog,
  verifyHardwareFingerprint,
  verifyP256,
  verifySignerAttestation,
} from '../lib/broker.js';

export const config = { api: { bodyParser: false } };

export const CANONICAL_PATH = '/api/device-enroll';

function isP256Pem(pem) {
  try {
    const key = crypto.createPublicKey(pem);
    const curve = key.asymmetricKeyDetails && key.asymmetricKeyDetails.namedCurve;
    return key.asymmetricKeyType === 'ec' && ['prime256v1', 'secp256r1', 'P-256'].includes(curve);
  } catch {
    return false;
  }
}

export { isP256Pem };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return sendError(res, e.httpStatus || 400, e.message, 'enroll-body-rejected');
  }

  const env = parseEnvelope(req, rawBody, CANONICAL_PATH);
  if (env.error) return sendError(res, env.httpStatus, env.error, 'enroll-envelope-rejected');

  let body = {};
  try {
    body = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    return sendError(res, 400, 'body must be JSON', 'enroll-body-rejected');
  }

  const code = String(body.code || '').trim();
  const deviceId = String(body.deviceId || '').trim();
  const publicKeyPem = String(body.publicKeyPem || '').trim();
  const keyType = String(body.keyType || '').trim();
  const attestation = body.attestation && typeof body.attestation === 'object' ? body.attestation : {};
  const hardware = body.hardware && typeof body.hardware === 'object' ? body.hardware : {};

  if (!/^[a-f0-9]{32}$/i.test(code)) return sendError(res, 400, 'malformed enrollment code', 'enroll-schema-rejected', { keyId: env.keyId });
  if (!deviceId || !publicKeyPem.includes('BEGIN PUBLIC KEY')) {
    return sendError(res, 400, 'deviceId and publicKeyPem are required', 'enroll-schema-rejected', { keyId: env.keyId });
  }
  if (!ALLOWED_KEY_TYPES.has(keyType)) return sendError(res, 403, 'keyType not allowed', 'enroll-schema-rejected', { keyId: env.keyId, keyType });
  if (!isP256Pem(publicKeyPem)) return sendError(res, 400, 'publicKeyPem must be an EC P-256 SPKI PEM', 'enroll-schema-rejected', { keyId: env.keyId });

  const derivedKeyId = keyIdFromPem(publicKeyPem);
  if (derivedKeyId !== env.keyId) {
    return sendError(res, 403, 'keyId does not match presented public key', 'enroll-keyid-mismatch');
  }
  if (!rateLimitOk(env.keyId)) return sendError(res, 429, 'rate limit exceeded', 'enroll-rate-limited', { keyId: env.keyId });

  if (!verifyP256(publicKeyPem, env.canonical, env.signature)) {
    return sendError(res, 401, 'signature verification failed', 'enroll-sig-rejected', { keyId: env.keyId });
  }
  if (env.seq !== 0) return sendError(res, 401, 'enroll requires seq 0', 'enroll-seq-rejected', { keyId: env.keyId });

  const codeHash = crypto.createHash('sha256').update(code.toLowerCase()).digest('hex');
  const failAttempt = async (codeDoc, currentAttempts) => {
    try {
      await fsPatch(
        `/enrollmentCodes/${codeHash}`,
        { attempts: (currentAttempts || 0) + 1 },
        { updateTime: codeDoc.updateTime },
      );
    } catch {
      // best effort; the transactional path below is authoritative
    }
  };

  try {
    const codeDoc = await fsGet(`/enrollmentCodes/${codeHash}`);
    if (!codeDoc) {
      return sendError(res, 403, 'unknown enrollment code', 'enroll-code-unknown', { keyId: env.keyId });
    }
    const c = dec({ mapValue: { fields: codeDoc.fields } }) || {};

    if (c.revoked) return sendError(res, 403, 'enrollment code revoked', 'enroll-code-revoked', { keyId: env.keyId });
    if (c.consumed) return sendError(res, 403, 'enrollment code already consumed', 'enroll-code-consumed', { keyId: env.keyId });
    if (c.expiresAt && Date.parse(c.expiresAt) < Date.now()) {
      return sendError(res, 403, 'enrollment code expired', 'enroll-code-expired', { keyId: env.keyId });
    }
    if ((c.attempts || 0) >= 5) {
      return sendError(res, 403, 'enrollment code attempt limit reached', 'enroll-code-attempts', { keyId: env.keyId });
    }
    if (c.deviceId !== deviceId) {
      await failAttempt(codeDoc, c.attempts);
      return sendError(res, 403, 'enrollment code is for a different device', 'enroll-code-device-mismatch', { keyId: env.keyId });
    }
    if (c.keyType && c.keyType !== keyType) {
      await failAttempt(codeDoc, c.attempts);
      return sendError(res, 403, 'enrollment code requires a different key type', 'enroll-code-keytype-mismatch', { keyId: env.keyId, keyType });
    }
    if (keyType === 'software-p256' && c.allowSoftware !== true) {
      return sendError(res, 403, 'software keys require an explicit software-permitted code', 'enroll-software-key-rejected', { keyId: env.keyId });
    }

    const hwErr = verifyHardwareFingerprint(deviceId, hardware, c.hardwareFingerprint || undefined);
    if (hwErr) {
      await failAttempt(codeDoc, c.attempts);
      return sendError(res, 403, hwErr, 'enroll-hardware-rejected', { keyId: env.keyId, deviceId });
    }
    const attestationErr = verifySignerAttestation(keyType, attestation);
    if (attestationErr) {
      await failAttempt(codeDoc, c.attempts);
      return sendError(res, 403, attestationErr, 'enroll-attestation-rejected', { keyId: env.keyId, deviceId, keyType });
    }
    const enrolledHardware = normalizeHardwareFingerprint(hardware);

    const existingKey = await fsGet(`/deviceKeys/${env.keyId}`);
    if (existingKey) {
      return sendError(res, 409, 'key already enrolled; use rotation flow', 'enroll-key-exists', { keyId: env.keyId });
    }

    const nowIso = new Date().toISOString();
    const keyExpiresAt = new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString();
    const tx = await fsBeginTransaction();
    try {
      await fsCommit(tx, [
        {
          path: `enrollmentCodes/${codeHash}`,
          fields: {
            consumed: true,
            consumedAt: nowIso,
            consumedByKeyId: env.keyId,
            attempts: (c.attempts || 0) + 1,
          },
          updateMask: ['consumed', 'consumedAt', 'consumedByKeyId', 'attempts'],
          precondition: { updateTime: codeDoc.updateTime },
        },
        {
          path: `deviceKeys/${env.keyId}`,
          fields: {
            deviceId,
            publicKeyPem,
            keyType,
            attestation,
            hardwareFingerprint: enrolledHardware,
            status: 'active',
            enrolledAt: nowIso,
            expiresAt: keyExpiresAt,
          },
          precondition: { exists: false },
        },
        {
          path: `devices/${deviceId}`,
          fields: {
            enrollment: {
              activeKeyId: env.keyId,
              seq: 0,
              lastRequestIds: [env.requestId],
              lastEnrolledAt: nowIso,
              keyType,
            },
            online: false,
            updatedAt: nowIso,
          },
          updateMask: ['enrollment', 'online', 'updatedAt'],
        },
      ]);
    } catch (e) {
      await fsRollback(tx);
      throw e;
    }

    audit(env.keyId, 'enroll', deviceId, `keyType=${keyType}`);
    slog('enroll-ok', { keyId: env.keyId, deviceId, keyType });
    return res.status(200).json({ success: true, deviceId, keyId: env.keyId, enrolledAt: nowIso, keyExpiresAt });
  } catch (err) {
    if (err.conflict) return sendError(res, 409, 'concurrent enrollment conflict', 'enroll-conflict', { keyId: env.keyId });
    return sendError(res, 500, err.message || 'enroll failed', 'enroll-error', { keyId: env.keyId });
  }
}
