import {
  audit,
  dec,
  fsGet,
  fsPatch,
  HARDWARE_RULES,
  MAX_RECENT_REQUESTS,
  parseEnvelope,
  rateLimitOk,
  readRawBody,
  sendError,
  slog,
  verifyHardwareFingerprint,
  verifyEnrolledHardware,
  verifyP256,
} from '../lib/broker.js';

export const config = { api: { bodyParser: false } };

export const CANONICAL_PATH = '/api/device-heartbeat';
export const TELEMETRY_WHITELIST = [
  'deviceId',
  'canonicalDeviceId',
  'deviceDisplayName',
  'deviceRole',
  'deviceType',
  'connectionMethod',
  'agentVersion',
  'heartbeatIntervalSeconds',
  'local',
  'network',
];

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
    return sendError(res, e.httpStatus || 400, e.message, 'heartbeat-body-rejected');
  }

  const env = parseEnvelope(req, rawBody, CANONICAL_PATH);
  if (env.error) return sendError(res, env.httpStatus, env.error, 'heartbeat-envelope-rejected');

  let body = {};
  try {
    body = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    return sendError(res, 400, 'body must be JSON', 'heartbeat-body-rejected');
  }
  const hardware = body.hardware && typeof body.hardware === 'object' ? body.hardware : {};
  const telemetry = body.telemetry && typeof body.telemetry === 'object' ? body.telemetry : {};

  if (!rateLimitOk(env.keyId)) return sendError(res, 429, 'rate limit exceeded', 'heartbeat-rate-limited', { keyId: env.keyId });

  try {
    const keyDoc = await fsGet(`/deviceKeys/${env.keyId}`);
    if (!keyDoc) return sendError(res, 403, 'key not enrolled', 'heartbeat-key-unknown', { keyId: env.keyId });
    const k = dec({ mapValue: { fields: keyDoc.fields } }) || {};
    if (k.status !== 'active') return sendError(res, 403, `key is ${k.status || 'inactive'}`, 'heartbeat-key-inactive', { keyId: env.keyId });
    if (k.expiresAt && Date.parse(k.expiresAt) < Date.now()) {
      return sendError(res, 403, 'key expired; re-enroll', 'heartbeat-key-expired', { keyId: env.keyId });
    }
    const deviceId = k.deviceId;

    if (!verifyP256(k.publicKeyPem, env.canonical, env.signature)) {
      return sendError(res, 401, 'signature verification failed', 'heartbeat-sig-rejected', { keyId: env.keyId });
    }

    const hwErr = verifyHardwareFingerprint(deviceId, hardware, HARDWARE_RULES[deviceId]);
    if (hwErr) {
      audit(env.keyId, 'heartbeat-hardware-mismatch', deviceId, hwErr);
      return sendError(res, 403, hwErr, 'heartbeat-hardware-rejected', { keyId: env.keyId, deviceId });
    }
    const enrolledHwErr = verifyEnrolledHardware(k.hardwareFingerprint, hardware);
    if (enrolledHwErr) {
      audit(env.keyId, 'heartbeat-enrolled-hardware-mismatch', deviceId, enrolledHwErr);
      return sendError(res, 403, enrolledHwErr, 'heartbeat-hardware-rejected', { keyId: env.keyId, deviceId });
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const devDoc = await fsGet(`/devices/${deviceId}`);
      if (!devDoc) return sendError(res, 404, 'device document missing', 'heartbeat-device-missing', { keyId: env.keyId, deviceId });
      const d = dec({ mapValue: { fields: devDoc.fields } }) || {};
      const enrollment = d.enrollment || {};

      if (enrollment.activeKeyId !== env.keyId) {
        return sendError(res, 403, 'key is not the active device key', 'heartbeat-key-superseded', { keyId: env.keyId, deviceId });
      }
      if (env.seq <= (enrollment.seq || 0)) {
        return sendError(res, 401, 'sequence replay rejected', 'heartbeat-seq-replay', { keyId: env.keyId, deviceId, seq: env.seq });
      }
      const recent = Array.isArray(enrollment.lastRequestIds) ? enrollment.lastRequestIds : [];
      if (recent.includes(env.requestId)) {
        return sendError(res, 401, 'requestId replay rejected', 'heartbeat-reqid-replay', { keyId: env.keyId, deviceId });
      }

      const nowIso = new Date().toISOString();
      const fields = {
        'enrollment.seq': env.seq,
        'enrollment.lastRequestIds': [env.requestId, ...recent].slice(0, MAX_RECENT_REQUESTS),
        'enrollment.lastHeartbeatAt': nowIso,
        'enrollment.lastHardware': hardware,
        lastSeen: nowIso,
        online: true,
        updatedAt: nowIso,
      };
      for (const key of TELEMETRY_WHITELIST) {
        if (telemetry[key] !== undefined) fields[key] = telemetry[key];
      }

      try {
        await fsPatch(`/devices/${deviceId}`, fields, { updateTime: devDoc.updateTime });
        slog('heartbeat-ok', { keyId: env.keyId, deviceId, seq: env.seq });
        return res.status(200).json({ success: true, deviceId, at: nowIso, seq: env.seq });
      } catch (e) {
        if (!e.conflict) throw e;
      }
    }
    return sendError(res, 409, 'too many write conflicts', 'heartbeat-conflict', { keyId: env.keyId });
  } catch (err) {
    return sendError(res, 500, err.message || 'heartbeat failed', 'heartbeat-error', { keyId: env.keyId });
  }
}
