import {
  audit,
  dec,
  fsGet,
  fsPatch,
  MAX_BODY_BYTES,
  MAX_RECENT_REQUESTS,
  parseEnvelope,
  rateLimitOk,
  readRawBody,
  sendError,
  slog,
  verifyP256,
} from '../lib/broker.js';

export const config = { api: { bodyParser: false } };

const RESULT_STATUS_MAP = { ok: 'completed', rejected: 'rejected', failed: 'failed', error: 'failed' };

export function canonicalCompletePath(commandId) {
  return `/api/device/commands/${commandId}/complete`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const commandId = String(req.query.commandId || '').trim();
  if (!commandId || !/^[\w.-]{1,128}$/.test(commandId)) {
    return sendError(res, 400, 'malformed commandId', 'complete-schema-rejected');
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return sendError(res, e.httpStatus || 400, e.message, 'complete-body-rejected');
  }

  const env = parseEnvelope(req, rawBody, canonicalCompletePath(commandId));
  if (env.error) return sendError(res, env.httpStatus, env.error, 'complete-envelope-rejected');
  if (!rateLimitOk(env.keyId)) return sendError(res, 429, 'rate limit exceeded', 'complete-rate-limited', { keyId: env.keyId });

  let body = {};
  try {
    body = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    return sendError(res, 400, 'body must be JSON', 'complete-body-rejected');
  }

  const claimToken = String(body.claimToken || '').trim();
  const result = body.result;
  if (!/^[a-f0-9]{32}$/.test(claimToken)) return sendError(res, 400, 'malformed claimToken', 'complete-schema-rejected');
  if (result === undefined || result === null || typeof result !== 'object') {
    return sendError(res, 400, 'result object is required', 'complete-schema-rejected');
  }
  const resultSize = Buffer.byteLength(JSON.stringify(result), 'utf-8');
  if (resultSize > MAX_BODY_BYTES / 2) {
    return sendError(res, 413, 'result too large', 'complete-result-oversize', { keyId: env.keyId, resultSize });
  }
  const resultStatus = String(result.status || '');
  if (!RESULT_STATUS_MAP[resultStatus]) {
    return sendError(res, 400, 'result.status must be ok|rejected|failed|error', 'complete-schema-rejected');
  }

  try {
    const keyDoc = await fsGet(`/deviceKeys/${env.keyId}`);
    if (!keyDoc) return sendError(res, 403, 'key not enrolled', 'complete-key-unknown', { keyId: env.keyId });
    const k = dec({ mapValue: { fields: keyDoc.fields } }) || {};
    if (k.status !== 'active') return sendError(res, 403, `key is ${k.status || 'inactive'}`, 'complete-key-inactive', { keyId: env.keyId });
    const deviceId = k.deviceId;

    if (!verifyP256(k.publicKeyPem, env.canonical, env.signature)) {
      return sendError(res, 401, 'signature verification failed', 'complete-sig-rejected', { keyId: env.keyId });
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const devDoc = await fsGet(`/devices/${deviceId}`);
      if (!devDoc) return sendError(res, 404, 'device document missing', 'complete-device-missing', { keyId: env.keyId, deviceId });
      const d = dec({ mapValue: { fields: devDoc.fields } }) || {};
      const enrollment = d.enrollment || {};

      if (enrollment.activeKeyId !== env.keyId) {
        return sendError(res, 403, 'key is not the active device key', 'complete-key-superseded', { keyId: env.keyId, deviceId });
      }
      if (env.seq <= (enrollment.seq || 0)) {
        return sendError(res, 401, 'sequence replay rejected', 'complete-seq-replay', { keyId: env.keyId, deviceId });
      }
      const recent = Array.isArray(enrollment.lastRequestIds) ? enrollment.lastRequestIds : [];
      if (recent.includes(env.requestId)) {
        return sendError(res, 401, 'requestId replay rejected', 'complete-reqid-replay', { keyId: env.keyId, deviceId });
      }

      const entry = (d.commandQueue || {})[commandId];
      if (!entry) return sendError(res, 404, 'command not found', 'complete-command-missing', { keyId: env.keyId, deviceId, commandId });
      if (entry.status !== 'claimed') {
        return sendError(res, 409, `command is ${entry.status}, not claimed`, 'complete-state-not-claimed', { keyId: env.keyId, deviceId, commandId, state: entry.status });
      }
      if (entry.claimToken !== claimToken) {
        return sendError(res, 409, 'claimToken does not match active claim', 'complete-token-mismatch', { keyId: env.keyId, deviceId, commandId });
      }
      if (entry.leaseUntil && Date.parse(entry.leaseUntil) < Date.now()) {
        return sendError(res, 409, 'claim lease expired; re-claim required', 'complete-lease-stale', { keyId: env.keyId, deviceId, commandId });
      }

      const nowIso = new Date().toISOString();
      const finalStatus = RESULT_STATUS_MAP[resultStatus];
      const q = `commandQueue.${commandId}`;
      try {
        await fsPatch(
          `/devices/${deviceId}`,
          {
            [`${q}.status`]: finalStatus,
            [`${q}.result`]: result,
            [`${q}.completedAt`]: nowIso,
            [`${q}.claimToken`]: '',
            'enrollment.seq': env.seq,
            'enrollment.lastRequestIds': [env.requestId, ...recent].slice(0, MAX_RECENT_REQUESTS),
            lastCommandAckAt: nowIso,
            lastCommandAckId: commandId,
            lastCommandAckStatus: finalStatus,
          },
          { updateTime: devDoc.updateTime },
        );
      } catch (e) {
        if (e.conflict) continue;
        throw e;
      }

      audit(env.keyId, `command-${finalStatus}`, deviceId, `commandId=${commandId}`);
      slog('complete-ok', { keyId: env.keyId, deviceId, commandId, finalStatus });
      return res.status(200).json({ success: true, deviceId, commandId, status: finalStatus, completedAt: nowIso });
    }
    return sendError(res, 409, 'too many write conflicts', 'complete-conflict', { keyId: env.keyId });
  } catch (err) {
    return sendError(res, 500, err.message || 'complete failed', 'complete-error', { keyId: env.keyId });
  }
}
