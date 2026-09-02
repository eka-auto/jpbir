import crypto from 'crypto';
import {
  audit,
  CLAIM_LEASE_MS,
  dec,
  fsGet,
  fsPatch,
  MAX_CLAIM_ATTEMPTS,
  MAX_RECENT_REQUESTS,
  parseEnvelope,
  rateLimitOk,
  readRawBody,
  sendError,
  slog,
  verifyP256,
} from '../lib/broker.js';

export const config = { api: { bodyParser: false } };

export function canonicalClaimPath(commandId) {
  return `/api/device/commands/${commandId}/claim`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const commandId = String(req.query.commandId || '').trim();
  if (!commandId || !/^[\w.-]{1,128}$/.test(commandId)) {
    return sendError(res, 400, 'malformed commandId', 'claim-schema-rejected');
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return sendError(res, e.httpStatus || 400, e.message, 'claim-body-rejected');
  }

  const env = parseEnvelope(req, rawBody, canonicalClaimPath(commandId));
  if (env.error) return sendError(res, env.httpStatus, env.error, 'claim-envelope-rejected');
  if (!rateLimitOk(env.keyId)) return sendError(res, 429, 'rate limit exceeded', 'claim-rate-limited', { keyId: env.keyId });

  let body = {};
  try {
    body = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    return sendError(res, 400, 'body must be JSON', 'claim-body-rejected');
  }
  const workerSessionId = String(body.workerSessionId || '').slice(0, 128);
  if (!workerSessionId) return sendError(res, 400, 'workerSessionId is required', 'claim-schema-rejected');

  try {
    const keyDoc = await fsGet(`/deviceKeys/${env.keyId}`);
    if (!keyDoc) return sendError(res, 403, 'key not enrolled', 'claim-key-unknown', { keyId: env.keyId });
    const k = dec({ mapValue: { fields: keyDoc.fields } }) || {};
    if (k.status !== 'active') return sendError(res, 403, `key is ${k.status || 'inactive'}`, 'claim-key-inactive', { keyId: env.keyId });
    const deviceId = k.deviceId;

    if (!verifyP256(k.publicKeyPem, env.canonical, env.signature)) {
      return sendError(res, 401, 'signature verification failed', 'claim-sig-rejected', { keyId: env.keyId });
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const devDoc = await fsGet(`/devices/${deviceId}`);
      if (!devDoc) return sendError(res, 404, 'device document missing', 'claim-device-missing', { keyId: env.keyId, deviceId });
      const d = dec({ mapValue: { fields: devDoc.fields } }) || {};
      const enrollment = d.enrollment || {};

      if (enrollment.activeKeyId !== env.keyId) {
        return sendError(res, 403, 'key is not the active device key', 'claim-key-superseded', { keyId: env.keyId, deviceId });
      }
      if (env.seq <= (enrollment.seq || 0)) {
        return sendError(res, 401, 'sequence replay rejected', 'claim-seq-replay', { keyId: env.keyId, deviceId });
      }
      const recent = Array.isArray(enrollment.lastRequestIds) ? enrollment.lastRequestIds : [];
      if (recent.includes(env.requestId)) {
        return sendError(res, 401, 'requestId replay rejected', 'claim-reqid-replay', { keyId: env.keyId, deviceId });
      }

      const queue = d.commandQueue || {};
      const entry = queue[commandId];
      if (!entry) return sendError(res, 404, 'command not found', 'claim-command-missing', { keyId: env.keyId, deviceId, commandId });

      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const priorAttempts = entry.attempt || 0;

      let claimable = false;
      if (entry.status === 'pending') {
        claimable = true;
      } else if (entry.status === 'claimed' && entry.leaseUntil && Date.parse(entry.leaseUntil) < now) {
        if (priorAttempts >= MAX_CLAIM_ATTEMPTS) {
          try {
            await fsPatch(
              `/devices/${deviceId}`,
              {
                [`commandQueue.${commandId}.status`]: 'dead-letter',
                [`commandQueue.${commandId}.deadLetterAt`]: nowIso,
                [`commandQueue.${commandId}.deadLetterReason`]: 'claim attempts exhausted',
                'enrollment.seq': env.seq,
                'enrollment.lastRequestIds': [env.requestId, ...recent].slice(0, MAX_RECENT_REQUESTS),
              },
              { updateTime: devDoc.updateTime },
            );
            audit(env.keyId, 'command-dead-letter', deviceId, `commandId=${commandId}`);
          } catch (e) {
            if (e.conflict) continue;
            throw e;
          }
          return sendError(res, 409, 'command dead-lettered after max claim attempts', 'claim-dead-letter', { keyId: env.keyId, deviceId, commandId });
        }
        claimable = true;
      } else if (entry.status === 'claimed') {
        return sendError(res, 409, 'command lease is active', 'claim-lease-held', { keyId: env.keyId, deviceId, commandId });
      } else {
        return sendError(res, 409, `command already ${entry.status}`, 'claim-state-final', { keyId: env.keyId, deviceId, commandId, state: entry.status });
      }

      if (!claimable) continue;

      const claimToken = crypto.randomBytes(16).toString('hex');
      const leaseUntilIso = new Date(now + CLAIM_LEASE_MS).toISOString();
      const q = `commandQueue.${commandId}`;
      try {
        await fsPatch(
          `/devices/${deviceId}`,
          {
            [`${q}.status`]: 'claimed',
            [`${q}.claimToken`]: claimToken,
            [`${q}.leaseUntil`]: leaseUntilIso,
            [`${q}.attempt`]: priorAttempts + 1,
            [`${q}.workerSessionId`]: workerSessionId,
            [`${q}.claimedAt`]: nowIso,
            'enrollment.seq': env.seq,
            'enrollment.lastRequestIds': [env.requestId, ...recent].slice(0, MAX_RECENT_REQUESTS),
          },
          { updateTime: devDoc.updateTime },
        );
      } catch (e) {
        if (e.conflict) continue;
        throw e;
      }

      slog('claim-ok', { keyId: env.keyId, deviceId, commandId, attempt: priorAttempts + 1 });
      return res.status(200).json({
        success: true,
        deviceId,
        commandId,
        claimToken,
        leaseUntil: leaseUntilIso,
        attempt: priorAttempts + 1,
        action: entry.action,
        payload: entry.payload || {},
      });
    }
    return sendError(res, 409, 'too many write conflicts', 'claim-conflict', { keyId: env.keyId });
  } catch (err) {
    return sendError(res, 500, err.message || 'claim failed', 'claim-error', { keyId: env.keyId });
  }
}
