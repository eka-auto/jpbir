import {
  dec,
  fsGet,
  fsPatch,
  findIdempotentResult,
  keyIsExpired,
  MAX_RECENT_REQUESTS,
  parseEnvelope,
  rateLimitOk,
  readRawBody,
  rememberIdempotentResult,
  sendError,
  slog,
  verifyP256,
} from './broker.js';

export const config = { api: { bodyParser: false } };

export const CANONICAL_PATH = '/api/device-commands-poll';

export function pollResponseCommands(queue, now = Date.now()) {
  const visible = [];
  for (const [id, entry] of Object.entries(queue || {})) {
    if (!entry) continue;
    const queuedAt = entry.requestedAt || entry.queuedAt || null;
    if (entry.status === 'pending') {
      visible.push({ commandId: id, action: entry.action || null, payload: entry.payload || {}, queuedAt, state: 'pending', attempt: entry.attempt || 0 });
    } else if (entry.status === 'claimed' && entry.leaseUntil && Date.parse(entry.leaseUntil) < now) {
      visible.push({ commandId: id, action: entry.action || null, payload: entry.payload || {}, queuedAt, state: 'lease-expired', attempt: entry.attempt || 0 });
    }
  }
  return visible;
}

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
    return sendError(res, e.httpStatus || 400, e.message, 'poll-body-rejected');
  }

  const env = parseEnvelope(req, rawBody, CANONICAL_PATH);
  if (env.error) return sendError(res, env.httpStatus, env.error, 'poll-envelope-rejected');
  if (!rateLimitOk(env.keyId)) return sendError(res, 429, 'rate limit exceeded', 'poll-rate-limited', { keyId: env.keyId });

  try {
    const keyDoc = await fsGet(`/deviceKeys/${env.keyId}`);
    if (!keyDoc) return sendError(res, 403, 'key not enrolled', 'poll-key-unknown', { keyId: env.keyId });
    const k = dec({ mapValue: { fields: keyDoc.fields } }) || {};
    if (k.status !== 'active') return sendError(res, 403, `key is ${k.status || 'inactive'}`, 'poll-key-inactive', { keyId: env.keyId });
    if (keyIsExpired(k)) return sendError(res, 403, 'key expired; re-enroll', 'poll-key-expired', { keyId: env.keyId });
    const deviceId = k.deviceId;

    if (!verifyP256(k.publicKeyPem, env.canonical, env.signature)) {
      return sendError(res, 401, 'signature verification failed', 'poll-sig-rejected', { keyId: env.keyId });
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const devDoc = await fsGet(`/devices/${deviceId}`);
      if (!devDoc) return sendError(res, 404, 'device document missing', 'poll-device-missing', { keyId: env.keyId, deviceId });
      const d = dec({ mapValue: { fields: devDoc.fields } }) || {};
      const enrollment = d.enrollment || {};

      if (enrollment.activeKeyId !== env.keyId) {
        return sendError(res, 403, 'key is not the active device key', 'poll-key-superseded', { keyId: env.keyId, deviceId });
      }
      const priorResult = findIdempotentResult(enrollment, env, CANONICAL_PATH);
      if (priorResult && priorResult.error) {
        return sendError(res, 401, priorResult.error, 'poll-reqid-reused', { keyId: env.keyId, deviceId });
      }
      if (priorResult) {
        slog('poll-idempotent-replay', { keyId: env.keyId, deviceId, seq: env.seq });
        return res.status(priorResult.status).json(priorResult.body);
      }
      if (env.seq <= (enrollment.seq || 0)) {
        return sendError(res, 401, 'sequence replay rejected', 'poll-seq-replay', { keyId: env.keyId, deviceId });
      }
      const recent = Array.isArray(enrollment.lastRequestIds) ? enrollment.lastRequestIds : [];
      if (recent.includes(env.requestId)) {
        return sendError(res, 401, 'requestId replay rejected', 'poll-reqid-replay', { keyId: env.keyId, deviceId });
      }

      const nowIso = new Date().toISOString();
      const queue = d.commandQueue || {};
      const visible = pollResponseCommands(queue);
      const responseBody = { success: true, deviceId, commands: visible };
      try {
        await fsPatch(
          `/devices/${deviceId}`,
          {
            'enrollment.seq': env.seq,
            'enrollment.lastRequestIds': [env.requestId, ...recent].slice(0, MAX_RECENT_REQUESTS),
            'enrollment.lastPollAt': nowIso,
            'enrollment.recentResults': rememberIdempotentResult(
              enrollment, env, CANONICAL_PATH, 200, responseBody,
            ),
          },
          { updateTime: devDoc.updateTime },
        );
      } catch (e) {
        if (e.conflict) continue;
        throw e;
      }

      slog('poll-ok', { keyId: env.keyId, deviceId, visible: visible.length });
      return res.status(200).json(responseBody);
    }
    return sendError(res, 409, 'too many write conflicts', 'poll-conflict', { keyId: env.keyId });
  } catch (err) {
    return sendError(res, 500, err.message || 'poll failed', 'poll-error', { keyId: env.keyId });
  }
}
