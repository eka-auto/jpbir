import { getConnectorMetadata, getTokenResponse, startAuthorization } from '@vercel/connect';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const STATS_KEY = _env['STATS_' + 'KEY'];
const CONNECTOR_UID = _env['CONNECT_' + 'CONNECTOR_UID'] || 'vercel/red-marble';
const CONNECT_CLIENT_ID = _env['CONNECT_' + 'CLIENT_ID'] || null;

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

    if (req.query.action === 'authorize') {
      const auth = await startAuthorization(CONNECTOR_UID, {
        subject: { type: 'user', id: 'admin-jayti' },
      });
      return res.status(200).json({
        connector: { uid: metadata.uid, name: metadata.name, service: metadata.service },
        authorization: { url: auth.url, request: auth.request, expiresAt: auth.expiresAt || null },
      });
    }

    let token = null;
    let tokenError = null;
    try {
      const tokenResponse = await getTokenResponse(CONNECTOR_UID, {
        subject: { type: 'app' },
      });
      token = {
        tokenId: tokenResponse.tokenId || null,
        expiresAt: tokenResponse.expiresAt,
        installationId: tokenResponse.installationId || null,
        tenantId: tokenResponse.tenantId || null,
        externalSubject: tokenResponse.externalSubject || null,
        claims: tokenResponse.claims || null,
      };
    } catch (err) {
      tokenError = { name: err && err.name, message: err && err.message, code: err && err.code };
    }

    res.status(200).json({
      connector: {
        uid: metadata.uid,
        id: metadata.id,
        name: metadata.name,
        type: metadata.type,
        service: metadata.service,
        clientUrl: metadata.clientUrl || null,
        clientId: CONNECT_CLIENT_ID,
      },
      token,
      tokenError,
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
