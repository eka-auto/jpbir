import { getConnectorMetadata, getTokenResponse } from '@vercel/connect';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const STATS_KEY = _env['STATS_' + 'KEY'];
const CONNECTOR_UID = _env['CONNECT_' + 'CONNECTOR_UID'] || 'vercel/red-marble';

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const max = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < max; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

function sendError(res, status, message, code) {
  res.status(status).json({ error: message, code });
}

export default async function handler(req, res) {
  const presented = req.query.key || req.headers['x-stats-key'] || '';
  if (!STATS_KEY || !timingSafeEqual(presented, STATS_KEY)) {
    return sendError(res, 401, 'unauthorized', 'unauthorized');
  }

  try {
    const metadata = await getConnectorMetadata(CONNECTOR_UID);
    const tokenResponse = await getTokenResponse(CONNECTOR_UID, {
      subject: { type: 'app' },
    });

    res.status(200).json({
      connector: {
        uid: metadata.uid,
        id: metadata.id,
        name: metadata.name,
        type: metadata.type,
        service: metadata.service,
        clientUrl: metadata.clientUrl || null,
      },
      token: {
        tokenId: tokenResponse.tokenId || null,
        expiresAt: tokenResponse.expiresAt,
        installationId: tokenResponse.installationId || null,
        tenantId: tokenResponse.tenantId || null,
        externalSubject: tokenResponse.externalSubject || null,
        claims: tokenResponse.claims || null,
      },
    });
  } catch (err) {
    if (err && err.name === 'ConnectorInstallationRequiredError') {
      return sendError(res, 400, 'connector installation required', 'connector-installation-required');
    }
    if (err && err.name === 'UserAuthorizationRequiredError') {
      return sendError(res, 400, 'user authorization required', 'user-authorization-required');
    }
    return sendError(res, 502, err && err.message ? err.message : 'connect failed', 'connect-error');
  }
}
